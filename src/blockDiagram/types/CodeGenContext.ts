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
        
        return allocation.register;
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
            return existing.register;
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
        
        this.registerAllocations.push({
            blockId,
            portId,
            register: registerName
        });
        
        return registerName;
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
        
        const memName = `mem_${blockId.replace(/[^a-zA-Z0-9]/g, '_')}`;
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
    }
}
