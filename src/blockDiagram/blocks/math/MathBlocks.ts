/**
 * Volume Control Block - ported from SpinCAD VolumeCADBlock_A
 * Provides volume control from -48dB to 0dB (silence to unity gain)
 * Can be modulated by a control input (e.g., POT)
 */

import { BaseBlock } from '../base/BaseBlock.js';
import { CodeGenContext } from '../../types/Block.js';

export class VolumeBlock extends BaseBlock {
    readonly type = 'math.volume';
    readonly category = 'Math';
    readonly name = 'Volume';
    readonly description = 'Volume control with optional CV modulation';
    readonly color = '#FF9800';
    readonly width = 150;
    
    constructor() {
        super();
        
        this._inputs = [
            { id: 'in', name: 'Audio Input', type: 'audio', required: true },
            { id: 'level_ctrl', name: 'Level CV', type: 'control', required: false }
        ];
        
        this._outputs = [
            { id: 'out', name: 'Output', type: 'audio' }
        ];
        
        this._parameters = [
            {
                id: 'level',
                name: 'Level (dB)',
                type: 'number',
                default: 0,
                min: -48,
                max: 0,
                step: 1,
                description: 'Volume level in dB (-48dB to 0dB)'
            }
        ];
        
        // Auto-calculate height based on port count
        this.autoCalculateHeight();
    }
    
    generateCode(ctx: CodeGenContext): string[] {
        const code: string[] = [];
        const inputReg = ctx.getInputRegister(this.type, 'in');
        const outputReg = ctx.allocateRegister(this.type, 'out');
        const levelCtrlReg = ctx.getInputRegister(this.type, 'level_ctrl');
        const levelDB = this.getParameterValue(ctx, this.type, 'level', 0);
        const one = ctx.getStandardConstant(1.0);
        const zero = ctx.getStandardConstant(0.0);
        
        // Convert dB to linear gain: gain = 10^(dB/20)
        const linearGain = Math.pow(10, levelDB / 20);
        
        // Check if input is already in accumulator (optimization)
        const inputForwarded = ctx.isAccumulatorForwarded(this.type, 'in');
        
        // Check if we should preserve accumulator for next block
        const preserveAcc = ctx.shouldPreserveAccumulator(this.type, 'out');
        const clearValue = preserveAcc ? one : zero;
        
        code.push(`; Volume Control: ${levelDB} dB (${linearGain.toFixed(4)} linear)`);
        
        if (levelCtrlReg) {
            // CV-controlled volume
            code.push(`; Volume modulated by ${levelCtrlReg}`);
            
            // Load input if not already in accumulator
            if (!inputForwarded) {
                const gainConst = ctx.getStandardConstant(linearGain);
                code.push(`rdax ${inputReg}, ${gainConst}`);
            } else if (Math.abs(linearGain - 1.0) > 0.00001) {
                // Input already in ACC, apply base level
                const gainConst = ctx.getStandardConstant(linearGain);
                code.push(`sof ${gainConst}, 0  ; Apply base level`);
            }
            
            // Multiply by control voltage
            code.push(`mulx ${levelCtrlReg}  ; Apply CV control`);
        } else {
            // Fixed volume level
            // Load input if not already in accumulator
            if (!inputForwarded) {
                const gainConst = ctx.getStandardConstant(linearGain);
                code.push(`rdax ${inputReg}, ${gainConst}`);
            } else if (Math.abs(linearGain - 1.0) > 0.00001) {
                // Input already in ACC, apply level
                const gainConst = ctx.getStandardConstant(linearGain);
                code.push(`sof ${gainConst}, 0`);
            }
            // else: input forwarded and gain=1.0, no operation needed!
        }
        
        code.push(`wrax ${outputReg}, ${clearValue}`);
        code.push('');
        
        return code;
    }
}
