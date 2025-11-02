/**
 * Chorus effect block
 * Translated from SpinCAD's ChorusCADBlock.java (generated from Chorus.spincad)
 * 
 * Classic chorus effect using LFO-modulated delay line
 * 
 * Translation Notes:
 * - LFO is initialized with hardcoded values (50, 64) on first run
 * - Chorus center uses safety bounds: delayOffset + (0.9 * tap1Center * delayLength) + 0.05 * delayLength
 * - Control inputs can modulate LFO rate and width dynamically
 * - Uses CHO RDA instructions for interpolated delay reading
 */

import { BaseBlock } from '../../base/BaseBlock.js';
import { CodeGenContext } from '../../../types/Block.js';

export class ChorusBlock extends BaseBlock {
    readonly type = 'fx.chorus';
    readonly category = 'Modulation';
    readonly name = 'Chorus';
    readonly description = 'Classic chorus with LFO-modulated delay';
    readonly color = '#24f2f2';  // From SpinCAD: 0x24f2f2
    readonly width = 180;
    
    // Constants from SpinCAD
    private readonly DELAY_MAX = 512;
    private readonly RATE_MAX = this.DELAY_MAX - 1;
    private readonly NUMBER_6554000 = 6554000.0;
    
    constructor() {
        super();
        
        this._inputs = [
            { id: 'in', name: 'Input', type: 'audio', required: true },
            { id: 'lfo_rate', name: 'LFO Rate', type: 'control', required: false },
            { id: 'lfo_width', name: 'LFO Width', type: 'control', required: false }
        ];
        
        this._outputs = [
            { id: 'out', name: 'Output', type: 'audio' }
        ];
        
        this._parameters = [
            {
                id: 'delayLength',
                name: 'Chorus Time',
                type: 'number',
                // Code values (samples)
                default: this.DELAY_MAX,
                min: 128,
                max: 2048,
                step: 1,
                // Display values (milliseconds)
                displayMin: this.samplesToMs(128),
                displayMax: this.samplesToMs(2048),
                displayStep: 0.1,
                displayDecimals: 1,
                displayUnit: 'ms',
                // Conversion functions
                toDisplay: (samples: number) => this.samplesToMs(samples),
                fromDisplay: (ms: number) => this.msToSamples(ms),
                description: 'Delay buffer length'
            },
            {
                id: 'tap1Center',
                name: 'Tap Center',
                type: 'number',
                default: 0.5,
                min: 0.25,
                max: 0.75,
                step: 0.01,
                displayDecimals: 2,
                description: 'Center position of modulated tap (0.25-0.75)'
            },
            {
                id: 'rate',
                name: 'LFO Rate',
                type: 'number',
                // Code values (0-511 internal rate)
                default: 20,
                min: 0,
                max: this.RATE_MAX,
                step: 1,
                // Display values (Hz)
                displayMin: 0.0,
                displayMax: this.lfoRateToHz(this.RATE_MAX),
                displayStep: 0.01,
                displayDecimals: 2,
                displayUnit: 'Hz',
                // Conversion functions (from AN-001)
                // f = Kf * Fs / (2^17 * 2*pi)
                // Kf = 2^17 * (2*pi*f / Fs)
                toDisplay: (rate: number) => this.lfoRateToHz(rate),
                fromDisplay: (hz: number) => this.hzToLfoRate(hz),
                description: 'Base LFO speed'
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
                description: 'LFO modulation depth percentage (5-100%)'
            },
            {
                id: 'lfoSel',
                name: 'LFO Select',
                type: 'select',
                default: 0,
                options: [
                    { value: 0, label: 'LFO 0' },
                    { value: 1, label: 'LFO 1' }
                ],
                description: 'Which LFO oscillator to use (SIN0 or SIN1)'
            }
        ];
        
        this.autoCalculateHeight();
    }
    
