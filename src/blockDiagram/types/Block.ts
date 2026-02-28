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
    type: 'number' | 'select' | 'boolean' | 'string';
    default: any;
    min?: number;
    max?: number;
    step?: number;
    options?: Array<{ label: string; value: any }>;
    description?: string;
    multiline?: boolean; // For string type: whether to use textarea instead of input
    // Display formatting for UI (slider shows these values)
    displayMin?: number;
    displayMax?: number;
    displayStep?: number;
    displayDecimals?: number;
    displayUnit?: string;
    // Conversion functions between display value and code value
    toDisplay?: (codeValue: number) => number;
    fromDisplay?: (displayValue: number) => number;
    conversion?: string;
    visibleIf?: string; // e.g. "filterType == 'smoother'"
}

export interface BlockMetadata {
    type: string;
    category: string;
    subcategory?: string;
    name: string;
    description: string;
    color: string;
    icon?: string;
    width: number;
    height: number;
    inputs: BlockPort[];
    outputs: BlockPort[];
    parameters: BlockParameter[];
    hasCustomLabel?: boolean;  // Indicates if this block type supports custom labels
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
    // Check if an output port is connected (optimization to skip generating unused outputs)
    isOutputConnected(blockId: string, portId: string): boolean;

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

    // Code section management
    // Blocks can push code to different sections that are assembled in order
    pushHeaderComment(...lines: string[]): void; // Header comments from sticky notes
    pushInitCode(...lines: string[]): void;      // EQU, MEM, SKP declarations
    pushInputCode(...lines: string[]): void;     // ADC reads, POT reads
    pushMainCode(...lines: string[]): void;      // Main processing logic
    pushOutputCode(...lines: string[]): void;    // DAC writes

    // Allocate delay memory
    allocateMemory(blockId: string, size: number): { name: string; address: number; size: number };

    // Register an EQU constant declaration
    registerEqu(name: string, value: string | number): string;

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

    // Get block instance
    getBlock(blockId: string): any; // Avoid circular dependency with Block interface

    // Get current block ID being processed
    getCurrentBlock(): string | null;

    // IR support
    pushIR(node: any): void; // any because of circular dependency with IR.ts
    getIR(): any[];

    // Get a short, unique identifier for a block (e.g. "b1", "b2") to avoid long UUIDs in assembly
    getShortId(blockId: string): string;

    // Local variable storage for macros
    getVariable(name: string): string | undefined;
    setVariable(name: string, value: string): void;

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
    readonly subcategory?: string;
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
     * Blocks should push code to appropriate sections using ctx.pushInitCode(), 
     * ctx.pushInputCode(), ctx.pushMainCode(), or ctx.pushOutputCode()
     * @param ctx Code generation context providing resource allocation and code sections
     */
    generateCode(ctx: CodeGenContext): void;

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

    /**
     * Get custom label text for this block instance (optional)
     * @param parameters The current parameter values
     * @returns Custom label text or null if no custom label
     */
    getCustomLabel?(parameters: Record<string, any>): string | null;
}
