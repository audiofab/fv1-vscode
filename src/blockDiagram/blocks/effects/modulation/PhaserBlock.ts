/**
 * Phaser effect block
 * Ported from SpinCAD PhaserCADBlock
 * 
 * Classic phaser effect using cascaded all-pass filters
 * Supports 1-5 stages (2, 4, 6, 8, or 10 all-pass filters)
 */

import { BaseBlock } from '../../base/BaseBlock.js';
import { CodeGenContext } from '../../../types/Block.js';

export class PhaserBlock extends BaseBlock {
    readonly type = 'fx.phaser';
    readonly category = 'Modulation';
    readonly name = 'Phaser';
    readonly description = 'Classic phaser with 2-10 all-pass stages';
    readonly color = '#00BCD4';  // Cyan like SpinCAD
    readonly width = 180;
    
    constructor() {
        super();
        
        this._inputs = [
            { id: 'in', name: 'Audio Input', type: 'audio', required: true },
            { id: 'speed_ctrl', name: 'LFO Speed', type: 'control', required: false },
            { id: 'width_ctrl', name: 'LFO Width', type: 'control', required: false },
            { id: 'phase_ctrl', name: 'Phase', type: 'control', required: false }
        ];
        
        this._outputs = [
            { id: 'mix', name: 'Mix Out', type: 'audio' },
            { id: 'wet', name: 'Wet Out', type: 'audio' }
        ];
        
        this._parameters = [
            {
                id: 'stages',
                name: 'Stages',
                type: 'number',
                default: 4,
                min: 1,
                max: 5,
                step: 1,
                description: 'Number of phaser stages (2x all-pass filters each)'
            },
            {
                id: 'speed',
                name: 'Speed',
                type: 'number',
                default: 0.5,
                min: 0.0,
                max: 1.0,
                step: 0.01,
                description: 'Default LFO speed (when not CV controlled)'
            },
            {
                id: 'width',
                name: 'Width',
                type: 'number',
                default: 0.5,
                min: 0.0,
                max: 1.0,
                step: 0.01,
                description: 'Default LFO width (when not CV controlled)'
            }
        ];
        
        this.autoCalculateHeight();
    }
    
    getInitCode(ctx: CodeGenContext): string[] {
        const code: string[] = [];
        
        code.push(`; Phaser Initialization`);
        code.push(`or ${this.formatS1_14(32767 / 32768.0)}  ; Load SIN1 frequency`);
        code.push(`wrax SIN1_RATE, 0`);
        
        return code;
    }
    
