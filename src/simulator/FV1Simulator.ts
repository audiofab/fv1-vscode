/**
 * FV-1 DSP Simulator
 * 
 * Simulates the Spin Semiconductor FV-1 DSP chip.
 * This class is designed to be platform-agnostic (Node.js or Browser/AudioWorklet).
 */
import { FV1Assembler } from '../FV1Assembler.js';

export class FV1Simulator {
    // Constants
    // Capabilities (Configurable)
    private delaySize: number = 32768;
    private delayMask: number = 32767; // For efficient circular buffer
    private regCount: number = 32;
    private progSize: number = 128;

    private static readonly MAX_ACC = 1.0 - (1.0 / 8388608.0); // 24-bit S.23: 1 - 2^-23
    private static readonly MIN_ACC = -1.0;

    // State
    private delayRam: Float32Array;
    private registers: Float32Array;
    private program: Uint32Array;

    private acc: number = 0;
    private pacc: number = 0;
    private lr: number = 0;     // Last Read register

    private lfo: number = 0;    // Internal LFO fregister (for CHO)
    private delayPointer: number = 0; // Circular buffer pointer
    private firstRun: boolean = true;
    private pc: number = 0;     // Program Counter
    private breakpoints: Set<number> = new Set();

    // Symbol metadata (optional, for debugging)
    private symbols: any[] = [];
    private memories: any[] = [];
    private fv1AsmMemBug: boolean = false;

    // Register aliases (Getters/Setters)
    // 0-7: Parameters
    private get sin0_rate(): number { return this.registers[0]; }
    private set sin0_rate(v: number) { this.registers[0] = v; }
    private get sin0_range(): number { return this.registers[1]; }
    private set sin0_range(v: number) { this.registers[1] = v; }

    private get sin1_rate(): number { return this.registers[2]; }
    private set sin1_rate(v: number) { this.registers[2] = v; }
    private get sin1_range(): number { return this.registers[3]; }
    private set sin1_range(v: number) { this.registers[3] = v; }

    private get rmp0_rate(): number { return this.registers[4]; }
    private set rmp0_rate(v: number) { this.registers[4] = v; }
    private get rmp0_range(): number { return this.registers[5]; }
    private set rmp0_range(v: number) { this.registers[5] = v; }

    private get rmp1_rate(): number { return this.registers[6]; }
    private set rmp1_rate(v: number) { this.registers[6] = v; }
    private get rmp1_range(): number { return this.registers[7]; }
    private set rmp1_range(v: number) { this.registers[7] = v; }

    // 8-13: Internal State accumulators (aliased as registers for the debugger)
    private get sin0(): number { return this.registers[8]; }
    private set sin0(v: number) { this.registers[8] = v; }
    private get cos0(): number { return this.registers[9]; }
    private set cos0(v: number) { this.registers[9] = v; }

    private get sin1(): number { return this.registers[10]; }
    private set sin1(v: number) { this.registers[10] = v; }
    private get cos1(): number { return this.registers[11]; }
    private set cos1(v: number) { this.registers[11] = v; }

    private get rmp0(): number { return this.registers[12]; }
    private set rmp0(v: number) { this.registers[12] = v; }
    private get rmp1(): number { return this.registers[13]; }
    private set rmp1(v: number) { this.registers[13] = v; }

    constructor() {
        this.delayRam = new Float32Array(this.delaySize);
        this.registers = new Float32Array(32 + this.regCount);
        this.program = new Uint32Array(this.progSize);
    }

    /**
     * Configures simulator hardware limits.
     */
    public setCapabilities(delaySize: number, regCount: number, progSize: number) {
        this.delaySize = delaySize;
        this.delayMask = delaySize - 1; // Assuming power of 2 for now, but modulo is fallback
        this.regCount = regCount; // Number of user registers
        this.progSize = progSize;

        // Reallocate if needed
        this.delayRam = new Float32Array(this.delaySize);
        this.registers = new Float32Array(32 + this.regCount); // 32 system + N user registers
        this.program = new Uint32Array(this.progSize);
        this.reset();
    }

    public getDelayPointer(): number {
        return this.delayPointer;
    }

    public getDelaySize(): number {
        return this.delaySize;
    }

