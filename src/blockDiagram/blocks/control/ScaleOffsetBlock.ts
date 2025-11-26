/**
 * Scale/Offset - Control signal scaling and offset utility
 * Ported from SpinCAD's ScaleOffsetControl block
 * 
 * Maps an input range to an output range using linear scaling.
 * Formula: output = (input - inLow) * scale + outLow
 * Where: scale = (outHigh - outLow) / (inHigh - inLow)
 *        offset = outLow - (inLow * scale)
 * 
 * Translation Notes:
 * - Uses SOF (scale/offset) instruction
 * - Scale range: -2.0 to 1.99993896484
 * - Offset range: -1.0 to 1.0 (clamped to 0.999 if needed)
 * - Useful for remapping pot/control ranges
 */

import { BaseBlock } from '../base/BaseBlock.js';
import { CodeGenContext } from '../../types/Block.js';

export class ScaleOffsetBlock extends BaseBlock {
    readonly type = 'control.scale_offset';
    readonly category = 'Control';
    readonly name = 'Scale/Offset';
    readonly description = 'Scale and offset a control signal to remap input range to output range';
    readonly color = '#f2b824';  // Using a distinct color for control blocks
    readonly width = 180;

    constructor() {
        super();

        this._inputs = [
            { id: 'ctrl_in', name: 'Control', type: 'control', required: true }
        ];

        this._outputs = [
            { id: 'ctrl_out', name: 'Control', type: 'control' }
        ];

        this._parameters = [
            {
                id: 'inLow',
                name: 'Input Low',
                type: 'number',
                default: 0.0,
                min: 0.0,
                max: 1.0,
                step: 0.01,
                displayDecimals: 2,
                description: 'Minimum value of input range (0.0-1.0)'
            },
            {
                id: 'inHigh',
                name: 'Input High',
                type: 'number',
                default: 1.0,
                min: 0.0,
                max: 1.0,
                step: 0.01,
                displayDecimals: 2,
                description: 'Maximum value of input range (0.0-1.0)'
            },
            {
                id: 'outLow',
                name: 'Output Low',
                type: 'number',
                default: 0.0,
                min: -2.0,
                max: 1.0,
                step: 0.01,
                displayDecimals: 2,
                description: 'Minimum value of output range (-2.0 to 1.0)'
            },
            {
                id: 'outHigh',
                name: 'Output High',
                type: 'number',
                default: 0.75,
                min: -2.0,
                max: 1.0,
                step: 0.01,
                displayDecimals: 2,
                description: 'Maximum value of output range (-2.0 to 1.0)'
            }
        ];

        this.autoCalculateHeight();
    }

    generateCode(ctx: CodeGenContext): void {
        const zero = ctx.getStandardConstant(0.0);

        // Get input register
        const inputReg = ctx.getInputRegister(this.type, 'ctrl_in');
        if (!inputReg) {
            ctx.pushMainCode(`; Scale/Offset (no input connected)`);
            return;
        }

        // Allocate output register
        const outputReg = ctx.allocateRegister(this.type, 'ctrl_out');

        // Get parameters
        const inLow = this.getParameterValue(ctx, this.type, 'inLow', 0.0);
        const inHigh = this.getParameterValue(ctx, this.type, 'inHigh', 1.0);
        const outLow = this.getParameterValue(ctx, this.type, 'outLow', 0.0);
        const outHigh = this.getParameterValue(ctx, this.type, 'outHigh', 0.75);

        // Calculate scale and offset
        const scale = (outHigh - outLow) / (inHigh - inLow);
        let offset = outLow - (inLow * scale);
        
        // Clamp offset to valid range (as done in SpinCAD)
        if (offset > 0.999) {
            offset = 0.999;
        }

        // Validate ranges (same as SpinCAD's checkValuesInRange)
        if (scale < -2.0 || scale > 1.99993896484) {
            ctx.pushMainCode(`; Scale/Offset - WARNING: Scale ${scale.toFixed(3)} out of range [-2.0, 1.999]`);
        }
        if (offset < -1.0 || offset > 1.0) {
            ctx.pushMainCode(`; Scale/Offset - WARNING: Offset ${offset.toFixed(3)} out of range [-1.0, 1.0]`);
        }

        ctx.pushMainCode(`; Scale/Offset - scale=${scale.toFixed(3)}, offset=${offset.toFixed(3)}`);
        ctx.pushMainCode(`; Input range: ${inLow.toFixed(2)} to ${inHigh.toFixed(2)}`);
        ctx.pushMainCode(`; Output range: ${outLow.toFixed(2)} to ${outHigh.toFixed(2)}`);
        ctx.pushMainCode(`rdax ${inputReg}, ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`sof ${this.formatS1_14(scale)}, ${this.formatS10(offset)}`);
        ctx.pushMainCode(`wrax ${outputReg}, ${zero}`);
        ctx.pushMainCode('');
    }
}
