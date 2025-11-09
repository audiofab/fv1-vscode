/**
 * LPF 1P - Single-pole low-pass filter using RDFX instruction
 * Ported from SpinCAD's LPF_RDFX block
 * 
 * Translation Notes:
 * - Uses RDFX + WRAX for efficient filtering when frequency is fixed
 * - Uses manual approach (RDAX + MULX) when frequency control input is connected
 */

import { BaseBlock } from '../../base/BaseBlock.js';
import { CodeGenContext } from '../../../types/Block.js';

export class LowPassFilterBlock extends BaseBlock {
    readonly type = 'fx.filter.lpf1p';
    readonly category = 'Filter';
    readonly name = 'LPF 1P';
    readonly description = 'Single-pole low-pass filter with frequency control';
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
                default: 0.15,
                min: 0.0,
                max: 1.0,
                step: 0.001,
                // Display values (Hz)
                displayMin: 80,
                displayMax: 5000,
                displayStep: 10,
                displayDecimals: 0,
                displayUnit: 'Hz',
                // Conversion functions
                toDisplay: (coeff: number) => this.filterCoeffToHz(coeff),
                fromDisplay: (hz: number) => this.hzToFilterCoeff(hz),
                description: 'Filter cutoff frequency (80-5000 Hz)'
            }
        ];

        this.autoCalculateHeight();
    }

    getCustomLabel(params: Record<string, any>): string {
        const freq = params['frequency'] ?? 0.15;
        const freqHz = this.filterCoeffToHz(freq);
        return `${Math.round(freqHz)} Hz`;
    }

    generateCode(ctx: CodeGenContext): void {
        const zero = ctx.getStandardConstant(0.0);
        const one = ctx.getStandardConstant(1.0);
        const half = ctx.getStandardConstant(0.5);
        const negOne = ctx.getStandardConstant(-1.0);

                // Get input register
        const inputReg = ctx.getInputRegister(this.type, 'in');
        if (!inputReg) {
            ctx.pushMainCode(`; LPF 1P (no input connected)`);        }

        // Get frequency control input (optional)
        const freqCtrlReg = ctx.getInputRegister(this.type, 'freq_ctrl');

        // Allocate output register (also used for filter state)
        const lpfReg = ctx.allocateRegister(this.type, 'out');

        // Get frequency parameter
        const freq = this.getParameterValue(ctx, this.type, 'frequency', 0.15);
        const freqHz = this.filterCoeffToHz(freq);
        
        ctx.pushMainCode(`; LPF 1P - ${freqHz.toFixed(0)} Hz`);

        if (freqCtrlReg) {
            // If frequency control input is connected, use manual filtering
            // This allows real-time modulation of cutoff frequency
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

        ctx.pushMainCode(`wrax ${lpfReg}, ${zero}`);
        ctx.pushMainCode('');
    }
}