    /**
     * Loads the machine code into the simulator.
     * @param code Array of 32-bit integers representing the assembled program.
     */
    public loadProgram(code: Uint32Array | number[]) {
        if (code.length > this.progSize) {
            console.warn(`Program size (${code.length}) exceeds max size (${this.progSize}). Truncating.`);
        }
        this.program.fill(0);
        this.program.set(code.slice(0, this.progSize));
        this.reset();
    }

    /**
     * Resets the simulator state (clears memory, registers, accumulator).
     */
    public reset() {
        this.delayRam.fill(0);
        this.registers.fill(0);
        this.acc = 0;
        this.pacc = 0;
        this.lr = 0;
        this.lfo = 0;
        this.pc = 0;
        this.delayPointer = 0;
        this.firstRun = true;

        this.sin0 = 0; this.cos0 = 1.0;
        this.sin1 = 0; this.cos1 = 1.0;
        this.rmp0 = 0; this.rmp1 = 0;

        // Default POT values to 0.5
        this.registers[16] = 0.5;
        this.registers[17] = 0.5;
        this.registers[18] = 0.5;
    }

    /**
     * Set breakpoints at specific instruction addresses.
     * @param addresses Set of addresses to break at.
     */
    public setBreakpoints(addresses: Set<number>) {
        this.breakpoints = addresses;
    }

    /**
     * Set symbol and memory metadata for expression evaluation.
     */
    public setSymbols(symbols: any[], memories: any[], fv1AsmMemBug: boolean = false) {
        this.symbols = symbols;
        this.memories = memories;
        this.fv1AsmMemBug = fv1AsmMemBug;
    }

    /**
     * Process a block of audio samples.
     * Useful for real-time audio processing in AudioWorklets.
     */
    public processBlock(
        inputL: Float32Array,
        inputR: Float32Array,
        outputL: Float32Array,
        outputR: Float32Array,
        pot0: number,
        pot1: number,
        pot2: number
    ) {
        const len = inputL.length;
        for (let i = 0; i < len; i++) {
            const [outL, outR] = this.step(inputL[i], inputR[i], pot0, pot1, pot2);
            outputL[i] = outL;
            outputR[i] = outR;
        }
    }

    /**
     * Process a single sample frame.
     * Executes instructions until the end of the program or a breakpoint is hit.
     * @param skipCurrentBreakpoint If true, will not break on the instruction at the current PC.
     * @returns [outL, outR, breakpointHit]
     */
    public step(inL: number, inR: number, pot0: number, pot1: number, pot2: number, skipCurrentBreakpoint: boolean = false): [number, number, boolean] {
        // Only begin a new frame if we are at PC 0 (either start or after wrap around)
        if (this.pc === 0) {
            this.beginFrame(inL, inR, pot0, pot1, pot2);
        }

        let firstInstruction = true;
        while (this.pc < this.progSize) {
            if (this.breakpoints.has(this.pc)) {
                if (!firstInstruction || !skipCurrentBreakpoint) {
                    return [...this.getOutputs(), true];
                }
            }
            this.stepInstruction();
            firstInstruction = false;
        }

        return [...this.endFrame(), false];
    }

    private getOutputs(): [number, number] {
        return [this.registers[22], this.registers[23]];
    }

    /**
     * Prepares for a single sample frame step.
     */
    public beginFrame(inL: number = 0, inR: number = 0, pot0: number = 0, pot1: number = 0, pot2: number = 0) {
        // Saturate inputs (ADC is -1.0 to 0.999..., POT is 0 to 0.999...)
        // POT has 10-bit resolution (1024 levels)
        const sat = (v: number) => Math.max(-1.0, Math.min(FV1Simulator.MAX_ACC, v));
        const satPot = (v: number) => {
            const quantized = Math.floor(Math.max(0, Math.min(0.9999999, v)) * 1024) / 1024;
            return quantized;
        };

        // Map inputs to registers (Standard FV-1 mapping)
        this.registers[20] = sat(inL);
        this.registers[21] = sat(inR);
        this.registers[16] = satPot(pot0);
        this.registers[17] = satPot(pot1);
        this.registers[18] = satPot(pot2);

        // Execute Program Setup
        this.acc = 0; // Accumulator is cleared at start of run
        this.lr = 0;  // LR is transient
        this.pacc = 0;
        this.pc = 0;
    }

