/**
 * Example demonstrating the new scratch register allocation approach
 * 
 * This example shows how to use getScratchRegister() for temporary calculations
 * within a block, and how permanent registers are allocated from the opposite end.
 */

import { BaseBlock } from '../blocks/base/BaseBlock.js';
import { CodeGenContext } from '../types/Block.js';

/**
 * Example: Soft Clipper Block
 * Demonstrates using multiple scratch registers for intermediate calculations
 */
export class SoftClipperExample extends BaseBlock {
    readonly type = 'fx.softclipper';
    readonly category = 'Effects';
    readonly name = 'Soft Clipper';
    readonly description = 'Soft clipping distortion using multiple scratch registers';
    readonly color = '#9C27B0';
    
    constructor() {
        super();
        
        this._inputs = [
            { id: 'in', name: 'Input', type: 'audio', required: true }
        ];
        
        this._outputs = [
            { id: 'out', name: 'Output', type: 'audio' }
        ];
        
        this._parameters = [
            {
                id: 'threshold',
                name: 'Threshold',
                type: 'number',
                default: 0.5,
                min: 0.1,
                max: 1.0,
                step: 0.01,
                description: 'Clipping threshold'
            }
        ];
    }
    
    generateCode(ctx: CodeGenContext): string[] {
        const code: string[] = [];
        
        // Get input register (from connected block)
        const inputReg = ctx.getInputRegister(this.type, 'in');
        
        // Allocate permanent output register (REG0, REG1, REG2, ... going up)
        const outputReg = ctx.allocateRegister(this.type, 'out');
        
        // Get scratch registers for intermediate calculations
        // These are allocated from REG31 downward (REG31, REG30, REG29, ...)
        const temp1 = ctx.getScratchRegister();  // REG31
        const temp2 = ctx.getScratchRegister();  // REG30
        const temp3 = ctx.getScratchRegister();  // REG29
        
        const threshold = this.getParameterValue(ctx, this.type, 'threshold', 0.5);
        
        code.push('; Soft Clipper with Scratch Registers');
        code.push(`; Input: ${inputReg}, Output: ${outputReg}`);
        code.push(`; Scratch: ${temp1}, ${temp2}, ${temp3}`);
        code.push('');
        
        // Example soft clipping algorithm using scratch registers
        code.push(`rdax ${inputReg}, 1.0`);
        code.push(`wrax ${temp1}, 1.0  ; Save input to temp1`);
        
        // Calculate absolute value
        code.push(`absa`);
        code.push(`wrax ${temp2}, 0.0  ; Save |input| to temp2`);
        
        // Compare with threshold
        code.push(`rdax ${temp2}, 1.0`);
        code.push(`sof ${this.formatS15(-1.0)}, ${this.formatS15(threshold)}`);
        code.push(`skp GEZ, 2`);
        
        // Below threshold - pass through
        code.push(`rdax ${temp1}, 1.0`);
        code.push(`skp 0, 3`);
        
        // Above threshold - apply soft clipping
        code.push(`rdax ${temp1}, ${this.formatS15(0.5)}`);
        code.push(`wrax ${temp3}, 1.0`);
        code.push(`mulx ${temp3}  ; Square for soft knee`);
        
        // Write final output
        code.push(`wrax ${outputReg}, 0.0`);
        code.push('');
        
        // No need to free temp1, temp2, temp3!
        // They are automatically available for the next block when
        // the compiler calls ctx.resetScratchRegisters()
        
        code.push('; Note: Scratch registers automatically freed after this block');
        code.push('');
        
        return code;
    }
}

/**
 * Key Points Demonstrated:
 * 
 * 1. Multiple scratch registers can be allocated in sequence
 *    - First call: REG31
 *    - Second call: REG30
 *    - Third call: REG29
 *    - etc.
 * 
 * 2. Permanent registers (outputs) go from bottom up
 *    - First block output: REG0
 *    - Second block output: REG1
 *    - etc.
 * 
 * 3. No cleanup required
 *    - Old API: ctx.freeRegister(this.type, 'temp1') ❌
 *    - New API: Nothing needed! ✅
 * 
 * 4. Automatic collision detection
 *    - If permanent registers reach up to meet scratch registers,
 *      an error is thrown automatically
 * 
 * 5. Register allocation visualization:
 *    REG0  [Permanent: Block 1 output]
 *    REG1  [Permanent: Block 2 output]
 *    REG2  [Permanent: Block 3 output]
 *    ...
 *    REG28 [Available]
 *    REG29 [Scratch: temp3 in current block]
 *    REG30 [Scratch: temp2 in current block]
 *    REG31 [Scratch: temp1 in current block]
 * 
 *    After this block completes, the compiler calls:
 *    ctx.resetScratchRegisters()
 *    
 *    And the next block can use REG31, REG30, REG29 again!
 */
