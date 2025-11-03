/**
 * 2-Input Mixer block
 * Translated from SpinCAD's Mixer_2_to_1CADBlock.java
 * Mix two audio signals with independent gain control (dB)
 */

import { BaseBlock } from '../base/BaseBlock.js';
import { CodeGenContext } from '../../types/Block.js';

export class Mixer2Block extends BaseBlock {
    readonly type = 'math.mixer2';
    readonly category = 'Utility';
    readonly name = 'Mixer 2:1';
    readonly description = 'Mix two audio signals with independent gain';
    readonly color = '#2468f2';  // SpinCAD color
    readonly width = 170;
    
    constructor() {
        super();
        
        this._inputs = [
            { id: 'in1', name: 'Input 1', type: 'audio', required: false },
            { id: 'in2', name: 'Input 2', type: 'audio', required: false },
            { id: 'level1', name: 'Level 1', type: 'control', required: false },
            { id: 'level2', name: 'Level 2', type: 'control', required: false }
        ];
        
        this._outputs = [
            { id: 'out', name: 'Output', type: 'audio' }
        ];
        
        this._parameters = [
            {
                id: 'gain1',
                name: 'Input Gain 1',
                type: 'number',
                // Code values (what generateCode uses)
                default: 1.0,  // Linear gain = 0dB
                min: 0.125,    // -18dB
                max: 1.0,      // 0dB
                step: 0.01,
                // Display values (what UI shows)
                displayMin: -18,
                displayMax: 0,
                displayStep: 1,
                displayDecimals: 0,
                displayUnit: 'dB',
                // Conversion functions
                toDisplay: BaseBlock.linearToDb,
                fromDisplay: BaseBlock.dbToLinear,
                description: 'Input 1 gain in decibels'
            },
            {
                id: 'gain2',
                name: 'Input Gain 2',
                type: 'number',
                // Code values
                default: 1.0,  // Linear gain = 0dB
                min: 0.125,    // -18dB
                max: 1.0,      // 0dB
                step: 0.01,
                // Display values
                displayMin: -18,
                displayMax: 0,
                displayStep: 1,
                displayDecimals: 0,
                displayUnit: 'dB',
                // Conversion functions
                toDisplay: BaseBlock.linearToDb,
                fromDisplay: BaseBlock.dbToLinear,
                description: 'Input 2 gain in decibels'
            }
        ];
        
        this.autoCalculateHeight();
    }
    
    generateCode(ctx: CodeGenContext): void {
        const zero = ctx.getStandardConstant(0.0);
        const one = ctx.getStandardConstant(1.0);
        const half = ctx.getStandardConstant(0.5);
        const negOne = ctx.getStandardConstant(-1.0);

                // Get input registers
        const input1Reg = ctx.getInputRegister(this.type, 'in1');
        const input2Reg = ctx.getInputRegister(this.type, 'in2');
        const level1Reg = ctx.getInputRegister(this.type, 'level1');
        const level2Reg = ctx.getInputRegister(this.type, 'level2');
        
        // Allocate output register
        const outputReg = ctx.allocateRegister(this.type, 'out');
        
        // Get parameters (already in linear gain, no conversion needed)
        const gain1 = this.getParameterValue(ctx, this.type, 'gain1', 1.0);
        const gain2 = this.getParameterValue(ctx, this.type, 'gain2', 1.0);
        
        ctx.pushMainCode(`; Mixer 2:1`);
        ctx.pushMainCode('');
        
        // Process Input 1
        if (input1Reg) {
            ctx.pushMainCode(`rdax ${input1Reg}, ${this.formatS1_14(gain1)}`);
            if (level1Reg) {
                ctx.pushMainCode(`mulx ${level1Reg}`);
            }
            
            // If both inputs and level 2 connected, need to save temporarily
            if (input2Reg && level2Reg) {
                ctx.pushMainCode(`wrax ${outputReg}, 0`);
            }
        }
        
        // Process Input 2
        if (input2Reg) {
            ctx.pushMainCode(`rdax ${input2Reg}, ${this.formatS1_14(gain2)}`);
            if (level2Reg) {
                ctx.pushMainCode(`mulx ${level2Reg}`);
                // If input 1 was processed, add it back
                if (input1Reg) {
                    ctx.pushMainCode(`rdax ${outputReg}, 1.0`);
                }
            }
        }
        
        ctx.pushMainCode(`wrax ${outputReg}, 0`);
        ctx.pushMainCode('');    }
}
