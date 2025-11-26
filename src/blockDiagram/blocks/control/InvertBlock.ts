/**
 * Invert Control Block
 * 
 * Inverts a control signal: input range 0.0 to 1.0 becomes output range 1.0 to 0.0
 * Simple formula: output = -input + 0.999
 * 
 * Based on SpinCAD InvertControlCADBlock
 */

import { BaseBlock } from '../base/BaseBlock.js';
import { CodeGenContext } from '../../types/Block.js';

export class InvertBlock extends BaseBlock {
    readonly type = 'control.invert';
    readonly category = 'Control';
    readonly name = 'Invert';
    readonly description = 'Inverts a control signal: 0.0→1.0, 1.0→0.0';
    readonly color = '#f2b824';

    constructor() {
        super();

        this._inputs = [
            { id: 'input', name: 'Input', type: 'control' }
        ];

        this._outputs = [
            { id: 'output', name: 'Output', type: 'control' }
        ];

        this._parameters = [];
        
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
        const outputReg = ctx.allocateRegister(this.type, 'output');

        ctx.pushMainCode(`; ${this.name}`);
        ctx.pushMainCode(`rdax ${inputReg}, ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`sof ${this.formatS1_14(-0.999)}, ${this.formatS10(0.999)}`);
        ctx.pushMainCode(`wrax ${outputReg}, ${zero}`);
        ctx.pushMainCode('');
    }
}
