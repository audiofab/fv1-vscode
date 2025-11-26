/**
 * Tone Generator Block
 * Sine wave generator using rotation matrix method with 4x oversampling
 * Based on Spin Semi sine wave generator program
 * 
 * Uses rotation matrix: [c'] = [cos(θ)  -sin(θ)] [c]
 *                        [s']   [sin(θ)   cos(θ)] [s]
 * For small angles: cos(θ) ≈ 1, sin(θ) ≈ θ (freq)
 * Simplified: c' = c - s*freq, s' = s + c*freq
 * Oversampled 4x to reach up to 20kHz
 */

import { BaseBlock } from '../base/BaseBlock.js';
import { CodeGenContext } from '../../types/Block.js';

export class ToneGenAdjustableBlock extends BaseBlock {
    readonly type = 'other.tonegen';
    readonly category = 'Utility';
    readonly name = 'Tone Generator';
    readonly description = 'Sine wave generator with rotation matrix oscillator (4x oversampled) based on Spin Semi sample code';
    readonly color = '#FF9800';
    readonly width = 180;
    
    constructor() {
        super();
        
        this._inputs = [
            { id: 'coarse_freq', name: 'Coarse Freq', type: 'control', required: false },
            { id: 'fine_freq', name: 'Fine Freq', type: 'control', required: false },
            { id: 'amplitude', name: 'Amplitude', type: 'control', required: false }
        ];
        
        this._outputs = [
            { id: 'out', name: 'Output', type: 'audio' }
        ];
        
        this._parameters = [
            {
                id: 'coarseFreq',
                name: 'Coarse Frequency',
                type: 'number',
                default: 0.5,
                min: 0.0,
                max: 1.0,
                step: 0.01,
                displayDecimals: 2,
                description: 'Coarse frequency control (0-1, exponential)'
            },
            {
                id: 'fineFreq',
                name: 'Fine Frequency',
                type: 'number',
                default: 0.5,
                min: 0.0,
                max: 1.0,
                step: 0.01,
                displayDecimals: 2,
                description: 'Fine frequency control (0-1, exponential)'
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
    
    generateCode(ctx: CodeGenContext): void {
        const outputReg = ctx.allocateRegister(this.type, 'out');
        const coarseFreqReg = ctx.getInputRegister(this.type, 'coarse_freq');
        const fineFreqReg = ctx.getInputRegister(this.type, 'fine_freq');
        const amplitudeReg = ctx.getInputRegister(this.type, 'amplitude');
        
        // Get parameters
        const coarseFreq = this.getParameterValue(ctx, this.type, 'coarseFreq', 0.5);
        const fineFreq = this.getParameterValue(ctx, this.type, 'fineFreq', 0.5);
        const amplitude = this.getParameterValue(ctx, this.type, 'amplitude', 0.5);
        
        // Allocate registers for oscillator state and filters
        const freqReg = ctx.allocateRegister(this.type, 'freq');
        const sReg = ctx.allocateRegister(this.type, 's');
        const cReg = ctx.allocateRegister(this.type, 'c');
        const p0filReg = ctx.allocateRegister(this.type, 'p0fil');
        const p2filReg = ctx.allocateRegister(this.type, 'p2fil');
        const ampReg = ctx.allocateRegister(this.type, 'amp');
        
        const zero = ctx.getStandardConstant(0.0);
        
        ctx.pushMainCode(`; Sine Wave Generator (rotation matrix, 4x oversampled)`);
        
        // Initialize oscillator state on first run
        const labelInit = `tonegen_${this.sanitizeLabelForAsm(this.type)}_init`;
        ctx.pushInitCode(`; Tone Generator init`);
        ctx.pushInitCode(`skp run, ${labelInit}`);
        ctx.pushInitCode(`sof ${this.formatS1_14(0.0)}, ${this.formatS10(0.5)}`);
        ctx.pushInitCode(`wrax ${sReg}, ${zero}`);
        ctx.pushInitCode(`${labelInit}:`);
        
        // Calculate frequency control
        ctx.pushMainCode(`; Calculate frequency`);
        
        // Get fine frequency control (or parameter)
        if (fineFreqReg) {
            ctx.pushMainCode(`rdax ${fineFreqReg}, ${this.formatS1_14(1.0)}`);
        } else {
            ctx.pushMainCode(`sof ${this.formatS1_14(0.0)}, ${this.formatS10(fineFreq)}`);
        }
        
        // Scale to exponential limits: scale to 0.01, offset by -0.005
        ctx.pushMainCode(`sof ${this.formatS1_14(0.01)}, ${this.formatS10(-0.005)}`);
        
        // Add coarse frequency control (or parameter)
        if (coarseFreqReg) {
            ctx.pushMainCode(`rdax ${coarseFreqReg}, ${this.formatS1_14(0.625)}`);
        } else {
            ctx.pushMainCode(`rdax ${zero}, ${this.formatS1_14(0.625 * coarseFreq)}`);
        }
        
        // Scale and offset: sof 1, -0.66
        ctx.pushMainCode(`sof ${this.formatS1_14(1.0)}, ${this.formatS10(-0.66)}`);
        
        // Exponential conversion
        ctx.pushMainCode(`exp ${this.formatS1_14(1.0)}, ${this.formatS10(0.0)}`);
        
        // Filter the frequency control
        ctx.pushMainCode(`rdfx ${p0filReg}, ${this.formatS1_14(0.01)}`);
        ctx.pushMainCode(`wrax ${p0filReg}, ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`wrax ${freqReg}, ${zero}`);
        
        // Calculate amplitude control
        ctx.pushMainCode(`; Calculate amplitude (dB/step)`);
        
        // Get amplitude control (or parameter)
        if (amplitudeReg) {
            ctx.pushMainCode(`rdax ${amplitudeReg}, ${this.formatS1_14(15.0/16.0)}`);
        } else {
            ctx.pushMainCode(`sof ${this.formatS1_14(0.0)}, ${this.formatS10((15.0/16.0) * amplitude)}`);
        }
        
        // Filter amplitude control
        ctx.pushMainCode(`rdfx ${p2filReg}, ${this.formatS1_14(0.01)}`);
        ctx.pushMainCode(`wrax ${p2filReg}, ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`sof ${this.formatS1_14(1.0)}, ${this.formatS10(-15.0/16.0)}`);
        ctx.pushMainCode(`exp ${this.formatS1_14(1.0)}, ${this.formatS10(0.0)}`);
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
