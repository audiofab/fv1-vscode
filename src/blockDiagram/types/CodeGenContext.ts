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
    
    // Accumulator forwarding optimization
    // Maps "blockId:portId" to whether it should preserve accumulator (wrax reg, 1.0)
    private accumulatorForwarding: Map<string, boolean> = new Map();
    
    // FV-1 hardware limits
    private readonly MAX_REGISTERS = 32;  // REG0-REG31
    private readonly MAX_MEMORY = 32768;  // Delay memory words
    
    constructor(graph: BlockGraph) {
        this.graph = graph;
        this.analyzeAccumulatorForwarding();
    }
    
    /**
     * Set the current block being processed
     */
    setCurrentBlock(blockId: string): void {
        this.currentBlockId = blockId;
    }
    
    /**
     * Analyze graph to determine which outputs can use accumulator forwarding
     * An output can forward its accumulator value to the next block if:
     * 1. It has exactly ONE consumer (one outgoing connection)
     * 2. The consumer block processes it as its FIRST/PRIMARY input
     */
    private analyzeAccumulatorForwarding(): void {
        // For each connection, determine if accumulator forwarding is possible
        for (const connection of this.graph.connections) {
            const sourceKey = `${connection.from.blockId}:${connection.from.portId}`;
            
            // Count how many connections use this output
            const consumersOfThisOutput = this.graph.connections.filter(
                conn => conn.from.blockId === connection.from.blockId && 
                        conn.from.portId === connection.from.portId
            );
            
            // Only enable forwarding if there's exactly ONE consumer
            if (consumersOfThisOutput.length === 1) {
                // Check if this is the primary input of the consumer block
                const targetBlock = this.graph.blocks.find(b => b.id === connection.to.blockId);
                if (targetBlock) {
                    // For now, we'll enable forwarding for any single-consumer output
                    // In the future, we could add more sophisticated analysis
                    this.accumulatorForwarding.set(sourceKey, true);
                }
            }
        }
    }
    
    /**
     * Check if an output should preserve the accumulator value (use wrax reg, 1.0)
     * This is used by blocks when storing their output
     */
    shouldPreserveAccumulator(blockIdOrType: string, portId: string): boolean {
        const blockId = blockIdOrType.includes('.') ? this.currentBlockId! : blockIdOrType;
        const key = `${blockId}:${portId}`;
        return this.accumulatorForwarding.get(key) ?? false;
    }
    
    /**
     * Check if an input can skip loading from register (accumulator already has value)
     * This is used by blocks when loading their inputs
     */
    isAccumulatorForwarded(blockIdOrType: string, portId: string): boolean {
        const blockId = blockIdOrType.includes('.') ? this.currentBlockId! : blockIdOrType;
        
        // Find the connection feeding this input
        const connection = this.graph.connections.find(
            conn => conn.to.blockId === blockId && conn.to.portId === portId
        );
        
        if (!connection) {
            return false;
        }
        
        // Check if the source output is set to forward its accumulator
        const sourceKey = `${connection.from.blockId}:${connection.from.portId}`;
        return this.accumulatorForwarding.get(sourceKey) ?? false;
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
        
        // If there are multiple blocks of the same type, add a number
        const sameTypeBlocks = this.graph.blocks.filter(b => b.type === block.type);
        let suffix = '';
        if (sameTypeBlocks.length > 1) {
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
            [0.0, 'k_zero'],
            [0.5, 'k_half'],
            [1.0, 'k_one'],
            [-1.0, 'k_neg_one'],
            [2.0, 'k_two'],
            [-0.5, 'k_neg_half'],
            [0.25, 'k_quarter'],
            [0.75, 'k_three_quarters']
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
        this.nextRegister = 0;
        this.nextScratchRegister = 31;
        this.nextMemoryAddress = 0;
        this.accumulatorForwarding.clear();
        this.analyzeAccumulatorForwarding();
    }
}
