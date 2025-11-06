/**
 * Shelving High-Pass Filter
 * Ported from SpinCAD's Shelving_Hipass block
 * 
 * A high-pass filter with adjustable shelf depth that allows some low-frequency content to pass through.
 * When shelf is 0 dB, it acts as a unity gain filter. When shelf is very negative (e.g., -40 dB),
 * it approaches a traditional high-pass filter response.
 * 
 * Translation Notes:
 * - Uses RDFX + WRLX for efficient shelving when shelf depth is fixed
 * - Uses manual approach (temp register + MULX) when shelf control input is connected
 * - Shelf parameter is converted from dB to linear gain (Math.pow(10, dB/20))
 */

import { BaseBlock } from '../../base/BaseBlock.js';
import { CodeGenContext } from '../../../types/Block.js';

export class ShelvingHighPassBlock extends BaseBlock {
    readonly type = 'fx.filter.shelving_hpf';
    readonly category = 'Filter';
    readonly name = 'Shelving HPF';
    readonly description = 'High-pass filter with adjustable shelf depth';
    readonly color = '#24f26f';  // From SpinCAD: 0x24f26f
    readonly width = 180;

    constructor() {
        super();

        this._inputs = [
            { id: 'in', name: 'Input', type: 'audio', required: true },
            { id: 'shelf_ctrl', name: 'Shelf', type: 'control', required: false }
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
                displayMax: 2500,
                displayStep: 10,
                displayDecimals: 0,
                displayUnit: 'Hz',
                // Conversion functions
                toDisplay: (coeff: number) => this.filterCoeffToHz(coeff),
                fromDisplay: (hz: number) => this.hzToFilterCoeff(hz),
                description: 'Filter cutoff frequency (80-2500 Hz)'
            },
            {
                id: 'shelf',
                name: 'Shelf Depth',
                type: 'number',
                // Code values (linear gain)
                default: BaseBlock.dbToLinear(-6),
                min: BaseBlock.dbToLinear(-40),
                max: BaseBlock.dbToLinear(-3),
                step: 0.001,
                // Display values (dB)
                displayMin: -40,
                displayMax: -3,
                displayStep: 0.5,
                displayDecimals: 1,
                displayUnit: 'dB',
                // Conversion functions
                toDisplay: (linear: number) => BaseBlock.linearToDb(linear),
                fromDisplay: (db: number) => BaseBlock.dbToLinear(db),
                description: 'Shelf depth in dB (-40 to -3 dB). More negative = more attenuation of low frequencies'
            }
        ];

        this.autoCalculateHeight();
    }

    generateCode(ctx: CodeGenContext): void {
        const zero = ctx.getStandardConstant(0.0);
        const one = ctx.getStandardConstant(1.0);

        // Get input register
        const inputReg = ctx.getInputRegister(this.type, 'in');
        if (!inputReg) {
            ctx.pushMainCode(`; Shelving HPF (no input connected)`);
            return;
        }

        // Get shelf control input (optional)
        const shelfCtrlReg = ctx.getInputRegister(this.type, 'shelf_ctrl');

        // Allocate registers
        const outputReg = ctx.allocateRegister(this.type, 'out');
        const hpfReg = ctx.allocateRegister(this.type, 'hpf_state');

        // Get parameters
        const freq = this.getParameterValue(ctx, this.type, 'frequency', 0.15);
        const shelf = this.getParameterValue(ctx, this.type, 'shelf', BaseBlock.dbToLinear(-6));
        
        // Calculate oneMinusShelf (used for scaling)
        const oneMinusShelf = 1.0 - shelf;
        
        const freqHz = this.filterCoeffToHz(freq);
        const shelfDb = BaseBlock.linearToDb(shelf);
        
        ctx.pushMainCode(`; Shelving HPF - ${freqHz.toFixed(0)} Hz, ${shelfDb.toFixed(1)} dB shelf`);

        // Load input
        ctx.pushMainCode(`rdax ${inputReg}, ${this.formatS1_14(1.0)}`);

        if (shelfCtrlReg) {
            // Dynamic shelf control: use temp register approach
            const tempReg = ctx.allocateRegister(this.type, 'temp');
            
            ctx.pushMainCode(`; Shelf modulated by control input`);
            ctx.pushMainCode(`wrax ${tempReg}, ${this.formatS1_14(-oneMinusShelf)}`);
            ctx.pushMainCode(`rdfx ${hpfReg}, ${this.formatS1_14(freq)}`);
            ctx.pushMainCode(`wrlx ${hpfReg}, ${this.formatS1_14(-1.0)}`);
            ctx.pushMainCode(`mulx ${shelfCtrlReg}`);
            ctx.pushMainCode(`rdax ${tempReg}, ${this.formatS1_14(1.0)}`);
        } else {
            // Fixed shelf: use efficient RDFX + WRHX approach
            ctx.pushMainCode(`rdfx ${hpfReg}, ${this.formatS1_14(freq)}`);
            ctx.pushMainCode(`wrhx ${hpfReg}, ${this.formatS1_14(-oneMinusShelf)}`);
        }

        ctx.pushMainCode(`wrax ${outputReg}, ${zero}`);
        ctx.pushMainCode('');
    }
}
