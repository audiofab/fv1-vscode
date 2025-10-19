/**
 * Core type definitions for FV-1 block diagram programming
 */

export interface BlockPosition {
    x: number;
    y: number;
}

export interface BlockPort {
    id: string;
    name: string;
    type: 'audio' | 'control';
    required?: boolean;
}

export interface BlockParameter {
    id: string;
    name: string;
    type: 'number' | 'select' | 'boolean';
    default: any;
    min?: number;
    max?: number;
    step?: number;
    options?: Array<{ label: string; value: any }>;
    description?: string;
}

export interface BlockMetadata {
    type: string;
    category: string;
    name: string;
    description: string;
    color: string;
    icon?: string;
    width: number;
    height: number;
    inputs: BlockPort[];
    outputs: BlockPort[];
    parameters: BlockParameter[];
}

export interface Block {
    id: string;
    type: string;
    position: BlockPosition;
    parameters: Record<string, any>;
}

export interface ValidationResult {
    valid: boolean;
    error?: string;
    warnings?: string[];
}

export interface CodeGenContext {
    // Get the register assigned to a block's input port
    getInputRegister(blockId: string, portId: string): string;
    
    // Allocate a new register for a block's output
    allocateRegister(blockId: string, portId: string): string;
    
    // Free a register for reuse
    freeRegister(blockId: string, portId: string): void;
    
    // Allocate delay memory
    allocateMemory(blockId: string, size: number): { name: string; address: number; size: number };
    
    // Get parameter value
    getParameter(blockId: string, parameterId: string): any;
    
    // Resource tracking
    getUsedRegisterCount(): number;
    getUsedMemorySize(): number;
    getMemoryBlocks(): Array<{ name: string; address: number; size: number }>;
}

export interface ValidationContext {
    // Check if a block's input is connected
    hasInput(blockId: string, portId: string): boolean;
    
    // Get all inputs for a block
    getInputs(blockId: string): string[];
    
    // Get block instance
    getBlock(blockId: string): Block | undefined;
}

/**
 * Base interface that all block definitions must implement
 */
export interface IBlockDefinition {
    // Metadata
    readonly type: string;
    readonly category: string;
    readonly name: string;
    readonly description: string;
    
    // Visual properties
    readonly color: string;
    readonly icon?: string;
    readonly width: number;
    readonly height: number;
    
    // I/O definition
    readonly inputs: BlockPort[];
    readonly outputs: BlockPort[];
    
    // Parameters (knobs, switches)
    readonly parameters: BlockParameter[];
    
    /**
     * Generate FV-1 assembly code for this block
     * @param ctx Code generation context providing resource allocation
     * @returns Array of assembly code lines
     */
    generateCode(ctx: CodeGenContext): string[];
    
    /**
     * Validate this block's configuration and connections
     * @param ctx Validation context
     * @returns Validation result
     */
    validate(ctx: ValidationContext): ValidationResult;
    
    /**
     * Get metadata about this block type
     */
    getMetadata(): BlockMetadata;
}
