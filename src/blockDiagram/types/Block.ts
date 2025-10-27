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
    // Display formatting for UI (slider shows these values)
    displayMin?: number;
    displayMax?: number;
    displayStep?: number;
    displayDecimals?: number;
    displayUnit?: string;
    // Conversion functions between display value and code value
    toDisplay?: (codeValue: number) => number;
    fromDisplay?: (displayValue: number) => number;
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
    
    // Get a scratch/temporary register for intermediate calculations
    // Scratch registers are allocated from high registers (REG31) down
    // They are automatically available again after the current block's code generation
    getScratchRegister(): string;
    
    // Reset scratch register allocation (called after each block's code generation)
    resetScratchRegisters(): void;
    
    // Accumulator forwarding optimization
    // Check if output should preserve accumulator (use wrax reg, 1.0 instead of wrax reg, 0.0)
    shouldPreserveAccumulator(blockId: string, portId: string): boolean;
    
    // Check if input value is already in accumulator (skip rdax instruction)
    isAccumulatorForwarded(blockId: string, portId: string): boolean;
    
    // Allocate delay memory
    allocateMemory(blockId: string, size: number): { name: string; address: number; size: number };
    
    // Register an EQU constant declaration
    registerEqu(name: string, value: string | number): void;
    
    // Get or create a standard constant name for common values
    getStandardConstant(value: number): string;
    
    // Check if an EQU constant has been registered
    hasEqu(name: string): boolean;
    
    // Get all registered EQU declarations
    getEquDeclarations(): Array<{ name: string; value: string }>;
    
    // Get all register aliases
    getRegisterAliases(): Array<{ alias: string; register: string }>;
    
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
     * Get EQU declarations for constants used by this block (optional)
     * @param ctx Code generation context
     * @returns Array of EQU declaration lines (e.g., "equ\tkrt\t0.5")
     */
    getEquDeclarations?(ctx: CodeGenContext): string[];
    
    /**
     * Get initialization code to run once at startup (optional)
     * This code will be placed in a SKP block
     * @param ctx Code generation context
     * @returns Array of initialization code lines
     */
    getInitCode?(ctx: CodeGenContext): string[];
    
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
    
    /**
     * Convert a code value to display value for a specific parameter
     * @param parameterId The parameter ID
     * @param codeValue The code value to convert
     * @returns The display value
     */
    getDisplayValue(parameterId: string, codeValue: number): number;
    
    /**
     * Convert a display value to code value for a specific parameter
     * @param parameterId The parameter ID
     * @param displayValue The display value to convert
     * @returns The code value
     */
    getCodeValue(parameterId: string, displayValue: number): number;
}
