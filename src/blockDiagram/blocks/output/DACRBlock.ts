/**
 * Right DAC Output block
 */

import { BaseBlock } from '../base/BaseBlock.js';
import { CodeGenContext, ValidationContext, ValidationResult } from '../../types/Block.js';

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
                min: -2.0,
                max: 1.99993896484375,
                step: 0.01,
                description: 'Output gain (S1.14 format: -2.0 to +1.9999)'
            }
        ];
        
        // Auto-calculate height based on port count
        this.autoCalculateHeight();
    }
    
    generateCode(ctx: CodeGenContext): string[] {
        const code: string[] = [];
        const inputReg = ctx.getInputRegister(this.type, 'in');
        const gain = this.getParameterValue(ctx, this.type, 'gain', 1.0);
        const one = ctx.getStandardConstant(1.0);
        const zero = ctx.getStandardConstant(0.0);
        
        // Check if input is already in accumulator (optimization)
        const inputForwarded = ctx.isAccumulatorForwarded(this.type, 'in');
        
        code.push('; Right DAC Output');
        
        // Load input if not already in accumulator
        if (!inputForwarded) {
            code.push(`rdax ${inputReg}, ${one}`);
        }
        
        // Apply gain using SOF (only if gain != 1.0)
        if (Math.abs(gain - 1.0) > 0.00001) {
            const gainConst = ctx.getStandardConstant(gain);
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
