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
    // Constants
    static readonly DEFAULT_SAMPLE_RATE = 32768;
    static readonly MAX_DELAY_MEMORY = 32768;
    
    // =========================================================================
    // Static Conversion Functions (SpinCAD-compatible)
    // For explicit sample rate when needed, otherwise use instance methods
    // =========================================================================
    
    /**
     * DBLEVEL: Convert linear gain (0.0-1.0) to decibels
     * SpinCAD formula: 20 * log10(linear)
     * @param linear Linear gain value (0.0 to 1.0)
     * @returns Gain in decibels (dB)
     */
    static linearToDb(linear: number): number {
        if (linear <= 0) return -Infinity;
        return 20 * Math.log10(linear);
    }
    
    /**
     * DBLEVEL: Convert decibels to linear gain (0.0-1.0)
     * SpinCAD formula: 10^(dB/20)
     * @param dB Gain in decibels
     * @returns Linear gain value (0.0 to 1.0)
     */
    static dbToLinear(dB: number): number {
        return Math.pow(10.0, dB / 20.0);
    }
    
    // =========================================================================
    // Instance Properties
    // =========================================================================
    
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
     * Get custom label to display in the center of the block
     * Override this method to provide dynamic labels based on parameters
     * @param parameters Current parameter values for this block instance
     * @returns Label text to display, or null for no label
     */
    getCustomLabel?(parameters: Record<string, any>): string | null;
    
    /**
     * Generate FV-1 assembly code for this block
     * Blocks should push code to appropriate sections using ctx.pushInitCode(), 
     * ctx.pushInputCode(), ctx.pushMainCode(), or ctx.pushOutputCode()
     */
    abstract generateCode(ctx: CodeGenContext): void;
    
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
     * Convert a code value to display value for a specific parameter
     */
    getDisplayValue(parameterId: string, codeValue: number): number {
        const param = this._parameters.find(p => p.id === parameterId);
        if (!param) {
            throw new Error(`Parameter '${parameterId}' not found in block '${this.type}'`);
        }
        
        return param.toDisplay ? param.toDisplay(codeValue) : codeValue;
    }
    
    /**
     * Convert a display value to code value for a specific parameter
     */
    getCodeValue(parameterId: string, displayValue: number): number {
        const param = this._parameters.find(p => p.id === parameterId);
        if (!param) {
            throw new Error(`Parameter '${parameterId}' not found in block '${this.type}'`);
        }
        
        return param.fromDisplay ? param.fromDisplay(displayValue) : displayValue;
    }
    
    /**
     * Get metadata about this block type
     */
    getMetadata(): BlockMetadata {
        // Serialize parameters without conversion functions (they stay server-side)
        const serializedParams = this.parameters.map(param => {
            const { toDisplay, fromDisplay, ...serialized } = param;
            return serialized;
        });
        
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
            parameters: serializedParams,
            hasCustomLabel: typeof this.getCustomLabel === 'function'
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
     * Helper: Format a number as FV-1 S1.14 fixed point
     * Used by most FV-1 instructions (RDAX, SOF, MULX, etc.)
     * Range: -2.0 to 1.99993896484
     */
    protected formatS1_14(value: number): string {
        // Clamp to valid range
        value = Math.max(-2.0, Math.min(1.99993896484, value));
        
        // Format with appropriate precision
        if (value === 0) return '0.0';
        if (value === 1.0) return '1.0';
        if (value === -1.0) return '-1.0';
        if (value === -2.0) return '-2.0';
        
        return value.toFixed(8);
    }
    
    /**
     * Helper: Format a number as FV-1 S.15 fixed point
     * Used only by CHO SOF instruction
     * Range: -1.0 to 0.99996948242
     */
    protected formatS15(value: number): string {
        // Clamp to valid range
        value = Math.max(-1.0, Math.min(0.99996948242, value));
        
        // Format with appropriate precision
        if (value === 0) return '0.0';
        if (value === -1.0) return '-1.0';
        
        return value.toFixed(8);
    }
    
    /**
     * Helper: Format a number as FV-1 S.10 fixed point
     * Used by some FV-1 instructions
     * Range: -1.0 to 0.9990234375
     */
    protected formatS10(value: number): string {
        // Clamp to valid range
        value = Math.max(-1.0, Math.min(0.9990234375, value));
        
        // Format with appropriate precision
        if (value === 0) return '0.0';
        if (value === -1.0) return '-1.0';
        
        return value.toFixed(8);
    }
    
    /**
     * Helper: Format a number as FV-1 S1.9 fixed point
     * Used by some FV-1 instructions
     * Range: -2.0 to 1.998046875
     */
    protected formatS1_9(value: number): string {
        // Clamp to valid range
        value = Math.max(-2.0, Math.min(1.998046875, value));
        
        // Format with appropriate precision
        if (value === 0) return '0.0';
        if (value === 1.0) return '1.0';
        if (value === -1.0) return '-1.0';
        if (value === -2.0) return '-2.0';
        
        return value.toFixed(8);
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
     * LENGTHTOTIME: Convert samples to milliseconds (uses getSampleRate())
     * @param samples Number of delay samples
     * @returns Time in milliseconds
     */
    protected samplesToMs(samples: number): number {
        return (samples / this.getSampleRate()) * 1000;
    }
    
    /**
     * LENGTHTOTIME: Convert milliseconds to samples (uses getSampleRate())
     * @param ms Time in milliseconds
     * @returns Number of delay samples (rounded)
     */
    protected msToSamples(ms: number): number {
        return Math.round((ms / 1000) * this.getSampleRate());
    }
    
    /**
     * SINLFOFREQ: Convert LFO rate value to frequency in Hz (uses getSampleRate())
     * FV-1 AN-001 formula: f = Kf * Fs / (2^17 * 2*pi)
     * @param rate LFO rate value (0-32767, typically 0-511 for SIN LFO)
     * @returns Frequency in Hz
     */
    protected lfoRateToHz(rate: number): number {
        return rate * this.getSampleRate() / (2**17 * 2.0 * Math.PI);
    }
    
    /**
     * SINLFOFREQ: Convert frequency in Hz to LFO rate value (uses getSampleRate())
     * FV-1 AN-001 formula: Kf = 2^17 * (2*pi*f / Fs)
     * @param hz Frequency in Hz
     * @returns LFO rate value (0-32767, rounded)
     */
    protected hzToLfoRate(hz: number): number {
        return Math.round(hz * 2**17 / this.getSampleRate() * 2.0 * Math.PI);
    }
    
    /**
     * LOGFREQ: Convert frequency in Hz to filter coefficient for RDFX/WRLX/WRHX
     * Used for single-pole filters (low-pass, high-pass, shelving)
     * SpinCAD formula: coefficient = 1 - e^(-2π * frequency / sampleRate)
     * This is the one-pole exponential filter coefficient
     * @param hz Frequency in Hz
     * @returns Filter coefficient (0.0 to ~1.0)
     */
    protected hzToFilterCoeff(hz: number): number {
        const omega = 2.0 * Math.PI * hz / this.getSampleRate();
        return 1.0 - Math.pow(Math.E, -omega);
    }
    
    /**
     * LOGFREQ: Convert filter coefficient back to frequency in Hz
     * Inverse of hzToFilterCoeff
     * SpinCAD formula: frequency = -(ln(1 - coefficient)) * sampleRate / (2π)
     * @param coeff Filter coefficient (0.0 to ~1.0)
     * @returns Frequency in Hz
     */
    protected filterCoeffToHz(coeff: number): number {
        return -(Math.log(1.0 - coeff)) * this.getSampleRate() / (2.0 * Math.PI);
    }
    
    /**
     * LOGFREQ2: Convert frequency in Hz to SVF filter coefficient
     * Used for two-pole State Variable Filters
     * SpinCAD formula: coefficient = 2 * sin(π * frequency / sampleRate)
     * @param hz Frequency in Hz
     * @returns Filter coefficient (0.0 to ~2.0)
     */
    protected hzToSvfCoeff(hz: number): number {
        return 2.0 * Math.sin(Math.PI * hz / this.getSampleRate());
    }
    
    /**
     * LOGFREQ2: Convert SVF filter coefficient back to frequency in Hz
     * Inverse of hzToSvfCoeff
     * SpinCAD formula: frequency = asin(coefficient / 2) * sampleRate / π
     * @param coeff Filter coefficient (0.0 to ~2.0)
     * @returns Frequency in Hz
     */
    protected svfCoeffToHz(coeff: number): number {
        return Math.asin(coeff / 2.0) * this.getSampleRate() / Math.PI;
    }
    
    /**
     * FILTTOTIME: Convert rise time in seconds to filter coefficient
     * SpinCAD formula: freq = 0.35/time, then coefficient = 1 - e^(-2π * freq / Fs)
     * Used for envelope followers and smoothing filters
     * @param timeSeconds Rise time in seconds
     * @returns Filter coefficient (0.0 to ~1.0), or -1.0 if time is 0
     */
    protected timeToFilterCoeff(timeSeconds: number): number {
        if (timeSeconds === 0.0) {
            return -1.0;
        }
        const freq = 0.35 / timeSeconds;
        const omega = 2.0 * Math.PI * freq / this.getSampleRate();
        return 1.0 - Math.pow(Math.E, -omega);
    }
    
    /**
     * FILTTOTIME: Convert filter coefficient to rise time in seconds
     * Inverse of timeToFilterCoeff
     * SpinCAD formula: freq = -(ln(1 - coeff)) * Fs / (2π), then time = 0.35/freq
     * @param coeff Filter coefficient (0.0 to ~1.0)
     * @returns Rise time in seconds
     */
    protected filterCoeffToTime(coeff: number): number {
        const freq = -(Math.log(1.0 - coeff)) * this.getSampleRate() / (2.0 * Math.PI);
        return 0.35 / freq;
    }
    
    /**
     * Helper: Generate a unique label for this block
     */
    protected generateLabel(blockId: string, suffix: string): string {
        return `${blockId.replace(/[^a-zA-Z0-9]/g, '_')}_${suffix}`;
    }
}