    public endFrame(): [number, number] {
        this.pc = 0;
        this.firstRun = false;
        this.updateLFOs();

        // Advance Delay Pointer (Circular Buffer)
        this.delayPointer = (this.delayPointer - 1 + this.delaySize) % this.delaySize;

        // Outputs (DACL = REG22, DACR = REG23)
        return [this.registers[22], this.registers[23]];
    }

    /**
     * Executes a single instruction at the current PC.
     * @returns The next PC address.
     */
    public stepInstruction(): number {
        if (this.pc >= this.progSize) return this.pc;

        const inst = this.program[this.pc];
        const opcode = inst & 0x1F;
        const preOpAcc = this.acc;

        const skip = this.executeInstruction(inst);

        if (opcode !== 0x11) { // Not SKP
            this.pacc = preOpAcc;
        }

        this.pc += 1 + skip;
        return this.pc;
    }

    private executeInstruction(inst: number): number {
        const opcode = inst & 0x1F; // Bottom 5 bits for opcode
        let skip = 0;

        switch (opcode) {
            case 0x00: // RDA (Read Delay Accumulate)
                this.opRDA(inst);
                break;
            case 0x01: // RMPA (Read Memory Pointer Accumulate)
                this.opRMPA(inst);
                break;
            case 0x02: // WRA (Write Delay Accumulate)
                this.opWRA(inst);
                break;
            case 0x03: // WRAP (Write Delay Accumulate & Pointer)
                this.opWRAP(inst);
                break;
            case 0x04: // RDAX (Read Register Accumulate)
                this.opRDAX(inst);
                break;
            case 0x05: // RDFX (Read Register Filter)
                this.opRDFX(inst);
                break;
            case 0x06: // WRAX (Write Register Accumulate)
                this.opWRAX(inst);
                break;
            case 0x07: // WRHX (Write Register High)
                this.opWRHX(inst);
                break;
            case 0x08: // WRLX (Write Register Low)
                this.opWRLX(inst);
                break;
            case 0x09: // MAXX
                this.opMAXX(inst);
                break;
            case 0x0A: // MULX
                this.opMULX(inst);
                break;
            case 0x0B: // LOG
                this.opLOG(inst);
                break;
            case 0x0C: // EXP
                this.opEXP(inst);
                break;
            case 0x0D: // SOF
                this.opSOF(inst);
                break;
            case 0x0E: // AND
                this.opAND(inst);
                break;
            case 0x0F: // OR
                this.opOR(inst);
                break;
            case 0x10: // XOR
                this.opXOR(inst);
                break;
            case 0x11: // SKP
                skip = this.opSKP(inst);
                break;
            case 0x12: // WLDS / WLDR
                // Check bit 30 to distinguish WLDS (0) and WLDR (1)
                if ((inst >>> 30) & 1) {
                    this.opWLDR(inst);
                } else {
                    this.opWLDS(inst);
                }
                break;
            case 0x13: // JAM
                this.opJAM(inst);
                break;
            case 0x14: // CHO
                this.opCHO(inst);
                break;
            default:
                // console.warn(`Unknown opcode: ${opcode.toString(16)}`);
                break;
        }
        return skip;
    }

    // --- Opcode Implementations ---

    private opRDA(inst: number) {
        // ... (existing comments)
        const addr = (inst >>> 5) & 0x7FFF;
        const coeff = this.decodeS1_9((inst >>> 21) & 0x7FF);

        // Address is relative to current delay pointer in circular buffer
        const readAddr = (this.delayPointer + addr) & this.delayMask;
        const val = this.delayRam[readAddr];

        this.lr = val;
        this.acc += val * coeff;
        this.acc = this.saturate(this.acc);
    }

    private opWRA(inst: number) {
        // WRA addr, coeff
        // Delay[addr] = ACC; ACC = ACC * coeff
        // Encoding: CCCCCCCCCCCAAAAAAAAAAAAAAAA00010
        const addr = (inst >>> 5) & 0x7FFF;
        const coeff = this.decodeS1_9((inst >>> 21) & 0x7FF);

        const writeAddr = (this.delayPointer + addr) & this.delayMask;
        this.delayRam[writeAddr] = this.acc;

        this.acc *= coeff;
        this.acc = this.saturate(this.acc);
    }

