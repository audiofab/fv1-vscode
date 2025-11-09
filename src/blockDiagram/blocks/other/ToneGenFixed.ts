/**
 * Fixed Frequency Tone Generator Block
 * Sine wave generator with fixed frequency and amplitude control
 * Based on SpinASM sine wave generator program
 * 
 * Uses rotation matrix: [c'] = [cos(θ)  -sin(θ)] [c]
 *                        [s']   [sin(θ)   cos(θ)] [s]
 * For small angles: cos(θ) ≈ 1, sin(θ) ≈ θ (freq)
 * Simplified: c' = c - s*freq, s' = s + c*freq
 * Oversampled 4x to reach up to 20kHz
 */

import { BaseBlock } from '../base/BaseBlock.js';
import { CodeGenContext } from '../../types/Block.js';

export class ToneGenFixedBlock extends BaseBlock {
    readonly type = 'other.tonegen.fixed';
    readonly category = 'Utility';
    readonly name = 'Tone Generator (Fixed)';
    readonly description = 'Fixed frequency sine wave generator with amplitude control';
    readonly color = '#FF9800';
    readonly width = 180;
    
    constructor() {
        super();
        
        this._inputs = [
            { id: 'amplitude', name: 'Amplitude', type: 'control', required: false }
        ];
        
        this._outputs = [
            { id: 'out', name: 'Output', type: 'audio' }
        ];
        
        this._parameters = [
            {
                id: 'frequency',
                name: 'Frequency',
                type: 'number',
                default: 440,
                min: 20,
                max: 10000,
                step: 1,
                displayDecimals: 0,
                displayUnit: 'Hz',
                description: 'Output frequency in Hz (20-10000 Hz)'
            },
            {
                id: 'amplitude',
                name: 'Amplitude',
                type: 'number',
                default: 0.5,
                min: 0.0,
                max: 1.0,
                step: 0.01,
                displayDecimals: 2,
                description: 'Output amplitude (0-1, exponential dB control)'
            }
        ];
        
        // Auto-calculate height based on port count
        this.autoCalculateHeight();
    }
    
    /**
     * Convert frequency in Hz to the internal freq register value
     * This reverse-engineers the exponential frequency calculation
     * from the Spin Semi program to find the input value that produces
     * the desired frequency.
     * 
     * The original calculation is:
     * 1. fine: input * 0.01 - 0.005
     * 2. coarse: fine + pot0 * 0.625
     * 3. exp_input: coarse * 1.0 - 0.66
     * 4. freq = exp(exp_input)
     * 
     * For fixed frequency, we simplify by setting fine=0 and calculating
     * the required coarse value.
     */
    private hzToFreqValue(hz: number): number {
        // Sample rate for FV-1
        const sampleRate = this.getSampleRate();
        
        // The rotation matrix advances by freq radians per iteration
        // With 4x oversampling, we need: freq_radians = 2*pi*Hz / (sampleRate * 4)
        const freqRadians = (2 * Math.PI * hz) / (sampleRate * 4);
        
        // The freq register value is approximately equal to the angle in radians
        // for small angles (which is valid for this oscillator)
        return freqRadians;
    }
    
    /**
     * Display the frequency in the block label
     */
    getCustomLabel(parameters: Record<string, any>): string | null {
        const frequency = parameters['frequency'] ?? 440;
        return `${frequency} Hz`;
    }
    
