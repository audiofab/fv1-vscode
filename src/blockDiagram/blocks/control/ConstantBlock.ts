/**
 * Constant Block
 * Ported from SpinCAD's ConstantCADBlock
 * 
 * Generates a constant control value that can be connected to other blocks.
 * Useful for providing fixed parameter values without using pots.
 * 
 * The value is stored in a register and can be used by any block that
 * accepts control inputs.
 * 
 * Translation Notes:
 * - SpinCAD stores value as integer 0-1000, divided by 1000 to get coefficient
 * - Generates: sof 0, constant followed by wrax register, 0
 * - This is a control output block, not an audio processor
 */

import { BaseBlock } from '../base/BaseBlock.js';
import { CodeGenContext } from '../../types/Block.js';

export class ConstantBlock extends BaseBlock {
    readonly type = 'control.constant';
    readonly category = 'Control';
    readonly name = 'Constant';
    readonly description = 'Generates a constant control value';
    readonly color = '#FF9800';
    readonly width = 140;
    
    constructor() {
        super();
        
        this._inputs = [];
        
        this._outputs = [
            { id: 'value', name: 'Value', type: 'control' }
        ];
        
        this._parameters = [
            {
                id: 'constant',
                name: 'Value',
                type: 'number',
                default: 0.999,
                min: 0.0,
                max: 0.999,
                step: 0.001,
                displayDecimals: 3,
                description: 'Constant value (0.0 to 0.999)'
            }
        ];
        
        this.autoCalculateHeight();
    }
    
    getCustomLabel(params: Record<string, any>): string {
        const constant = params['constant'] ?? 0.999;
        return constant.toFixed(3);
    }
    
    generateCode(ctx: CodeGenContext): void {
        // Get parameter value
        const constant = this.getParameterValue(ctx, this.type, 'constant', 0.999);
        
        // Allocate output register
        const valueReg = ctx.allocateRegister(this.type, 'value');
        
        const zero = ctx.getStandardConstant(0.0);
        
        ctx.pushMainCode(`; Constant value generator`);
        ctx.pushMainCode(`sof ${zero}, ${this.formatS10(constant)}`);
        ctx.pushMainCode(`wrax ${valueReg}, ${zero}`);
        ctx.pushMainCode('');
    }
}