    private opWRAP(inst: number) {
        // WRAP addr, coeff
        // Delay[addr] = ACC; ACC = ACC * coeff + LR
        // Note: Pointer decrement happens at end of step, not here.
        // Encoding: CCCCCCCCCCCAAAAAAAAAAAAAAAA00011
        const addr = (inst >>> 5) & 0x7FFF;
        const coeff = this.decodeS1_9((inst >>> 21) & 0x7FF);

        const writeAddr = (this.delayPointer + addr) & this.delayMask;
        this.delayRam[writeAddr] = this.acc;

        // ACC = ACC * coeff + LR
        this.acc = this.acc * coeff + this.lr;
        this.acc = this.saturate(this.acc);
    }

    private opRDAX(inst: number) {
        // RDAX reg, coeff
        // ACC = ACC + (Reg[reg] * coeff)
        // Encoding: CCCCCCCCCCCCCCCC00000AAAAAA00100
        const reg = (inst >>> 5) & 0x3F;
        const coeff = this.decodeS1_14((inst >>> 16) & 0xFFFF);

        const val = this.registers[reg];
        this.acc += val * coeff;
        this.acc = this.saturate(this.acc);
    }

    private opWRAX(inst: number) {
        // WRAX reg, coeff
        // Reg[reg] = ACC; ACC = ACC * coeff
        // Encoding: CCCCCCCCCCCCCCCC00000AAAAAA00110
        const reg = (inst >>> 5) & 0x3F;
        const coeff = this.decodeS1_14((inst >>> 16) & 0xFFFF);

        this.registers[reg] = this.acc;
        this.acc *= coeff;
        this.acc = this.saturate(this.acc);
    }

    private opSOF(inst: number) {
        // SOF c, d
        // ACC = ACC * c + d
        // Encoding: CCCCCCCCCCCCCCCCDDDDDDDDDDD01101
        const d = this.decodeS_10((inst >>> 5) & 0x7FF);
        const c = this.decodeS1_14((inst >>> 16) & 0xFFFF);

        this.acc = this.acc * c + d;
        this.acc = this.saturate(this.acc);
    }

    private opRMPA(inst: number) {
        // RMPA coeff
        // Read memory pointer. ADDR_PTR is mapped to REG24.
        // Encoding: CCCCCCCCCCC000000000001100000001 (or similar, coeff is top)
        const coeff = this.decodeS1_9((inst >>> 21) & 0x7FF);
        const ptr = Math.floor(this.registers[24] * this.delaySize);

        const readAddr = (this.delayPointer + ptr) % this.delaySize;
        const val = this.delayRam[readAddr];
        this.lr = val;
        this.acc += val * coeff;
        this.acc = this.saturate(this.acc);
    }

    private opMULX(inst: number) {
        // Encoding: 000000000000000000000AAAAAA01010
        const reg = (inst >>> 5) & 0x3F;
        this.acc = this.acc * this.registers[reg];
        this.acc = this.saturate(this.acc);
    }

    private opLOG(inst: number) {
        // ACC = log2(|ACC|) * coeff + d
        // Encoding: CCCCCCCCCCCCCCCCDDDDDDDDDDD01011
        const d = this.decodeS4_6((inst >>> 5) & 0x7FF);
        const coeff = this.decodeS1_14((inst >>> 16) & 0xFFFF);

        const val = Math.abs(this.acc);
        let logVal: number;
        if (val > 1.52587890625e-5) { // 2^-16, approx 96dB limit
            logVal = Math.log2(val);
        } else {
            logVal = -16.0;
        }

        // Result is in S4.19 format, so we divide by 16 to keep it in our S.23 float space
        this.acc = (logVal * coeff + d) / 16.0;
        this.acc = this.saturate(this.acc);
    }

    private opEXP(inst: number) {
        // ACC = 2^ACC
        // Encoding: CCCCCCCCCCCCCCCCDDDDDDDDDDD01100
        const d = this.decodeS_10((inst >>> 5) & 0x7FF);
        const coeff = this.decodeS1_14((inst >>> 16) & 0xFFFF);

        const valS419 = this.acc * 16.0;
        // Result is linear S.23, which naturally fits our -1..1 float range
        this.acc = Math.pow(2, valS419) * coeff + d;
        this.acc = this.saturate(this.acc);
    }

    private opRDFX(inst: number) {
        // RDFX reg, coeff
        // ACC = (REG[reg] - ACC) * coeff + REG[reg]
        // Encoding: CCCCCCCCCCCCCCCC00000AAAAAA00101
        const reg = (inst >>> 5) & 0x3F;
        const coeff = this.decodeS1_14((inst >>> 16) & 0xFFFF);

        const rx = this.registers[reg];
        this.acc = (this.acc - rx) * coeff + rx;
        this.acc = this.saturate(this.acc);
    }