    generateCode(ctx: CodeGenContext): string[] {
        const code: string[] = [];
        const stages = Math.floor(this.getParameterValue(ctx, this.type, 'stages', 4));
        const defaultSpeed = this.getParameterValue(ctx, this.type, 'speed', 0.5);
        const defaultWidth = this.getParameterValue(ctx, this.type, 'width', 0.5);
        
        const inputReg = ctx.getInputRegister(this.type, 'in');
        const speedCtrlReg = ctx.getInputRegister(this.type, 'speed_ctrl');
        const widthCtrlReg = ctx.getInputRegister(this.type, 'width_ctrl');
        const phaseCtrlReg = ctx.getInputRegister(this.type, 'phase_ctrl');
        
        if (!inputReg) {
            code.push(`; Phaser (no input connected)`);
            return code;
        }
        
        // Allocate registers for all-pass stages
        const pout = ctx.allocateRegister(this.type, 'mix');
        const p1 = ctx.getScratchRegister();
        const p2 = ctx.getScratchRegister();
        
        let p3 = '', p4 = '', p5 = '', p6 = '', p7 = '', p8 = '', p9 = '', p10 = '';
        if (stages > 1) {
            p3 = ctx.getScratchRegister();
            p4 = ctx.getScratchRegister();
        }
        if (stages > 2) {
            p5 = ctx.getScratchRegister();
            p6 = ctx.getScratchRegister();
        }
        if (stages > 3) {
            p7 = ctx.getScratchRegister();
            p8 = ctx.getScratchRegister();
        }
        if (stages > 4) {
            p9 = ctx.getScratchRegister();
            p10 = ctx.getScratchRegister();
        }
        
        const temp = ctx.getScratchRegister();
        const temp1 = ctx.getScratchRegister();
        const wetReg = ctx.allocateRegister(this.type, 'wet');
        const bypassReg = ctx.getScratchRegister();
        const phaseReg = ctx.getScratchRegister();
        
        code.push(`; Phaser (${stages} stages = ${stages * 2} all-pass filters)`);
        code.push('');
        
        // LFO control
        code.push(`; LFO Control`);
        if (widthCtrlReg) {
            code.push(`rdax ${widthCtrlReg}, 1.0  ; Load width from CV`);
        } else {
            code.push(`sof 0.0, ${this.formatS1_14(defaultWidth)}  ; Default width`);
        }
        const depthReg = ctx.getScratchRegister();
        code.push(`wrax ${depthReg}, 0.9`);
        code.push(`wrax ${bypassReg}, 0`);
        code.push('');
        
        if (speedCtrlReg) {
            code.push(`rdax ${speedCtrlReg}, 1.0  ; Load speed from CV`);
            code.push(`mulx ${speedCtrlReg}`);
            code.push(`sof 0.83, 0.002`);
        } else {
            code.push(`sof 0.0, ${this.formatS1_14(defaultSpeed)}  ; Default speed`);
        }
        code.push(`wrax SIN1_RATE, 0`);
        code.push('');
        
        // Generate phase control value
        code.push(`; Generate phase control from LFO`);
        code.push(`cho rdal, SIN1  ; Read SIN LFO`);
        code.push(`sof 0.5, 0.5  ; Scale to 0-1`);
        code.push(`log 0.5, 0  ; Logarithmic curve`);
        code.push(`exp 1.0, 0  ; Exponential curve`);
        code.push(`sof 1.0, -0.5`);
        code.push(`sof 1.999, 0`);
        code.push(`mulx ${depthReg}  ; Apply depth`);
        code.push(`sof 0.15, 0.83  ; Scale to 0.8-0.95 range`);
        code.push(`wrax ${phaseReg}, 0`);
        code.push('');
        
        // Phase shifter cascade
        code.push(`; All-pass filter cascade`);
        code.push(`rdax ${p1}, 1.0`);
        code.push(`wrax ${temp}, 1.0`);
        code.push(`mulx ${phaseReg}`);
        code.push(`rdax ${inputReg}, ${this.formatS1_14(1.0 / 64.0)}`);
        code.push(`wrax ${p1}, -1.0`);
        code.push(`mulx ${phaseReg}`);
        
        // Stage 1 (always present)
        this.generatePhaseShiftStage(code, p2, phaseReg, temp, temp1);
        
        // Stages 2-5 (conditional)
        if (stages > 1) {
            this.generatePhaseShiftStage(code, p3, phaseReg, temp, temp1);
            this.generatePhaseShiftStage(code, p4, phaseReg, temp, temp1);
        }
        if (stages > 2) {
            this.generatePhaseShiftStage(code, p5, phaseReg, temp, temp1);
            this.generatePhaseShiftStage(code, p6, phaseReg, temp, temp1);
        }
        if (stages > 3) {
            this.generatePhaseShiftStage(code, p7, phaseReg, temp, temp1);
            this.generatePhaseShiftStage(code, p8, phaseReg, temp, temp1);
        }
        if (stages > 4) {
            this.generatePhaseShiftStage(code, p9, phaseReg, temp, temp1);
            this.generatePhaseShiftStage(code, p10, phaseReg, temp, temp1);
        }
        
        code.push(`rdax ${temp}, 1.0`);
        
        // Apply gain boost (compensate for phase shift attenuation)
        code.push(`; Boost output (6 stages of -2 gain = 64x)`);
        for (let i = 0; i < 6; i++) {
            code.push(`sof -2.0, 0`);
        }
        code.push('');
        
        code.push(`wrax ${wetReg}, 1.0  ; Save wet signal`);
        code.push(`mulx ${bypassReg}  ; Apply bypass`);
        code.push(`rdax ${inputReg}, 1.0  ; Mix with dry`);
        code.push(`wrax ${pout}, 0`);
        code.push('');
        
        return code;
    }
    
    private generatePhaseShiftStage(code: string[], delayReg: string, phaseReg: string, temp: string, temp1: string): void {
        code.push(`rdax ${temp}, 1.0`);
        code.push(`wrax ${temp1}, 0`);
        code.push(`rdax ${delayReg}, 1.0`);
        code.push(`wrax ${temp}, 1.0`);
        code.push(`mulx ${phaseReg}`);
        code.push(`rdax ${temp1}, 1.0`);
        code.push(`wrax ${delayReg}, -1.0`);
        code.push(`mulx ${phaseReg}`);
    }
}
