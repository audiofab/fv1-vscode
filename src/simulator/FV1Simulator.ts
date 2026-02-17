/**
 * FV-1 DSP Simulator
 * 
 * Simulates the Spin Semiconductor FV-1 DSP chip.
 * This class is designed to be platform-agnostic (Node.js or Browser/AudioWorklet).
 */

export class FV1Simulator {
    // Constants
    private static readonly DELAY_SIZE = 32768;
    private static readonly REG_COUNT = 64;
    private static readonly PROG_SIZE = 128;
    private static readonly MAX_ACC = 0.999969; // Saturation limit
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

    // LFO State
    private sin0: number = 0;
    private cos0: number = 0;
    private sin1: number = 0;
    private cos1: number = 0;
    private rmp0: number = 0;
    private rmp1: number = 0;

    private sin0_rate: number = 0; private sin0_range: number = 0;
    private sin1_rate: number = 0; private sin1_range: number = 0;
    private rmp0_rate: number = 0; private rmp0_range: number = 0;
    private rmp1_rate: number = 0; private rmp1_range: number = 0;

    constructor() {
        this.delayRam = new Float32Array(FV1Simulator.DELAY_SIZE);
        this.registers = new Float32Array(FV1Simulator.REG_COUNT);
        this.program = new Uint32Array(FV1Simulator.PROG_SIZE);
    }

    /**
     * Loads the machine code into the simulator.
     * @param code Array of 32-bit integers representing the assembled program.
     */
    public loadProgram(code: Uint32Array | number[]) {
        if (code.length > FV1Simulator.PROG_SIZE) {
            console.warn(`Program size (${code.length}) exceeds max size (${FV1Simulator.PROG_SIZE}). Truncating.`);
        }
        this.program.fill(0);
        this.program.set(code.slice(0, FV1Simulator.PROG_SIZE));
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
        this.delayPointer = 0;
        this.firstRun = true;
        
        this.sin0 = 0; this.cos0 = 1.0;
        this.sin1 = 0; this.cos1 = 1.0;
        this.rmp0 = 0; this.rmp1 = 0;
        // Rates and ranges are typically set by the program, but could reset here too.
    }

    /**
     * Process a block of audio samples.
     * Useful for real-time audio processing in AudioWorklets.
     * 
     * @param inputL Input Left channel samples
     * @param inputR Input Right channel samples
     * @param outputL Output Left channel samples (will be written to)
     * @param outputR Output Right channel samples (will be written to)
     * @param pot0 Potentiometer 0 value (0.0 to 1.0)
     * @param pot1 Potentiometer 1 value (0.0 to 1.0)
     * @param pot2 Potentiometer 2 value (0.0 to 1.0)
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
     * Executes the entire 128-instruction program for this sample.
     */
    public step(inL: number, inR: number, pot0: number, pot1: number, pot2: number): [number, number] {
        // Map inputs to registers (Standard FV-1 mapping)
        // ADCL = REG20, ADCR = REG21
        this.registers[20] = inL;
        this.registers[21] = inR;
        
        // Map POTs to registers (Common convention: REG16-18, or accessed via RDAX POTx)
        // We store them here so RDAX instructions referencing them work if mapped.
        this.registers[16] = pot0;
        this.registers[17] = pot1;
        this.registers[18] = pot2;

        // Execute Program
        this.acc = 0; // Accumulator is cleared at start of run
        this.lr = 0;  // LR is transient
        this.pacc = 0;

        let pc = 0;
        while (pc < FV1Simulator.PROG_SIZE) {
            const inst = this.program[pc];
            const opcode = inst & 0x1F;
            const preOpAcc = this.acc; // Capture ACC before modification

            // Execute and get skip count (usually 0)
            const skip = this.executeInstruction(inst);
            
            // Update PACC if not SKP. PACC holds the ACC value *before* the current instruction.
            if (opcode !== 0x11) {
                this.pacc = preOpAcc;
            }
            
            pc += 1 + skip;
        }

        this.firstRun = false;
        this.updateLFOs();
        
        // Advance Delay Pointer (Circular Buffer)
        this.delayPointer = (this.delayPointer - 1) & 0x7FFF;

        // Outputs (DACL = REG22, DACR = REG23)
        return [this.registers[22], this.registers[23]];
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
        // RDA addr, coeff
        // ACC = ACC + (Delay[addr] * coeff)
        // Encoding: CCCCCCCCCCCAAAAAAAAAAAAAAAA00000
        const addr = (inst >>> 5) & 0x7FFF;
        const coeff = this.decodeS1_9((inst >>> 21) & 0x7FF);
        
        // Address is relative to current delay pointer in circular buffer
        const readAddr = (this.delayPointer + addr) & 0x7FFF;
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

        const writeAddr = (this.delayPointer + addr) & 0x7FFF;
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

        const writeAddr = (this.delayPointer + addr) & 0x7FFF;
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
        const ptr = Math.floor(this.registers[24] * 32768); // Assuming REG24 is pointer
        
        const readAddr = (this.delayPointer + ptr) & 0x7FFF;
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

        // Simplified:
        const val = Math.abs(this.acc);
        if (val > 0.000001) {
            this.acc = Math.log2(val) * coeff + d;
        } else {
            this.acc = -16.0 * coeff + d; // Floor approx
        }
        this.acc = this.saturate(this.acc);
    }

    private opEXP(inst: number) {
        // ACC = 2^ACC
        // Encoding: CCCCCCCCCCCCCCCCDDDDDDDDDDD01100
        const d = this.decodeS_10((inst >>> 5) & 0x7FF);
        const coeff = this.decodeS1_14((inst >>> 16) & 0xFFFF);

        this.acc = Math.pow(2, this.acc) * coeff + d;
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

        const val = Math.abs(this.registers[reg]) * coeff;
        if (val > Math.abs(this.acc)) {
            this.acc = val; // Sign? Usually magnitude check, result is magnitude?
        }
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

        const readAddr = (this.delayPointer + index + 32768) & 0x7FFF;
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

    private updateLFOs() {
        // RMP0
        this.rmp0 -= this.rmp0_rate * (1.0/4096.0);
        while (this.rmp0 >= 1.0) this.rmp0 -= 1.0;
        while (this.rmp0 < 0.0) this.rmp0 += 1.0;

        // RMP1
        this.rmp1 -= this.rmp1_rate * (1.0/4096.0);
        while (this.rmp1 >= 1.0) this.rmp1 -= 1.0;
        while (this.rmp1 < 0.0) this.rmp1 += 1.0;

        // SIN0
        let x = this.sin0_rate * (1.0/256.0);
        this.cos0 += x * this.sin0;
        this.sin0 -= x * this.cos0;

        // SIN1
        x = this.sin1_rate * (1.0/256.0);
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