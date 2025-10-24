/**
 * FV-1 Instruction Documentation
 * Documentation for FV-1 DSP instructions for hover tooltips
 */

export interface InstructionDoc {
    name: string;
    syntax: string;
    description: string;
    operands?: string;
    example?: string;
}

export const FV1_INSTRUCTIONS: Record<string, InstructionDoc> = {
    // Accumulator Instructions
    'sof': {
        name: 'SOF',
        syntax: 'SOF C, D',
        description: 'Scale and Offset. ACC = ACC * C + D.',
        operands: 'C: Coefficient (-2.0 to +1.99), D: Offset (-1.0 to +0.99)',
        example: 'SOF 0.5, 0.0  ; Scale by 0.5'
    },
    'and': {
        name: 'AND',
        syntax: 'AND mask',
        description: 'Bitwise AND ACC with mask value.',
        operands: 'mask: 24-bit mask value',
        example: 'AND $FFFE00  ; Mask lower bits'
    },
    'or': {
        name: 'OR',
        syntax: 'OR mask',
        description: 'Bitwise OR ACC with mask value.',
        operands: 'mask: 24-bit mask value',
        example: 'OR $000100  ; Set bit 8'
    },
    'xor': {
        name: 'XOR',
        syntax: 'XOR mask',
        description: 'Bitwise XOR ACC with mask value.',
        operands: 'mask: 24-bit mask value',
        example: 'XOR $FFFFFF  ; Invert all bits'
    },
    'log': {
        name: 'LOG',
        syntax: 'LOG C, D',
        description: 'Logarithmic conversion. Converts linear ACC to log format. ACC = log2(|ACC|) * C + D.',
        operands: 'C: Coefficient, D: Offset',
        example: 'LOG 0.5, 0.0  ; Log conversion'
    },
    'exp': {
        name: 'EXP',
        syntax: 'EXP C, D',
        description: 'Exponential conversion. Converts log ACC to linear format. ACC = 2^ACC * C + D.',
        operands: 'C: Coefficient, D: Offset',
        example: 'EXP 0.5, 0.0  ; Exp conversion'
    },
    'skp': {
        name: 'SKP',
        syntax: 'SKP flags, N',
        description: 'Skip next N instructions based on condition flags.',
        operands: 'flags: RUN, ZRC, ZRO, GEZ, NEG; N: number of instructions to skip',
        example: 'SKP NEG, 2  ; Skip 2 instructions if ACC is negative'
    },
    
    // Register Instructions
    'rdax': {
        name: 'RDAX',
        syntax: 'RDAX addr, C',
        description: 'Typical multiply and accumulate. ACC = REG[ADDR] * C + ACC.',
        operands: 'addr: Register address (REG0-REG31, POT0-POT2, ADCL, ADCR); C: Coefficient',
        example: 'RDAX ADCL, 0.5  ; Read left input scaled by 0.5'
    },
    'wrax': {
        name: 'WRAX',
        syntax: 'WRAX addr, C',
        description: 'Write ACC to REG[ADDR], then multiply ACC by C.',
        operands: 'addr: Register address; C: Coefficient (typically 0.0 to clear ACC)',
        example: 'WRAX DACL, 0.0  ; Write to left output and clear ACC'
    },
    'maxx': {
        name: 'MAXX',
        syntax: 'MAXX addr, C',
        description: 'Compare |ACC| with |REG[ADDR] * C|, keep maximum value.',
        operands: 'addr: Register address; C: Coefficient applied after comparison',
        example: 'MAXX REG0, 0.0  ; Keep maximum of ACC and REG0'
    },
    'mulx': {
        name: 'MULX',
        syntax: 'MULX addr',
        description: 'Multiply ACC by REG[ADDR]. An important application of the MULX instruction is squaring the content of ACC, which combined with a single order LP is especially useful in calculating the RMS value of an arbitrary waveform.',
        operands: 'addr: Register address',
        example: 'MULX POT0  ; Multiply ACC by POT0 value'
    },
    'rdfx': {
        name: 'RDFX',
        syntax: 'RDFX addr, C',
        description: 'Read shelving filter. ACC = (ACC - REG[ADDR])*C + REG[ADDR]',
        operands: 'addr: Register address; C: Coefficient',
        example: 'RDFX REG0, 0.5'
    },
    'wrlx': {
        name: 'WRLX',
        syntax: 'WRLX addr, C',
        description: 'Write shelving filter low. Current ACC is saved to REG[ADDR], then ACC = (previous ACC - ACC) * C + previous ACC.',
        operands: 'addr: Register address; C: Coefficient',
        example: 'WRLX REG0, 0.5'
    },
    'wrhx': {
        name: 'WRHX',
        syntax: 'WRHX addr, C',
        description: 'Write shelving filter high. Current ACC is saved to REG[ADDR], then ACC = ACC * C + previous ACC.',
        operands: 'addr: Register address; C: Coefficient',
        example: 'WRHX REG1, -0.5'
    },
    
    // Delay Memory Instructions
    'rda': {
        name: 'RDA',
        syntax: 'RDA addr, C',
        description: 'Read from delay memory, multiply by C, and add to ACC.',
        operands: 'addr: Delay memory address (0-32767); C: Coefficient',
        example: 'RDA 16383, 0.5  ; Read from delay at 0.5 volume'
    },
    'rmpa': {
        name: 'RMPA',
        syntax: 'RMPA C',
        description: 'Read from delay memory at ADDR_PTR, multiply by C and add to ACC.',
        operands: 'C: Coefficient',
        example: 'RMPA 0.5  ; Read from ADDR_PTR location'
    },
    'wra': {
        name: 'WRA',
        syntax: 'WRA addr, C',
        description: 'Write ACC to delay memory, then multiply ACC by C.',
        operands: 'addr: Delay memory address; C: Coefficient',
        example: 'WRA 16383, 0.0  ; Write to delay and clear ACC'
    },
    'wrap': {
        name: 'WRAP',
        syntax: 'WRAP addr, C',
        description: 'Write ACC to delay memory at address pointer, multiply by C and add LR (last sample read).',
        operands: 'addr: Delay memory address (sets LR); C: Coefficient',
        example: 'WRAP 16383, 0.0'
    },
    
    // LFO/Chorus Instructions
    'wlds': {
        name: 'WLDS',
        syntax: 'WLDS SIN, freq, amp',
        description: 'Write LFO selection for sine wave.',
        operands: 'freq: Frequency register; amp: Amplitude register',
        example: 'WLDS SIN0, 51, 8194'
    },
    'wldr': {
        name: 'WLDR',
        syntax: 'WLDR RMP, freq, amp',
        description: 'Write LFO selection for ramp wave.',
        operands: 'freq: Frequency register; amp: Amplitude register',
        example: 'WLDR RMP0, $100, 0'
    },
    'jam': {
        name: 'JAM',
        syntax: 'JAM lfo',
        description: 'Reset LFO to initial state.',
        operands: 'lfo: LFO number (0 or 1)',
        example: 'JAM 0  ; Reset LFO 0'
    },
    'cho': {
        name: 'CHO',
        syntax: 'CHO type, lfo[, flags, addr/const]',
        description: 'Chorus operation. Used for LFO-modulated delay reads.',
        operands: 'type: RDA, SOF, RDAL; lfo: SIN/COS/RMP; flags: REG/COMPC/COMPA/RPTR2/NA; addr: memory address',
        example: 'CHO RDA, SIN0, REG|COMPC, 1000'
    },
    
    // Other Instructions
    'clr': {
        name: 'CLR',
        syntax: 'CLR',
        description: 'Clear accumulator (set ACC to 0).',
        operands: 'None',
        example: 'CLR  ; ACC = 0'
    },
    'not': {
        name: 'NOT',
        syntax: 'NOT',
        description: 'Logical NOT operation on ACC (invert all bits).',
        operands: 'None',
        example: 'NOT  ; Invert ACC'
    },
    'absa': {
        name: 'ABSA',
        syntax: 'ABSA',
        description: 'Absolute value of ACC.',
        operands: 'None',
        example: 'ABSA  ; ACC = |ACC|'
    },
    'ldax': {
        name: 'LDAX',
        syntax: 'LDAX addr',
        description: 'Load ACC with register value (equivalent to RDAX with C=1.0).',
        operands: 'addr: Register address',
        example: 'LDAX REG0  ; ACC = REG0'
    },
    'nop': {
        name: 'NOP',
        syntax: 'NOP',
        description: 'No operation. Does nothing, used for timing or padding.',
        operands: 'None',
        example: 'NOP  ; Do nothing'
    }
};

// Helper function to get documentation for an instruction (case-insensitive)
export function getInstructionDoc(instruction: string): InstructionDoc | undefined {
    return FV1_INSTRUCTIONS[instruction.toLowerCase()];
}
