/**
 * Ping Pong Delay effect block
 * Ported from SpinCAD PingPongCADBlock
 * 
 * Stereo delay with alternating left/right taps
 * Creates classic ping-pong effect
 */

import { BaseBlock } from '../../base/BaseBlock.js';
import { CodeGenContext } from '../../../types/Block.js';

export class PingPongDelayBlock extends BaseBlock {
    readonly type = 'fx.pingpong';
    readonly category = 'Delay';
    readonly name = 'Ping Pong Delay';
    readonly description = 'Stereo delay with alternating left/right taps';
    readonly color = '#4CAF50';
    readonly width = 180;
    
    constructor() {
        super();
        
        this._inputs = [
            { id: 'in', name: 'Input', type: 'audio', required: true },
            { id: 'delay_time', name: 'Delay Time', type: 'control', required: false }
        ];
        
        this._outputs = [
            { id: 'left', name: 'Left Out', type: 'audio' },
            { id: 'right', name: 'Right Out', type: 'audio' }
        ];
        
        this._parameters = [
            {
                id: 'length',
                name: 'Max Length',
                type: 'number',
                default: 0.9,
                min: 0.01,
                max: 2.0,
                step: 0.01,
                description: 'Maximum delay length in seconds. Actual max = 32768 samples / sample rate (1.0s @ 32768 Hz).'
            },
            {
                id: 'tap0Level',
                name: 'Left Tap Level',
                type: 'number',
                default: 0.65,
                min: 0.0,
                max: 1.0,
                step: 0.01,
                description: 'Left tap output level'
            },
            {
                id: 'tap1Level',
                name: 'Right Tap Level',
                type: 'number',
                default: 0.65,
                min: 0.0,
                max: 1.0,
                step: 0.01,
                description: 'Right tap output level'
            },
            {
                id: 'fbLevel',
                name: 'Feedback',
                type: 'number',
                default: 0.05,
                min: 0.0,
                max: 0.99,
                step: 0.01,
                description: 'Feedback amount'
            },
            {
                id: 'delayGain',
                name: 'Delay Line Gain',
                type: 'number',
                default: 0.85,
                min: 0.0,
                max: 1.0,
                step: 0.01,
                description: 'Gain when writing to delay line'
            },
            {
                id: 'defaultGain',
                name: 'Input Gain',
                type: 'number',
                default: 1.0,
                min: 0.0,
                max: 2.0,
                step: 0.01,
                description: 'Default input gain (when not CV controlled)'
            }
        ];
        
        this.autoCalculateHeight();
    }
    
    generateCode(ctx: CodeGenContext): void {
                // Get parameters
        const lengthRequested = this.getParameterValue(ctx, this.type, 'length', 0.9);
        const tap0Level = this.getParameterValue(ctx, this.type, 'tap0Level', 0.65);
        const tap1Level = this.getParameterValue(ctx, this.type, 'tap1Level', 0.65);
        const fbLevel = this.getParameterValue(ctx, this.type, 'fbLevel', 0.05);
        const delayGain = this.getParameterValue(ctx, this.type, 'delayGain', 0.85);
        const defaultGain = this.getParameterValue(ctx, this.type, 'defaultGain', 1.0);
        
        // Clamp length to actual maximum based on sample rate
        const absoluteMaxDelay = this.getMaxDelayTime();
        const length = Math.min(lengthRequested, absoluteMaxDelay);
        
        const inputReg = ctx.getInputRegister(this.type, 'in');
        const gainCtrlReg = ctx.getInputRegister(this.type, 'delay_time');
        
        if (!inputReg) {
            ctx.pushMainCode(`; Ping Pong Delay (no input connected)`);        }
        
        // Warn if clamped
        if (lengthRequested > absoluteMaxDelay) {
            ctx.pushMainCode(`; WARNING: Requested delay time ${lengthRequested}s exceeds maximum ${absoluteMaxDelay.toFixed(3)}s`);
            ctx.pushMainCode(`;          at sample rate ${this.getSampleRate()} Hz. Clamped to ${absoluteMaxDelay.toFixed(3)}s`);
        }
        
        // Allocate memory and registers
        const delaySamples = this.timeToSamples(length);
        const delayMem = ctx.allocateMemory(this.type, delaySamples);
        
        const leftOutReg = ctx.allocateRegister(this.type, 'left');
        const rightOutReg = ctx.allocateRegister(this.type, 'right');
        
        // Tap positions (equally spaced for ping pong)
        const tap0Offset = Math.floor(delaySamples * (4.0 / 8.0));  // 50% of max
        const tap1Offset = 0;  // End of delay line (100%)
        
        ctx.pushMainCode(`; Ping Pong Delay @ ${this.getSampleRate()} Hz`);
        ctx.pushMainCode(`; Memory: ${delayMem.name} @ ${delayMem.address} (${delaySamples} samples = ${length.toFixed(3)}s)`);
        ctx.pushMainCode(`; Taps: Left=${tap0Offset}, Right=${tap1Offset}`);
        ctx.pushMainCode('');
        
        // Scale input by gain control or default
        if (gainCtrlReg) {
            ctx.pushMainCode(`rdax ${inputReg}, 1.0`);
            ctx.pushMainCode(`mulx ${gainCtrlReg}  ; Apply gain CV`);
        } else {
            const gainConst = ctx.getStandardConstant(defaultGain);
            ctx.pushMainCode(`rdax ${inputReg}, ${gainConst}`);
        }
        
        // Add feedback from right output
        const fbConst = ctx.getStandardConstant(fbLevel);
        ctx.pushMainCode(`rdax ${rightOutReg}, ${fbConst}  ; Add feedback from right tap`);
        
        // Write to delay line
        const delayGainConst = ctx.getStandardConstant(delayGain);
        ctx.pushMainCode(`wra ${delayMem.name}, ${delayGainConst}  ; Write to delay line`);
        ctx.pushMainCode('');
        
        // Read left tap (50% position)
        const tap0Const = ctx.getStandardConstant(tap0Level);
        if (tap0Offset > 0) {
            ctx.pushMainCode(`rda ${delayMem.name} + ${tap0Offset}, ${tap0Const}  ; Read left tap`);
        } else {
            ctx.pushMainCode(`rda ${delayMem.name}#, ${tap0Const}  ; Read left tap`);
        }
        ctx.pushMainCode(`wrax ${leftOutReg}, 0`);
        ctx.pushMainCode('');
        
        // Read right tap (100% position = end of delay)
        const tap1Const = ctx.getStandardConstant(tap1Level);
        ctx.pushMainCode(`rda ${delayMem.name}#, ${tap1Const}  ; Read right tap (end)`);
        ctx.pushMainCode(`wrax ${rightOutReg}, 0`);
        ctx.pushMainCode('');    }
}
