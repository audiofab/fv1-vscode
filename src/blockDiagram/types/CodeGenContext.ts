/**
 * Code generation context implementation
 */

import { CodeGenContext } from '../types/Block.js';
import { BlockGraph } from '../types/Graph.js';
import { Connection } from '../types/Connection.js';

interface RegisterAllocation {
    blockId: string;
    portId: string;
    register: string;
    alias: string;  // Human-readable alias for the register
}

interface MemoryAllocation {
    blockId: string;
    name: string;
    address: number;
    size: number;
}

interface EquDeclaration {
    name: string;
    value: string;
}

export class CodeGenerationContext implements CodeGenContext {
    private graph: BlockGraph;
    private registerAllocations: RegisterAllocation[] = [];
    private memoryAllocations: MemoryAllocation[] = [];
    private equDeclarations: EquDeclaration[] = [];
    private nextRegister: number = 0;  // Allocate permanent registers from REG0 upward
    private nextScratchRegister: number = 31;  // Allocate scratch registers from REG31 downward
    private nextMemoryAddress: number = 0;
    private currentBlockId: string | null = null;
    
    // Code sections
    private initCode: string[] = [];    // EQU, MEM declarations, SKP logic
    private inputCode: string[] = [];   // ADC reads, POT reads
    private mainCode: string[] = [];    // Main processing logic
    private outputCode: string[] = [];  // DAC writes
    
    // FV-1 hardware limits
    private readonly MAX_REGISTERS = 32;  // REG0-REG31
    private readonly MAX_MEMORY = 32768;  // Delay memory words
    
    constructor(graph: BlockGraph) {
        this.graph = graph;
    }
    
    /**
     * Set the current block being processed
     */
    setCurrentBlock(blockId: string): void {
        this.currentBlockId = blockId;
    }
    
    /**
     * Push code to the initialization section
     * For EQU/MEM declarations and SKP logic
     */
    pushInitCode(...lines: string[]): void {
        this.initCode.push(...lines);
    }
    
    /**
     * Push code to the input section
     * For ADC reads and POT reads
     */
    pushInputCode(...lines: string[]): void {
        this.inputCode.push(...lines);
    }
    
    /**
     * Push code to the main code section
     * For main processing logic
     */
    pushMainCode(...lines: string[]): void {
        this.mainCode.push(...lines);
    }
    
    /**
     * Push code to the output section
     * For DAC writes
     */
    pushOutputCode(...lines: string[]): void {
        this.outputCode.push(...lines);
    }
    
    /**
     * Get all code sections
     * Also generates EQU and MEM declarations at the beginning of init section
     */
    getCodeSections(): {
        init: string[];
        input: string[];
        main: string[];
        output: string[];
    } {
        const init: string[] = [];
        
        // Add EQU declarations for constants
        const equDecls = this.getEquDeclarations();
        if (equDecls.length > 0) {
            init.push('; Constants');
            for (const equ of equDecls) {
                init.push(`equ\t${equ.name}\t${equ.value}`);
            }
            init.push('');
        }
        
        // Add EQU declarations for register aliases
        const aliases = this.getRegisterAliases();
        if (aliases.length > 0) {
            init.push('; Register Aliases');
            for (const alias of aliases) {
                init.push(`equ\t${alias.alias}\t${alias.register}`);
            }
            init.push('');
        }
        
        // Add MEM declarations
        const memBlocks = this.getMemoryBlocks();
        if (memBlocks.length > 0) {
            init.push('; Memory Allocations');
            for (const mem of memBlocks) {
                init.push(`mem\t${mem.name}\t${mem.size}`);
            }
            init.push('');
        }
        
        // Add any custom init code from blocks
        if (this.initCode.length > 0) {
            init.push(...this.initCode);
        }

        return {
            init,
            input: [...this.inputCode],
            main: [...this.mainCode],
            output: [...this.outputCode]
        };
    }
    
    /**
     * Check if an output port is connected to anything
     * Used to skip generating code for unused outputs (optimization)
     */
    isOutputConnected(blockIdOrType: string, portId: string): boolean {
        // If blockIdOrType looks like a type (contains '.'), use current block ID
        const blockId = blockIdOrType.includes('.') ? this.currentBlockId! : blockIdOrType;
        
        // Check if any connection uses this output
        return this.graph.connections.some(
            conn => conn.from.blockId === blockId && conn.from.portId === portId
        );
    }
    
    /**
     * Get the register that feeds a block's input port
     * Returns null if input is not connected (for optional inputs like CV)
     */
    getInputRegister(blockIdOrType: string, portId: string): string | null {
        // If blockIdOrType looks like a type (contains '.'), use current block ID
        const blockId = blockIdOrType.includes('.') ? this.currentBlockId! : blockIdOrType;
        
        // Find the connection feeding this input
        const connection = this.graph.connections.find(
            conn => conn.to.blockId === blockId && conn.to.portId === portId
        );
        
        if (!connection) {
            // No connection - this is OK for optional inputs
            return null;
        }
        
        // Find the register allocated to the source output
        const allocation = this.registerAllocations.find(
            alloc => alloc.blockId === connection.from.blockId && 
                     alloc.portId === connection.from.portId
        );
        
        if (!allocation) {
            throw new Error(
                `No register allocated for ${connection.from.blockId}.${connection.from.portId}`
            );
        }
        
        // Return the alias (symbolic name) instead of raw register name
        return allocation.alias;
    }
    
