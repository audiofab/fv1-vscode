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
                name: 'Delay Time',
                type: 'number',
                default: 16384,
                min: 100,
                max: 32767,
                step: 1,
                displayMin: this.samplesToMs(100),
                displayMax: this.samplesToMs(32767),
                displayStep: 0.1,
                displayDecimals: 2,
                displayUnit: 'ms',
                toDisplay: (samples: number) => this.samplesToMs(samples),
                fromDisplay: (ms: number) => this.msToSamples(ms),
                description: 'Total delay buffer length in milliseconds'
            },
            {
                id: 'tap1Ratio',
                name: 'Tap 1 Time',
                type: 'number',
                default: 0.85,
                min: 0.0,
                max: 1.0,
                step: 0.01,
                displayMin: 0,
                displayMax: 100,
                displayStep: 1,
                displayDecimals: 0,
                displayUnit: '%',
                toDisplay: (ratio: number) => ratio * 100,
                fromDisplay: (percent: number) => percent / 100,
                description: 'Tap 1 delay time as percentage of total delay'
            },
            {
                id: 'tap2Ratio',
                name: 'Tap 2 Time',
                type: 'number',
                default: 0.60,
                min: 0.0,
                max: 1.0,
                step: 0.01,
                displayMin: 0,
                displayMax: 100,
                displayStep: 1,
                displayDecimals: 0,
                displayUnit: '%',
                toDisplay: (ratio: number) => ratio * 100,
                fromDisplay: (percent: number) => percent / 100,
                description: 'Tap 2 delay time as percentage of total delay'
            },
            {
                id: 'tap3Ratio',
                name: 'Tap 3 Time',
                type: 'number',
                default: 0.45,
                min: 0.0,
                max: 1.0,
                step: 0.01,
                displayMin: 0,
                displayMax: 100,
                displayStep: 1,
                displayDecimals: 0,
                displayUnit: '%',
                toDisplay: (ratio: number) => ratio * 100,
                fromDisplay: (percent: number) => percent / 100,
                description: 'Tap 3 delay time as percentage of total delay'
            }
        ];

        this.autoCalculateHeight();
    }

    generateCode(ctx: CodeGenContext): void {
        const zero = ctx.getStandardConstant(0.0);
        const one = ctx.getStandardConstant(1.0);

                // Get input register
        const inputReg = ctx.getInputRegister(this.type, 'in');
        if (!inputReg) {
            ctx.pushMainCode(`; ThreeTap (no input connected)`);
            return; // Don't generate code if input is not connected
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

        ctx.pushMainCode(`; ThreeTap - ${this.samplesToMs(delayLength).toFixed(1)}ms`);
        ctx.pushMainCode(`; Taps at ${(tap1Ratio * 100).toFixed(0)}%, ${(tap2Ratio * 100).toFixed(0)}%, ${(tap3Ratio * 100).toFixed(0)}%`);

        // Write input + feedback to delay line
        if (feedbackReg) {
            ctx.pushMainCode(`; Add feedback to input`);
            ctx.pushMainCode(`rdax ${feedbackReg}, ${this.formatS1_14(fbkGain)}`);
            
            // If feedback gain CV is connected, modulate it
            if (fbkCtrl) {
                ctx.pushMainCode(`mulx ${fbkCtrl}`);
            }
        }

        ctx.pushMainCode(`rdax ${inputReg}, ${this.formatS1_14(inputGain)}`);
        ctx.pushMainCode(`wra ${memory.name}, ${zero}`);

        // Generate code for each connected tap output
        const taps = [
            { id: 'tap1', ratio: tap1Ratio, ctrl: delayTime1Ctrl },
            { id: 'tap2', ratio: tap2Ratio, ctrl: delayTime2Ctrl },
            { id: 'tap3', ratio: tap3Ratio, ctrl: delayTime3Ctrl }
        ];

        taps.forEach((tap, index) => {
            // OPTIMIZATION: Only generate code for connected outputs
            if (!ctx.isOutputConnected(this.type, tap.id)) {
                return; // Skip this tap - it's not connected
            }
            
            const outputReg = ctx.allocateRegister(this.type, tap.id);
            const tapNum = index + 1;
            ctx.pushMainCode(``);
            ctx.pushMainCode(`; Tap ${tapNum} - ${(tap.ratio * 100).toFixed(0)}% of delay`);
            
            // Load 0.5 in S1.14 format (0x7FFF00 >> 8 = 0x7FFF)
            // This is the base value for ADDR_PTR calculation
            ctx.pushMainCode(`clr`);
            ctx.pushMainCode(`or $7FFF00`);
            
            // If delay time CV is connected, multiply by it
            if (tap.ctrl) {
                ctx.pushMainCode(`mulx ${tap.ctrl}`);
            }
            
            // Calculate scale and offset for this tap
            // SpinCAD formula: scale = (0.95 * ratio * length) / 32768
            //                  offset = (delayOffset + 0.05 * ratio * length) / 32768
            const scale = (0.95 * tap.ratio * delayLength) / 32768.0;
            const offset = (delayOffset + (0.05 * tap.ratio * delayLength)) / 32768.0;
            
            // SOF: Scale and offset - this calculates the delay address
            ctx.pushMainCode(`sof ${this.formatS1_14(scale)}, ${this.formatS1_14(offset)}`);
            
            // Write to ADDR_PTR register to set read address
            ctx.pushMainCode(`wrax ADDR_PTR, ${zero}`);
            
            // Read from delay at calculated address with interpolation
            ctx.pushMainCode(`rmpa ${one}`);
            
            // Store in output register
            ctx.pushMainCode(`wrax ${outputReg}, ${zero}`);
        });    }
}
