/**
 * 4-Input Mixer - ported from SpinCAD Mixer4_1CADBlock
 */

import { BaseBlock } from '../base/BaseBlock.js';
import { CodeGenContext } from '../../types/Block.js';

export class Mixer4Block extends BaseBlock {
    readonly type = 'math.mixer4';
    readonly category = 'Math';
    readonly name = 'Mixer (4→1)';
    readonly description = 'Mix four audio signals';
    readonly color = '#FFEB3B';  // Yellow like SpinCAD
    readonly width = 170;
    
    constructor() {
        super();
        
        this._inputs = [
            { id: 'in1', name: 'Input 1', type: 'audio', required: false },
            { id: 'level1_ctrl', name: 'Level 1', type: 'control', required: false },
            { id: 'in2', name: 'Input 2', type: 'audio', required: false },
            { id: 'level2_ctrl', name: 'Level 2', type: 'control', required: false },
            { id: 'in3', name: 'Input 3', type: 'audio', required: false },
            { id: 'level3_ctrl', name: 'Level 3', type: 'control', required: false },
            { id: 'in4', name: 'Input 4', type: 'audio', required: false },
            { id: 'level4_ctrl', name: 'Level 4', type: 'control', required: false }
        ];
        
        this._outputs = [
            { id: 'out', name: 'Output', type: 'audio' }
        ];
        
        this._parameters = [
            {
                id: 'gain1',
                name: 'Gain 1',
                type: 'number',
                default: 0.25,
                min: 0.0,
                max: 1.0,
                step: 0.01,
                description: 'Gain for input 1'
            },
            {
                id: 'gain2',
                name: 'Gain 2',
                type: 'number',
                default: 0.25,
                min: 0.0,
                max: 1.0,
                step: 0.01,
                description: 'Gain for input 2'
            },
            {
                id: 'gain3',
                name: 'Gain 3',
                type: 'number',
                default: 0.25,
                min: 0.0,
                max: 1.0,
                step: 0.01,
                description: 'Gain for input 3'
            },
            {
                id: 'gain4',
                name: 'Gain 4',
                type: 'number',
                default: 0.25,
                min: 0.0,
                max: 1.0,
                step: 0.01,
                description: 'Gain for input 4'
            }
        ];
        
        this.autoCalculateHeight();
    }
    
    generateCode(ctx: CodeGenContext): string[] {
        const code: string[] = [];
        const outputReg = ctx.allocateRegister(this.type, 'out');
        const zero = ctx.getStandardConstant(0.0);
        const one = ctx.getStandardConstant(1.0);
        
        const preserveAcc = ctx.shouldPreserveAccumulator(this.type, 'out');
        const clearValue = preserveAcc ? one : zero;
        
        code.push('; Mixer 4→1');
        
        let hasPreviousInput = false;
        
        // Process each input
        for (let i = 1; i <= 4; i++) {
            const inputReg = ctx.getInputRegister(this.type, `in${i}`);
            const levelCtrlReg = ctx.getInputRegister(this.type, `level${i}_ctrl`);
            const gain = this.getParameterValue(ctx, this.type, `gain${i}`, 0.25);
            
            if (inputReg) {
                const gainConst = ctx.getStandardConstant(gain);
                code.push(`rdax ${inputReg}, ${gainConst}  ; Input ${i}`);
                
                if (levelCtrlReg) {
                    code.push(`mulx ${levelCtrlReg}  ; Modulate by CV`);
                }
                
                if (!hasPreviousInput) {
                    // First input - store it
                    code.push(`wrax ${outputReg}, ${zero}`);
                    hasPreviousInput = true;
                } else {
                    // Subsequent inputs - add to accumulator
                    code.push(`rdax ${outputReg}, ${one}  ; Add previous inputs`);
                    code.push(`wrax ${outputReg}, ${zero}`);
                }
            }
        }
        
        // If no inputs connected, output silence
        if (!hasPreviousInput) {
            code.push(`clr`);
            code.push(`wrax ${outputReg}, ${zero}`);
        } else if (preserveAcc) {
            // Update last wrax to preserve accumulator
            const lastWraxIndex = code.length - 1;
            code[lastWraxIndex] = `wrax ${outputReg}, ${clearValue}`;
        }
        
        code.push('');
        
        return code;
    }
}
