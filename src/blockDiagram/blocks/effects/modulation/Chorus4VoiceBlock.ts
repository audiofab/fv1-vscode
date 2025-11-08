/**
 * 4-Voice Chorus Effect Block
 * Four independent chorus voices with individual tap points
 */

import { BaseBlock } from '../../base/BaseBlock.js';
import { CodeGenContext } from '../../../types/Block.js';

export class Chorus4VoiceBlock extends BaseBlock {
    readonly type = 'effects.modulation.chorus4voice';
    readonly category = 'Modulation';
    readonly name = '4-Voice Chorus';
    readonly description = 'Four-voice chorus with independent outputs';
    readonly color = '#24F2F2';
    readonly width = 180;
    
    constructor() {
        super();
        
        this._inputs = [
            { id: 'input', name: 'Input', type: 'audio', required: true },
            { id: 'rateIn', name: 'LFO Rate', type: 'control', required: false },
            { id: 'widthIn', name: 'LFO Width', type: 'control', required: false }
        ];
        
        this._outputs = [
            { id: 'voice1', name: 'Voice 1', type: 'audio' },
            { id: 'voice2', name: 'Voice 2', type: 'audio' },
            { id: 'voice3', name: 'Voice 3', type: 'audio' },
            { id: 'voice4', name: 'Voice 4', type: 'audio' }
        ];
        
        this._parameters = [
            {
                id: 'gain1',
                name: 'Input Gain',
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
                description: 'Input signal gain'
            },
            {
                id: 'delayLength',
                name: 'Chorus Time',
                type: 'number',
                default: 512,
                min: 0,
                max: 2048,
                step: 1,
                displayMin: this.samplesToMs(0),
                displayMax: this.samplesToMs(2048),
                displayStep: 0.1,
                displayDecimals: 2,
                displayUnit: 'ms',
                toDisplay: (samples: number) => this.samplesToMs(samples),
                fromDisplay: (ms: number) => this.msToSamples(ms),
                description: 'Delay line length'
            },
            {
                id: 'tap1Center',
                name: 'Tap 1 Center',
                type: 'number',
                default: 0.25,
                min: 0.0,
                max: 1.0,
                step: 0.001,
                displayDecimals: 3,
                description: 'Voice 1 tap position (0-1)'
            },
            {
                id: 'tap2Center',
                name: 'Tap 2 Center',
                type: 'number',
                default: 0.33,
                min: 0.0,
                max: 1.0,
                step: 0.001,
                displayDecimals: 3,
                description: 'Voice 2 tap position (0-1)'
            },
            {
                id: 'tap3Center',
                name: 'Tap 3 Center',
                type: 'number',
                default: 0.63,
                min: 0.0,
                max: 1.0,
                step: 0.001,
                displayDecimals: 3,
                description: 'Voice 3 tap position (0-1)'
            },
            {
                id: 'tap4Center',
                name: 'Tap 4 Center',
                type: 'number',
                default: 0.75,
                min: 0.0,
                max: 1.0,
                step: 0.001,
                displayDecimals: 3,
                description: 'Voice 4 tap position (0-1)'
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
                default: 64,
                min: 0,
                max: 200,
                step: 1,
                displayDecimals: 1,
                description: 'LFO modulation depth'
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
        const rateInReg = ctx.getInputRegister(this.type, 'rateIn');
        const widthInReg = ctx.getInputRegister(this.type, 'widthIn');
        
        if (!inputReg) {
            ctx.pushMainCode(`; 4-Voice Chorus (no input connected)`);
            return;
        }
        
        // Get parameters
        const gain1 = this.getParameterValue(ctx, this.type, 'gain1', 1.0);
        const delayLength = this.getParameterValue(ctx, this.type, 'delayLength', 512);
        const tap1Center = this.getParameterValue(ctx, this.type, 'tap1Center', 0.25);
        const tap2Center = this.getParameterValue(ctx, this.type, 'tap2Center', 0.33);
        const tap3Center = this.getParameterValue(ctx, this.type, 'tap3Center', 0.63);
        const tap4Center = this.getParameterValue(ctx, this.type, 'tap4Center', 0.75);
        const rate = this.getParameterValue(ctx, this.type, 'rate', 20);
        const width = this.getParameterValue(ctx, this.type, 'width', 64);
        const lfoSel = this.getParameterValue(ctx, this.type, 'lfoSel', 0);
        
        // Allocate delay memory
        const memory = ctx.allocateMemory(this.type, delayLength);
        const delayOffset = memory.address;
        const memoryName = memory.name;
        
        // Get standard constants
        const zero = ctx.getStandardConstant(0.0);
        
        ctx.pushMainCode(`; 4-Voice Chorus`);
        
        // Initialize LFO (only once at startup)
        const labelInit = `chorus4_${this.sanitizeLabelForAsm(this.type)}_init`;
        const lfoName = lfoSel === 0 ? 'SIN0' : 'SIN1';
        const lfoRangeName = lfoSel === 0 ? 'SIN0_RANGE' : 'SIN1_RANGE';
        const lfoRateName = lfoSel === 0 ? 'SIN0_RATE' : 'SIN1_RATE';
        
        ctx.pushInitCode(`; 4-Voice Chorus LFO init`);
        ctx.pushInitCode(`skp run, ${labelInit}`);
        ctx.pushInitCode(`wlds ${lfoName}, 50, 64`);
        ctx.pushInitCode(`${labelInit}:`);
        
        // Scale LFO width by control input if connected
        if (widthInReg) {
            const widthMax = 16384;
            const temp = width / widthMax;
            ctx.pushMainCode(`rdax ${widthInReg}, ${this.formatS1_14(temp)}`);
            ctx.pushMainCode(`wrax ${lfoRangeName}, ${zero}`);
        }
        
        // Scale LFO rate by control input if connected
        if (rateInReg) {
            const rateMax = 511;
            const temp1 = rate / rateMax;
            ctx.pushMainCode(`rdax ${rateInReg}, ${this.formatS1_14(temp1)}`);
            ctx.pushMainCode(`wrax ${lfoRateName}, ${zero}`);
        }
        
        // Mix input and write to delay
        ctx.pushMainCode(`rdax ${inputReg}, ${this.formatS1_14(gain1)}`);
        ctx.pushMainCode(`wra ${memoryName}, ${zero}`);
        
        // Generate outputs for each connected voice
        const voices = [
            { id: 'voice1', center: tap1Center, phase: 0 }, // SIN, REG|COMPC
            { id: 'voice2', center: tap2Center, phase: 1 }, // SIN, REG|COMPA
            { id: 'voice3', center: tap3Center, phase: 2 }, // COS, REG|COMPC
            { id: 'voice4', center: tap4Center, phase: 3 }  // COS, REG|COMPA
        ];
        
        for (let i = 0; i < voices.length; i++) {
            const voice = voices[i];
            
            if (ctx.isOutputConnected(this.type, voice.id)) {
                const outputReg = ctx.allocateRegister(this.type, voice.id);
                const chorusCenter = Math.floor(delayOffset + (0.9 * voice.center * delayLength) + 0.05 * delayLength);
                
                // Four-phase interpolated chorus read
                const lfoType = (voice.phase >= 2) ? 'COS' : 'SIN';
                
                if (voice.phase === 0) {
                    // Voice 1: SIN, REG|COMPC
                    ctx.pushMainCode(`cho rda, ${lfoName}, ${lfoType}|REG|COMPC, ${chorusCenter}`);
                    ctx.pushMainCode(`cho rda, ${lfoName}, ${lfoType}, ${chorusCenter + 1}`);
                } else if (voice.phase === 1) {
                    // Voice 2: SIN, REG|COMPA
                    ctx.pushMainCode(`cho rda, ${lfoName}, ${lfoType}|REG|COMPA, ${chorusCenter}`);
                    ctx.pushMainCode(`cho rda, ${lfoName}, ${lfoType}|COMPC|COMPA, ${chorusCenter + 1}`);
                } else if (voice.phase === 2) {
                    // Voice 3: COS, REG|COMPC
                    ctx.pushMainCode(`cho rda, ${lfoName}, ${lfoType}|REG|COMPC, ${chorusCenter}`);
                    ctx.pushMainCode(`cho rda, ${lfoName}, ${lfoType}, ${chorusCenter + 1}`);
                } else {
                    // Voice 4: COS, REG|COMPA
                    ctx.pushMainCode(`cho rda, ${lfoName}, ${lfoType}|REG|COMPA, ${chorusCenter}`);
                    ctx.pushMainCode(`cho rda, ${lfoName}, ${lfoType}|COMPC|COMPA, ${chorusCenter + 1}`);
                }
                
                ctx.pushMainCode(`wrax ${outputReg}, ${zero}`);
            }
        }
        
        ctx.pushMainCode('');
    }
}
