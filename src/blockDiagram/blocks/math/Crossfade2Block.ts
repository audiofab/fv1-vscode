/**
 * Crossfade 2 Block
 * 
 * Linear crossfade between two audio inputs using a control input.
 * Control input range 0.0 to 1.0 crossfades from Input 1 to Input 2.
 * Uses inverted scaling to create complementary gains.
 * 
 * Based on SpinCAD crossfade_2CADBlock
 * 
 * Translation Notes:
 * - Requires all three inputs connected (both audio + control)
 * - Control @ 0.0: Input 1 at full, Input 2 at zero
 * - Control @ 0.5: Both inputs at equal level
 * - Control @ 1.0: Input 2 at full, Input 1 at zero
 * - Uses temp register to hold one signal while processing the other
 * - Formula for Input 2: (controlIn * -1.0) * -2.0 = gain2
 * - Formula for Input 1: (controlIn * 1.0 - 1.0) * -2.0 = gain1
 */

import { BaseBlock } from '../base/BaseBlock.js';
import { CodeGenContext } from '../../types/Block.js';

export class Crossfade2Block extends BaseBlock {
    readonly type = 'math.crossfade2';
    readonly category = 'Math';
    readonly name = 'Crossfade 2';
    readonly description = 'Linear crossfade between two inputs using control signal (0=In1, 1=In2)';
    readonly color = '#f2f224';
    readonly width = 180;

    constructor() {
        super();

        this._inputs = [
            { id: 'input1', name: 'Audio In 1', type: 'audio' },
            { id: 'input2', name: 'Audio In 2', type: 'audio' },
            { id: 'control', name: 'Control Input', type: 'control' }
        ];

        this._outputs = [
            { id: 'output', name: 'Audio Output', type: 'audio' }
        ];

        this._parameters = [];
    }

    generateCode(ctx: CodeGenContext): void {
        const zero = this.formatS1_14(0.0);
        const input1Reg = ctx.getInputRegister(this.type, 'input1');
        const input2Reg = ctx.getInputRegister(this.type, 'input2');
        const controlReg = ctx.getInputRegister(this.type, 'control');

        // Only generate code if control input is connected
        if (!controlReg) {
            ctx.pushMainCode(`; ${this.name} (control input not connected)`);
            return;
        }

        const outputReg = ctx.allocateRegister(this.type, 'output');
        const tempReg = ctx.allocateRegister(this.type, 'temp');

        ctx.pushMainCode(`; ${this.name} - linear crossfade`);

        // Process Input 2 (if connected)
        if (input2Reg) {
            ctx.pushMainCode(`; Calculate gain for Input 2`);
            ctx.pushMainCode(`rdax ${controlReg}, ${this.formatS1_14(-1.0)}`);
            ctx.pushMainCode(`sof ${this.formatS1_14(-2.0)}, ${zero}`);
            ctx.pushMainCode(`mulx ${input2Reg}`);
            ctx.pushMainCode(`wrax ${tempReg}, ${zero}`);
        }

        // Process Input 1 (if connected)
        if (input1Reg) {
            ctx.pushMainCode(`; Calculate gain for Input 1`);
            ctx.pushMainCode(`rdax ${controlReg}, ${this.formatS1_14(1.0)}`);
            ctx.pushMainCode(`sof ${this.formatS1_14(1.0)}, ${this.formatS10(-1.0)}`);
            ctx.pushMainCode(`sof ${this.formatS1_14(-2.0)}, ${zero}`);
            ctx.pushMainCode(`mulx ${input1Reg}`);
        }

        // Mix both signals
        ctx.pushMainCode(`rdax ${tempReg}, ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`wrax ${outputReg}, ${zero}`);
        ctx.pushMainCode('');
    }
}