    private opMAXX(inst: number) {
        // Encoding: CCCCCCCCCCCCCCCC00000AAAAAA01001
        const reg = (inst >>> 5) & 0x3F;
        const coeff = this.decodeS1_14((inst >>> 16) & 0xFFFF);

        const a = Math.abs(this.acc);
        const b = Math.abs(this.registers[reg] * coeff);
        // MAXX result is always the magnitude (absolute value)
        this.acc = Math.max(a, b);
        this.acc = this.saturate(this.acc);
    }

    private opSKP(inst: number): number {
        // SKP condition, n
        // Encoding: CCCCCNNNNNN000000000000000010001
        const n = (inst >>> 21) & 0x3F;
        const flags = inst & 0xF8000000;

        let conditionMet = false;
        // Flags: RUN=0x80000000, ZRC=0x40000000, ZRO=0x20000000, GEZ=0x10000000, NEG=0x08000000

        if ((flags & 0x08000000) && this.acc < 0) conditionMet = true; // NEG
        if ((flags & 0x10000000) && this.acc >= 0) conditionMet = true; // GEZ
        if ((flags & 0x20000000) && this.acc === 0) conditionMet = true; // ZRO
        // ZRC (Zero Crossing) requires previous acc
        if ((flags & 0x40000000) && (this.acc * this.pacc < 0)) conditionMet = true;
        // RUN flag: Skip if NOT first run
        if ((flags & 0x80000000) && !this.firstRun) conditionMet = true;

        return conditionMet ? n : 0;
    }

    private opWRLX(inst: number) {
        // WRLX reg, coeff
        // Reg[reg] = ACC; ACC = (PACC - ACC) * coeff + PACC
        // Encoding: CCCCCCCCCCCCCCCC00000AAAAAA01000
        const reg = (inst >>> 5) & 0x3F;
        const coeff = this.decodeS1_14((inst >>> 16) & 0xFFFF);

        this.registers[reg] = this.acc;
        this.acc = (this.pacc - this.acc) * coeff + this.pacc;
        this.acc = this.saturate(this.acc);
    }

    private opWRHX(inst: number) {
        // WRHX reg, coeff
        // Reg[reg] = ACC; ACC = PACC + ACC * coeff
        // Encoding: CCCCCCCCCCCCCCCC00000AAAAAA00111
        const reg = (inst >>> 5) & 0x3F;
        const coeff = this.decodeS1_14((inst >>> 16) & 0xFFFF);

        this.registers[reg] = this.acc;
        this.acc = this.pacc + this.acc * coeff;
        this.acc = this.saturate(this.acc);
    }

    private opAND(inst: number) {
        // AND mask
        // Encoding: MMMMMMMMMMMMMMMMMMMMMMMM00001110
        const mask = (inst >>> 8) & 0xFFFFFF;
        // Convert ACC to 24-bit int, apply mask, convert back
        let iAcc = Math.floor(this.acc * 8388608.0); // 2^23
        iAcc &= mask;
        this.acc = iAcc / 8388608.0;
    }

    private opOR(inst: number) {
        // OR mask
        // Encoding: MMMMMMMMMMMMMMMMMMMMMMMM00001111
        const mask = (inst >>> 8) & 0xFFFFFF;
        let iAcc = Math.floor(this.acc * 8388608.0);
        iAcc |= mask;
        this.acc = iAcc / 8388608.0;
    }

    private opXOR(inst: number) {
        // XOR mask
        // Encoding: MMMMMMMMMMMMMMMMMMMMMMMM00010000
        const mask = (inst >>> 8) & 0xFFFFFF;
        let iAcc = Math.floor(this.acc * 8388608.0);
        iAcc ^= mask;
        this.acc = iAcc / 8388608.0;
    }

    private opJAM(inst: number) {
        // JAM lfo
        // Encoding: 0000000000000000000000001N010011
        const lfo = (inst >>> 6) & 0x3; // 0=RMP0, 1=RMP1
        if (lfo === 0) this.rmp0 = 0;
        else if (lfo === 1) this.rmp1 = 0;
    }