    /**
     * Allocate a register for a block's output port
     * These are permanent registers allocated from REG0 upward
     */
    allocateRegister(blockIdOrType: string, portId: string): string {
        // If blockIdOrType looks like a type (contains '.'), use current block ID
        const blockId = blockIdOrType.includes('.') ? this.currentBlockId! : blockIdOrType;
        
        // Check if already allocated
        const existing = this.registerAllocations.find(
            alloc => alloc.blockId === blockId && alloc.portId === portId
        );
        
        if (existing) {
            return existing.alias;  // Return alias, not raw register name
        }
        
        // Check if we have room for another permanent register
        // Need to ensure we don't collide with scratch registers
        if (this.nextRegister > this.nextScratchRegister) {
            throw new Error(
                'Out of registers! Permanent registers (REG0-REG' + (this.nextRegister - 1) + 
                ') have collided with scratch registers (REG' + (this.nextScratchRegister + 1) + '-REG31).'
            );
        }
        
        const registerName = `REG${this.nextRegister}`;
        this.nextRegister++;
        
        // Generate a meaningful alias for this register
        const alias = this.generateRegisterAlias(blockId, portId);
        
        this.registerAllocations.push({
            blockId,
            portId,
            register: registerName,
            alias
        });
        
        return alias;  // Return the alias, not the raw register name
    }
    
    /**
     * Generate a meaningful alias for a register
     */
    private generateRegisterAlias(blockId: string, portId: string): string {
        // Get the block to find its type
        const block = this.graph.blocks.find(b => b.id === blockId);
        if (!block) {
            // Fallback to blockId
            return this.sanitizeIdentifier(`${blockId}_${portId}`);
        }
        
        // Create alias from block type and port
        // e.g., "input.adcl" + "out" -> "adcl_out"
        // e.g., "math.gain" + "out" -> "gain_out"
        const typeParts = block.type.split('.');
        const baseName = typeParts[typeParts.length - 1]; // Get last part (e.g., "adcl", "gain")
        
        // Special case for POT blocks: use the potNumber parameter
        let suffix = '';
        if (block.type === 'input.pot') {
            if (block.parameters && block.parameters.potNumber !== undefined && block.parameters.potNumber !== null) {
                suffix = `${block.parameters.potNumber}`;
            } else {
                // POT block without potNumber parameter - use index as fallback
                const sameTypeBlocks = this.graph.blocks.filter(b => b.type === block.type);
                const index = sameTypeBlocks.findIndex(b => b.id === blockId);
                suffix = `${index}`;
            }
        } else if (this.graph.blocks.filter(b => b.type === block.type).length > 1) {
            // If there are multiple blocks of the same type, add a number
            const sameTypeBlocks = this.graph.blocks.filter(b => b.type === block.type);
            const index = sameTypeBlocks.findIndex(b => b.id === blockId);
            suffix = `${index + 1}`;
        }
        
        return this.sanitizeIdentifier(`${baseName}${suffix}_${portId}`);
    }
    
    /**
     * Sanitize an identifier to make it valid for assembly
     */
    private sanitizeIdentifier(name: string): string {
        return name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
    }
    
    /**
     * Get a scratch/temporary register for intermediate calculations
     * Scratch registers are allocated from REG31 downward and are automatically
     * available again after the current block's code generation completes
     */
    getScratchRegister(): string {
        // Check if we have room for another scratch register
        // Need to ensure we don't collide with permanent registers
        if (this.nextScratchRegister < this.nextRegister) {
            throw new Error(
                'Out of registers! Scratch registers (REG' + (this.nextScratchRegister + 1) + '-REG31) ' +
                'have collided with permanent registers (REG0-REG' + (this.nextRegister - 1) + ').'
            );
        }
        
        const registerName = `REG${this.nextScratchRegister}`;
        this.nextScratchRegister--;
        
        return registerName;
    }
    
    /**
     * Reset scratch register allocation
     * Called after each block's code generation to make scratch registers available again
     */
    resetScratchRegisters(): void {
        this.nextScratchRegister = 31;
    }
    
    /**
     * Register an EQU constant declaration
     * For common values, use standardized names
     */
    registerEqu(name: string, value: string | number): void {
        // Check if already registered
        if (this.hasEqu(name)) {
            return; // Already registered, skip
        }
        
        const valueStr = typeof value === 'number' ? value.toString() : value;
        this.equDeclarations.push({ name, value: valueStr });
    }
    
