/**
 * Ring Modulator effect block
 * Ported from SpinCAD RingModCADBlock
 * 
 * Ring modulation using internal quadrature oscillator
 * Creates metallic, inharmonic timbres
 */

import { BaseBlock } from '../../base/BaseBlock.js';
import { CodeGenContext } from '../../../types/Block.js';

export class RingModulatorBlock extends BaseBlock {
    readonly type = 'fx.ringmod';
    readonly category = 'Effects';
    readonly name = 'Ring Modulator';
    readonly description = 'Ring modulation with internal oscillator';
    readonly color = '#00BCD4';  // Cyan
    readonly width = 180;
    
    constructor() {
        super();
        
        this._inputs = [
            { id: 'in', name: 'Audio Input', type: 'audio', required: true },
            { id: 'freq_ctrl', name: 'Carrier Freq', type: 'control', required: false }
        ];
        
        this._outputs = [
            { id: 'out', name: 'Output', type: 'audio' }
        ];
        
        this._parameters = [
            {
                id: 'lfo',
                name: 'Oscillator Rate',
                type: 'number',
                default: 0.02,
                min: 0.001,
                max: 1.0,
                step: 0.001,
                description: 'Internal oscillator rate (controls max freq)'
            }
        ];
        
        this.autoCalculateHeight();
    }
    
    getInitCode(ctx: CodeGenContext): string[] {
        const code: string[] = [];
        const sReg = ctx.getScratchRegister();
        const cReg = ctx.getScratchRegister();
        
        code.push(`; Ring Mod Oscillator Init`);
        code.push(`wrax ${sReg}, 0  ; Set s to 0`);
        code.push(`sof 0, -1  ; Set acc to -1`);
        code.push(`wrax ${cReg}, 0  ; Set c to -1`);
        
        return code;
    }
    
    generateCode(ctx: CodeGenContext): string[] {
        const code: string[] = [];
        const lfo = this.getParameterValue(ctx, this.type, 'lfo', 0.02);
        
        const inputReg = ctx.getInputRegister(this.type, 'in');
        const freqCtrlReg = ctx.getInputRegister(this.type, 'freq_ctrl');
        
        if (!inputReg) {
            code.push(`; Ring Modulator (no input connected)`);
            return code;
        }
        
        // Allocate registers for quadrature oscillator
        const sReg = ctx.getScratchRegister();
        const cReg = ctx.getScratchRegister();
        const outputReg = ctx.allocateRegister(this.type, 'out');
        
        code.push(`; Ring Modulator`);
        code.push(`; Quadrature oscillator (rate=${lfo})`);
        code.push('');
        
        // Generate carrier oscillator using quadrature method
        code.push(`; Quadrature Oscillator`);
        code.push(`rdax ${sReg}, ${this.formatS15(lfo)}  ; Read s register`);
        if (freqCtrlReg) {
            code.push(`mulx ${freqCtrlReg}  ; Modulate frequency`);
        }
        code.push(`rdax ${cReg}, 1.0  ; Integrate with c`);
        code.push(`wrax ${cReg}, ${this.formatS15(-lfo)}  ; Write c, keep -lfo*c`);
        if (freqCtrlReg) {
            code.push(`mulx ${freqCtrlReg}  ; Modulate frequency`);
        }
        code.push(`rdax ${sReg}, 1.0  ; Integrate with s`);
        code.push(`wrax ${sReg}, 1.0  ; Write s, keep in ACC`);
        code.push('');
        
        // Ring modulate: multiply input by oscillator
        code.push(`; Ring Modulation`);
        code.push(`mulx ${inputReg}  ; Multiply by input signal`);
        code.push(`wrax ${outputReg}, 0`);
        code.push('');
        
        return code;
    }
}