    private opWLDS(inst: number) {
        // WLDS lfo, freq, amp
        // Encoding: 00NFFFFFFFFFAAAAAAAAAAAAAAA10010
        const lfo = (inst >>> 29) & 0x1; // 0=SIN0, 1=SIN1
        const freq = (inst >>> 20) & 0x1FF;
        const amp = (inst >>> 5) & 0x7FFF;

        // Map to 32-bit integer range
        // rate = f / 511.0; range = a / 32767.0;
        if (lfo === 0) {
            this.sin0_rate = freq / 511.0;
            this.sin0_range = amp / 32767.0;
        } else {
            this.sin1_rate = freq / 511.0;
            this.sin1_range = amp / 32767.0;
        }
    }

    private opWLDR(inst: number) {
        // WLDR lfo, freq, amp
        // Encoding: 01NFFFFFFFFFFFFFFFF000000AA10010
        const lfo = 2 + ((inst >>> 29) & 0x1); // 2=RMP0, 3=RMP1
        // Freq is signed 16-bit
        let freq = (inst >>> 13) & 0xFFFF;
        if (freq & 0x8000) freq -= 65536;

        const ampCode = (inst >>> 5) & 0x3;
        const amp = 4096 >> ampCode; // 0->4096, 1->2048, 2->1024, 3->512

        // rate = f / 16384.0; range = a / 8192.0;
        if (lfo === 2) {
            this.rmp0_rate = freq / 16384.0;
            this.rmp0_range = amp / 8192.0;
        } else {
            this.rmp1_rate = freq / 16384.0;
            this.rmp1_range = amp / 8192.0;
        }
    }

    private getLfoVal(flags: number, lfoSelect: number): number {
        if (lfoSelect === 0) {
            return (flags & 1) ? this.cos0 : this.sin0;
        } else if (lfoSelect === 1) {
            return (flags & 1) ? this.cos1 : this.sin1;
        } else if (lfoSelect === 2) {
            return this.rmp0;
        } else {
            return this.rmp1;
        }
    }

    private getLfoRange(lfoSelect: number): number {
        if (lfoSelect === 0) return this.sin0_range;
        if (lfoSelect === 1) return this.sin1_range;
        if (lfoSelect === 2) return this.rmp0_range;
        return this.rmp1_range;
    }

    private opCHO(inst: number) {
        const mode = (inst >>> 30) & 0x3;
        if (mode === 0) {
            this.opCHO_RDA(inst);
        } else if (mode === 2) {
            this.opCHO_SOF(inst);
        } else if (mode === 3) {
            this.opCHO_RDAL(inst);
        }
    }

    private opCHO_RDA(inst: number) {
        const flags = (inst >>> 24) & 0x3F;
        const lfoSelect = (inst >>> 21) & 0x3;
        const offset = (inst >>> 5) & 0xFFFF;

        const lfoIn = this.getLfoVal(flags, lfoSelect);
        let range = this.getLfoRange(lfoSelect);
        range *= 8192.0;

        if (flags & 2) { // cho_reg
            this.lfo = lfoIn;
        }
        let v = this.lfo;

        if (flags & 16) { // cho_rptr2
            v += 0.5;
            if (v >= 1.0) v -= 1.0;
        }

        if (flags & 8) { // cho_compa
            v = -v;
        }

        let index: number;
        let c: number;

        if (flags & 32) { // cho_na
            index = offset;
            c = Math.min(v, 1.0 - v);
            c = Math.max(0.0, Math.min(1.0, 4.0 * c - 0.5));
        } else {
            const addr = v * range + offset;
            index = Math.floor(addr);
            c = addr - index;
        }

        const readAddr = (this.delayPointer + index + this.delaySize) % this.delaySize;
        this.lr = this.delayRam[readAddr];

        if (flags & 4) { // cho_compc
            c = 1.0 - c;
        }

        this.acc += this.lr * c;
        this.acc = this.saturate(this.acc);
    }

    private opCHO_SOF(inst: number) {
        const flags = (inst >>> 24) & 0x3F;
        const lfoSelect = (inst >>> 21) & 0x3;
        const coeffRaw = (inst >>> 5) & 0xFFFF;
        const coeff = this.decodeS_15(coeffRaw);

        const lfoIn = this.getLfoVal(flags, lfoSelect);
        const range = this.getLfoRange(lfoSelect);

        if (flags & 2) { // cho_reg
            this.lfo = lfoIn;
        }
        let v = this.lfo;

        if (flags & 32) { // cho_na
            v = Math.min(v, 1.0 - v);
            v = Math.max(0.0, Math.min(1.0, 4.0 * v - 0.5));
        } else {
            v *= range;
        }

        if (flags & 4) { // cho_compc
            v = 1.0 - v;
        }

        this.acc = v * this.acc + coeff;
        this.acc = this.saturate(this.acc);
    }

