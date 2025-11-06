/**
 * SVF 2P - State Variable Filter (2-pole)
 * Ported from SpinCAD's SVF2P block
 * 
 * Classic state-variable filter topology providing simultaneous lowpass, bandpass, and highpass outputs.
 * This is a 2-pole (12dB/octave) filter with resonance control.
 * 
 * Translation Notes:
 * - Frequency coefficient calculated as: fZ = sin(2π * f / Fs)
 * - Q coefficient: q1 = 1 / Q
 * - All three filter outputs (LP, BP, HP) are available simultaneously
 * - Optional frequency control input allows real-time modulation
 */

import { BaseBlock } from '../../base/BaseBlock.js';
import { CodeGenContext } from '../../../types/Block.js';

export class StateVariableFilter2PBlock extends BaseBlock {
    readonly type = 'fx.filter.svf2p';
    readonly category = 'Filter';
    readonly name = 'SVF 2P';
    readonly description = 'State-variable filter with lowpass, bandpass, and highpass outputs';
    readonly color = '#24f26f';
    readonly width = 180;

    constructor() {
        super();

        this._inputs = [
            { id: 'in', name: 'Audio Input', type: 'audio', required: true },
            { id: 'freq_ctrl', name: 'Frequency', type: 'control', required: false }
        ];

        this._outputs = [
            { id: 'lpf', name: 'Lowpass Out', type: 'audio' },
            { id: 'bpf', name: 'Bandpass Out', type: 'audio' },
            { id: 'hpf', name: 'Hipass Out', type: 'audio' }
        ];

        this._parameters = [
            {
                id: 'frequency',
                name: 'Frequency',
                type: 'number',
                default: 1000,
                min: 80,
                max: 2500,
                step: 1,
                displayDecimals: 0,
                displayUnit: 'Hz',
                description: 'Filter cutoff frequency (80-2500 Hz)'
            },
            {
                id: 'q',
                name: 'Resonance (Q)',
                type: 'number',
                default: 1,
                min: 1,
                max: 100,
                step: 1,
                displayDecimals: 0,
                description: 'Filter resonance/Q (1-100)'
            }
        ];

        this.autoCalculateHeight();
    }

    generateCode(ctx: CodeGenContext): void {
        const zero = ctx.getStandardConstant(0.0);
        const one = ctx.getStandardConstant(1.0);
        const negOne = ctx.getStandardConstant(-1.0);

        // Get input register
        const inputReg = ctx.getInputRegister(this.type, 'in');
        if (!inputReg) {
            ctx.pushMainCode(`; SVF 2P (no input connected)`);
            return;
        }

        // Get frequency control input (optional)
        const freqCtrlReg = ctx.getInputRegister(this.type, 'freq_ctrl');

        // Allocate registers for filter states and outputs
        const highPassReg = ctx.allocateRegister(this.type, 'hpf');
        const bandPassReg = ctx.allocateRegister(this.type, 'bpf');
        const lowPassReg = ctx.allocateRegister(this.type, 'lpf');

        // Get parameters
        const f0 = this.getParameterValue(ctx, this.type, 'frequency', 740);
        const q0 = this.getParameterValue(ctx, this.type, 'q', 1.0);

        // Calculate coefficients
        // fZ = sin(2π * f / Fs) where Fs = 32768 Hz
        const sampleRate = 32768;
        const fZ = Math.sin(2 * Math.PI * f0 / sampleRate);
        const q1 = 1.0 / q0;

        ctx.pushMainCode(`; SVF 2P - ${f0.toFixed(0)} Hz, Q=${q0.toFixed(2)}`);
        ctx.pushMainCode('');

        // Clear accumulator
        ctx.pushMainCode(`sof ${zero}, ${zero}`);

        // Compute highpass: input - lowpass - (bandpass * q1)
        ctx.pushMainCode(`rdax ${inputReg}, ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`rdax ${lowPassReg}, ${this.formatS1_14(-1.0)}`);
        ctx.pushMainCode(`rdax ${bandPassReg}, ${this.formatS1_14(-q1)}`);
        ctx.pushMainCode(`wrax ${highPassReg}, ${this.formatS1_14(fZ)}`);

        if (freqCtrlReg) {
            // Modulate frequency with control input
            ctx.pushMainCode(`mulx ${freqCtrlReg}`);
        }

        // Update bandpass: bandpass + (highpass * fZ)
        ctx.pushMainCode(`rdax ${bandPassReg}, ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`wrax ${bandPassReg}, ${this.formatS1_14(fZ)}`);

        if (freqCtrlReg) {
            // Modulate frequency with control input
            ctx.pushMainCode(`mulx ${freqCtrlReg}`);
        }

        // Update lowpass: lowpass + (bandpass * fZ)
        ctx.pushMainCode(`rdax ${lowPassReg}, ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`wrax ${lowPassReg}, ${zero}`);
        ctx.pushMainCode('');
    }
}
