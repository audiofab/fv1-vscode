/**
 * Left DAC Output block
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
                min: -2.0,
                max: 1.99993896484375,
                step: 0.01,
                description: 'Output gain (S1.14 format: -2.0 to +1.9999)'
            }
        ];
        
        // Auto-calculate height based on port count
        this.autoCalculateHeight();
    }
    
    generateCode(ctx: CodeGenContext): void {
        const inputReg = ctx.getInputRegister(this.type, 'in');
        const gain = this.getParameterValue(ctx, this.type, 'gain', 1.0);
        const one = ctx.getStandardConstant(1.0);
        const zero = ctx.getStandardConstant(0.0);
        
        // Push DAC write to output section
        ctx.pushOutputCode('; Left DAC Output');
        
        // Load input
        ctx.pushOutputCode(`rdax\t${inputReg},\t${one}`);
        
        // Apply gain using SOF (only if gain != 1.0)
        if (Math.abs(gain - 1.0) > 0.00001) {
            const gainConst = ctx.getStandardConstant(gain);
            ctx.pushOutputCode(`sof\t${gainConst},\t${zero}`);
        }
        
        ctx.pushOutputCode(`wrax\tDACL,\t${zero}`);
        ctx.pushOutputCode('');
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
