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
    readonly category = 'Modulation';
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
    
    generateCode(ctx: CodeGenContext): void {
        // Initialize oscillator registers
        const sReg = ctx.getScratchRegister();
        const cReg = ctx.getScratchRegister();
        
        ctx.pushInitCode(`; Ring Mod Oscillator Init`);
        ctx.pushInitCode(`wrax ${sReg}, 0  ; Set s to 0`);
        ctx.pushInitCode(`sof 0, -1  ; Set acc to -1`);
        ctx.pushInitCode(`wrax ${cReg}, 0  ; Set c to -1`);
        
        // Generate main code
        const lfo = this.getParameterValue(ctx, this.type, 'lfo', 0.02);
        
        const inputReg = ctx.getInputRegister(this.type, 'in');
        const freqCtrlReg = ctx.getInputRegister(this.type, 'freq_ctrl');
        
        if (!inputReg) {
            ctx.pushMainCode(`; Ring Modulator (no input connected)`);
            return;
        }
        
        // Use previously allocated registers for quadrature oscillator
        const outputReg = ctx.allocateRegister(this.type, 'out');
        
        ctx.pushMainCode(`; Ring Modulator`);
        ctx.pushMainCode(`; Quadrature oscillator (rate=${lfo})`);
        ctx.pushMainCode('');
        
        // Generate carrier oscillator using quadrature method
        ctx.pushMainCode(`; Quadrature Oscillator`);
        ctx.pushMainCode(`rdax ${sReg}, ${this.formatS1_14(lfo)}  ; Read s register`);
        if (freqCtrlReg) {
            ctx.pushMainCode(`mulx ${freqCtrlReg}  ; Modulate frequency`);
        }
        ctx.pushMainCode(`rdax ${cReg}, 1.0  ; Integrate with c`);
        ctx.pushMainCode(`wrax ${cReg}, ${this.formatS1_14(-lfo)}  ; Write c, keep -lfo*c`);
        if (freqCtrlReg) {
            ctx.pushMainCode(`mulx ${freqCtrlReg}  ; Modulate frequency`);
        }
        ctx.pushMainCode(`rdax ${sReg}, 1.0  ; Integrate with s`);
        ctx.pushMainCode(`wrax ${sReg}, 1.0  ; Write s, keep in ACC`);
        ctx.pushMainCode('');
        
        // Ring modulate: multiply input by oscillator
        ctx.pushMainCode(`; Ring Modulation`);
        ctx.pushMainCode(`mulx ${inputReg}  ; Multiply by input signal`);
        ctx.pushMainCode(`wrax ${outputReg}, 0`);
        ctx.pushMainCode('');    }
}
