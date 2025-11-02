/**
 * Left ADC Input block
 * Represents the left audio input to the FV-1
 */

import { BaseBlock } from '../base/BaseBlock.js';
import { CodeGenContext } from '../../types/Block.js';

export class ADCLBlock extends BaseBlock {
    readonly type = 'input.adcl';
    readonly category = 'Input';
    readonly name = 'Left Input';
    readonly description = 'Left channel audio input (ADCL)';
    readonly color = '#2196F3';
    readonly width = 150;
    
    get height(): number {
        return 80;
    }
    
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
    }
    
    generateCode(ctx: CodeGenContext): void {
        const outputReg = ctx.allocateRegister(this.type, 'out');
        const gain = this.getParameterValue(ctx, this.type, 'gain', 1.0);
        
        // Push ADC read to input section
        ctx.pushInputCode('; Left ADC Input');
        ctx.pushInputCode(`rdax\tADCL,\t${this.formatS15(gain)}`);
        ctx.pushInputCode(`wrax\t${outputReg},\t0.0`);
        ctx.pushInputCode('');
    }
}
