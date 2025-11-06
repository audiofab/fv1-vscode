/**
 * Power Control Block
 * 
 * Raises a control signal to a power (2-5).
 * Optional invert (before power) and flip (after power) flags.
 * 
 * Invert: input = -input + 0.999
 * Power: multiply input by itself (power-1) times using MULX
 * Flip: output = -output + 0.999
 * 
 * Based on SpinCAD PowerControlCADBlock
 */

import { BaseBlock } from '../base/BaseBlock.js';
import { CodeGenContext } from '../../types/Block.js';

export class PowerBlock extends BaseBlock {
    readonly type = 'control.power';
    readonly category = 'Control';
    readonly name = 'Power';
    readonly description = 'Raise control signal to a power with optional invert/flip';
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
                id: 'power',
                name: 'Power',
                type: 'number',
                default: 3,
                min: 1,
                max: 5,
                step: 1,
                description: 'Exponent to raise input signal to (1-5). Creates exponential curves: power=1 is linear, power=2 is quadratic (gentle curve), power=3 is cubic (moderate curve), power=4-5 creates steep curves. Higher values compress low signals more.'
            },
            {
                id: 'invert',
                name: 'Invert',
                type: 'boolean',
                default: false,
                description: 'Invert input before applying power (flips 0→1, 1→0). When enabled: output = input^power. When disabled: output = 1 - input^power. Use this to flip the curve direction.'
            },
            {
                id: 'flip',
                name: 'Flip',
                type: 'boolean',
                default: false,
                description: 'Flip output after applying power (mirrors the curve horizontally). Reverses the input axis so the curve starts at 1.0 instead of 0.0. Combine with Invert for different curve shapes.'
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
        const valueReg = ctx.allocateRegister(this.type, 'value');
        const outputReg = ctx.allocateRegister(this.type, 'output');

        // Get parameters
        const power = Math.floor(this.getParameterValue(ctx, this.type, 'power', 3));
        const invert = this.getParameterValue(ctx, this.type, 'invert', false);
        const flip = this.getParameterValue(ctx, this.type, 'flip', false);

        ctx.pushMainCode(`; ${this.name} - power=${power}, invert=${invert}, flip=${flip}`);
        ctx.pushMainCode(`rdax ${inputReg}, ${this.formatS1_14(1.0)}`);

        // Apply invert if enabled
        if (invert) {
            ctx.pushMainCode(`; ---Invert`);
            ctx.pushMainCode(`sof ${this.formatS1_14(-0.9990234375)}, ${this.formatS1_14(0.9990234375)}`);
        }

        // Store value for multiplication
        ctx.pushMainCode(`wrax ${valueReg}, ${this.formatS1_14(1.0)}`);

        // Multiply by itself (power-1) times
        for (let i = 0; i < power - 1; i++) {
            ctx.pushMainCode(`mulx ${valueReg}`);
        }

        // Apply flip if enabled
        if (flip) {
            ctx.pushMainCode(`; ---Flip`);
            ctx.pushMainCode(`sof ${this.formatS1_14(-0.9990234375)}, ${this.formatS1_14(0.9990234375)}`);
        }

        ctx.pushMainCode(`wrax ${outputReg}, ${zero}`);
        ctx.pushMainCode('');
    }
}
