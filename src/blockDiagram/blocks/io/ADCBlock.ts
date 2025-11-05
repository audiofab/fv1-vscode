/**
 * ADC Input block
 * Represents an audio input to the FV-1
 */

import { BaseBlock } from '../base/BaseBlock.js';
import { CodeGenContext } from '../../types/Block.js';

export class ADCBlock extends BaseBlock {
    readonly type = 'input.adc';
    readonly category = 'I/O';
    readonly name = 'ADC Input';
    readonly description = 'Audio input channel';
    readonly color = '#2196F3';
    readonly width = 150;
    
    constructor() {
        super();
        
        // ADC inputs have no input ports (they are sources)
        this._inputs = [];
        
        // One audio output
        this._outputs = [
            { id: 'out', name: 'Audio', type: 'audio' }
        ];
        
        // Optional gain parameter
        this._parameters = [
            {
                id: 'adcNumber',
                name: 'ADC Number',
                type: 'select',
                default: 0,
                options: [
                    { label: 'ADCL', value: 0 },
                    { label: 'ADCR', value: 1 }
                ],
                description: 'Which ADC to read'
            },
            {
                id: 'gain',
                name: 'Gain',
                type: 'number',
                default: 1.0,
                min: 0.0,
                max: 2.0,
                step: 0.01,
                description: 'Input gain (0.0 to 2.0)'
            }
        ];
        this.autoCalculateHeight();
    }

    /**
     * Display which ADC is being read (ADCL or ADCR)
     */
    getCustomLabel(parameters: Record<string, any>): string | null {
        const adcNumber = parameters['adcNumber'] ?? 0;
        return `ADC${adcNumber == 0 ? 'L' : 'R'}`;
    }

    generateCode(ctx: CodeGenContext): void {
        const outputReg = ctx.allocateRegister(this.type, 'out');
        const adcNumber = this.getParameterValue<number>(ctx, this.type, 'adcNumber', 0);
        const gain = this.getParameterValue(ctx, this.type, 'gain', 1.0);
        const gainConst = ctx.getStandardConstant(gain);
        const zero = ctx.getStandardConstant(0.0);
        
        // Push ADC read to input section
        ctx.pushInputCode(`; ${adcNumber == 0 ? 'Left' : 'Right'} ADC Input`);
        ctx.pushInputCode(`rdax\tADC${adcNumber == 0 ? 'L' : 'R'},\t${gainConst}`);
        ctx.pushInputCode(`wrax\t${outputReg},\t${zero}`);
        ctx.pushInputCode('');
    }
}
