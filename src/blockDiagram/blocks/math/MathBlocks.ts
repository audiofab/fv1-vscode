/**
 * Simple gain/mixer block
 */

import { BaseBlock } from '../base/BaseBlock.js';
import { CodeGenContext } from '../../types/Block.js';

export class GainBlock extends BaseBlock {
    readonly type = 'math.gain';
    readonly category = 'Math';
    readonly name = 'Gain';
    readonly description = 'Multiply signal by gain factor';
    readonly color = '#FF9800';
    readonly width = 150;
    readonly height = 80;
    
    constructor() {
        super();
        
        this._inputs = [
            { id: 'in', name: 'Input', type: 'audio', required: true },
            { id: 'gain_ctrl', name: 'Gain CV', type: 'control', required: false }
        ];
        
        this._outputs = [
            { id: 'out', name: 'Output', type: 'audio' }
        ];
        
        this._parameters = [
            {
                id: 'gain',
                name: 'Gain',
                type: 'number',
                default: 1.0,
                min: -2.0,
                max: 2.0,
                step: 0.01,
                description: 'Gain factor (-2.0 to 2.0, modulated by Gain CV)'
            }
        ];
    }
    
    generateCode(ctx: CodeGenContext): string[] {
        const code: string[] = [];
        const inputReg = ctx.getInputRegister(this.type, 'in');
        const outputReg = ctx.allocateRegister(this.type, 'out');
        const gainCtrlReg = ctx.getInputRegister(this.type, 'gain_ctrl');
        const baseGain = this.getParameterValue(ctx, this.type, 'gain', 1.0);
        
        code.push('; Gain Block');
        if (gainCtrlReg) {
            code.push(`; Gain modulated by ${gainCtrlReg} (base: ${baseGain})`);
            // Read input, then multiply by CV control value
            code.push(`rdax ${inputReg}, 1.0`);
            code.push(`mulx ${gainCtrlReg}  ; Apply CV control`);
            // Optionally scale by base gain too if needed
            if (Math.abs(baseGain - 1.0) > 0.001) {
                code.push(`rdax ${inputReg}, ${this.formatS15(baseGain - 1.0)}  ; Add base gain offset`);
            }
        } else {
            code.push(`; Static gain: ${baseGain}`);
            code.push(`rdax ${inputReg}, ${this.formatS15(baseGain)}`);
        }
        code.push(`wrax ${outputReg}, 0.0`);
        code.push('');
        
        return code;
    }
}

/**
 * Mixer block - combine two audio signals
 */
export class MixerBlock extends BaseBlock {
    readonly type = 'math.mixer';
    readonly category = 'Math';
    readonly name = 'Mixer';
    readonly description = 'Mix two audio signals';
    readonly color = '#FF9800';
    readonly width = 150;
    readonly height = 100;
    
    constructor() {
        super();
        
        this._inputs = [
            { id: 'in1', name: 'Input 1', type: 'audio', required: true },
            { id: 'in2', name: 'Input 2', type: 'audio', required: true }
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
                description: 'Gain for input 1'
            },
            {
                id: 'gain2',
                name: 'Gain 2',
                type: 'number',
                default: 0.5,
                min: 0.0,
                max: 1.0,
                step: 0.01,
                description: 'Gain for input 2'
            }
        ];
    }
    
    generateCode(ctx: CodeGenContext): string[] {
        const code: string[] = [];
        const input1Reg = ctx.getInputRegister(this.type, 'in1');
        const input2Reg = ctx.getInputRegister(this.type, 'in2');
        const outputReg = ctx.allocateRegister(this.type, 'out');
        const gain1 = this.getParameterValue(ctx, this.type, 'gain1', 0.5);
        const gain2 = this.getParameterValue(ctx, this.type, 'gain2', 0.5);
        
        code.push('; Mixer Block');
        code.push(`rdax ${input1Reg}, ${this.formatS15(gain1)}`);
        code.push(`rdax ${input2Reg}, ${this.formatS15(gain2)}`);
        code.push(`wrax ${outputReg}, 0.0`);
        code.push('');
        
        return code;
    }
}