    generateCode(ctx: CodeGenContext): void {
                // Get input register - if not connected, return early
        const inputReg = ctx.getInputRegister(this.type, 'in');
        if (!inputReg) {
            ctx.pushMainCode(`; Chorus (no input connected)`);        }
        
        // Get control input registers (may be undefined if not connected)
        const rateInReg = ctx.getInputRegister(this.type, 'lfo_rate');
        const widthInReg = ctx.getInputRegister(this.type, 'lfo_width');
        
        // Get parameters
        const delayLength = Math.floor(this.getParameterValue(ctx, this.type, 'delayLength', 512));
        const tap1Center = this.getParameterValue(ctx, this.type, 'tap1Center', 0.5);
        const rate = this.getParameterValue(ctx, this.type, 'rate', 20);
        const width = this.getParameterValue(ctx, this.type, 'width', 30);
        const lfoSel = Math.floor(this.getParameterValue(ctx, this.type, 'lfoSel', 0));
        
        // Allocate output register
        const outputReg = ctx.allocateRegister(this.type, 'out');
        
        // Allocate delay memory - use maximum size from parameter definition
        // This ensures the memory is large enough even if user changes delayLength later
        const delayLengthParam = this._parameters.find(p => p.id === 'delayLength');
        if (!delayLengthParam?.max) {
            throw new Error(`Chorus block: delayLength parameter or its max value is not defined`);
        }
        const maxDelayLength = delayLengthParam.max;
        const memory = ctx.allocateMemory(this.type, maxDelayLength);
        const delayOffset = memory.address;
        const memoryName = memory.name;
        
        ctx.pushMainCode(`; Chorus`);
        ctx.pushMainCode('');
        
        // Initialize LFO (skip if already running)
        // Note: SpinCAD uses hardcoded values (50, 64) here, not the parameter values
        const lfoNum = lfoSel === 0 ? 'SIN0' : 'SIN1';
        ctx.pushInitCode(`; Initialize ${lfoNum} (once at startup)`);
        ctx.pushInitCode(`skp run, chorus_${this.sanitizeLabelForAsm(this.type)}_running`);
        ctx.pushInitCode(`wlds ${lfoNum}, 50, 64`);
        ctx.pushInitCode(`chorus_${this.sanitizeLabelForAsm(this.type)}_running:`);
        ctx.pushInitCode('');
        
        // Handle LFO width control input if connected
        if (widthInReg) {
            const x1 = delayLength * width;
            const x3 = x1 / this.NUMBER_6554000;
            
            ctx.pushMainCode(`; LFO Width control input`);
            ctx.pushMainCode(`rdax ${widthInReg}, ${this.formatS1_14(x3)}`);
            const rangeReg = lfoSel === 0 ? 'SIN0_RANGE' : 'SIN1_RANGE';
            ctx.pushMainCode(`wrax ${rangeReg}, 0`);
            ctx.pushMainCode('');
        }
        
        // Handle LFO rate control input if connected
        if (rateInReg) {
            const temp1 = rate / this.RATE_MAX;
            
            ctx.pushMainCode(`; LFO Rate control input`);
            ctx.pushMainCode(`rdax ${rateInReg}, ${this.formatS1_14(temp1)}`);
            const rateReg = lfoSel === 0 ? 'SIN0_RATE' : 'SIN1_RATE';
            ctx.pushMainCode(`wrax ${rateReg}, 0`);
            ctx.pushMainCode('');
        }
        
        // Process audio through delay
        ctx.pushMainCode(`; Write input to delay line`);
        ctx.pushMainCode(`ldax ${inputReg}`);
        ctx.pushMainCode(`wra ${memoryName}, 0`);
        ctx.pushMainCode('');
        
        // Read chorus tap with LFO modulation
        // Careful to not put center point too close to the end or beginning
        const chorusCenter = Math.floor(delayOffset + (0.9 * tap1Center * delayLength) + 0.05 * delayLength);
        
        ctx.pushMainCode(`; Read modulated tap (interpolated)`);
        ctx.pushMainCode(`; Chorus center at ${chorusCenter}`);
        
        // CHO RDA instructions for interpolated delay reading
        // First read: SIN|REG|COMPC for fractional interpolation
        const flag1 = lfoSel === 0 ? 'SIN0' : 'SIN1';
        ctx.pushMainCode(`cho rda, ${flag1}, SIN | REG | COMPC, ${chorusCenter}`);
        
        // Second read: SIN flag for next sample
        ctx.pushMainCode(`cho rda, ${flag1}, SIN, ${chorusCenter + 1}`);
        ctx.pushMainCode('');
        
        ctx.pushMainCode(`wrax ${outputReg}, 0`);
        ctx.pushMainCode('');    }
    
    /**
     * Sanitize type identifier for use in assembly labels
     */
    private sanitizeLabelForAsm(type: string): string {
        return type.replace(/\./g, '_');
    }
}
