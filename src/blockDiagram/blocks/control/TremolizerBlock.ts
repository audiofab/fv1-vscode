/**
 * Tremolizer Control Block
 * 
 * Takes an LFO signal (usually 0.0 to 1.0) and allows you to adjust the width/depth
 * via a control input. Outputs an inverted control signal suitable for tremolo effects.
 * 
 * Based on SpinCAD tremolizerCADBlock
 * 
 * Translation Notes:
 * - Depth parameter controls maximum modulation amount (0.5-0.999)
 * - Optional width control input modulates the depth
 * - Final output is inverted: (input * depth * width) then SOF -0.999, 0.999
 * - Output range: inverted, suitable for amplitude modulation
 */

import { BaseBlock } from '../base/BaseBlock.js';
import { CodeGenContext } from '../../types/Block.js';

export class TremolizerBlock extends BaseBlock {
    readonly type = 'control.tremolizer';
    readonly category = 'Control';
    readonly name = 'Tremolizer';
    readonly description = 'Adjusts LFO width/depth for tremolo effects with optional width control';
    readonly color = '#f2f224';

    constructor() {
        super();

        this._inputs = [
            { id: 'lfo_input', name: 'LFO Input', type: 'control' },
            { id: 'width', name: 'LFO Width', type: 'control' }
        ];

        this._outputs = [
            { id: 'output', name: 'Control Output', type: 'control' }
        ];

        this._parameters = [
            {
                id: 'depth',
                name: 'Depth',
                type: 'number',
                default: 0.75,
                min: 0.5,
                max: 0.999,
                step: 0.001,
                displayDecimals: 2,
                description: 'Maximum modulation depth (0.5=subtle, 0.999=full tremolo effect)'
            }
        ];
        
        // Auto-calculate height based on port count
        this.autoCalculateHeight();
    }

    generateCode(ctx: CodeGenContext): void {
        const lfoInputReg = ctx.getInputRegister(this.type, 'lfo_input');

        if (!lfoInputReg) {
            ctx.pushMainCode(`; ${this.name} (no LFO input connected)`);
            return;
        }

        const zero = this.formatS1_14(0.0);
        const outputReg = ctx.allocateRegister(this.type, 'output');
        const widthReg = ctx.getInputRegister(this.type, 'width');

        // Get depth parameter
        const depth = this.getParameterValue(ctx, this.type, 'depth', 0.75) as number;

        ctx.pushMainCode(`; ${this.name} - depth=${depth.toFixed(2)}`);
        ctx.pushMainCode(`rdax ${lfoInputReg}, ${this.formatS1_14(depth)}`);

        // If width control is connected, modulate with it
        if (widthReg) {
            ctx.pushMainCode(`mulx ${widthReg}`);
        }

        // Invert the signal
        ctx.pushMainCode(`sof ${this.formatS1_14(-0.999)}, ${this.formatS1_14(0.999)}`);
        ctx.pushMainCode(`wrax ${outputReg}, ${zero}`);
        ctx.pushMainCode('');
    }
}
