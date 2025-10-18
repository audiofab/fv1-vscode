/**
 * Abstract base class for block definitions
 * Provides common functionality and structure for all blocks
 */

import { 
    IBlockDefinition, 
    BlockPort, 
    BlockParameter, 
    BlockMetadata,
    ValidationResult,
    ValidationContext,
    CodeGenContext
} from '../../types/Block.js';

export abstract class BaseBlock implements IBlockDefinition {
    // Metadata (must be set by subclasses)
    abstract readonly type: string;
    abstract readonly category: string;
    abstract readonly name: string;
    abstract readonly description: string;
    
    // Visual properties (can be overridden)
    readonly color: string = '#607D8B';
    readonly icon?: string;
    readonly width: number = 200;
    readonly height: number = 100;
    
    // I/O definition (use protected to allow subclass initialization)
    protected _inputs: BlockPort[] = [];
    protected _outputs: BlockPort[] = [];
    
    // Parameters
    protected _parameters: BlockParameter[] = [];
    
    get inputs(): BlockPort[] { return this._inputs; }
    get outputs(): BlockPort[] { return this._outputs; }
    get parameters(): BlockParameter[] { return this._parameters; }
    
    /**
     * Generate FV-1 assembly code for this block
     * Must be implemented by subclasses
     */
    abstract generateCode(ctx: CodeGenContext): string[];
    
    /**
     * Validate this block's configuration and connections
     * Default implementation checks required inputs
     */
    validate(ctx: ValidationContext): ValidationResult {
        const warnings: string[] = [];
        
        // Check required inputs
        for (const input of this.inputs) {
            if (input.required && !ctx.hasInput(ctx.getBlock(this.type)?.id || '', input.id)) {
                return {
                    valid: false,
                    error: `Required input '${input.name}' is not connected`
                };
            }
        }
        
        // Check if outputs are used (warning only)
        const block = ctx.getBlock(this.type);
        if (block && this.outputs.length > 0) {
            const connectedOutputs = ctx.getInputs(block.id);
            if (connectedOutputs.length === 0) {
                warnings.push('Block outputs are not connected to anything');
            }
        }
        
        return {
            valid: true,
            warnings: warnings.length > 0 ? warnings : undefined
        };
    }
    
    /**
     * Get metadata about this block type
     */
    getMetadata(): BlockMetadata {
        return {
            type: this.type,
            category: this.category,
            name: this.name,
            description: this.description,
            color: this.color,
            icon: this.icon,
            width: this.width,
            height: this.height,
            inputs: this.inputs,
            outputs: this.outputs,
            parameters: this.parameters
        };
    }
    
    /**
     * Helper: Get a parameter value with type safety
     */
    protected getParameterValue<T = any>(
        ctx: CodeGenContext, 
        blockId: string, 
        parameterId: string, 
        defaultValue?: T
    ): T {
        const value = ctx.getParameter(blockId, parameterId);
        return value !== undefined ? value : defaultValue as T;
    }
    
    /**
     * Helper: Format a number as FV-1 S.15 fixed point
     * Range: -1.0 to 0.99996948242 (represented as -1.0 to 1.0 in code)
     */
    protected formatS15(value: number): string {
        // Clamp to valid range
        value = Math.max(-1.0, Math.min(0.99996948242, value));
        
        // Format with appropriate precision
        if (value === 0) return '0.0';
        if (value === 1.0) return '1.0';
        if (value === -1.0) return '-1.0';
        
        return value.toFixed(6);
    }
    
    /**
     * Helper: Calculate delay samples from time in seconds
     * FV-1 runs at 32.768 kHz sample rate
     */
    protected timeToSamples(timeSeconds: number): number {
        return Math.floor(timeSeconds * 32768);
    }
    
    /**
     * Helper: Generate a unique label for this block
     */
    protected generateLabel(blockId: string, suffix: string): string {
        return `${blockId.replace(/[^a-zA-Z0-9]/g, '_')}_${suffix}`;
    }
}
