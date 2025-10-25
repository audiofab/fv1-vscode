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

/**
 * Abstract base class for block definitions
 * Provides common functionality and structure for all blocks
 * 
 * Sample Rate Configuration:
 * -------------------------
 * The FV-1 sample rate defaults to 32768 Hz, which gives a maximum delay time of 1.0 second
 * (32768 samples / 32768 Hz = 1.0s).
 * 
 * To support different sample rates, override the getSampleRate() method in your block class:
 * 
 * @example
 * ```typescript
 * class MyBlock extends BaseBlock {
 *   protected getSampleRate(): number {
 *     return 48000; // Custom sample rate
 *   }
 * }
 * ```
 * 
 * This affects:
 * - timeToSamples() / samplesToTime() conversion
 * - getMaxDelayTime() calculation (32768 samples / sample rate)
 * - All delay-based effects that allocate memory
 */
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
    private _height: number = 100;
    
    // Global FV-1 constants
    /**
     * FV-1 sample rate in Hz
     * Default: 32768 Hz (can be overridden via getSampleRate())
     */
    protected static readonly DEFAULT_SAMPLE_RATE: number = 32768;
    
    /**
     * FV-1 total delay memory size in samples
     */
    protected static readonly MAX_DELAY_MEMORY: number = 32768;
    
    // I/O definition (use protected to allow subclass initialization)
    protected _inputs: BlockPort[] = [];
    protected _outputs: BlockPort[] = [];
    
    // Parameters
    protected _parameters: BlockParameter[] = [];
    
    get inputs(): BlockPort[] { return this._inputs; }
    get outputs(): BlockPort[] { return this._outputs; }
    get parameters(): BlockParameter[] { return this._parameters; }
    
    /**
     * Get block height - automatically calculated based on port count unless overridden
     */
    get height(): number {
        return this._height;
    }
    
    /**
     * Set custom height (optional - will auto-calculate if not called)
     */
    protected setHeight(value: number): void {
        this._height = value;
    }
    
    /**
     * Auto-calculate and set height based on port count
     * Called automatically after ports are defined
     */
    protected autoCalculateHeight(): void {
        this._height = this.calculateMinHeight();
    }
    
    /**
     * Calculate the minimum height needed to fit all ports
     * Port layout: first port at y=40, then 20px spacing between ports
     * Add 20px padding at bottom
     */
    protected calculateMinHeight(): number {
        const portSpacing = 20;
        const firstPortY = 40;
        const bottomPadding = 20;
        const maxPorts = Math.max(this._inputs.length, this._outputs.length);
        
        if (maxPorts === 0) {
            return 100; // Default minimum height
        }
        
        const lastPortY = firstPortY + (maxPorts - 1) * portSpacing;
        return lastPortY + bottomPadding;
    }
    
    /**
     * Generate FV-1 assembly code for this block
     * Must be implemented by subclasses
     */
    abstract generateCode(ctx: CodeGenContext): string[];
    
    /**
     * Get EQU declarations for constants used by this block (optional)
     * Default implementation returns empty array
     */
    getEquDeclarations?(ctx: CodeGenContext): string[] {
        return [];
    }
    
    /**
     * Get initialization code to run once at startup (optional)
     * Default implementation returns empty array
     */
    getInitCode?(ctx: CodeGenContext): string[] {
        return [];
    }
    
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
     * Get the FV-1 sample rate in Hz
     * Override this method to support different sample rates
     * Default: 32768 Hz
     */
    protected getSampleRate(): number {
        return BaseBlock.DEFAULT_SAMPLE_RATE;
    }
    
    /**
     * Get the maximum delay time in seconds based on available memory and sample rate
     * FV-1 has 32768 samples of delay memory total
     * @returns Maximum delay time in seconds
     */
    protected getMaxDelayTime(): number {
        return BaseBlock.MAX_DELAY_MEMORY / this.getSampleRate();
    }
    
    /**
     * Helper: Calculate delay samples from time in seconds
     * Uses the configurable sample rate
     */
    protected timeToSamples(timeSeconds: number): number {
        return Math.floor(timeSeconds * this.getSampleRate());
    }
    
    /**
     * Helper: Calculate time in seconds from sample count
     */
    protected samplesToTime(samples: number): number {
        return samples / this.getSampleRate();
    }
    
    /**
     * Helper: Generate a unique label for this block
     */
    protected generateLabel(blockId: string, suffix: string): string {
        return `${blockId.replace(/[^a-zA-Z0-9]/g, '_')}_${suffix}`;
    }
}
