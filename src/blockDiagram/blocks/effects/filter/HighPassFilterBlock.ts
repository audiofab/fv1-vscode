/**
 * HPF 1P - Single-pole high-pass filter using RDFX instruction
 * Ported from SpinCAD's HPF_RDFX block
 * 
 * This filter works by creating a low-pass filter and subtracting it from the input,
 * resulting in a high-pass response.
 * 
 * Translation Notes:
 * - Uses RDFX + WRAX for efficient filtering when frequency is fixed
 * - Uses manual approach (RDAX + MULX) when frequency control input is connected
 * - Final output is input - lowpass = highpass
 */

import { BaseBlock } from '../../base/BaseBlock.js';
import { CodeGenContext } from '../../../types/Block.js';

export class HighPassFilterBlock extends BaseBlock {
    readonly type = 'fx.filter.hpf1p';
    readonly category = 'Filter';
    readonly name = 'HPF 1P';
    readonly description = 'Single-pole high-pass filter with frequency control';
    readonly color = '#24f26f';
    readonly width = 180;

    constructor() {
        super();

        this._inputs = [
            { id: 'in', name: 'Input', type: 'audio', required: true },
            { id: 'freq_ctrl', name: 'Frequency', type: 'control', required: false }
        ];

        this._outputs = [
            { id: 'out', name: 'Output', type: 'audio' }
        ];

        this._parameters = [
            {
                id: 'frequency',
                name: 'Frequency',
                type: 'number',
                // Code values (filter coefficient)
                default: 0.015,
                min: 0.0,
                max: 1.0,
                step: 0.001,
                // Display values (Hz)
                displayMin: 40,
                displayMax: 3500,
                displayStep: 10,
                displayDecimals: 0,
                displayUnit: 'Hz',
                // Conversion functions
                toDisplay: (coeff: number) => this.filterCoeffToHz(coeff),
                fromDisplay: (hz: number) => this.hzToFilterCoeff(hz),
                description: 'Filter cutoff frequency (40-3500 Hz)'
            }
        ];

        this.autoCalculateHeight();
    }

    getCustomLabel(params: Record<string, any>): string {
        const freq = params['frequency'] ?? 0.015;
        const freqHz = this.filterCoeffToHz(freq);
        return `${Math.round(freqHz)} Hz`;
    }

    generateCode(ctx: CodeGenContext): void {
        const zero = ctx.getStandardConstant(0.0);
        const one = ctx.getStandardConstant(1.0);
        const negOne = ctx.getStandardConstant(-1.0);

        // Get input register
        const inputReg = ctx.getInputRegister(this.type, 'in');
        if (!inputReg) {
            ctx.pushMainCode(`; HPF 1P (no input connected)`);
            return;
        }

        // Get frequency control input (optional)
        const freqCtrlReg = ctx.getInputRegister(this.type, 'freq_ctrl');

        // Allocate registers
        const outputReg = ctx.allocateRegister(this.type, 'out');
        const lpfReg = ctx.allocateRegister(this.type, 'lpf_state');

        // Get frequency parameter
        const freq = this.getParameterValue(ctx, this.type, 'frequency', 0.015);
        const freqHz = this.filterCoeffToHz(freq);
        
        ctx.pushMainCode(`; HPF 1P - ${freqHz.toFixed(0)} Hz`);

        if (freqCtrlReg) {
            // Frequency modulated by control input
            ctx.pushMainCode(`; Frequency modulated by control input`);
            ctx.pushMainCode(`rdax ${inputReg}, ${this.formatS1_14(freq)}`);
            ctx.pushMainCode(`rdax ${lpfReg}, ${this.formatS1_14(-freq)}`);
            ctx.pushMainCode(`mulx ${freqCtrlReg}`);
            ctx.pushMainCode(`rdax ${lpfReg}, ${this.formatS1_14(1.0)}`);
        } else {
            // Use RDFX instruction for efficient filtering
            ctx.pushMainCode(`rdax ${inputReg}, ${this.formatS1_14(1.0)}`);
            ctx.pushMainCode(`rdfx ${lpfReg}, ${this.formatS1_14(freq)}`);
        }

        // Write LPF state and negate (ACC now has -LPF)
        ctx.pushMainCode(`wrax ${lpfReg}, ${this.formatS1_14(-1.0)}`);
        
        // Add input to get highpass (input - lowpass = highpass)
        ctx.pushMainCode(`rdax ${inputReg}, ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`wrax ${outputReg}, ${zero}`);
        ctx.pushMainCode('');
    }
}
