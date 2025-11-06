/**
 * SVF 2P Adjustable - State Variable Filter (2-pole) with control inputs
 * Ported from SpinCAD's SVF_2P_adjustable block
 * 
 * Advanced state-variable filter with optional frequency and Q control inputs.
 * Provides simultaneous lowpass, bandpass, highpass, and notch (band-reject) outputs.
 * 
 * Translation Notes:
 * - Q range can be set via qMin and qMax parameters
 * - Q control input scales between qMin and qMax: scaledQ = (1/qMax - 1/qMin) * control - 1/qMin
 * - Notch output computed as: lpf + hpf
 * - When control inputs connected, uses temp registers for intermediate calculations
 */

import { BaseBlock } from '../../base/BaseBlock.js';
import { CodeGenContext } from '../../../types/Block.js';

export class StateVariableFilter2PAdjustableBlock extends BaseBlock {
    readonly type = 'fx.filter.svf2p_adj';
    readonly category = 'Filter';
    readonly name = 'SVF 2P Adjustable';
    readonly description = 'State-variable filter with control inputs and notch output';
    readonly color = '#24f26f';
    readonly width = 200;

    constructor() {
        super();

        this._inputs = [
            { id: 'in', name: 'Input', type: 'audio', required: true },
            { id: 'freq_ctrl', name: 'Frequency', type: 'control', required: false },
            { id: 'q_ctrl', name: 'Q', type: 'control', required: false }
        ];

        this._outputs = [
            { id: 'lpf', name: 'Low Pass Output', type: 'audio' },
            { id: 'bpf', name: 'Band Pass Output', type: 'audio' },
            { id: 'brf', name: 'Notch Output', type: 'audio' },
            { id: 'hpf', name: 'High Pass Output', type: 'audio' }
        ];

        this._parameters = [
            {
                id: 'frequency',
                name: 'Frequency',
                type: 'number',
                // Code values (filter coefficient)
                default: 0.15,
                min: 0.0,
                max: 1.0,
                step: 0.001,
                // Display values (Hz)
                displayMin: 20,
                displayMax: 5000,
                displayStep: 10,
                displayDecimals: 0,
                displayUnit: 'Hz',
                // Conversion functions
                toDisplay: (coeff: number) => this.filterCoeffToHz(coeff),
                fromDisplay: (hz: number) => this.hzToFilterCoeff(hz),
                description: 'Filter cutoff frequency (20-5000 Hz)'
            },
            {
                id: 'qMax',
                name: 'Max Resonance',
                type: 'number',
                default: 50,
                min: 1.0,
                max: 200.0,
                step: 1.0,
                displayDecimals: 1,
                description: 'Maximum Q value (1-200)'
            },
            {
                id: 'qMin',
                name: 'Min Resonance',
                type: 'number',
                default: 1,
                min: 1.0,
                max: 50.0,
                step: 0.1,
                displayDecimals: 1,
                description: 'Minimum Q value (1-50)'
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
            ctx.pushMainCode(`; SVF 2P Adjustable (no input connected)`);
            return;
        }

        // Get control inputs (optional)
        const freqCtrlReg = ctx.getInputRegister(this.type, 'freq_ctrl');
        const qCtrlReg = ctx.getInputRegister(this.type, 'q_ctrl');

        // Allocate registers for filter states
        const z1Reg = ctx.allocateRegister(this.type, 'bpf');  // z1 is bandpass
        const z2Reg = ctx.allocateRegister(this.type, 'z2');   // z2 is internal state
        const lpfReg = ctx.allocateRegister(this.type, 'lpf');
        const hpfReg = ctx.allocateRegister(this.type, 'hpf');

        // Get parameters
        const freq = this.getParameterValue(ctx, this.type, 'frequency', 0.15);
        const qMax = this.getParameterValue(ctx, this.type, 'qMax', 50);
        const qMin = this.getParameterValue(ctx, this.type, 'qMin', 1);

        const freqHz = this.filterCoeffToHz(freq);
        
        ctx.pushMainCode(`; SVF 2P Adjustable - ${freqHz.toFixed(0)} Hz`);
        ctx.pushMainCode('');

        // Clear accumulator
        ctx.pushMainCode(`clr`);

        // Read z1 (bandpass state) scaled by frequency coefficient
        ctx.pushMainCode(`rdax ${z1Reg}, ${this.formatS1_14(freq)}`);

        if (freqCtrlReg) {
            ctx.pushMainCode(`mulx ${freqCtrlReg}`);
        }

        ctx.pushMainCode(`rdax ${z2Reg}, ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`wrax ${lpfReg}, ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`wrax ${z2Reg}, ${this.formatS1_14(-1.0)}`);

        // Handle Q control
        if (qCtrlReg) {
            // Save intermediate result for later
            const tempReg = ctx.allocateRegister(this.type, 'temp');
            const scaledQReg = ctx.allocateRegister(this.type, 'scaledQ');

            ctx.pushMainCode(`wrax ${tempReg}, ${zero}`);

            // Calculate scaled Q coefficient
            const y = 1.0 / qMin;
            const x1 = 1.0 / qMax;
            const q = x1 - y;

            ctx.pushMainCode(`; Scale Q control input`);
            ctx.pushMainCode(`rdax ${qCtrlReg}, ${this.formatS1_14(1.0)}`);
            ctx.pushMainCode(`sof ${this.formatS1_14(-q)}, ${this.formatS1_14(-y)}`);
            ctx.pushMainCode(`wrax ${scaledQReg}, ${zero}`);

            // Apply scaled Q to z1
            ctx.pushMainCode(`rdax ${z1Reg}, ${this.formatS1_14(1.0)}`);
            ctx.pushMainCode(`mulx ${scaledQReg}`);
            ctx.pushMainCode(`rdax ${tempReg}, ${this.formatS1_14(1.0)}`);
        } else {
            // Fixed Q value
            const q = 1.0 / qMax;
            ctx.pushMainCode(`rdax ${z1Reg}, ${this.formatS1_14(-q)}`);
        }

        // Add input and compute highpass
        ctx.pushMainCode(`rdax ${inputReg}, ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`wrax ${hpfReg}, ${this.formatS1_14(freq)}`);

        if (freqCtrlReg) {
            ctx.pushMainCode(`mulx ${freqCtrlReg}`);
        }

        // Update z1 (bandpass)
        ctx.pushMainCode(`rdax ${z1Reg}, ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`wrax ${z1Reg}, ${zero}`);

        // Generate notch output if connected (lpf + hpf)
        const brfReg = ctx.allocateRegister(this.type, 'brf');
        ctx.pushMainCode(`; Notch output (LPF + HPF)`);
        ctx.pushMainCode(`rdax ${lpfReg}, ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`rdax ${hpfReg}, ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`wrax ${brfReg}, ${zero}`);
        ctx.pushMainCode('');
    }
}
