/**
 * ThreeTap - Triple tap delay with independent outputs and CV control
 * Converted from SpinCAD TripleTap block
 */

import { BaseBlock } from '../../base/BaseBlock.js';
import { CodeGenContext } from '../../../types/Block.js';

export class TripleTapDelayBlock extends BaseBlock {
    readonly type = 'fx.delay.tripletap';
    readonly category = 'Delay';
    readonly name = 'ThreeTap';
    readonly description = 'Triple tap delay with independent outputs and CV modulation';
    readonly color = '#6060c4';
    readonly width = 200;

    constructor() {
        super();

        this._inputs = [
            { id: 'in', name: 'Input', type: 'audio', required: true },
            { id: 'feedback', name: 'Feedback', type: 'audio', required: false },
            { id: 'delay_time_1', name: 'Delay Time 1', type: 'control', required: false },
            { id: 'delay_time_2', name: 'Delay Time 2', type: 'control', required: false },
            { id: 'delay_time_3', name: 'Delay Time 3', type: 'control', required: false },
            { id: 'fbk_ctrl', name: 'Feedback Gain', type: 'control', required: false }
        ];

        this._outputs = [
            { id: 'tap1', name: 'Tap 1 Out', type: 'audio' },
            { id: 'tap2', name: 'Tap 2 Out', type: 'audio' },
            { id: 'tap3', name: 'Tap 3 Out', type: 'audio' }
        ];

        this._parameters = [
            {
                id: 'inputGain',
                name: 'Input Gain (dB)',
                type: 'number',
                default: 0,
                min: -24,
                max: 0,
                step: 1,
                description: 'Input gain in decibels (-24 to 0 dB)'
            },
            {
                id: 'fbkGain',
                name: 'Feedback Gain (dB)',
                type: 'number',
                default: -6,
                min: -24,
                max: 0,
                step: 1,
                description: 'Feedback gain in decibels (-24 to 0 dB)'
            },
            {
                id: 'delayLength',
                name: 'Delay Time (samples)',
                type: 'number',
                default: 16384,
                min: 100,
                max: 32767,
                step: 100,
                description: 'Total delay buffer length in samples (max delay time)'
            },
            {
                id: 'tap1Ratio',
                name: 'Tap 1 Time (%)',
                type: 'number',
                default: 0.85,
                min: 0.0,
                max: 1.0,
                step: 0.01,
                description: 'Tap 1 delay time as percentage of total delay (0.0 to 1.0)'
            },
            {
                id: 'tap2Ratio',
                name: 'Tap 2 Time (%)',
                type: 'number',
                default: 0.60,
                min: 0.0,
                max: 1.0,
                step: 0.01,
                description: 'Tap 2 delay time as percentage of total delay (0.0 to 1.0)'
            },
            {
                id: 'tap3Ratio',
                name: 'Tap 3 Time (%)',
                type: 'number',
                default: 0.45,
                min: 0.0,
                max: 1.0,
                step: 0.01,
                description: 'Tap 3 delay time as percentage of total delay (0.0 to 1.0)'
            }
        ];

        this.autoCalculateHeight();
    }

    generateCode(ctx: CodeGenContext): string[] {
        const code: string[] = [];

        // Get input register
        const inputReg = ctx.getInputRegister(this.type, 'in');
        if (!inputReg) {
            code.push(`; ThreeTap (no input connected)`);
            return code;
        }

        // Get optional inputs
        const feedbackReg = ctx.getInputRegister(this.type, 'feedback');
        const delayTime1Ctrl = ctx.getInputRegister(this.type, 'delay_time_1');
        const delayTime2Ctrl = ctx.getInputRegister(this.type, 'delay_time_2');
        const delayTime3Ctrl = ctx.getInputRegister(this.type, 'delay_time_3');
        const fbkCtrl = ctx.getInputRegister(this.type, 'fbk_ctrl');

        // Get parameters
        const inputGainDb = this.getParameterValue(ctx, this.type, 'inputGain', 0);
        const fbkGainDb = this.getParameterValue(ctx, this.type, 'fbkGain', -6);
        const delayLength = Math.floor(this.getParameterValue(ctx, this.type, 'delayLength', 16384));
        const tap1Ratio = this.getParameterValue(ctx, this.type, 'tap1Ratio', 0.85);
        const tap2Ratio = this.getParameterValue(ctx, this.type, 'tap2Ratio', 0.60);
        const tap3Ratio = this.getParameterValue(ctx, this.type, 'tap3Ratio', 0.45);

        // Convert dB to linear
        const inputGain = BaseBlock.dbToLinear(inputGainDb);
        const fbkGain = BaseBlock.dbToLinear(fbkGainDb);

        // Allocate delay memory
        const memory = ctx.allocateMemory(this.type, delayLength);
        const delayOffset = memory.address;

        code.push(`; ThreeTap - ${this.samplesToMs(delayLength).toFixed(1)}ms`);
        code.push(`; Taps at ${(tap1Ratio * 100).toFixed(0)}%, ${(tap2Ratio * 100).toFixed(0)}%, ${(tap3Ratio * 100).toFixed(0)}%`);

        // Write input + feedback to delay line
        if (feedbackReg) {
            code.push(`; Add feedback to input`);
            code.push(`rdax ${feedbackReg}, ${this.formatS1_14(fbkGain)}`);
            
            // If feedback gain CV is connected, modulate it
            if (fbkCtrl) {
                code.push(`mulx ${fbkCtrl}`);
            }
        }

        code.push(`rdax ${inputReg}, ${this.formatS1_14(inputGain)}`);
        code.push(`wra ${memory.name}, 0.0`);

        // Generate code for each connected tap output
        const taps = [
            { id: 'tap1', ratio: tap1Ratio, ctrl: delayTime1Ctrl },
            { id: 'tap2', ratio: tap2Ratio, ctrl: delayTime2Ctrl },
            { id: 'tap3', ratio: tap3Ratio, ctrl: delayTime3Ctrl }
        ];

        taps.forEach((tap, index) => {
            const outputReg = ctx.allocateRegister(this.type, tap.id);
            if (outputReg) {
                const tapNum = index + 1;
                code.push(``);
                code.push(`; Tap ${tapNum} - ${(tap.ratio * 100).toFixed(0)}% of delay`);
                
                // Load 0.5 in S1.14 format (0x7FFF00 >> 8 = 0x7FFF)
                // This is the base value for ADDR_PTR calculation
                code.push(`clr`);
                code.push(`or $7FFF00`);
                
                // If delay time CV is connected, multiply by it
                if (tap.ctrl) {
                    code.push(`mulx ${tap.ctrl}`);
                }
                
                // Calculate scale and offset for this tap
                // SpinCAD formula: scale = (0.95 * ratio * length) / 32768
                //                  offset = (delayOffset + 0.05 * ratio * length) / 32768
                const scale = (0.95 * tap.ratio * delayLength) / 32768.0;
                const offset = (delayOffset + (0.05 * tap.ratio * delayLength)) / 32768.0;
                
                // SOF: Scale and offset - this calculates the delay address
                code.push(`sof ${this.formatS1_14(scale)}, ${this.formatS1_14(offset)}`);
                
                // Write to ADDR_PTR register to set read address
                code.push(`wrax ADDR_PTR, 0`);
                
                // Read from delay at calculated address with interpolation
                code.push(`rmpa ${this.formatS1_14(1.0)}`);
                
                // Store in output register
                code.push(`wrax ${outputReg}, 0.0`);
            }
        });

        return code;
    }
}
