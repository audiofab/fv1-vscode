/**
 * 3-Input Mixer block
 * Translated from SpinCAD's Mixer_3_to_1CADBlock.java
 * Mix three audio signals with independent gain control (dB)
 */

import { BaseBlock } from '../base/BaseBlock.js';
import { CodeGenContext } from '../../types/Block.js';

export class Mixer3Block extends BaseBlock {
    readonly type = 'math.mixer3';
    readonly category = 'Utility';
    readonly name = 'Mixer 3:1';
    readonly description = 'Mix three audio signals with independent gain';
    readonly color = '#2468f2';
    readonly width = 170;
    
    constructor() {
        super();
        
        this._inputs = [
            { id: 'in1', name: 'Input 1', type: 'audio', required: false },
            { id: 'in2', name: 'Input 2', type: 'audio', required: false },
            { id: 'in3', name: 'Input 3', type: 'audio', required: false },
            { id: 'level1', name: 'Level 1', type: 'control', required: false },
            { id: 'level2', name: 'Level 2', type: 'control', required: false },
            { id: 'level3', name: 'Level 3', type: 'control', required: false }
        ];
        
        this._outputs = [
            { id: 'out', name: 'Output', type: 'audio' }
        ];
        
        this._parameters = [
            {
                id: 'gain1',
                name: 'Input Gain 1',
                type: 'number',
                default: 1.0,
                min: 0.125,
                max: 1.0,
                step: 0.01,
                displayMin: -18,
                displayMax: 0,
                displayStep: 1,
                displayDecimals: 0,
                displayUnit: 'dB',
                toDisplay: BaseBlock.linearToDb,
                fromDisplay: BaseBlock.dbToLinear,
                description: 'Input 1 gain in decibels'
            },
            {
                id: 'gain2',
                name: 'Input Gain 2',
                type: 'number',
                default: 1.0,
                min: 0.125,
                max: 1.0,
                step: 0.01,
                displayMin: -18,
                displayMax: 0,
                displayStep: 1,
                displayDecimals: 0,
                displayUnit: 'dB',
                toDisplay: BaseBlock.linearToDb,
                fromDisplay: BaseBlock.dbToLinear,
                description: 'Input 2 gain in decibels'
            },
            {
                id: 'gain3',
                name: 'Input Gain 3',
                type: 'number',
                default: 1.0,
                min: 0.125,
                max: 1.0,
                step: 0.01,
                displayMin: -18,
                displayMax: 0,
                displayStep: 1,
                displayDecimals: 0,
                displayUnit: 'dB',
                toDisplay: BaseBlock.linearToDb,
                fromDisplay: BaseBlock.dbToLinear,
                description: 'Input 3 gain in decibels'
            }
        ];
        
        this.autoCalculateHeight();
    }
    
    generateCode(ctx: CodeGenContext): void {
        const zero = ctx.getStandardConstant(0.0);
        const one = ctx.getStandardConstant(1.0);

        const input1Reg = ctx.getInputRegister(this.type, 'in1');
        const input2Reg = ctx.getInputRegister(this.type, 'in2');
        const input3Reg = ctx.getInputRegister(this.type, 'in3');
        const level1Reg = ctx.getInputRegister(this.type, 'level1');
        const level2Reg = ctx.getInputRegister(this.type, 'level2');
        const level3Reg = ctx.getInputRegister(this.type, 'level3');
        
        const outputReg = ctx.allocateRegister(this.type, 'out');
        
        const gain1 = this.getParameterValue(ctx, this.type, 'gain1', 1.0);
        const gain2 = this.getParameterValue(ctx, this.type, 'gain2', 1.0);
        const gain3 = this.getParameterValue(ctx, this.type, 'gain3', 1.0);
        
        ctx.pushMainCode('; Mixer 3:1');
        ctx.pushMainCode('');
        
        if (input1Reg) {
            ctx.pushMainCode(`rdax ${input1Reg}, ${this.formatS1_14(gain1)}`);
            if (level1Reg) {
                ctx.pushMainCode(`mulx ${level1Reg}`);
            }
            ctx.pushMainCode(`wrax ${outputReg}, ${zero}`);
        }
        
        if (input2Reg) {
            ctx.pushMainCode(`rdax ${input2Reg}, ${this.formatS1_14(gain2)}`);
            if (level2Reg) {
                ctx.pushMainCode(`mulx ${level2Reg}`);
            }
            if (input1Reg) {
                ctx.pushMainCode(`rdax ${outputReg}, ${one}`);
            }
            ctx.pushMainCode(`wrax ${outputReg}, ${zero}`);
        }
        
        if (input3Reg) {
            ctx.pushMainCode(`rdax ${input3Reg}, ${this.formatS1_14(gain3)}`);
            if (level3Reg) {
                ctx.pushMainCode(`mulx ${level3Reg}`);
            }
            if (input1Reg) {
                ctx.pushMainCode(`rdax ${outputReg}, ${one}`);
            } else if (input2Reg) {
                ctx.pushMainCode(`rdax ${outputReg}, ${one}`);
            }
            ctx.pushMainCode(`wrax ${outputReg}, ${zero}`);
        }
        
        ctx.pushMainCode('');    }
}
