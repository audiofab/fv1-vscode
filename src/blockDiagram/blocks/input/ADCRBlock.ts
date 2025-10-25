/**
 * Right ADC Input block
 * Represents the right audio input to the FV-1
 */

import { BaseBlock } from '../base/BaseBlock.js';
import { CodeGenContext } from '../../types/Block.js';

export class ADCRBlock extends BaseBlock {
    readonly type = 'input.adcr';
    readonly category = 'Input';
    readonly name = 'Right Input';
    readonly description = 'Right channel audio input (ADCR)';
    readonly color = '#2196F3';
    readonly width = 150;
    
    constructor() {
        super();
        
        this._inputs = [];
        
        this._outputs = [
            { id: 'out', name: 'Audio', type: 'audio' }
        ];
        
        this._parameters = [
            {
                id: 'gain',
                name: 'Gain',
                type: 'number',
                default: 1.0,
                min: -2.0,
                max: 1.99993896484375,
                step: 0.01,
                description: 'Input gain (S1.14 format: -2.0 to +1.9999)'
            }
        ];
        
        // Auto-calculate height based on port count
        this.autoCalculateHeight();
    }
    
    generateCode(ctx: CodeGenContext): string[] {
        const code: string[] = [];
        const outputReg = ctx.allocateRegister(this.type, 'out');
        const gain = this.getParameterValue(ctx, this.type, 'gain', 1.0);
        const gainConst = ctx.getStandardConstant(gain);
        const one = ctx.getStandardConstant(1.0);
        const zero = ctx.getStandardConstant(0.0);
        
        // Check if we should preserve accumulator for next block
        const preserveAcc = ctx.shouldPreserveAccumulator(this.type, 'out');
        const clearValue = preserveAcc ? one : zero;
        
        code.push('; Right ADC Input');
        code.push(`rdax ADCR, ${gainConst}`);
        code.push(`wrax ${outputReg}, ${clearValue}`);
        code.push('');
        
        return code;
    }
}
