/**
 * Multi-input Mixer blocks - ported from SpinCAD
 * Provides 2, 3, and 4-input mixers with independent gain control
 */

import { BaseBlock } from '../base/BaseBlock.js';
import { CodeGenContext } from '../../types/Block.js';

/**
 * 2-Input Mixer block - mix two audio signals
 * Each input has independent gain control with optional CV modulation
 */
export class Mixer2Block extends BaseBlock {
    readonly type = 'math.mixer2';
    readonly category = 'Math';
    readonly name = 'Mixer (2→1)';
    readonly description = 'Mix two audio signals with independent gain';
    readonly color = '#FFEB3B';  // Yellow like SpinCAD
    readonly width = 170;
    
    constructor() {
        super();
        
        this._inputs = [
            { id: 'in1', name: 'Input 1', type: 'audio', required: false },
            { id: 'level1_ctrl', name: 'Level 1 CV', type: 'control', required: false },
            { id: 'in2', name: 'Input 2', type: 'audio', required: false },
            { id: 'level2_ctrl', name: 'Level 2 CV', type: 'control', required: false }
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
                description: 'Base gain for input 1 (0.0 to 1.0)'
            },
            {
                id: 'gain2',
                name: 'Gain 2',
                type: 'number',
                default: 0.5,
                min: 0.0,
                max: 1.0,
                step: 0.01,
                description: 'Base gain for input 2 (0.0 to 1.0)'
            }
        ];
        
        // Auto-calculate height based on port count
        this.autoCalculateHeight();
    }
    
    generateCode(ctx: CodeGenContext): string[] {
        const code: string[] = [];
        const input1Reg = ctx.getInputRegister(this.type, 'in1');
        const input2Reg = ctx.getInputRegister(this.type, 'in2');
        const level1CtrlReg = ctx.getInputRegister(this.type, 'level1_ctrl');
        const level2CtrlReg = ctx.getInputRegister(this.type, 'level2_ctrl');
        const outputReg = ctx.allocateRegister(this.type, 'out');
        const gain1 = this.getParameterValue(ctx, this.type, 'gain1', 0.5);
        const gain2 = this.getParameterValue(ctx, this.type, 'gain2', 0.5);
        const zero = ctx.getStandardConstant(0.0);
        const one = ctx.getStandardConstant(1.0);
        
        // Check if we should preserve accumulator for next block
        const preserveAcc = ctx.shouldPreserveAccumulator(this.type, 'out');
        const clearValue = preserveAcc ? one : zero;
        
        code.push('; Mixer 2→1');
        
        let hasInput1 = false;
        
        // Handle input 1
        if (input1Reg) {
            const gain1Const = ctx.getStandardConstant(gain1);
            code.push(`rdax ${input1Reg}, ${gain1Const}  ; Input 1`);
            if (level1CtrlReg) {
                code.push(`mulx ${level1CtrlReg}  ; Modulate by CV`);
            }
            code.push(`wrax ${outputReg}, ${zero}  ; Store input 1`);
            hasInput1 = true;
        }
        
        // Handle input 2
        if (input2Reg) {
            const gain2Const = ctx.getStandardConstant(gain2);
            code.push(`rdax ${input2Reg}, ${gain2Const}  ; Input 2`);
            if (level2CtrlReg) {
                code.push(`mulx ${level2CtrlReg}  ; Modulate by CV`);
            }
            
            if (hasInput1) {
                // Add to previously stored input 1
                code.push(`rdax ${outputReg}, ${one}  ; Add input 1`);
            }
            code.push(`wrax ${outputReg}, ${clearValue}`);
        } else if (hasInput1 && preserveAcc) {
            // Need to update the clearValue for input 1 if no input 2
            code[code.length - 2] = `wrax ${outputReg}, ${clearValue}  ; Store input 1`;
        }
        
        if (!input1Reg && !input2Reg) {
            // No inputs connected - output silence
            code.push(`clr`);
            code.push(`wrax ${outputReg}, ${zero}`);
        }
        
        code.push('');
        
        return code;
    }
}

/**
 * 3-Input Mixer - ported from SpinCAD Mixer3_1CADBlock
 */
export class Mixer3Block extends BaseBlock {
    readonly type = 'math.mixer3';
    readonly category = 'Math';
    readonly name = 'Mixer (3→1)';
    readonly description = 'Mix three audio signals';
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
            { id: 'level3_ctrl', name: 'Level 3', type: 'control', required: false }
        ];
        
        this._outputs = [
            { id: 'out', name: 'Output', type: 'audio' }
        ];
        
        this._parameters = [
            {
                id: 'gain1',
                name: 'Gain 1',
                type: 'number',
                default: 0.333,
                min: 0.0,
                max: 1.0,
                step: 0.01,
                description: 'Gain for input 1'
            },
            {
                id: 'gain2',
                name: 'Gain 2',
                type: 'number',
                default: 0.333,
                min: 0.0,
                max: 1.0,
                step: 0.01,
                description: 'Gain for input 2'
            },
            {
                id: 'gain3',
                name: 'Gain 3',
                type: 'number',
                default: 0.333,
                min: 0.0,
                max: 1.0,
                step: 0.01,
                description: 'Gain for input 3'
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
        
        code.push('; Mixer 3→1');
        
        let hasPreviousInput = false;
        
        // Process each input
        for (let i = 1; i <= 3; i++) {
            const inputReg = ctx.getInputRegister(this.type, `in${i}`);
            const levelCtrlReg = ctx.getInputRegister(this.type, `level${i}_ctrl`);
            const gain = this.getParameterValue(ctx, this.type, `gain${i}`, 0.333);
            
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

/**
 * 4-Input Mixer - ported from SpinCAD Mixer4_1CADBlock
 */
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
