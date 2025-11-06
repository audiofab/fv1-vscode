/**
 * Control Smoother Block
 * 
 * Applies a low-pass filter to a control signal to smooth out sudden changes.
 * Uses a single-pole filter (RDFX) to create smooth transitions.
 * 
 * Based on SpinCAD control_smootherCADBlock
 * 
 * Translation Notes:
 * - Uses RDFX instruction for filtering
 * - Filter coefficient: 0.00015 to 0.15 (0.51-15 Hz displayed)
 * - Useful for smoothing pot inputs or other control signals
 */

import { BaseBlock } from '../base/BaseBlock.js';
import { CodeGenContext } from '../../types/Block.js';

export class ControlSmootherBlock extends BaseBlock {
    readonly type = 'control.smoother';
    readonly category = 'Control';
    readonly name = 'Smoother';
    readonly description = 'Low-pass filter for smoothing control signals';
    readonly color = '#f2b824';

    constructor() {
        super();

        this._inputs = [
            { id: 'input', name: 'Control Input', type: 'control' }
        ];

        this._outputs = [
            { id: 'output', name: 'Control Output', type: 'control' }
        ];

        this._parameters = [
            {
                id: 'frequency',
                name: 'Frequency',
                type: 'number',
                default: 0.00015,
                min: 0.0,
                max: 1.0,
                displayMin: 0.51,
                displayMax: 15.0,
                displayUnit: 'Hz',
                toDisplay: (coeff: number) => this.filterCoeffToHz(coeff),
                fromDisplay: (hz: number) => this.hzToFilterCoeff(hz),
                description: 'Low-pass filter cutoff frequency for smoothing'
            }
        ];
        
        // Auto-calculate height based on port count
        this.autoCalculateHeight();
    }

    generateCode(ctx: CodeGenContext): void {
        const inputReg = ctx.getInputRegister(this.type, 'input');

        if (!inputReg) {
            ctx.pushMainCode(`; ${this.name} (no input connected)`);
            return;
        }

        const zero = this.formatS1_14(0.0);
        const filtReg = ctx.allocateRegister(this.type, 'filt');

        // Get filter frequency parameter
        const frequency = this.getParameterValue(ctx, this.type, 'frequency', 0.00015) as number;

        ctx.pushMainCode(`; ${this.name} - frequency=${this.filterCoeffToHz(frequency).toFixed(2)} Hz`);
        ctx.pushMainCode(`rdax ${inputReg}, ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`rdfx ${filtReg}, ${this.formatS1_14(frequency)}`);
        ctx.pushMainCode(`wrax ${filtReg}, ${zero}`);
        ctx.pushMainCode('');
    }
}
