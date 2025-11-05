/**
 * LPF 1P - Single-pole low-pass filter using RDFX instruction
 * Converted from SpinCAD LPF_RDFX block
 */

import { BaseBlock } from '../../base/BaseBlock.js';
import { BlockParameter, CodeGenContext } from '../../../types/Block.js';

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
                name: 'Frequency (Hz)',
                type: 'number',
                default: 800,
                min: 80,
                max: 5000,
                step: 10,
                description: 'Filter cutoff frequency in Hz (80-5000 Hz)'
            }
        ];

        this.autoCalculateHeight();
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

        // Get frequency parameter and convert to coefficient
        const frequencyHz = this.getParameterValue(ctx, this.type, 'frequency', 800);
        const freqCoeff = this.hzToFilterCoeff(frequencyHz);
        
        // Check if we should preserve accumulator for next block
                                        ctx.pushMainCode(`; LPF 1P - ${frequencyHz.toFixed(0)} Hz`);

        if (freqCtrlReg) {
            // If frequency control input is connected, use manual filtering
            // This allows real-time modulation of cutoff frequency
            ctx.pushMainCode(`; Frequency modulated by control input`);
            ctx.pushMainCode(`rdax ${inputReg}, ${this.formatS1_14(freqCoeff)}`);
            ctx.pushMainCode(`rdax ${lpfReg}, ${this.formatS1_14(-freqCoeff)}`);
            ctx.pushMainCode(`mulx ${freqCtrlReg}`);
            ctx.pushMainCode(`rdax ${lpfReg}, ${this.formatS1_14(1.0)}`);
        } else {
            // Use RDFX instruction for efficient filtering
            ctx.pushMainCode(`rdax ${inputReg}, ${this.formatS1_14(1.0)}`);
            ctx.pushMainCode(`rdfx ${lpfReg}, ${this.formatS1_14(freqCoeff)}`);
        }

        ctx.pushMainCode(`wrax ${lpfReg}, 0.0`);    }
}
