/**
 * Flanger Effect Block
 * Variable delay with LFO modulation and feedback for classic flanging effect
 */

import { BaseBlock } from '../../base/BaseBlock.js';
import { CodeGenContext } from '../../../types/Block.js';

export class FlangerBlock extends BaseBlock {
    readonly type = 'effects.modulation.flanger';
    readonly category = 'Modulation';
    readonly name = 'Flanger';
    readonly description = 'Classic flanger effect with LFO modulation';
    readonly color = '#24F2F2';
    readonly width = 180;
    
    constructor() {
        super();
        
        this._inputs = [
            { id: 'input', name: 'Input', type: 'audio', required: true },
            { id: 'feedbackIn', name: 'Feedback In', type: 'audio', required: false },
            { id: 'rateIn', name: 'LFO Rate', type: 'control', required: false },
            { id: 'widthIn', name: 'LFO Width', type: 'control', required: false },
            { id: 'fbk', name: 'Feedback Gain', type: 'control', required: false }
        ];
        
        this._outputs = [
            { id: 'output', name: 'Output', type: 'audio' },
            { id: 'tap', name: 'Tap', type: 'audio' }
        ];
        
        this._parameters = [
            {
                id: 'inputGain',
                name: 'Input Gain',
                type: 'number',
                default: BaseBlock.dbToLinear(0),
                min: BaseBlock.dbToLinear(-24),
                max: BaseBlock.dbToLinear(0),
                step: 0.01,
                displayMin: -24,
                displayMax: 0,
                displayStep: 0.1,
                displayDecimals: 1,
                displayUnit: 'dB',
                toDisplay: (linear: number) => BaseBlock.linearToDb(linear),
                fromDisplay: (db: number) => BaseBlock.dbToLinear(db),
                description: 'Input signal gain'
            },
            {
                id: 'fbkGain',
                name: 'Feedback Gain',
                type: 'number',
                default: BaseBlock.dbToLinear(-6),
                min: BaseBlock.dbToLinear(-24),
                max: BaseBlock.dbToLinear(0),
                step: 0.01,
                displayMin: -24,
                displayMax: 0,
                displayStep: 0.1,
                displayDecimals: 1,
                displayUnit: 'dB',
                toDisplay: (linear: number) => BaseBlock.linearToDb(linear),
                fromDisplay: (db: number) => BaseBlock.dbToLinear(db),
                description: 'Feedback gain amount'
            },
            {
                id: 'delayLength',
                name: 'Delay Time',
                type: 'number',
                default: 64,
                min: 16,
                max: 512,
                step: 1,
                displayMin: this.samplesToMs(16),
                displayMax: this.samplesToMs(512),
                displayStep: 0.1,
                displayDecimals: 2,
                displayUnit: 'ms',
                toDisplay: (samples: number) => this.samplesToMs(samples),
                fromDisplay: (ms: number) => this.msToSamples(ms),
                description: 'Delay line length (sweep center point)'
            },
            {
                id: 'rate',
                name: 'LFO Rate',
                type: 'number',
                default: 20,
                min: 0,
                max: 511,
                step: 1,
                displayMin: 0.0,
                displayMax: this.lfoRateToHz(511),
                displayStep: 0.1,
                displayDecimals: 1,
                displayUnit: 'Hz',
                toDisplay: (rate: number) => this.lfoRateToHz(rate),
                fromDisplay: (hz: number) => this.hzToLfoRate(hz),
                description: 'LFO modulation rate'
            },
            {
                id: 'width',
                name: 'LFO Width',
                type: 'number',
                default: 30,
                min: 5,
                max: 100,
                step: 1,
                displayDecimals: 0,
                displayUnit: '%',
                description: 'LFO modulation depth (5-100%)'
            },
            {
                id: 'lfoSel',
                name: 'LFO Select',
                type: 'select',
                default: 0,
                options: [
                    { label: 'LFO 0', value: 0 },
                    { label: 'LFO 1', value: 1 }
                ],
                description: 'Which LFO oscillator to use'
            }
        ];
        
        this.autoCalculateHeight();
    }

    /**
     * Display which LFO is being used
     */
    getCustomLabel(parameters: Record<string, any>): string | null {
        const lfoSel = parameters['lfoSel'] ?? 0;
        return `LFO ${lfoSel}`;
    }

