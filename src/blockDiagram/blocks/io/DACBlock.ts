/**
 * DAC Output block
 */

import { BaseBlock } from '../base/BaseBlock.js';
import { CodeGenContext } from '../../types/Block.js';

export class DACBlock extends BaseBlock {
    readonly type = 'output.dac';
    readonly category = 'I/O';
    readonly name = 'DAC Output';
    readonly description = 'Audio output channel (DAC)';
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
                id: 'dacNumber',
                name: 'DAC Number',
                type: 'select',
                default: 0,
                options: [
                    { label: 'DACL', value: 0 },
                    { label: 'DACR', value: 1 }
                ],
                description: 'Which DAC to write to'
            },
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

    /**
     * Display which DAC is being read (DACL or DACR)
     */
    getCustomLabel(parameters: Record<string, any>): string | null {
        const dacNumber = parameters['dacNumber'] ?? 0;
        return `DAC${dacNumber == 0 ? 'L' : 'R'}`;
    }

    generateCode(ctx: CodeGenContext): void {
        const inputReg = ctx.getInputRegister(this.type, 'in');
        const dacNumber = this.getParameterValue<number>(ctx, this.type, 'dacNumber', 0);
        const gain = this.getParameterValue(ctx, this.type, 'gain', 1.0);
        const one = ctx.getStandardConstant(1.0);
        const zero = ctx.getStandardConstant(0.0);
        
        // Push DAC write to output section
        ctx.pushOutputCode(`; ${dacNumber == 0 ? 'Left' : 'Right'} DAC Output`);
        
        // Load input
        ctx.pushOutputCode(`rdax\t${inputReg},\t${one}`);
        
        // Apply gain using SOF (only if gain != 1.0)
        if (Math.abs(gain - 1.0) > 0.00001) {
            const gainConst = ctx.getStandardConstant(gain);
            ctx.pushOutputCode(`sof\t${gainConst},\t${zero}`);
        }
        
        ctx.pushOutputCode(`wrax\tDAC${dacNumber == 0 ? 'L' : 'R'},\t${zero}`);
        
        ctx.pushOutputCode('');
    }
}