    /**
     * Get or create a standard EQU name for a common constant value
     * Returns the EQU name to use in code
     */
    getStandardConstant(value: number): string {
        // Map of common values to standard names
        const standardConstants: Map<number, string> = new Map([
            [0.001, 'k_0_001'],
            [0.0, 'k_zero'],
            [0.5, 'k_0_5'],
            [1.0, 'k_one'],
            [-1.0, 'k_neg_one'],
            [-0.5, 'k_neg_0_5'],
            [-0.25, 'k_neg_0_25'],
            [0.25, 'k_0_25'],
            [-0.75, 'k_neg_0_75'],
            [0.75, 'k_0_75']
        ]);
        
        // Check if this is a standard constant
        const standardName = standardConstants.get(value);
        if (standardName) {
            // Register it if not already registered
            if (!this.hasEqu(standardName)) {
                this.registerEqu(standardName, value);
            }
            return standardName;
        }
        
        // For non-standard values, return the literal
        return value.toString();
    }
    
    /**
     * Check if an EQU constant has been registered
     */
    hasEqu(name: string): boolean {
        return this.equDeclarations.some(equ => equ.name === name);
    }
    
    /**
     * Get all registered EQU declarations
     */
    getEquDeclarations(): Array<{ name: string; value: string }> {
        return [...this.equDeclarations];
    }
    
    /**
     * Get all register aliases for EQU declarations
     */
    getRegisterAliases(): Array<{ alias: string; register: string }> {
        return this.registerAllocations.map(alloc => ({
            alias: alloc.alias,
            register: alloc.register
        }));
    }
    
    /**
     * Allocate delay memory for a block
     */
    allocateMemory(blockIdOrType: string, size: number): { name: string; address: number; size: number } {
        // If blockIdOrType looks like a type (contains '.'), use current block ID
        const blockId = blockIdOrType.includes('.') ? this.currentBlockId! : blockIdOrType;
        
        // Check if already allocated
        const existing = this.memoryAllocations.find(
            alloc => alloc.blockId === blockId
        );
        
        if (existing) {
            return existing;
        }
        
        // Check if enough memory available
        if (this.nextMemoryAddress + size > this.MAX_MEMORY) {
            throw new Error(
                `Out of delay memory! Requested ${size} words, ` +
                `but only ${this.MAX_MEMORY - this.nextMemoryAddress} available.`
            );
        }
        
        // Generate a short, unique memory name based on block type
        // Follow same pattern as register aliases: use block type name + instance number
        const block = this.graph.blocks.find(b => b.id === blockId);
        let memName: string;
        
        if (block) {
            // Extract base name from block type (e.g., "effects.delay" -> "delay")
            const typeParts = block.type.split('.');
            const baseName = typeParts[typeParts.length - 1];
            
            // If there are multiple blocks of the same type, add instance number
            const sameTypeBlocks = this.graph.blocks.filter(b => b.type === block.type);
            let suffix = '';
            if (sameTypeBlocks.length > 1) {
                const index = sameTypeBlocks.findIndex(b => b.id === blockId);
                suffix = `${index + 1}`;
            }
            
            memName = this.sanitizeIdentifier(`${baseName}${suffix}_mem`);
        } else {
            // Fallback to generic name with counter
            memName = `mem${this.memoryAllocations.length}`;
        }
        
        // Ensure name doesn't exceed 32 characters (FV-1 limit)
        if (memName.length > 32) {
            memName = memName.substring(0, 32);
        }
        
        const allocation = {
            blockId,
            name: memName,
            address: this.nextMemoryAddress,
            size
        };
        
        this.memoryAllocations.push(allocation);
        this.nextMemoryAddress += size;
        
        return allocation;
    }
    
    /**
     * Get a parameter value from a block
     */
    getParameter(blockIdOrType: string, parameterId: string): any {
        // If blockIdOrType looks like a type (contains '.'), use current block ID
        const blockId = blockIdOrType.includes('.') ? this.currentBlockId! : blockIdOrType;
        
        const block = this.graph.blocks.find(b => b.id === blockId);
        if (!block) {
            throw new Error(`Block ${blockId} not found`);
        }
        
        return block.parameters[parameterId];
    }
    
    /**
     * Get count of used registers
     */
    getUsedRegisterCount(): number {
        return this.nextRegister;
    }
    
    /**
     * Get total used memory size
     */
    getUsedMemorySize(): number {
        return this.nextMemoryAddress;
    }
    
    /**
     * Get all memory allocations
     */
    getMemoryBlocks(): Array<{ name: string; address: number; size: number }> {
        return this.memoryAllocations.map(alloc => ({
            name: alloc.name,
            address: alloc.address,
            size: alloc.size
        }));
    }
    
    /**
     * Reset allocations (for re-compilation)
     */
    reset(): void {
        this.registerAllocations = [];
        this.memoryAllocations = [];
        this.equDeclarations = [];
        this.initCode = [];
        this.inputCode = [];
        this.mainCode = [];
        this.outputCode = [];
        this.nextRegister = 0;
        this.nextScratchRegister = 31;
        this.nextMemoryAddress = 0;
    }
}
