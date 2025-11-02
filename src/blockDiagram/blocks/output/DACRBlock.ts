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
    
    generateCode(ctx: CodeGenContext): void {
        const inputReg = ctx.getInputRegister(this.type, 'in');
        const gain = this.getParameterValue(ctx, this.type, 'gain', 1.0);
        
        // Push DAC write to output section
        ctx.pushOutputCode('; Right DAC Output');
        
        // Load input
        ctx.pushOutputCode(`rdax\t${inputReg},\t1.0`);
        
        // Apply gain using SOF (only if gain != 1.0)
        if (Math.abs(gain - 1.0) > 0.00001) {
            ctx.pushOutputCode(`sof\t${this.formatS15(gain)},\t0.0`);
        }
        
        ctx.pushOutputCode(`wrax\tDACR,\t0.0`);
        ctx.pushOutputCode('');
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