    generateCode(ctx: CodeGenContext): void {
        const outputReg = ctx.allocateRegister(this.type, 'out');
        const amplitudeReg = ctx.getInputRegister(this.type, 'amplitude');
        
        // Get parameters
        const frequencyHz = this.getParameterValue(ctx, this.type, 'frequency', 440);
        const amplitude = this.getParameterValue(ctx, this.type, 'amplitude', 0.5);
        
        // Calculate the fixed frequency value
        const freqValue = this.hzToFreqValue(frequencyHz);
        
        // Allocate registers for oscillator state and amplitude filter
        const freqReg = ctx.allocateRegister(this.type, 'freq');
        const sReg = ctx.allocateRegister(this.type, 's');
        const cReg = ctx.allocateRegister(this.type, 'c');
        const p2filReg = ctx.allocateRegister(this.type, 'p2fil');
        const ampReg = ctx.allocateRegister(this.type, 'amp');
        
        const zero = ctx.getStandardConstant(0.0);
        
        ctx.pushMainCode(`; Sine Wave Generator - ${frequencyHz} Hz (fixed)`);
        
        // Initialize oscillator state and frequency on first run
        const labelInit = `tonegen_fixed_${this.sanitizeLabelForAsm(this.type)}_init`;
        ctx.pushInitCode(`; Tone Generator (Fixed) init`);
        ctx.pushInitCode(`skp run, ${labelInit}`);
        ctx.pushInitCode(`sof ${this.formatS1_14(0.0)}, ${this.formatS1_14(0.5)}`);
        ctx.pushInitCode(`wrax ${sReg}, ${zero}`);
        ctx.pushInitCode(`sof ${this.formatS1_14(0.0)}, ${this.formatS1_14(freqValue)}`);
        ctx.pushInitCode(`wrax ${freqReg}, ${zero}`);
        ctx.pushInitCode(`${labelInit}:`);
        
        // Calculate amplitude control
        ctx.pushMainCode(`; Calculate amplitude (dB/step)`);
        
        // Get amplitude control (or parameter)
        if (amplitudeReg) {
            ctx.pushMainCode(`rdax ${amplitudeReg}, ${this.formatS1_14(15.0/16.0)}`);
        } else {
            ctx.pushMainCode(`sof ${this.formatS1_14(0.0)}, ${this.formatS1_14((15.0/16.0) * amplitude)}`);
        }
        
        // Filter amplitude control
        ctx.pushMainCode(`rdfx ${p2filReg}, ${this.formatS1_14(0.01)}`);
        ctx.pushMainCode(`wrax ${p2filReg}, ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`sof ${this.formatS1_14(1.0)}, ${this.formatS1_14(-15.0/16.0)}`);
        ctx.pushMainCode(`exp ${this.formatS1_14(1.0)}, ${this.formatS1_14(0.0)}`);
        ctx.pushMainCode(`wrax ${ampReg}, ${zero}`);
        
        // Oversample the oscillator 4x (rotation matrix iteration)
        ctx.pushMainCode(`; Rotation matrix oscillator (4x oversampled)`);
        
        // Iteration 1
        ctx.pushMainCode(`rdax ${cReg}, ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`mulx ${freqReg}`);
        ctx.pushMainCode(`rdax ${sReg}, ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`wrax ${sReg}, ${this.formatS1_14(-1.0)}`);
        ctx.pushMainCode(`mulx ${freqReg}`);
        ctx.pushMainCode(`rdax ${cReg}, ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`wrax ${cReg}, ${zero}`);
        
        // Iteration 2
        ctx.pushMainCode(`rdax ${cReg}, ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`mulx ${freqReg}`);
        ctx.pushMainCode(`rdax ${sReg}, ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`wrax ${sReg}, ${this.formatS1_14(-1.0)}`);
        ctx.pushMainCode(`mulx ${freqReg}`);
        ctx.pushMainCode(`rdax ${cReg}, ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`wrax ${cReg}, ${zero}`);
        
        // Iteration 3
        ctx.pushMainCode(`rdax ${cReg}, ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`mulx ${freqReg}`);
        ctx.pushMainCode(`rdax ${sReg}, ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`wrax ${sReg}, ${this.formatS1_14(-1.0)}`);
        ctx.pushMainCode(`mulx ${freqReg}`);
        ctx.pushMainCode(`rdax ${cReg}, ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`wrax ${cReg}, ${zero}`);
        
        // Iteration 4 (final - accumulate in ACC)
        ctx.pushMainCode(`rdax ${cReg}, ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`mulx ${freqReg}`);
        ctx.pushMainCode(`rdax ${sReg}, ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`wrax ${sReg}, ${this.formatS1_14(-1.0)}`);
        ctx.pushMainCode(`mulx ${freqReg}`);
        ctx.pushMainCode(`rdax ${cReg}, ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`wrax ${cReg}, ${this.formatS1_14(1.99)}`);
        
        // Scale output by amplitude
        ctx.pushMainCode(`mulx ${ampReg}`);
        
        // Write to output
        ctx.pushMainCode(`wrax ${outputReg}, ${zero}`);
        ctx.pushMainCode('');
    }
}
