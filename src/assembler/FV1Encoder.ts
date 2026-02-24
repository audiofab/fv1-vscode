import { ASTNode, Expression } from './FV1Parser.js';

export interface EncodingField {
    name: string;
    bits: number;
    offset: number;
    type?: 'S1_14' | 'S_15' | 'S1_9' | 'S_10' | 'S4_6' | 'U' | 'S' | 'REG' | 'ADDR' | 'LFO';
    value?: number;
}

export interface InstructionSchema {
    opcode: number;
    fields: EncodingField[];
}

export const INSTRUCTION_SET: Record<string, InstructionSchema> = {
    // Accumulator
    'SOF': {
        opcode: 0b01101, fields: [
            { name: 'coeff', bits: 16, offset: 16, type: 'S1_14' },
            { name: 'd', bits: 11, offset: 5, type: 'S_10' },
            { name: 'op', bits: 5, offset: 0, value: 0b01101 }
        ]
    },
    'AND': {
        opcode: 0b01110, fields: [
            { name: 'mask', bits: 24, offset: 8, type: 'U' },
            { name: 'op', bits: 8, offset: 0, value: 0b01110 }
        ]
    },
    'OR': {
        opcode: 0b01111, fields: [
            { name: 'mask', bits: 24, offset: 8, type: 'U' },
            { name: 'op', bits: 8, offset: 0, value: 0b01111 }
        ]
    },
    'XOR': {
        opcode: 0b10000, fields: [
            { name: 'mask', bits: 24, offset: 8, type: 'U' },
            { name: 'op', bits: 8, offset: 0, value: 0b10000 }
        ]
    },
    'LOG': {
        opcode: 0b01011, fields: [
            { name: 'coeff', bits: 16, offset: 16, type: 'S1_14' },
            { name: 'd', bits: 11, offset: 5, type: 'S4_6' },
            { name: 'op', bits: 5, offset: 0, value: 0b01011 }
        ]
    },
    'EXP': {
        opcode: 0b01100, fields: [
            { name: 'coeff', bits: 16, offset: 16, type: 'S1_14' },
            { name: 'd', bits: 11, offset: 5, type: 'S_10' },
            { name: 'op', bits: 5, offset: 0, value: 0b01100 }
        ]
    },
    'SKP': {
        opcode: 0b10001, fields: [
            { name: 'flags', bits: 5, offset: 27, type: 'LFO' }, // Special handling for flag bits
            { name: 'n', bits: 6, offset: 21, type: 'S' },
            { name: 'op', bits: 5, offset: 0, value: 0b10001 }
        ]
    },
    'JMP': {
        opcode: 0b10001, fields: [
            { name: 'flags', bits: 5, offset: 27, value: 0 },
            { name: 'n', bits: 6, offset: 21, type: 'S' },
            { name: 'op', bits: 5, offset: 0, value: 0b10001 }
        ]
    },
    'NOP': {
        opcode: 0b10001, fields: [
            { name: 'flags', bits: 5, offset: 27, value: 0 },
            { name: 'n', bits: 6, offset: 21, value: 0 },
            { name: 'op', bits: 5, offset: 0, value: 0b10001 }
        ]
    },

    // Register
    'RDAX': {
        opcode: 0b00100, fields: [
            { name: 'addr', bits: 6, offset: 5, type: 'REG' },
            { name: 'coeff', bits: 16, offset: 16, type: 'S1_14' },
            { name: 'op', bits: 5, offset: 0, value: 0b00100 }
        ]
    },
    'WRAX': {
        opcode: 0b00110, fields: [
            { name: 'addr', bits: 6, offset: 5, type: 'REG' },
            { name: 'coeff', bits: 16, offset: 16, type: 'S1_14' },
            { name: 'op', bits: 5, offset: 0, value: 0b00110 }
        ]
    },
    'MAXX': {
        opcode: 0b01001, fields: [
            { name: 'addr', bits: 6, offset: 5, type: 'REG' },
            { name: 'coeff', bits: 16, offset: 16, type: 'S1_14' },
            { name: 'op', bits: 5, offset: 0, value: 0b01001 }
        ]
    },
    'MULX': {
        opcode: 0b01010, fields: [
            { name: 'addr', bits: 6, offset: 5, type: 'REG' },
            { name: 'op', bits: 5, offset: 0, value: 0b01010 }
        ]
    },
    'RDFX': {
        opcode: 0b00101, fields: [
            { name: 'addr', bits: 6, offset: 5, type: 'REG' },
            { name: 'coeff', bits: 16, offset: 16, type: 'S1_14' },
            { name: 'op', bits: 5, offset: 0, value: 0b00101 }
        ]
    },
    'WRLX': {
        opcode: 0b01000, fields: [
            { name: 'addr', bits: 6, offset: 5, type: 'REG' },
            { name: 'coeff', bits: 16, offset: 16, type: 'S1_14' },
            { name: 'op', bits: 5, offset: 0, value: 0b01000 }
        ]
    },
    'WRHX': {
        opcode: 0b00111, fields: [
            { name: 'addr', bits: 6, offset: 5, type: 'REG' },
            { name: 'coeff', bits: 16, offset: 16, type: 'S1_14' },
            { name: 'op', bits: 5, offset: 0, value: 0b00111 }
        ]
    },
    'LDAX': {
        opcode: 0b00101, fields: [
            { name: 'coeff', bits: 16, offset: 16, value: 0 },
            { name: 'addr', bits: 6, offset: 5, type: 'REG' },
            { name: 'op', bits: 5, offset: 0, value: 0b00101 }
        ]
    },

    // Delay RAM
    'RDA': {
        opcode: 0b00000, fields: [
            { name: 'addr', bits: 16, offset: 5, type: 'ADDR' },
            { name: 'coeff', bits: 11, offset: 21, type: 'S1_9' },
            { name: 'op', bits: 5, offset: 0, value: 0b00000 }
        ]
    },
    'RMPA': {
        opcode: 0b00001, fields: [
            { name: 'coeff', bits: 11, offset: 21, type: 'S1_9' },
            { name: 'op', bits: 5, offset: 0, value: 0b00001 }
        ]
    },
    'WRA': {
        opcode: 0b00010, fields: [
            { name: 'addr', bits: 16, offset: 5, type: 'ADDR' },
            { name: 'coeff', bits: 11, offset: 21, type: 'S1_9' },
            { name: 'op', bits: 5, offset: 0, value: 0b00010 }
        ]
    },
    'WRAP': {
        opcode: 0b00011, fields: [
            { name: 'addr', bits: 16, offset: 5, type: 'ADDR' },
            { name: 'coeff', bits: 11, offset: 21, type: 'S1_9' },
            { name: 'op', bits: 5, offset: 0, value: 0b00011 }
        ]
    },

    // LFO/CHO
    'WLDS': {
        opcode: 0b10010, fields: [
            { name: 'sinLfo', bits: 1, offset: 29, type: 'U' }, // N
            { name: 'freq', bits: 9, offset: 20, type: 'U' },   // F
            { name: 'ampl', bits: 15, offset: 5, type: 'U' },   // A
            { name: 'op', bits: 5, offset: 0, value: 0b10010 }
        ]
    },
    'WLDR': {
        opcode: 0b10010, fields: [
            { name: 'type', bits: 1, offset: 30, value: 1 },    // Always 1 for WLDR
            { name: 'rmpLfo', bits: 1, offset: 29, type: 'U' }, // N
            { name: 'freq', bits: 16, offset: 13, type: 'U' },  // F (signed 16-bit)
            { name: 'ampl', bits: 2, offset: 5, type: 'U' },    // A (backward encoding handled in assembler)
            { name: 'op', bits: 5, offset: 0, value: 0b10010 }
        ]
    },
    'JAM': {
        opcode: 0b10011, fields: [
            { name: 'rmpLfo', bits: 1, offset: 6, type: 'U' },
            { name: 'type', bits: 1, offset: 7, value: 1 },
            { name: 'op', bits: 5, offset: 0, value: 0b10011 }
        ]
    },
    'CHO': {
        opcode: 0b10100, fields: [
            { name: 'mode', bits: 2, offset: 30, type: 'U' },
            { name: 'flags', bits: 6, offset: 24, type: 'U' },
            { name: 'n', bits: 3, offset: 21, type: 'U' },
            { name: 'param', bits: 16, offset: 5, type: 'ADDR' }, // Can be addr or coeff
            { name: 'op', bits: 5, offset: 0, value: 0b10100 }
        ]
    },

    // Pseudo-ops
    'CLR': { opcode: 0b01110, fields: [{ name: 'val', bits: 32, offset: 0, value: 0b01110 }] },
    'NOT': { opcode: 0b10000, fields: [{ name: 'val', bits: 32, offset: 0, value: 0b10000 }] },
    'ABSA': { opcode: 0b01001, fields: [{ name: 'val', bits: 32, offset: 0, value: 0b01001 }] },
};

