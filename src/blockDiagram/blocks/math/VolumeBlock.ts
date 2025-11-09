/**
 * Volume Control Block - ported from SpinCAD VolumeCADBlock_A
 * Provides volume control from -48dB to 0dB (silence to unity gain)
 * Can be modulated by a control input (e.g., POT)
 */

import { BaseBlock } from '../base/BaseBlock.js';
import { CodeGenContext } from '../../types/Block.js';

export class VolumeBlock extends BaseBlock {
    readonly type = 'math.volume';
    readonly category = 'Utility';
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
    
    getCustomLabel(params: Record<string, any>): string {
        const levelDB = params['level'] ?? 0;
        return `${levelDB} dB`;
    }
    
    generateCode(ctx: CodeGenContext): void {
        const inputReg = ctx.getInputRegister(this.type, 'in');
        const outputReg = ctx.allocateRegister(this.type, 'out');
        const levelCtrlReg = ctx.getInputRegister(this.type, 'level_ctrl');
        const levelDB = this.getParameterValue(ctx, this.type, 'level', 0);
        
        // Convert dB to linear gain: gain = 10^(dB/20)
        const linearGain = Math.pow(10, levelDB / 20);
        const one = ctx.getStandardConstant(1.0);
        const zero = ctx.getStandardConstant(0.0);
        
        ctx.pushMainCode(`; Volume Control: ${levelDB} dB (${linearGain.toFixed(4)} linear)`);
        
        if (levelCtrlReg) {
            // CV-controlled volume
            ctx.pushMainCode(`; Volume modulated by ${levelCtrlReg}`);
            
            // Always load the audio input explicitly
            if (Math.abs(linearGain - 1.0) > 0.00001) {
                const gainConst = ctx.getStandardConstant(linearGain);
                ctx.pushMainCode(`rdax ${inputReg}, ${gainConst}  ; Load audio and apply base level`);
            } else {
                ctx.pushMainCode(`rdax ${inputReg}, ${one}  ; Load audio`);
            }
            
            // Multiply by control voltage
            ctx.pushMainCode(`mulx ${levelCtrlReg}  ; Apply CV control`);
        } else {
            // Fixed volume level
            const gainConst = ctx.getStandardConstant(linearGain);
            ctx.pushMainCode(`rdax ${inputReg}, ${gainConst}`);
        }
        
        ctx.pushMainCode(`wrax ${outputReg}, ${zero}`);
        ctx.pushMainCode('');
    }
}
