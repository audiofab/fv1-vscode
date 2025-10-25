/**
 * 2-Input Mixer block - ported from SpinCAD
 * Mix two audio signals with independent gain control
 */

import { BaseBlock } from '../base/BaseBlock.js';
import { CodeGenContext } from '../../types/Block.js';

export class Mixer2Block extends BaseBlock {
    readonly type = 'math.mixer2';
    readonly category = 'Math';
    readonly name = 'Mixer (2→1)';
    readonly description = 'Mix two audio signals with independent gain';
    readonly color = '#FFEB3B';  // Yellow like SpinCAD
    readonly width = 170;
    
    constructor() {
        super();
        
        this._inputs = [
            { id: 'in1', name: 'Input 1', type: 'audio', required: false },
            { id: 'level1_ctrl', name: 'Level 1 CV', type: 'control', required: false },
            { id: 'in2', name: 'Input 2', type: 'audio', required: false },
            { id: 'level2_ctrl', name: 'Level 2 CV', type: 'control', required: false }
        ];
        
        this._outputs = [
            { id: 'out', name: 'Output', type: 'audio' }
        ];
        
        this._parameters = [
            {
                id: 'gain1',
                name: 'Gain 1',
                type: 'number',
                default: 0.5,
                min: 0.0,
                max: 1.0,
                step: 0.01,
                description: 'Base gain for input 1 (0.0 to 1.0)'
            },
            {
                id: 'gain2',
                name: 'Gain 2',
                type: 'number',
                default: 0.5,
                min: 0.0,
                max: 1.0,
                step: 0.01,
                description: 'Base gain for input 2 (0.0 to 1.0)'
            }
        ];
        
        // Auto-calculate height based on port count
        this.autoCalculateHeight();
    }
    
    generateCode(ctx: CodeGenContext): string[] {
        const code: string[] = [];
        const input1Reg = ctx.getInputRegister(this.type, 'in1');
        const input2Reg = ctx.getInputRegister(this.type, 'in2');
        const level1CtrlReg = ctx.getInputRegister(this.type, 'level1_ctrl');
        const level2CtrlReg = ctx.getInputRegister(this.type, 'level2_ctrl');
        const outputReg = ctx.allocateRegister(this.type, 'out');
        const gain1 = this.getParameterValue(ctx, this.type, 'gain1', 0.5);
        const gain2 = this.getParameterValue(ctx, this.type, 'gain2', 0.5);
        const zero = ctx.getStandardConstant(0.0);
        const one = ctx.getStandardConstant(1.0);
        
        // Check if we should preserve accumulator for next block
        const preserveAcc = ctx.shouldPreserveAccumulator(this.type, 'out');
        const clearValue = preserveAcc ? one : zero;
        
        code.push('; Mixer 2→1');
        
        let hasInput1 = false;
        
        // Handle input 1
        if (input1Reg) {
            const gain1Const = ctx.getStandardConstant(gain1);
            code.push(`rdax ${input1Reg}, ${gain1Const}  ; Input 1`);
            if (level1CtrlReg) {
                code.push(`mulx ${level1CtrlReg}  ; Modulate by CV`);
            }
            code.push(`wrax ${outputReg}, ${zero}  ; Store input 1`);
            hasInput1 = true;
        }
        
        // Handle input 2
        if (input2Reg) {
            const gain2Const = ctx.getStandardConstant(gain2);
            code.push(`rdax ${input2Reg}, ${gain2Const}  ; Input 2`);
            if (level2CtrlReg) {
                code.push(`mulx ${level2CtrlReg}  ; Modulate by CV`);
            }
            
            if (hasInput1) {
                // Add to previously stored input 1
                code.push(`rdax ${outputReg}, ${one}  ; Add input 1`);
            }
            code.push(`wrax ${outputReg}, ${clearValue}`);
        } else if (hasInput1 && preserveAcc) {
            // Need to update the clearValue for input 1 if no input 2
            code[code.length - 2] = `wrax ${outputReg}, ${clearValue}  ; Store input 1`;
        }
        
        if (!input1Reg && !input2Reg) {
            // No inputs connected - output silence
            code.push(`clr`);
            code.push(`wrax ${outputReg}, ${zero}`);
        }
        
        code.push('');
        
        return code;
    }
}