export class Encoder {
    public static encode(format: string, value: number): number {
        switch (format) {
            case 'S1_14': return this.toFixedPoint(value, 1, 14, 2.0);
            case 'S_15': return this.toFixedPoint(value, 0, 15, 1.0);
            case 'S1_9': return this.toFixedPoint(value, 1, 9, 2.0);
            case 'S_10': return this.toFixedPoint(value, 0, 10, 1.0);
            case 'S4_6': return this.toFixedPoint(value, 4, 6, 16.0);
        }
        return value;
    }

    private static toFixedPoint(value: number, intBits: number, fracBits: number, maxValue: number): number {
        const lsb = maxValue / (1 << fracBits);
        const min = -maxValue;
        const max = maxValue - lsb;

        let num = Math.min(Math.max(value, min), max);
        let encoded = Math.trunc(num * (1 << fracBits));

        const totalBits = 1 + intBits + fracBits;
        const mask = (1 << totalBits) - 1;

        return (encoded < 0) ? (encoded + (1 << totalBits)) & mask : encoded & mask;
    }

    public static assembleInstruction(mnemonic: string, operands: number[], schema: InstructionSchema): number {
        let result = 0;
        let operandIdx = 0;

        for (const field of schema.fields) {
            let val = 0;
            if (field.value !== undefined) {
                val = field.value;
            } else {
                val = operands[operandIdx++];
                if (field.type) val = this.encode(field.type, val);
            }

            const mask = field.bits === 32 ? 0xFFFFFFFF : (1 << field.bits) - 1;
            result |= (val & mask) << field.offset;
        }

        return result >>> 0;
    }
}