    generateCode(ctx: CodeGenContext): void {
        const inputReg = ctx.getInputRegister(this.type, 'input');
        const feedbackInReg = ctx.getInputRegister(this.type, 'feedbackIn');
        const rateInReg = ctx.getInputRegister(this.type, 'rateIn');
        const widthInReg = ctx.getInputRegister(this.type, 'widthIn');
        const fbkReg = ctx.getInputRegister(this.type, 'fbk');
        
        if (!inputReg) {
            ctx.pushMainCode(`; Flanger (no input connected)`);
            return;
        }
        
        // Get parameters
        const inputGain = this.getParameterValue(ctx, this.type, 'inputGain', 1.0);
        const fbkGain = this.getParameterValue(ctx, this.type, 'fbkGain', 0.5);
        const delayLength = this.getParameterValue(ctx, this.type, 'delayLength', 64);
        const rate = this.getParameterValue(ctx, this.type, 'rate', 20);
        const width = this.getParameterValue(ctx, this.type, 'width', 30);
        const lfoSel = this.getParameterValue(ctx, this.type, 'lfoSel', 0);
        
        // Allocate delay memory
        const memory = ctx.allocateMemory(this.type, delayLength);
        const delayOffset = memory.address;
        const memoryName = memory.name;
        
        // Allocate output registers
        const outputReg = ctx.allocateRegister(this.type, 'output');
        
        // Get standard constants
        const zero = ctx.getStandardConstant(0.0);
        const one = ctx.getStandardConstant(1.0);
        
        ctx.pushMainCode(`; Flanger`);
        
        // Initialize LFO (only once at startup)
        const labelInit = `flanger_${this.sanitizeLabelForAsm(this.type)}_init`;
        const number6554000 = 6554000.0;
        const twoHundred = 200.0;
        const x1 = delayLength * width;
        const x3 = x1 / number6554000;
        const x2 = x1 / twoHundred;
        
        const lfoName = lfoSel === 0 ? 'SIN0' : 'SIN1';
        const lfoRangeName = lfoSel === 0 ? 'SIN0_RANGE' : 'SIN1_RANGE';
        const lfoRateName = lfoSel === 0 ? 'SIN0_RATE' : 'SIN1_RATE';
        
        ctx.pushInitCode(`; Flanger LFO init`);
        ctx.pushInitCode(`skp run, ${labelInit}`);
        ctx.pushInitCode(`wlds ${lfoName}, ${rate}, ${Math.floor(x2)}`);
        ctx.pushInitCode(`${labelInit}:`);
        
        // Scale LFO width by control input if connected
        if (widthInReg) {
            ctx.pushMainCode(`rdax ${widthInReg}, ${this.formatS1_14(x3)}`);
            ctx.pushMainCode(`wrax ${lfoRangeName}, ${zero}`);
        }
        
        // Scale LFO rate by control input if connected
        if (rateInReg) {
            const rateMax = 511;
            const temp1 = rate / rateMax;
            ctx.pushMainCode(`rdax ${rateInReg}, ${this.formatS1_14(temp1)}`);
            ctx.pushMainCode(`wrax ${lfoRateName}, ${zero}`);
        }
        
        // Process feedback if connected
        if (feedbackInReg) {
            ctx.pushMainCode(`rdax ${feedbackInReg}, ${this.formatS1_14(fbkGain)}`);
            if (fbkReg) {
                ctx.pushMainCode(`mulx ${fbkReg}`);
            }
        }
        
        // Mix input
        ctx.pushMainCode(`rdax ${inputReg}, ${this.formatS1_14(inputGain)}`);
        
        // Write to delay
        ctx.pushMainCode(`wra ${memoryName}, ${zero}`);
        
        // Read from delay with chorus/flanger modulation
        // Calculate center point (0.9 * 0.5 * delayLength + 0.05 * delayLength)
        const tap1Center = 0.5;
        const chorusCenter = Math.floor(delayOffset + (0.9 * tap1Center * delayLength) + 0.05 * delayLength);
        
        // Four-phase interpolated chorus read
        const flags = lfoSel === 0 ? 'SIN0' : 'SIN1';
        ctx.pushMainCode(`cho rda, ${flags}, REG|COMPC, ${chorusCenter}`);
        ctx.pushMainCode(`cho rda, ${flags}, SIN, ${chorusCenter + 1}`);
        
        // Write output
        ctx.pushMainCode(`wrax ${outputReg}, ${zero}`);
        
        // Optional center tap output (if connected to something)
        if (ctx.isOutputConnected(this.type, 'tap')) {
            const tapReg = ctx.allocateRegister(this.type, 'tap');
            ctx.pushMainCode(`rda ${memoryName}^, ${one}`);
            ctx.pushMainCode(`wrax ${tapReg}, ${zero}`);
        }
        
        ctx.pushMainCode('');
    }
}
