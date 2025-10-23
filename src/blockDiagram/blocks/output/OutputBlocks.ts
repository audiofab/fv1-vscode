/**
 * Output blocks: DAC Left and Right
 */

import { BaseBlock } from '../base/BaseBlock.js';
import { CodeGenContext, ValidationContext, ValidationResult } from '../../types/Block.js';

export class DACLBlock extends BaseBlock {
    readonly type = 'output.dacl';
    readonly category = 'Output';
    readonly name = 'Left Output';
    readonly description = 'Left channel audio output (DACL)';
    readonly color = '#F44336';
    readonly width = 150;
    
    constructor() {
        super();
        
        // DAC outputs have one input
        this._inputs = [
            { id: 'in', name: 'Audio', type: 'audio', required: true }
        ];
        
        // No outputs (this is a sink)
        this._outputs = [];
        
        // Optional output gain
        this._parameters = [
            {
                id: 'gain',
                name: 'Gain',
                type: 'number',
                default: 1.0,
                min: 0.0,
                max: 2.0,
                step: 0.01,
                description: 'Output gain (0.0 to 2.0)'
            }
        ];
        
        // Auto-calculate height based on port count
        this.autoCalculateHeight();
    }
    
    generateCode(ctx: CodeGenContext): string[] {
        const code: string[] = [];
        const inputReg = ctx.getInputRegister(this.type, 'in');
        const gain = this.getParameterValue(ctx, this.type, 'gain', 1.0);
        const gainConst = ctx.getStandardConstant(gain);
        const one = ctx.getStandardConstant(1.0);
        const zero = ctx.getStandardConstant(0.0);
        
        // Check if input is already in accumulator (optimization)
        const inputForwarded = ctx.isAccumulatorForwarded(this.type, 'in');
        
        code.push('; Left DAC Output');
        if (!inputForwarded) {
            code.push(`rdax ${inputReg}, ${gainConst}`);
        } else if (Math.abs(gain - 1.0) > 0.001) {
            // Input already in ACC, but need to apply gain
            code.push(`sof ${gainConst}, 0`);
        }
        code.push(`wrax DACL, ${zero}`);
        code.push('');
        
        return code;
    }
    
    validate(ctx: ValidationContext): ValidationResult {
        // Must have input connected
        const block = ctx.getBlock(this.type);
        if (!block || !ctx.hasInput(block.id, 'in')) {
            return {
                valid: false,
                error: 'Left output must have audio input connected'
            };
        }
        
        return { valid: true };
    }
}

export class DACRBlock extends BaseBlock {
    readonly type = 'output.dacr';
    readonly category = 'Output';
    readonly name = 'Right Output';
    readonly description = 'Right channel audio output (DACR)';
    readonly color = '#F44336';
    readonly width = 150;
    
    constructor() {
        super();
        
        this._inputs = [
            { id: 'in', name: 'Audio', type: 'audio', required: true }
        ];
        
        this._outputs = [];
        
        this._parameters = [
            {
                id: 'gain',
                name: 'Gain',
                type: 'number',
                default: 1.0,
                min: 0.0,
                max: 2.0,
                step: 0.01,
                description: 'Output gain (0.0 to 2.0)'
            }
        ];
        
        // Auto-calculate height based on port count
        this.autoCalculateHeight();
    }
    
    generateCode(ctx: CodeGenContext): string[] {
        const code: string[] = [];
        const inputReg = ctx.getInputRegister(this.type, 'in');
        const gain = this.getParameterValue(ctx, this.type, 'gain', 1.0);
        const gainConst = ctx.getStandardConstant(gain);
        const one = ctx.getStandardConstant(1.0);
        const zero = ctx.getStandardConstant(0.0);
        
        // Check if input is already in accumulator (optimization)
        const inputForwarded = ctx.isAccumulatorForwarded(this.type, 'in');
        
        code.push('; Right DAC Output');
        if (!inputForwarded) {
            code.push(`rdax ${inputReg}, ${gainConst}`);
        } else if (Math.abs(gain - 1.0) > 0.001) {
            // Input already in ACC, but need to apply gain
            code.push(`sof ${gainConst}, 0`);
        }
        code.push(`wrax DACR, ${zero}`);
        code.push('');
        
        return code;
    }
    
    validate(ctx: ValidationContext): ValidationResult {
        const block = ctx.getBlock(this.type);
        if (!block || !ctx.hasInput(block.id, 'in')) {
            return {
                valid: false,
                error: 'Right output must have audio input connected'
            };
        }
        
        return { valid: true };
    }
}
