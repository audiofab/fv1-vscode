/**
 * Example block: Left ADC Input
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
    readonly height = 80;
    
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
    
    generateCode(ctx: CodeGenContext): string[] {
        const code: string[] = [];
        const outputReg = ctx.allocateRegister(this.type, 'out');
        const gain = this.getParameterValue(ctx, this.type, 'gain', 1.0);
        
        code.push('; Left ADC Input');
        code.push(`rdax ADCL, ${this.formatS15(gain)}`);
        code.push(`wrax ${outputReg}, 0.0`);
        code.push('');
        
        return code;
    }
}

/**
 * Right ADC Input
 */
export class ADCRBlock extends BaseBlock {
    readonly type = 'input.adcr';
    readonly category = 'Input';
    readonly name = 'Right Input';
    readonly description = 'Right channel audio input (ADCR)';
    readonly color = '#2196F3';
    readonly width = 150;
    readonly height = 80;
    
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
                min: 0.0,
                max: 2.0,
                step: 0.01,
                description: 'Input gain (0.0 to 2.0)'
            }
        ];
    }
    
    generateCode(ctx: CodeGenContext): string[] {
        const code: string[] = [];
        const outputReg = ctx.allocateRegister(this.type, 'out');
        const gain = this.getParameterValue(ctx, this.type, 'gain', 1.0);
        
        code.push('; Right ADC Input');
        code.push(`rdax ADCR, ${this.formatS15(gain)}`);
        code.push(`wrax ${outputReg}, 0.0`);
        code.push('');
        
        return code;
    }
}

/**
 * Potentiometer Input
 */
export class PotBlock extends BaseBlock {
    readonly type = 'input.pot';
    readonly category = 'Input';
    readonly name = 'Potentiometer';
    readonly description = 'Read potentiometer control value (POT0, POT1, or POT2)';
    readonly color = '#4CAF50';
    readonly width = 150;
    readonly height = 80;
    
    constructor() {
        super();
        
        this._inputs = [];
        
        this._outputs = [
            { id: 'out', name: 'Control', type: 'control' }
        ];
        
        this._parameters = [
            {
                id: 'potNumber',
                name: 'Pot Number',
                type: 'select',
                default: 0,
                options: [
                    { label: 'POT0', value: 0 },
                    { label: 'POT1', value: 1 },
                    { label: 'POT2', value: 2 }
                ],
                description: 'Which potentiometer to read'
            },
            {
                id: 'invert',
                name: 'Invert',
                type: 'boolean',
                default: false,
                description: 'Invert the pot value (1.0 - value)'
            }
        ];
    }
    
    generateCode(ctx: CodeGenContext): string[] {
        const code: string[] = [];
        const outputReg = ctx.allocateRegister(this.type, 'out');
        const potNumber = this.getParameterValue<number>(ctx, this.type, 'potNumber', 0);
        const invert = this.getParameterValue<boolean>(ctx, this.type, 'invert', false);
        
        // Get a scratch register for filtering
        const filterReg0 = ctx.getScratchRegister();
        
        const potName = `POT${potNumber}`;
        
        code.push(`; Potentiometer ${potNumber}`);
        code.push('; POT filtering a-la-SpinCAD');
        code.push(`rdax ${potName}, 1.0`);
        code.push(`rdfx ${filterReg0}, 0.001`);
        code.push(`wrhx ${filterReg0}, -0.75`);
        code.push(`rdax ${outputReg}, 0.75`);
        
        if (invert) {
            code.push('sof -1.0, 1.0  ; Invert');
        }
        
        code.push(`wrax ${outputReg}, 0.0  ; Write to output`);
        code.push('');
        
        return code;
    }
}
