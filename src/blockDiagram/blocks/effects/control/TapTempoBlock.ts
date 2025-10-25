/**
 * Tap Tempo control block
 * Ported from SpinCAD TapTempoCADBlock
 * 
 * Provides tap tempo functionality with debouncing and latching switch mechanism.
 * Takes a momentary switch input (via POT) and generates synchronized outputs:
 * - Latch: Toggles on each tap
 * - Ramp: Running ramp from 0 to 1 synchronized to taps
 * - Tap Tempo: Sampled/held tempo value
 */

import { BaseBlock } from '../../base/BaseBlock.js';
import { CodeGenContext } from '../../../types/Block.js';

export class TapTempoBlock extends BaseBlock {
    readonly type = 'control.taptempo';
    readonly category = 'Control';
    readonly name = 'Tap Tempo';
    readonly description = 'Tap tempo with debouncing and latching outputs';
    readonly color = '#FF9800';  // Orange for control blocks
    readonly width = 180;
    
    constructor() {
        super();
        
        this._inputs = [
            { id: 'tap_in', name: 'Tap Switch', type: 'control', required: true }
        ];
        
        this._outputs = [
            { id: 'latch', name: 'Latch', type: 'control' },
            { id: 'ramp', name: 'Ramp', type: 'control' },
            { id: 'taptempo', name: 'Tap Tempo', type: 'control' }
        ];
        
        this._parameters = [
            {
                id: 'maxTime',
                name: 'Max Time',
                type: 'number',
                default: 1.0,
                min: 0.1,
                max: 5.0,
                step: 0.1,
                description: 'Maximum tempo time in seconds'
            },
            {
                id: 'defaultTime',
                name: 'Default Time',
                type: 'number',
                default: 0.33,
                min: 0.01,
                max: 5.0,
                step: 0.01,
                description: 'Default tempo time in seconds'
            }
        ];
        
        // Auto-calculate height based on port count
        this.autoCalculateHeight();
    }
    
    getInitCode(ctx: CodeGenContext): string[] {
        const code: string[] = [];
        const maxTime = this.getParameterValue(ctx, this.type, 'maxTime', 1.0);
        const defaultTime = this.getParameterValue(ctx, this.type, 'defaultTime', 0.33);
        
        // Get register allocations
        const latchReg = ctx.allocateRegister(this.type, 'latch');
        const rampReg = ctx.allocateRegister(this.type, 'ramp');
        
        code.push(`; Tap Tempo Initialization`);
        code.push(`or ${this.formatS15(4096 / 32768.0)}  ; Load RMP0 frequency`);
        code.push(`wrax RMP0_RATE, ${this.formatS15(0.99)}  ; Set rate, load 0.99`);
        code.push(`wrax ${latchReg}, ${this.formatS15(defaultTime / maxTime)}`);
        code.push(`wrax ${rampReg}, 0`);
        
        return code;
    }
    
    generateCode(ctx: CodeGenContext): string[] {
        const code: string[] = [];
        const maxTime = this.getParameterValue(ctx, this.type, 'maxTime', 1.0);
        const tapInputReg = ctx.getInputRegister(this.type, 'tap_in');
        
        if (!tapInputReg) {
            code.push(`; Tap Tempo (no input connected)`);
            return code;
        }
        
        // Allocate registers
        const dbReg = ctx.getScratchRegister();       // Debounce register
        const momReg = ctx.getScratchRegister();      // Momentary register
        const latchReg = ctx.allocateRegister(this.type, 'latch');
        const rampReg = ctx.allocateRegister(this.type, 'ramp');
        const taptempoReg = ctx.allocateRegister(this.type, 'taptempo');
        
        const rampRate = 1.0 / maxTime / 16.0;
        const count = 0.01;
        
        code.push(`; Tap Tempo Control`);
        code.push(`;   Switch input: ${tapInputReg}`);
        code.push('');
        
        // Switch debouncing and pot filtering workaround
        code.push(`; Switch Debouncing`);
        code.push(`ldax ${tapInputReg}  ; Load tap switch input`);
        code.push(`sof 1.0, -0.5`);
        code.push(`skp neg, 4`);
        code.push(`ldax ${dbReg}`);
        code.push(`sof 1.0, ${this.formatS15(count)}`);
        code.push(`wrax ${dbReg}, 0`);
        code.push(`skp zro, 3`);
        code.push(`; DOWN:`);
        code.push(`ldax ${dbReg}`);
        code.push(`sof 1.0, ${this.formatS15(-count)}`);
        code.push(`wrax ${dbReg}, 0`);
        code.push('');
        
        // Latching switch - falling edge triggered flip-flop
        // Schmitt trigger action: <-0.9 is low, >0.9 is high, in-between ignored
        code.push(`; Latching Switch (Schmitt Trigger)`);
        code.push(`ldax ${dbReg}`);
        code.push(`absa`);
        code.push(`sof 1.0, -0.9`);
        code.push(`skp neg, 13`);
        code.push(`ldax ${dbReg}`);
        code.push(`sof 1.0, -0.9`);
        code.push(`skp neg, 3`);
        code.push(`sof 0.0, 0.999`);
        code.push(`wrax ${momReg}, 0`);
        code.push(`skp zro, 7`);
        code.push(`; LO:`);
        code.push(`ldax ${momReg}`);
        code.push(`skp neg, 5`);
        code.push(`sof 0.0, -0.999`);
        code.push(`wrax ${momReg}, 0`);
        code.push(`ldax ${latchReg}`);
        code.push(`sof -1.0, 0`);
        code.push(`wrax ${latchReg}, 0`);
        code.push('');
        
        // Tap tempo - uses RMP0 as a 1 Hz rising ramp
        // Runs while latch is low, sampled and held when latch is high
        code.push(`; Tap Tempo Processing`);
        code.push(`ldax ${latchReg}`);
        code.push(`skp neg, 4`);
        code.push(`jam RMP0  ; Reset ramp`);
        code.push(`ldax ${rampReg}`);
        code.push(`wrax ${taptempoReg}, 0  ; Sample tempo`);
        code.push(`skp zro, 12`);
        code.push(`; LOW:`);
        code.push(`sof 0.0, ${this.formatS15(rampRate)}`);
        code.push(`wrax RMP0_RATE, 0  ; Set ramp rate`);
        code.push(`cho rdal, RMP0  ; Read ramp value`);
        code.push(`sof -2.0, 0.999`);
        code.push(`sof 1.0, 0.001`);
        code.push(`wrax ${rampReg}, 1.0`);
        code.push(`sof 1.0, -0.999`);
        code.push(`skp neg, 4`);
        code.push(`ldax ${taptempoReg}`);
        code.push(`wrax ${rampReg}, 0`);
        code.push(`sof 0.0, 0.999`);
        code.push(`wrax ${latchReg}, 0`);
        code.push('');
        
        return code;
    }
}