    private opCHO_RDAL(inst: number) {
        const flags = (inst >>> 24) & 0x3F;
        const lfoSelect = (inst >>> 21) & 0x3;

        const lfoIn = this.getLfoVal(flags, lfoSelect);
        this.acc = lfoIn;
        this.acc = this.saturate(this.acc);
    }

    // --- Debugging / State Access ---

    public getPC(): number {
        return this.pc;
    }

    public getProgSize(): number {
        return this.progSize;
    }

    public setPC(pc: number) {
        this.pc = Math.max(0, Math.min(this.progSize - 1, pc));
    }

    public setAcc(val: number) {
        this.acc = this.saturate(val);
    }

    public setPacc(val: number) {
        this.pacc = this.saturate(val);
    }

    /**
     * Sets a register value with hardware-accurate saturation and quantization.
     * @param idx Register index (0-63)
     * @param val Raw value (float)
     */
    public setRegister(idx: number, val: number) {
        if (idx < 0 || idx >= this.regCount) return;

        // POT registers (16, 17, 18) are 10-bit quantized 0..1
        if (idx >= 16 && idx <= 18) {
            val = Math.floor(Math.max(0, Math.min(0.9999999, val)) * 1024) / 1024;
        } else {
            // Other registers (ADC, DAC, User) are S.23 saturated
            val = this.saturate(val);
        }
        this.registers[idx] = val;
    }

    /**
     * Evaluates a string expression (register name, symbol, memory suffix).
     * @returns { result: string, value: number } or null
     */
    public evaluateExpression(expr: string): { label: string, value: number } | null {
        let expression = expr.trim().toUpperCase();

        // Handle suffixes ^ and #
        let suffix: string = "";
        if (expression.endsWith("^")) {
            suffix = "^";
            expression = expression.slice(0, -1);
        } else if (expression.endsWith("#")) {
            suffix = "#";
            expression = expression.slice(0, -1);
        }

        // 1. Check if it's a register name
        const state = this.getState();
        if (suffix === "" && state.registers[expression] !== undefined) {
            return { label: expression, value: state.registers[expression] };
        }

        // 2. Check if it's ACC/PACC
        if (suffix === "" && expression === "ACC") {
            return { label: "ACC", value: this.acc };
        }
        if (suffix === "" && expression === "PACC") {
            return { label: "PACC", value: this.pacc };
        }

        // 3. Check symbols (EQU)
        const sym = this.symbols.find(s => s.name.toUpperCase() === expression);
        if (sym && suffix === "") {
            const addr = parseInt(sym.value);
            if (!isNaN(addr) && addr >= 0 && addr <= 63) {
                return { label: `REG[${addr}] (${sym.name})`, value: this.registers[addr] };
            }
        }

        // 4. Check memories (MEM)
        const mem = this.memories.find(m => m.name.toUpperCase() === expression);
        if (mem && mem.start !== undefined) {
            let addr = mem.start;
            let typeLabel = "";

            if (suffix === "^") {
                addr = FV1Assembler.getMiddleAddr(mem.start, mem.size);
                typeLabel = " (Middle)";
            } else if (suffix === "#") {
                addr = FV1Assembler.getEndAddr(mem.start, mem.size, this.fv1AsmMemBug);
                typeLabel = " (End)";
            }

            if (addr >= 0 && addr < this.delaySize) {
                return { label: `MEM[${addr}] (${mem.name}${typeLabel})`, value: this.delayRam[addr] };
            }
        }

        // 5. Check DELAY[idx]
        if (suffix === "") {
            const delayMatch = expression.match(/^DELAY\[(\d+)\]$/);
            if (delayMatch) {
                const idx = parseInt(delayMatch[1]);
                if (idx >= 0 && idx < this.delaySize) {
                    return { label: `DELAY[${idx}]`, value: this.delayRam[idx] };
                }
            }
        }

        return null;
    }

