/**
 * Crossfade 3 Block
 * 
 * Equal power crossfade using piecewise approximation for smooth transitions.
 * Uses SKP (skip) instructions to implement two different curve segments:
 * - 0.0 to 0.5: One curve segment
 * - 0.5 to 1.0: Another curve segment
 * 
 * Based on SpinCAD crossfade_3CADBlock
 * 
 * Translation Notes:
 * - Requires all three inputs connected (both audio + control)
 * - Uses SKP NEG to test if control < 0.5
 * - Different scaling factors for each range to create equal power curve
 * - More natural sounding crossfade than linear version
 * - Control @ 0.0: Input 1 at full, Input 2 at zero
 * - Control @ 0.5: Both inputs at equal power
 * - Control @ 1.0: Input 2 at full, Input 1 at zero
 * - Uses temp register to accumulate mixed signal
 */

import { BaseBlock } from '../base/BaseBlock.js';
import { CodeGenContext } from '../../types/Block.js';

export class Crossfade3Block extends BaseBlock {
    readonly type = 'math.crossfade3';
    readonly category = 'Math';
    readonly name = 'Crossfade 3';
    readonly description = 'Equal power crossfade with smooth piecewise curve (0=In1, 1=In2)';
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

        // Only generate code if all three inputs are connected
        if (!controlReg || !input1Reg || !input2Reg) {
            ctx.pushMainCode(`; ${this.name} (requires all inputs connected)`);
            return;
        }

        const outputReg = ctx.allocateRegister(this.type, 'output');
        const tempReg = ctx.allocateRegister(this.type, 'temp');

        const labelZeroFifty = `xfade3_${this.sanitizeLabelForAsm(this.type)}_zerofifty`;
        const labelWriteout = `xfade3_${this.sanitizeLabelForAsm(this.type)}_writeout`;

        ctx.pushMainCode(`; ${this.name} - equal power crossfade`);
        
        // Test if control is between 0 and 0.5
        ctx.pushMainCode(`rdax ${controlReg}, ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`sof ${this.formatS1_14(1.0)}, ${this.formatS1_14(-0.5)}`);
        ctx.pushMainCode(`skp neg, ${labelZeroFifty}`);

        // Here, controlIn is between 0.5 and 1.0
        ctx.pushMainCode(`; Control range 0.5 to 1.0`);
        ctx.pushMainCode(`rdax ${controlReg}, ${this.formatS1_14(0.586)}`);
        ctx.pushMainCode(`sof ${this.formatS1_14(1.0)}, ${this.formatS1_14(0.414)}`);
        ctx.pushMainCode(`mulx ${input2Reg}`);
        ctx.pushMainCode(`wrax ${tempReg}, ${zero}`);
        
        ctx.pushMainCode(`rdax ${controlReg}, ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`sof ${this.formatS1_14(0.707)}, ${this.formatS1_14(-0.707)}`);
        ctx.pushMainCode(`sof ${this.formatS1_14(-2.0)}, ${zero}`);
        ctx.pushMainCode(`mulx ${input1Reg}`);
        ctx.pushMainCode(`rdax ${tempReg}, ${this.formatS1_14(1.0)}`);
        ctx.pushMainCode(`skp run, ${labelWriteout}`);

        // Here, controlIn is between 0.0 and 0.5
        ctx.pushMainCode(`${labelZeroFifty}:`);
        ctx.pushMainCode(`; Control range 0.0 to 0.5`);
        ctx.pushMainCode(`clr`);
        ctx.pushMainCode(`rdax ${controlReg}, ${this.formatS1_14(1.414)}`);
        ctx.pushMainCode(`mulx ${input2Reg}`);
        ctx.pushMainCode(`wrax ${tempReg}, ${zero}`);
        
        ctx.pushMainCode(`rdax ${controlReg}, ${this.formatS1_14(-0.586)}`);
        ctx.pushMainCode(`sof ${this.formatS1_14(0.999)}, ${this.formatS1_14(0.999)}`);
        ctx.pushMainCode(`mulx ${input1Reg}`);
        ctx.pushMainCode(`rdax ${tempReg}, ${this.formatS1_14(1.0)}`);

        ctx.pushMainCode(`${labelWriteout}:`);
        ctx.pushMainCode(`wrax ${outputReg}, ${zero}`);
        ctx.pushMainCode('');
    }

    /**
     * Sanitize type identifier for use in assembly labels
     */
    private sanitizeLabelForAsm(type: string): string {
        return type.replace(/\./g, '_');
    }
}
