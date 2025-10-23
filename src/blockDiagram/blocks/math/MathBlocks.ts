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
        
        // Auto-calculate height based on port count
        this.autoCalculateHeight();
    }
    
    generateCode(ctx: CodeGenContext): string[] {
        const code: string[] = [];
        const inputReg = ctx.getInputRegister(this.type, 'in');
        const outputReg = ctx.allocateRegister(this.type, 'out');
        const gainCtrlReg = ctx.getInputRegister(this.type, 'gain_ctrl');
        const baseGain = this.getParameterValue(ctx, this.type, 'gain', 1.0);
        const one = ctx.getStandardConstant(1.0);
        const zero = ctx.getStandardConstant(0.0);
        
        // Check if input is already in accumulator (optimization)
        const inputForwarded = ctx.isAccumulatorForwarded(this.type, 'in');
        
        // Check if we should preserve accumulator for next block
        const preserveAcc = ctx.shouldPreserveAccumulator(this.type, 'out');
        const clearValue = preserveAcc ? one : zero;
        
        code.push('; Gain Block');
        if (gainCtrlReg) {
            code.push(`; Gain modulated by ${gainCtrlReg} (base: ${baseGain})`);
            // Read input (or skip if already in accumulator)
            if (!inputForwarded) {
                code.push(`rdax ${inputReg}, ${one}`);
            }
            code.push(`mulx ${gainCtrlReg}  ; Apply CV control`);
            // Optionally scale by base gain too if needed
            if (Math.abs(baseGain - 1.0) > 0.001) {
                const offset = ctx.getStandardConstant(baseGain - 1.0);
                code.push(`rdax ${inputReg}, ${offset}  ; Add base gain offset`);
            }
        } else {
            code.push(`; Static gain: ${baseGain}`);
            const gainConst = ctx.getStandardConstant(baseGain);
            // Read input (or skip if already in accumulator)
            if (!inputForwarded) {
                code.push(`rdax ${inputReg}, ${gainConst}`);
            } else if (Math.abs(baseGain - 1.0) > 0.001) {
                // Input already in ACC, but need to apply gain
                code.push(`sof ${gainConst}, 0`);
            }
        }
        code.push(`wrax ${outputReg}, ${clearValue}`);
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
    
    constructor() {
        super();
        
        this._inputs = [
            { id: 'in1', name: 'Input 1', type: 'audio', required: true },
            { id: 'in2', name: 'Input 2', type: 'audio', required: true },
            { id: 'gain1_ctrl', name: 'Gain 1 CV', type: 'control', required: false },
            { id: 'gain2_ctrl', name: 'Gain 2 CV', type: 'control', required: false }
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
                description: 'Base gain for input 1 (modulated by Gain 1 CV if connected)'
            },
            {
                id: 'gain2',
                name: 'Gain 2',
                type: 'number',
                default: 0.5,
                min: 0.0,
                max: 1.0,
                step: 0.01,
                description: 'Base gain for input 2 (modulated by Gain 2 CV if connected)'
            }
        ];
        
        // Auto-calculate height based on port count
        this.autoCalculateHeight();
    }
    
    generateCode(ctx: CodeGenContext): string[] {
        const code: string[] = [];
        const input1Reg = ctx.getInputRegister(this.type, 'in1');
        const input2Reg = ctx.getInputRegister(this.type, 'in2');
        const gain1CtrlReg = ctx.getInputRegister(this.type, 'gain1_ctrl');
        const gain2CtrlReg = ctx.getInputRegister(this.type, 'gain2_ctrl');
        const outputReg = ctx.allocateRegister(this.type, 'out');
        const baseGain1 = this.getParameterValue(ctx, this.type, 'gain1', 0.5);
        const baseGain2 = this.getParameterValue(ctx, this.type, 'gain2', 0.5);
        const zero = ctx.getStandardConstant(0.0);
        const one = ctx.getStandardConstant(1.0);
        
        code.push('; Mixer Block');
        
        // Handle input 1 with optional CV control
        if (gain1CtrlReg) {
            code.push(`; Input 1 with CV modulation (base: ${baseGain1})`);
            const temp1 = ctx.getScratchRegister();
            code.push(`rdax ${input1Reg}, ${one}`);
            code.push(`mulx ${gain1CtrlReg}  ; Apply CV control`);
            // Add base gain offset if needed
            if (Math.abs(baseGain1 - 1.0) > 0.001) {
                const offset = ctx.getStandardConstant(baseGain1 - 1.0);
                code.push(`rdax ${input1Reg}, ${offset}  ; Add base gain offset`);
            }
            code.push(`wrax ${temp1}, ${zero}  ; Store input 1 result`);
            
            // Handle input 2 with optional CV control
            if (gain2CtrlReg) {
                code.push(`; Input 2 with CV modulation (base: ${baseGain2})`);
                code.push(`rdax ${input2Reg}, ${one}`);
                code.push(`mulx ${gain2CtrlReg}  ; Apply CV control`);
                // Add base gain offset if needed
                if (Math.abs(baseGain2 - 1.0) > 0.001) {
                    const offset = ctx.getStandardConstant(baseGain2 - 1.0);
                    code.push(`rdax ${input2Reg}, ${offset}  ; Add base gain offset`);
                }
            } else {
                const gain2Const = ctx.getStandardConstant(baseGain2);
                code.push(`rdax ${input2Reg}, ${gain2Const}`);
            }
            code.push(`rdax ${temp1}, ${one}  ; Add input 1 result`);
        } else {
            // Input 1 uses static gain
            const gain1Const = ctx.getStandardConstant(baseGain1);
            code.push(`rdax ${input1Reg}, ${gain1Const}`);
            
            // Handle input 2 with optional CV control
            if (gain2CtrlReg) {
                code.push(`; Input 2 with CV modulation (base: ${baseGain2})`);
                const temp2 = ctx.getScratchRegister();
                code.push(`wrax ${temp2}, ${zero}  ; Store input 1 result`);
                code.push(`rdax ${input2Reg}, ${one}`);
                code.push(`mulx ${gain2CtrlReg}  ; Apply CV control`);
                // Add base gain offset if needed
                if (Math.abs(baseGain2 - 1.0) > 0.001) {
                    const offset = ctx.getStandardConstant(baseGain2 - 1.0);
                    code.push(`rdax ${input2Reg}, ${offset}  ; Add base gain offset`);
                }
                code.push(`rdax ${temp2}, ${one}  ; Add input 1 result`);
            } else {
                const gain2Const = ctx.getStandardConstant(baseGain2);
                code.push(`rdax ${input2Reg}, ${gain2Const}`);
            }
        }
        
        code.push(`wrax ${outputReg}, ${zero}`);
        code.push('');
        
        return code;
    }
}
