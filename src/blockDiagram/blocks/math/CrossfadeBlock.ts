/**
 * Crossfade Block
 * 
 * Crossfades between two audio inputs with optional control input for fade amount.
 * Each input has an independent gain control.
 * 
 * Based on SpinCAD crossfadeCADBlock
 * 
 * Translation Notes:
 * - gain1/gain2 parameters with dB to linear conversion
 * - Optional fade control input modulates the mix using MULX
 * - Complex conditional logic based on which inputs are connected
 * - Formula: output = (input1 * -gain1 + input2 * gain2) * fade + input1 * gain1
 */

import { BaseBlock } from '../base/BaseBlock.js';
import { CodeGenContext } from '../../types/Block.js';

export class CrossfadeBlock extends BaseBlock {
    readonly type = 'math.crossfade';
    readonly category = 'Math';
    readonly name = 'Crossfade';
    readonly description = 'Crossfade between two audio inputs with independent gain controls';
    readonly color = '#2468f2';
    readonly width = 180;

    constructor() {
        super();

        this._inputs = [
            { id: 'input1', name: 'Input 1', type: 'audio' },
            { id: 'input2', name: 'Input 2', type: 'audio' },
            { id: 'fade', name: 'Fade', type: 'control' }
        ];

        this._outputs = [
            { id: 'output', name: 'Audio Output', type: 'audio' }
        ];

        this._parameters = [
            {
                id: 'gain1',
                name: 'Input 1 Gain',
                type: 'number',
                default: BaseBlock.dbToLinear(-6),
                min: BaseBlock.dbToLinear(-12),
                max: BaseBlock.dbToLinear(0),
                displayMin: -12,
                displayMax: 0,
                displayUnit: 'dB',
                toDisplay: (linear: number) => BaseBlock.linearToDb(linear),
                fromDisplay: (db: number) => BaseBlock.dbToLinear(db),
                description: 'Gain for Input 1'
            },
            {
                id: 'gain2',
                name: 'Input 2 Gain',
                type: 'number',
                default: BaseBlock.dbToLinear(-6),
                min: BaseBlock.dbToLinear(-12),
                max: BaseBlock.dbToLinear(0),
                displayMin: -12,
                displayMax: 0,
                displayUnit: 'dB',
                toDisplay: (linear: number) => BaseBlock.linearToDb(linear),
                fromDisplay: (db: number) => BaseBlock.dbToLinear(db),
                description: 'Gain for Input 2'
            }
        ];
    }

    generateCode(ctx: CodeGenContext): void {
        const zero = this.formatS1_14(0.0);
        const input1Reg = ctx.getInputRegister(this.type, 'input1');
        const input2Reg = ctx.getInputRegister(this.type, 'input2');
        const fadeReg = ctx.getInputRegister(this.type, 'fade');
        const outputReg = ctx.allocateRegister(this.type, 'output');

        // Get gain parameters
        const gain1 = this.getParameterValue(ctx, this.type, 'gain1', BaseBlock.dbToLinear(-6)) as number;
        const gain2 = this.getParameterValue(ctx, this.type, 'gain2', BaseBlock.dbToLinear(-6)) as number;

        ctx.pushMainCode(`; ${this.name} - gain1=${BaseBlock.linearToDb(gain1).toFixed(1)}dB, gain2=${BaseBlock.linearToDb(gain2).toFixed(1)}dB`);

        // Complex conditional logic based on SpinCAD implementation
        if (input1Reg && input2Reg) {
            // Both inputs connected
            ctx.pushMainCode(`rdax ${input1Reg}, ${this.formatS1_14(-gain1)}`);
            ctx.pushMainCode(`rdax ${input2Reg}, ${this.formatS1_14(gain2)}`);
            
            if (fadeReg) {
                ctx.pushMainCode(`mulx ${fadeReg}`);
            }
            
            ctx.pushMainCode(`rdax ${input1Reg}, ${this.formatS1_14(gain1)}`);
        } else if (input1Reg) {
            // Only input 1 connected
            ctx.pushMainCode(`rdax ${input1Reg}, ${this.formatS1_14(gain1)}`);
            
            if (fadeReg) {
                ctx.pushMainCode(`mulx ${fadeReg}`);
            }
        } else if (input2Reg) {
            // Only input 2 connected
            ctx.pushMainCode(`rdax ${input2Reg}, ${this.formatS1_14(gain2)}`);
            
            if (fadeReg) {
                ctx.pushMainCode(`mulx ${fadeReg}`);
            }
        } else {
            // No inputs connected
            ctx.pushMainCode(`; Crossfade (no inputs connected)`);
            ctx.pushMainCode(`clr`);
        }

        ctx.pushMainCode(`wrax ${outputReg}, ${zero}`);
        ctx.pushMainCode('');
    }
}
