/**
 * Potentiometer Input block
 * Reads potentiometer control values (POT0, POT1, or POT2)
 */

import { BaseBlock } from '../base/BaseBlock.js';
import { CodeGenContext } from '../../types/Block.js';

export class PotBlock extends BaseBlock {
    readonly type = 'input.pot';
    readonly category = 'Input';
    readonly name = 'Potentiometer';
    readonly description = 'Read potentiometer control value (POT0, POT1, or POT2)';
    readonly color = '#4CAF50';
    readonly width = 150;
    
    get height(): number {
        return 80;
    }
    
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
                id: 'speedup',
                name: 'Enable Speedup Filter',
                type: 'boolean',
                default: true,
                description: 'Apply high-shelf filter to improve pot response time (recommended)'
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
    
    generateCode(ctx: CodeGenContext): void {
        const outputReg = ctx.allocateRegister(this.type, 'out');
        const potNumber = this.getParameterValue<number>(ctx, this.type, 'potNumber', 0);
        const speedup = this.getParameterValue<boolean>(ctx, this.type, 'speedup', true);
        const invert = this.getParameterValue<boolean>(ctx, this.type, 'invert', false);
        
        const potName = `POT${potNumber}`;
        
        // Push POT read to input section
        ctx.pushInputCode(`; Potentiometer ${potNumber}`);
        
        if (speedup) {
            // Apply high-shelf filter for faster pot response
            const filterReg = ctx.getScratchRegister();  // Stores filtered value
            
            ctx.pushInputCode(`; POT filtering a-la-SpinCAD`);
            ctx.pushInputCode(`rdax\t${potName},\t1.0`);
            ctx.pushInputCode(`rdfx\t${filterReg},\t0.001`);
            ctx.pushInputCode(`wrhx\t${filterReg},\t-0.75`);
            ctx.pushInputCode(`rdax\t${outputReg},\t0.75`);
            
            if (invert) {
                ctx.pushInputCode('sof\t-1.0,\t1.0\t; Invert');
            }
            
            ctx.pushInputCode(`wrax\t${outputReg},\t0.0\t; Write to output`);
        } else {
            // Direct pot reading without filtering
            ctx.pushInputCode(`; POT direct read (no speedup filter)`);
            ctx.pushInputCode(`rdax\t${potName},\t1.0`);
            
            if (invert) {
                ctx.pushInputCode('sof\t-1.0,\t1.0\t; Invert');
            }
            
            ctx.pushInputCode(`wrax\t${outputReg},\t0.0`);
        }
        
        ctx.pushInputCode('');
    }
}