    public getState() {
        return {
            pc: this.pc,
            acc: this.acc,
            pacc: this.pacc,
            lr: this.lr,
            lfo: this.lfo,
            // Official Register Naming
            registers: Object.fromEntries(
                Array.from({ length: this.regCount }, (_, i) => {
                    let name = `[${i}]`;
                    if (i === 0) name = "SIN0_RATE";
                    else if (i === 1) name = "SIN0_RANGE";
                    else if (i === 2) name = "SIN1_RATE";
                    else if (i === 3) name = "SIN1_RANGE";
                    else if (i === 4) name = "RMP0_RATE";
                    else if (i === 5) name = "RMP0_RANGE";
                    else if (i === 6) name = "RMP1_RATE";
                    else if (i === 7) name = "RMP1_RANGE";
                    else if (i === 8) name = "SIN0";
                    else if (i === 9) name = "COS0";
                    else if (i === 10) name = "SIN1";
                    else if (i === 11) name = "COS1";
                    else if (i === 12) name = "RMP0";
                    else if (i === 13) name = "RMP1";
                    else if (i === 16) name = "POT0";
                    else if (i === 17) name = "POT1";
                    else if (i === 18) name = "POT2";
                    else if (i === 20) name = "ADCL";
                    else if (i === 21) name = "ADCR";
                    else if (i === 22) name = "DACL";
                    else if (i === 23) name = "DACR";
                    else if (i === 24) name = "ADDR_PTR";
                    else if (i >= 32 && i <= 63) name = `REG${i - 32}`;

                    return [name, this.registers[i]];
                })
            ),
            // Flags
            flags: {
                RUN: this.firstRun,
                ZRC: (this.acc * this.pacc < 0),
                ZRO: (this.acc === 0),
                GEZ: (this.acc >= 0),
                NEG: (this.acc < 0)
            },
            // LFO Internal positions
            lfoState: {
                sin0: this.sin0, cos0: this.cos0,
                sin1: this.sin1, cos1: this.cos1,
                rmp0: this.rmp0, rmp1: this.rmp1
            }
        };
    }

    public getRegisters(): Float32Array {
        return this.registers;
    }

    public getDelayRam(): Float32Array {
        return this.delayRam;
    }

    private updateLFOs() {
        // RMP0
        this.rmp0 -= this.rmp0_rate * (1.0 / 4096.0);
        while (this.rmp0 >= 1.0) this.rmp0 -= 2.0;
        while (this.rmp0 < -1.0) this.rmp0 += 2.0;

        // RMP1
        this.rmp1 -= this.rmp1_rate * (1.0 / 4096.0);
        while (this.rmp1 >= 1.0) this.rmp1 -= 2.0;
        while (this.rmp1 < -1.0) this.rmp1 += 2.0;

        // SIN0
        let x = this.sin0_rate * (1.0 / 256.0);
        this.cos0 += x * this.sin0;
        this.sin0 -= x * this.cos0;

        // SIN1
        x = this.sin1_rate * (1.0 / 256.0);
        this.cos1 += x * this.sin1;
        this.sin1 -= x * this.cos1;
    }

    // --- Helpers ---

    private decodeS1_14(raw: number): number {
        // 16 bits: 1 sign, 1 integer, 14 fractional
        if (raw & 0x8000) return (raw - 0x10000) / 16384.0;
        return raw / 16384.0;
    }

    private decodeS1_9(raw: number): number {
        // 11 bits: 1 sign, 1 integer, 9 fractional
        if (raw & 0x400) return (raw - 0x800) / 512.0;
        return raw / 512.0;
    }

    private decodeS_10(raw: number): number {
        // 11 bits: 1 sign, 0 integer, 10 fractional
        if (raw & 0x400) return (raw - 0x800) / 1024.0;
        return raw / 1024.0;
    }

    private decodeS4_6(raw: number): number {
        // 11 bits: 1 sign, 4 integer, 6 fractional
        if (raw & 0x400) return (raw - 0x800) / 64.0;
        return raw / 64.0;
    }

    private decodeS_15(raw: number): number {
        // 16 bits: 1 sign, 0 integer, 15 fractional
        if (raw & 0x8000) return (raw - 0x10000) / 32768.0;
        return raw / 32768.0;
    }

    private saturate(val: number): number {
        if (val > FV1Simulator.MAX_ACC) return FV1Simulator.MAX_ACC;
        if (val < FV1Simulator.MIN_ACC) return FV1Simulator.MIN_ACC;
        return val;
    }
}