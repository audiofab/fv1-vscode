interface FV1AssemblerOptions {
  fv1AsmMemBug?: boolean;
  clampReals?: boolean;
  regCount?: number;
  progSize?: number;
  delaySize?: number;
}

interface FV1AssemblerProblem {
  message: string;
  isfatal: boolean;
  line: number;
}

interface FV1Memory {
  size: number;
  start?: number;
  middle?: number;
  end?: number;
  name: string;
  line: number;
  original: string;
}

interface FV1Symbol {
  name: string;
  value: string;
  line?: number;
  original?: string;
}

interface FV1Instruction {
  opcode: number;
  numOperands: number;
}

interface FV1AssemblerResult {
  machineCode: number[];
  problems: FV1AssemblerProblem[];
  labels: Map<string, { line: number, instructionLine: number }>;
  symbols: FV1Symbol[];
  memories: FV1Memory[];
  addressToLineMap: Map<number, number>; // Maps instruction address to source line number
  usedRegistersCount: number;           // Number of local registers (REG0-31) used
}

// Possible signed fixed-point number formats for the FV-1
// Bits  Range      Resolution        (LSB value)
// S1.14  16    -2 to 1.99993896484  0.00006103516
// S1.9   11    -2 to 1.998046875    0.00195312525
// S.10   11    -1 to 0.9990234375   0.0009765625

interface SignedFixedPointNumber {
  integer_bits: number;
  fractional_bits: number;
  minimum?: number;
  maximum?: number;
}

// Helper function to reduce expressions of numbers in a string to a final value
// Based on:
//    https://code.tutsplus.com/what-they-didnt-tell-you-about-es5s-array-extras--net-28263t
//    https://stackoverflow.com/questions/2276021/evaluating-a-string-as-a-mathematical-expression-in-javascript
function resolveExpression(expression: string) {
  const _parts = expression.match(
    // digits |operators|whitespace 
    /(?:\-?[\d\.]+)|[-\+\*\/<>]|\s+/g
  );

  if (expression !== _parts.join("")) {
    throw new Error(`Failed to parse expression ${expression}`)
  }

  // Trim each part and remove any whitespace
  const parts = _parts.map((part) => (part.trim())).filter((part) => part !== "");
  const nums = parts.map((part) => (parseFloat(part)));

  // Build an array with all operations reduced to additions
  const processed = new Array<number>();

  for (let i = 0; i < parts.length; i++) {
    if (!Number.isNaN(nums[i])) {
      processed.push(nums[i]);
    } else {
      switch (parts[i]) {
        case "+":
          continue; //ignore 
        case "-":
          processed.push(nums[++i] * -1);
          break;
        case "*":
          processed.push(processed.pop() * nums[++i]);
          break;
        case "/":
          processed.push(processed.pop() / nums[++i]);
          break;
        case "<":
          processed.push(processed.pop() << nums[++i]);
          break;
        case ">":
          processed.push(processed.pop() >> nums[++i]);
          break;
        default:
          throw new Error(`Unknown operation: ${parts[i]}`);
      }
    }
  }

  //add all numbers and return the result 
  return processed.reduce((result, elem) => (result + elem));
}


class SignedFixedPointNumber implements SignedFixedPointNumber {
  constructor(public integer_bits: number, public fractional_bits: number, private max_value: number) {
    const lsb = max_value / (1 << fractional_bits);
    this.minimum = -max_value;
    this.maximum = max_value - lsb;
  }

  public encode(value: string, clamp?: boolean, onError?: (msg: string) => void): number | null {
    // Apparently the SpinASM assembler allows multiple signs in front of numbers
    // so we need to deal with that here as well
    let multiplier = 1;
    while (value.startsWith('+') || value.startsWith('-')) {
      if (value.startsWith('-')) {
        multiplier *= -1;
      }
      value = value.substring(1);
    }
    let num = resolveExpression(value);
    if (isNaN(num)) {
      if (onError) {
        onError(`Invalid number: ${value}`);
      }
      return null
    }
    num *= multiplier;
    if (num < this.minimum || num > this.maximum) {
      if (clamp) {
        num = Math.min(Math.max(num, this.minimum), this.maximum);
      } else {
        if (onError) {
          onError(`Value out of range: ${value} (must be between ${this.minimum} and ${this.maximum})`);
        }
        return null;
      }
    }

    let encoded = Math.trunc(num * (1 << this.fractional_bits));
    let total_bits = 1 + this.integer_bits + this.fractional_bits;
    let mask = ((1 << (total_bits)) - 1);
    // Convert to unsigned representation (two's complement)
    if (encoded < 0) {
      encoded = (encoded + (1 << (total_bits))) & mask;
    } else {
      encoded = encoded & mask;
    }

    return encoded;
  }
}

const S1_14 = new SignedFixedPointNumber(1, 14, 2.0);
const S_15 = new SignedFixedPointNumber(0, 15, 1.0);
const S1_9 = new SignedFixedPointNumber(1, 9, 2.0);
const S_10 = new SignedFixedPointNumber(0, 10, 1.0);
const S4_6 = new SignedFixedPointNumber(4, 6, 16.0);

// Hexadecimal numbers start with a $
// Binary numbers start with % and contain underscores for readability
// Binary numbers can also be an OR'ing of decimal values (e.g. "4|1")

class FV1Assembler {
  private NOP_ENCODING = 0x0000_0011;
  private options: Required<FV1AssemblerOptions>;

  public static getMiddleAddr(start: number, size: number): number {
    if (size % 2) {
      // Odd size, so the middle sample is (size - 1) / 2 - 1
      return start + (size - 1) / 2 - 1;
    } else {
      return start + size / 2;
    }
  }

  public static getEndAddr(start: number, size: number, fv1AsmMemBug: boolean = false): number {
    const end = start + size - 1;
    if (fv1AsmMemBug) {
      // Simulate SpinASM bug where the end address is actually one more than it should be
      return end + 1;
    }
    return end;
  }

  private readonly instructions = new Map<string, FV1Instruction>([
    // Accumulator instructions
    ['SOF', { opcode: 0b01101, numOperands: 2 }],
    ['AND', { opcode: 0b01110, numOperands: 1 }],
    ['OR', { opcode: 0b01111, numOperands: 1 }],
    ['XOR', { opcode: 0b10000, numOperands: 1 }],
    ['LOG', { opcode: 0b01011, numOperands: 2 }],
    ['EXP', { opcode: 0b01100, numOperands: 2 }],
    ['SKP', { opcode: 0b10001, numOperands: 2 }],
    ['JMP', { opcode: 0b10001, numOperands: 1 }],  // JMP is SKP with no flags
    ['NOP', { opcode: 0b10001, numOperands: 0 }],  // NOP is SKP with no flags and 0 offset
    // Register instructions
    ['RDAX', { opcode: 0b00100, numOperands: 2 }],
    ['WRAX', { opcode: 0b00110, numOperands: 2 }],
    ['MAXX', { opcode: 0b01001, numOperands: 2 }],
    ['MULX', { opcode: 0b01010, numOperands: 1 }],
    ['RDFX', { opcode: 0b00101, numOperands: 2 }],
    ['WRLX', { opcode: 0b01000, numOperands: 2 }],
    ['WRHX', { opcode: 0b00111, numOperands: 2 }],
    // Delay RAM intructions
    ['RDA', { opcode: 0b00000, numOperands: 2 }],
    ['RMPA', { opcode: 0b00001, numOperands: 1 }],
    ['WRA', { opcode: 0b00010, numOperands: 2 }],
    ['WRAP', { opcode: 0b00011, numOperands: 2 }],
    // LFO instructions
    ['WLDS', { opcode: 0b10010, numOperands: 3 }],
    ['WLDR', { opcode: 0b10010, numOperands: 3 }],
    ['JAM', { opcode: 0b10011, numOperands: 1 }],
    ['CHO', { opcode: 0b10100, numOperands: -1 }], // Special case with variable operands
    // Pseudo op-code instructions
    ['CLR', { opcode: 0b01110, numOperands: 0 }], // Same encoding as AND
    ['NOT', { opcode: 0b10000, numOperands: 0 }], // Same encoding as XOR
    ['ABSA', { opcode: 0b01001, numOperands: 0 }], // Same encoding as MAXX
    ['LDAX', { opcode: 0b00101, numOperands: 1 }], // Same encoding as RDFX
  ]);

  private readonly predefinedSymbols = new Map<string, number>([
    // Registers
    ['SIN0_RATE', 0x00], ['SIN0_RANGE', 0x01], ['SIN1_RATE', 0x02], ['SIN1_RANGE', 0x03],
    ['RMP0_RATE', 0x04], ['RMP0_RANGE', 0x05], ['RMP1_RATE', 0x06], ['RMP1_RANGE', 0x07],
    ['POT0', 0x10], ['POT1', 0x11], ['POT2', 0x12], ['ADCL', 0x14], ['ADCR', 0x15],
    ['DACL', 0x16], ['DACR', 0x17], ['ADDR_PTR', 0x18],
    // CHO-related
    ['SIN0', 0x00], ['SIN1', 0x01], ['RMP0', 0x02], ['RMP1', 0x03],
    ['COS0', 0x08], ['COS1', 0x09],
    ['RDA', 0x00], ['SOF', 0x02], ['RDAL', 0x03],
    ['SIN', 0x00], ['COS', 0x01], ['REG', 0x02], ['COMPC', 0x04],
    ['COMPA', 0x08], ['RPTR2', 0x10], ['NA', 0x20],
    // SKP flags
    ['RUN', 0x8000_0000], ['ZRC', 0x4000_0000], ['ZRO', 0x2000_0000],
    ['GEZ', 0x1000_0000], ['NEG', 0x0800_0000]
  ]);

  private labels = new Map<string, { line: number, instructionLine: number }>();
  private symbols: FV1Symbol[] = [];
  private memories: FV1Memory[] = [];
  private problems: FV1AssemblerProblem[] = [];
  constructor(options: FV1AssemblerOptions = {}) {
    this.options = {
      fv1AsmMemBug: options.fv1AsmMemBug ?? true,
      clampReals: options.clampReals ?? true,
      regCount: options.regCount ?? 32,
      progSize: options.progSize ?? 128,
      delaySize: options.delaySize ?? 32768
    };

    // Dynamically add REG0-REGx symbols
    // user registers start at index 32 (0x20)
    for (let i = 0; i < this.options.regCount - 32; i++) {
      this.predefinedSymbols.set(`REG${i}`, 0x20 + i);
    }
  }

  public assemble(source: string): FV1AssemblerResult {
    this.reset();
    let machineCode: number[] = [];
    const instructionLines = this.preprocessSource(source);

    // If there are no fatal problems continue with parsing instructions
    if (!this.problems.some(p => p.isfatal)) {
      machineCode = this.generateMachineCode(instructionLines);
    }

    return {
      machineCode: machineCode,
      problems: this.problems,
      labels: new Map(this.labels),
      symbols: this.symbols,
      memories: this.memories,
      addressToLineMap: this.addressToLineMap,
      usedRegistersCount: this.usedRegisters.size
    };
  }

  private addressToLineMap = new Map<number, number>();
  private usedRegisters = new Set<number>();

  private reset(): void {
    this.labels.clear();
    this.symbols = [];
    this.memories = [];
    this.problems = [];
    this.addressToLineMap.clear();
    this.usedRegisters.clear();
  }

  private parseInteger(value: string, maxNumBits: number = 0, isSigned: boolean = false): number | null {
    let parsed: number = null;
    if (value.includes('|')) {
      // Handle OR'ed values
      const parts = value.split('|');
      parsed = 0;
      for (const part of parts) {
        const partValue = this.parseInteger(part.trim());
        if (partValue === null) {
          return null;
        }
        parsed |= partValue;
      }
    } else if (value.startsWith('$')) {
      parsed = parseInt(value.substring(1), 16);
    } else if (value.startsWith('0X')) {
      parsed = parseInt(value.substring(2), 16);
    } else if (value.startsWith('%')) {
      // Handle binary with optional underscores
      const binaryStr = value.substring(1).replace(/_/g, '');
      parsed = parseInt(binaryStr, 2);
    } else {
      try {
        parsed = resolveExpression(value);
      } catch {
        parsed = parseInt(value, 10);
      }
    }

    if (isNaN(parsed)) {
      return null;
    }

    if (maxNumBits <= 0) {
      maxNumBits = 32;
    }
    const maxUnsigned = 2 ** maxNumBits - 1;
    if (isSigned) {
      const minSigned = -(2 ** (maxNumBits - 1));
      const maxSigned = (2 ** (maxNumBits - 1)) - 1;
      if (parsed < minSigned || parsed > maxSigned) return null;
    } else {
      if (parsed < 0 || parsed > maxUnsigned) return null;
    }

    return parsed;
  }

  private preprocessSource(source: string): Map<number, string[]> {
    // Add built-in registers and choModes to the list of symbols
    this.predefinedSymbols.forEach((value, key) => {
      this.symbols.push({ name: key, value: value.toString() });
    });

    // Preprocess source: remove comments, trim lines, and filter out empty lines
    const lines = new Map(
      source
        .split('\n')
        .map((line, index) => ({ line: line.trim(), number: index + 1 }))
        .filter(({ line }) => line && !line.startsWith(';'))
        .map(({ line, number }) => {
          // Remove inline comments
          const commentIndex = line.indexOf(';');
          return { line: commentIndex !== -1 ? line.substring(0, commentIndex).trim() : line, number: number };
        })
        .filter(({ line }) => line.length > 0)
        .map(({ line, number }) => [number, line] as [number, string])
    );

    // Process EQU directives
    for (const [lineNumber, line] of lines.entries()) {
      const parts = line.toUpperCase().split(/\s+/);
      if (parts.length == 3) {
        // Handle both scenarios in the docs (EQU first or second)
        if ((parts[0] === 'EQU') || (parts[1] === 'EQU')) {
          const name = parts[0] === 'EQU' ? parts[1] : parts[0];
          // Check that name isn't a label
          if (this.labels.has(name)) {
            this.problems.push({ message: `EQU name '${name}' conflicts with existing label`, isfatal: true, line: lineNumber });
          } else {
            // Check for duplicate EQU definitions
            const existing = this.symbols.find(s => s.name === name);
            if (existing) {
              this.problems.push({
                message: `Duplicate EQU '${name}' - already defined on line ${existing.line}`,
                isfatal: false,
                line: lineNumber
              });
            } else {
              this.symbols.push({ name: name, value: parts[2], line: lineNumber, original: line });
            }
            lines.delete(lineNumber); // Remove EQU line after processing
          }
        }
      }
    }

    // Replace any EQU symbols that happened to be defined as internal symbolic values
    for (const _sym of this.symbols) {
      for (const sym of this.symbols) {
        if (_sym.value === sym.name) {
          // SpinASM seems to resolve any symbolic value as it is replaced
          // So, attempt to resolve the symbolic expression now, if possible
          _sym.value = sym.value;
        }
      }
    }
    // If an EQU happened to be made up of other EQU in an expression, resolve
    // any EQUs in the expression
    for (const _sym of this.symbols) {
      for (const sym of this.symbols) {
        const regex = new RegExp(`(?<=^|\\s|[^\\w])(${sym.name})(?=$|\\s|[^\\w])`, 'g');
        _sym.value = _sym.value.replace(regex, sym.value);
        // SpinASM seems to resolve any symbolic value as it is replaced
        // So, attempt to resolve the symbolic expression now, if possible
        // otherwise we get into order of operations issues later!
        try {
          _sym.value = `${resolveExpression(_sym.value)}`;
        } catch (error) {
          // Ignore
        }
      }
    }

    // Process all lines for MEM directives
    for (const [lineNumber, line] of lines.entries()) {
      const parts = line.toUpperCase().split(/\s+/);
      if (parts.length == 3) {
        // Handle both scenarios in the docs (MEM first or second)
        if ((parts[0] === 'MEM') || (parts[1] === 'MEM')) {
          const name = parts[0] === 'MEM' ? parts[1] : parts[0];
          // Check that name isn't a label or and EQU
          if (this.labels.has(name)) {
            this.problems.push({ message: `MEM name '${name}' conflicts with existing label`, isfatal: true, line: lineNumber });
          } else if (this.symbols.find(s => s.name === name)) {
            this.problems.push({ message: `MEM name '${name}' conflicts with existing symbol`, isfatal: true, line: lineNumber });
          } else {
            let sizeStr = parts[2];
            // Replace any symbols in the MEM size
            for (const sym of this.symbols) {
              const regex = new RegExp(`(?<=^|\\s|[^\\w])(${sym.name})(?=$|\\s|[^\\w])`, 'g');
              sizeStr = sizeStr.replace(regex, sym.value);
            }
            // parseInteger should evaluate any expressions
            const size = this.parseInteger(sizeStr.toString());
            if (size === null) {
              this.problems.push({ message: `Invalid memory size '${sizeStr}' in MEM directive`, isfatal: true, line: lineNumber });
            } else if (size > this.options.delaySize) {
              this.problems.push({ message: `MEM size exceeds maximum of ${this.options.delaySize} words`, isfatal: true, line: lineNumber });
            } else {
              this.memories.push({ name: name.toUpperCase(), size: size, line: lineNumber, original: line });
              lines.delete(lineNumber); // Remove MEM line after processing
            }
          }
        }
      }
    }

    // Now we can allocate delay memory because EQU symbols may be defined
    // as MEM expressions which we need to resolve before replacing EQU symbols
    // globally in the code
    const totalDelayMemory = this.allocateDelayMemory();

    // Resolve any memory addresses in EQU values
    // TODO: This isn't really needed except to match the SpinASM stats output
    for (const sym of this.symbols) {
      if (isNaN(parseFloat(sym.value))) {
        // Doesn't look like a number, so try parsing as a delay memory address
        const addr = this.parseDelayMemoryAddress(sym.value);
        if (addr !== null) {
          sym.value = addr.toString();
        }
      }
    }

    let instructionLine = 0;
    // Resolve labels and remove them if necessary
    for (const [lineNumber, line] of lines.entries()) {
      if (line.includes(':')) {
        const [label, rest] = line.split(':', 2);
        const labelName = label.trim().toUpperCase();
        if (this.labels.has(labelName)) {
          this.problems.push({ message: `Duplicate label '${labelName}'`, isfatal: true, line: lineNumber });
        } else if (labelName === '') {
          this.problems.push({ message: `Empty label is not allowed`, isfatal: true, line: lineNumber });
        } else {
          this.labels.set(labelName, { line: lineNumber, instructionLine: instructionLine });
        }
        // If there are instructions after the label, keep the instructions
        if (rest && rest.trim()) {
          lines.set(lineNumber, rest.trim());
        } else {
          lines.delete(lineNumber); // Remove line if only label
          instructionLine--;        // Adjust instruction line count as this was a label
        }
      }
      instructionLine++;
    }

    let invalidLine: boolean = false
    // The remaining lines should be instructions. First pull out the
    // instruction mnemonic.
    const instructionLines = new Map<number, string[]>();
    for (const [lineNumber, line] of lines.entries()) {
      const parts = line.toUpperCase().split(/\s+/);
      if (parts.length === 0) {
        // Shouldn't happen since we filtered out empty lines earlier
        invalidLine = true;
        this.problems.push({ message: `Internal error: empty line after preprocessing`, isfatal: true, line: lineNumber });
      } else {
        const mnemonic = parts[0];
        let operands = parts.slice(1).join('');
        // Expand operands separated by commas into separate tokens
        const expandedLines: string[] = [];
        expandedLines.push(mnemonic); // The instruction mnemonic
        // Replace all occurrences of symbols in each subpart
        for (const equ of this.symbols) {
          const regex = new RegExp(`(?<=^|\\s|[^\\w])(${equ.name})(?=$|\\s|[^\\w])`, 'g');
          operands = operands.replace(regex, equ.value);
        }
        // Resolve any memory addresses in operands
        for (const mem of this.memories) {
          // Replace all occurrences of memory names (with optional modifiers) in each subpart
          {
            const memName = mem.name + '#';
            const regex = new RegExp(`(?<=^|\\s|[^\\w])(${mem.name}#)(?=$|\\s|[^\\w])`, 'g');
            operands = operands.replace(regex, this.getMemoryAddressString(memName, lineNumber, mnemonic));
          }
          {
            const memName = mem.name + '^';
            const regex = new RegExp(`(?<=^|\\s|[^\\w])(${mem.name}\\^)(?=$|\\s|[^\\w])`, 'g');
            operands = operands.replace(regex, this.getMemoryAddressString(memName, lineNumber, mnemonic));
          }
          {
            const memName = mem.name;
            const regex = new RegExp(`(?<=^|\\s|[^\\w])(${mem.name})(?=$|\\s|[^\\w])`, 'g');
            operands = operands.replace(regex, this.getMemoryAddressString(memName, lineNumber, mnemonic));
          }
        }

        // Split on commas and trim whitespace
        const subParts = operands.split(',');
        for (const subPart of subParts) {
          if (subPart && subPart.trim()) {
            expandedLines.push(subPart.trim());
          }
        }

        instructionLines.set(lineNumber, expandedLines);
      }
    }

    if (invalidLine) {
      return null;
    }

    return instructionLines;
  }

  private allocateDelayMemory(): number {
    // Iterate over all memories and allocate the delay memory chunks
    let nextAvailableAddress = 0;
    this.memories.forEach(mem => {
      mem.start = nextAvailableAddress;
      nextAvailableAddress += mem.size;
      if (nextAvailableAddress > this.options.delaySize) {
        this.problems.push({ message: `Total delay memory exceeds ${this.options.delaySize} words`, isfatal: true, line: mem.line });
      }
      mem.end = FV1Assembler.getEndAddr(mem.start, mem.size); // Logical end (without bug)
      if (this.options.fv1AsmMemBug) {
        // Recycle the static calculation but add the extra skip if bug is on
        nextAvailableAddress += 1;
      }
      mem.middle = FV1Assembler.getMiddleAddr(mem.start, mem.size);
    });
    return nextAvailableAddress;
  }

  private generateMachineCode(lines: Map<number, string[]>): number[] {
    const machineCode: number[] = [];
    let errorLine = -1;
    let line128 = -1;  // Track the source line number where instruction 128 occurs

    try {
      lines.forEach((lineParts, lineNumber) => {
        errorLine = lineNumber;
        const mnemonic = lineParts[0];
        const addr = machineCode.length;
        this.addressToLineMap.set(addr, lineNumber);

        const encoding = this.encodeInstruction(mnemonic, lineParts.slice(1), lineNumber, addr);
        if (encoding === null) {
          throw new Error('Encoding error');
        }
        machineCode.push(encoding);

        // Track where instruction limit is exceeded
        if (machineCode.length === this.options.progSize) {
          line128 = lineNumber;
        }
      });
    } catch (e) {
      this.problems.push({ message: `Error encoding instruction on line ${errorLine}`, isfatal: true, line: errorLine });
      return [];
    }

    if (machineCode.length > this.options.progSize) {
      // Report error at the line where limit was first exceeded
      const reportLine = line128 !== -1 ? line128 : errorLine;
      this.problems.push({ message: `Program exceeds ${this.options.progSize} instruction limit (${machineCode.length} instructions)`, isfatal: true, line: reportLine });
      return machineCode;
    }

    // Pad to progSize instructions if needed
    while (machineCode.length < this.options.progSize) {
      machineCode.push(this.NOP_ENCODING);
    }

    return machineCode;
  }

  private encodeInstruction(mnemonic: string, operands: string[], lineNumber: number, instructionLineNumber: number): number | null {
    const instruction = this.getInstruction(mnemonic, lineNumber, operands);

    if (instruction === null) {
      return null;
    }

    switch (mnemonic) {
      case 'AND': // MMMMMMMMMMMMMMMMMMMMMMMM00001110
      case 'OR':  // MMMMMMMMMMMMMMMMMMMMMMMM00001111
      case 'XOR': // MMMMMMMMMMMMMMMMMMMMMMMM00010000
        {
          let m = this.parseInteger(operands[0], 24);

          if (m === null) {
            this.problems.push({ message: `Line ${lineNumber}: Invalid operand in ${mnemonic} instruction`, isfatal: true, line: lineNumber });
            return null;
          }
          return (m << 8 | instruction.opcode) >>> 0; // >>>0 ensures unsigned value
        }
      case 'LOG': // CCCCCCCCCCCCCCCCDDDDDDDDDDD01011
        {
          const coeff = this.parseFixedPointNumber(operands[0], S1_14, lineNumber, mnemonic, 16);
          const d = this.parseFixedPointNumber(operands[1], S4_6, lineNumber, mnemonic, 11);

          if (coeff === null || d === null) {
            this.problems.push({ message: `Line ${lineNumber}: Invalid operand in ${mnemonic} instruction`, isfatal: true, line: lineNumber });
            return null;
          }
          return (coeff << 16 | d << 5 | instruction.opcode) >>> 0; // >>>0 ensures unsigned value
        }

      case 'CHO':
        {
          // This instruction has a variable number of operands depending on
          // what the mode is
          const mode = this.parseInteger(operands[0], 2);
          const n = this.parseInteger(operands[1], 4);  // Need to treat n as 4 bits for RDAL. Range checking done later.
          if (mode === null || n === null) {
            this.problems.push({ message: `Line ${lineNumber}: Invalid operand in ${mnemonic} instruction`, isfatal: true, line: lineNumber });
            return null;
          }

          const numOperands = (mode === this.predefinedSymbols.get('RDAL')) ? 2 : 4;
          if (operands.length !== numOperands) {
            this.problems.push({ message: `Line ${lineNumber}: ${mnemonic} instruction requires ${numOperands} operands`, isfatal: true, line: lineNumber });
            return null;
          }

          switch (mode) {
            case this.predefinedSymbols.get('RDA'):   // 00CCCCCC0NNAAAAAAAAAAAAAAAA10100
              {
                const flags = this.parseInteger(operands[2], 6);
                const addr = this.parseInteger(operands[3]);
                if (flags === null || addr === null || n < 0 || n > 3) {
                  this.problems.push({ message: `Line ${lineNumber}: Invalid operand in ${mnemonic} instruction`, isfatal: true, line: lineNumber });
                  return null;
                }
                return (mode << 30 | flags << 24 | n << 21 | addr << 5 | instruction.opcode) >>> 0; // >>>0 ensures unsigned value
              }
            case this.predefinedSymbols.get('SOF'):   // 10CCCCCC0NNDDDDDDDDDDDDDDDD10100
              {
                const flags = this.parseInteger(operands[2], 6);
                const d = this.parseFixedPointNumber(operands[3], S_15, lineNumber, mnemonic, 16);
                if (flags === null || d === null || n < 0 || n > 3) {
                  this.problems.push({ message: `Line ${lineNumber}: Invalid operand in ${mnemonic} instruction`, isfatal: true, line: lineNumber });
                  return null;
                }
                return (mode << 30 | flags << 24 | n << 21 | d << 5 | instruction.opcode) >>> 0; // >>>0 ensures unsigned value
              }
            case this.predefinedSymbols.get('RDAL'):  // 1100001X0YZ000000000000000010100
              {
                // According to this forum topic, there is a typo in the FV-1 datasheet!
                // http://www.spinsemi.com/forum/viewtopic.php?t=399&hilit=COS0
                // Where:
                // X0YZ
                // 0000 sin0
                // 0001 sin1
                // 0010 rmp0
                // 0011 rmp1
                // 1000 cos0
                // 1001 cos1
                // All others not used
                if (n < 0 || (n >= 4 && n <= 7) || n > 9) {
                  this.problems.push({ message: `Line ${lineNumber}: Invalid LFO type in ${mnemonic} instruction`, isfatal: true, line: lineNumber });
                  return null;
                }
                return (mode << 30 | 1 << 25 | n << 21 | instruction.opcode) >>> 0; // >>>0 ensures unsigned value
              }
            default:
              this.problems.push({ message: `Line ${lineNumber}: Unknown mode for ${mnemonic} instruction`, isfatal: true, line: lineNumber });
              return null;
          }
        }
      case 'SOF': // CCCCCCCCCCCCCCCCDDDDDDDDDDD01101
      case 'EXP': // CCCCCCCCCCCCCCCCDDDDDDDDDDD01100
        {
          const coeff = this.parseFixedPointNumber(operands[0], S1_14, lineNumber, mnemonic, 16);
          // d can only be a fixed-point number
          const d = this.parseFixedPointNumber(operands[1], S_10, lineNumber, mnemonic, 11);

          if (coeff === null || d === null) {
            this.problems.push({ message: `Line ${lineNumber}: Invalid operand in ${mnemonic} instruction`, isfatal: true, line: lineNumber });
            return null;
          }
          return (coeff << 16 | d << 5 | instruction.opcode) >>> 0; // >>>0 ensures unsigned value
        }

      case 'SKP': // CCCCCNNNNNN000000000000000010001
      case 'JMP': // 00000NNNNNN000000000000000010001
        {
          // We don't range check flags as they are already left-shifted values
          // And we'll explicitly range check n to print a better error message
          let flags = 0;
          let n_index = 0
          if (mnemonic === 'SKP') {
            flags = this.parseInteger(operands[0]);
            n_index = 1;
          }
          let n = this.parseInteger(operands[n_index]);
          if (n === null) {
            // Must be a label, so try to resolve it
            if (this.labels.has(operands[n_index])) {
              n = this.labels.get(operands[n_index]).instructionLine - instructionLineNumber - 1; // Relative to next instruction
            }
          }
          if (flags === null || n === null) {
            this.problems.push({ message: `Line ${lineNumber}: Invalid operand in ${mnemonic} instruction`, isfatal: true, line: lineNumber });
            return null;
          }
          if (n > 0b111111) {
            this.problems.push({ message: `Line ${lineNumber}: ${mnemonic} target out of range for label '${operands[1]}'`, isfatal: true, line: lineNumber });
            return null;
          }
          return (flags | n << 21 | instruction.opcode) >>> 0; // >>>0 ensures unsigned value
        }

      case 'MULX': // 000000000000000000000AAAAAA01010
        {
          const addr = this.parseInteger(operands[0], 6);
          this.trackRegister(addr);
          if (addr === null) {
            this.problems.push({ message: `Line ${lineNumber}: Invalid operand in ${mnemonic} instruction`, isfatal: true, line: lineNumber });
            return null;
          }
          return (addr << 5 | instruction.opcode) >>> 0; // >>>0 ensures unsigned value
        }

      case 'RDAX': // CCCCCCCCCCCCCCCC00000AAAAAA00100
      case 'WRAX': // CCCCCCCCCCCCCCCC00000AAAAAA00110
      case 'MAXX': // CCCCCCCCCCCCCCCC00000AAAAAA01001
      case 'RDFX': // CCCCCCCCCCCCCCCC00000AAAAAA00101
      case 'WRLX': // CCCCCCCCCCCCCCCC00000AAAAAA01000
      case 'WRHX': // CCCCCCCCCCCCCCCC00000AAAAAA00111
      case 'LDAX': // 000000000000000000000AAAAAA00101 (special case of RDAX)
        {
          const addr = this.parseInteger(operands[0], 6);
          this.trackRegister(addr);
          // LDAX only has one operand, coeff is zero
          let coeff = 0;
          if (mnemonic !== 'LDAX') {
            coeff = this.parseFixedPointNumber(operands[1], S1_14, lineNumber, mnemonic, 16);
          }
          if (coeff === null || addr === null) {
            this.problems.push({ message: `Line ${lineNumber}: Invalid operand in ${mnemonic} instruction`, isfatal: true, line: lineNumber });
            return null;
          }
          return (coeff << 16 | addr << 5 | instruction.opcode) >>> 0; // >>>0 ensures unsigned value
        }

      case 'RDA':  // CCCCCCCCCCCAAAAAAAAAAAAAAAA00000
      case 'WRA':  // CCCCCCCCCCCAAAAAAAAAAAAAAAA00010
      case 'WRAP': // CCCCCCCCCCCAAAAAAAAAAAAAAAA00011
        {
          const addr = this.parseInteger(operands[0]);
          const coeff = this.parseFixedPointNumber(operands[1], S1_9, lineNumber, mnemonic, 11);
          if (coeff === null || addr === null) {
            this.problems.push({ message: `Line ${lineNumber}: Invalid operand in ${mnemonic} instruction`, isfatal: true, line: lineNumber });
            return null;
          }
          return (coeff << 21 | addr << 5 | instruction.opcode) >>> 0; // >>>0 ensures unsigned value
        }

      case 'RMPA': // CCCCCCCCCCC000000000001100000001 (but not really....)
        {
          const coeff = this.parseFixedPointNumber(operands[0], S1_9, lineNumber, mnemonic, 11);
          if (coeff === null) {
            this.problems.push({ message: `Line ${lineNumber}: Invalid operand in ${mnemonic} instruction`, isfatal: true, line: lineNumber });
            return null;
          }
          // NOTE: Another typo in the FV-1 datasheet - the opcode is actually 00001 not 1100000001!!
          //       Verified by comparing to the SpinASM output
          // return (coeff << 21 | 0b11 << 8 | instruction.opcode) >>> 0; // >>>0 ensures unsigned value
          return (coeff << 21 | instruction.opcode) >>> 0; // >>>0 ensures unsigned value
        }

      case 'WLDS': // 00NFFFFFFFFFAAAAAAAAAAAAAAA10010
        {
          const sinLfo = this.parseInteger(operands[0], 1);
          const freq = this.parseInteger(operands[1], 9);
          const ampl = this.parseInteger(operands[2], 15);
          if (sinLfo === null || freq === null || ampl === null) {
            this.problems.push({ message: `Line ${lineNumber}: Invalid operand in ${mnemonic} instruction`, isfatal: true, line: lineNumber });
            return null;
          }
          return (sinLfo << 29 | freq << 20 | ampl << 5 | instruction.opcode) >>> 0; // >>>0 ensures unsigned value
        }

      case 'WLDR': // 01NFFFFFFFFFFFFFFFF000000AA10010
        {
          let rmpLfo = this.parseInteger(operands[0], 2);       // Translated to 1-bit value below
          const freq = this.parseInteger(operands[1], 16, true);  // Signed 16-bit
          let ampl = this.parseInteger(operands[2]);            // Translated to 2-bit value below
          if (rmpLfo === null || freq === null || ampl === null) {
            this.problems.push({ message: `Line ${lineNumber}: Invalid operand in ${mnemonic} instruction`, isfatal: true, line: lineNumber });
            return null;
          }
          // This instruction has odd, custom ranges for frequency and amplitude so check them specifically here
          // (I don't see why this can't be as low as -32768 but the docs say -16384...)
          if (freq < -16384 || freq > 32767) {
            this.problems.push({ message: `Line ${lineNumber}: Frequency out of range in ${mnemonic} instruction`, isfatal: true, line: lineNumber });
            return null;
          }

          // Convert rmpLfo to 1-bit value
          if (![0, 1, 2, 3].includes(rmpLfo)) {
            this.problems.push({ message: `Line ${lineNumber}: Invalid LFO selection in ${mnemonic} instruction`, isfatal: true, line: lineNumber });
            return null;
          } else {
            // Convert LFO selection to a 1-bit value (this is another error in the FV-1 datasheet!)
            switch (rmpLfo) {
              case 0: rmpLfo = 0; break;
              case 1: rmpLfo = 1; break;
              case 2: rmpLfo = 0; break;  // RMP0 constant
              case 3: rmpLfo = 1; break;  // RMP1 constant
            }
          }
          // Convert amplitude to one of the allowed values
          if (![512, 1024, 2048, 4096].includes(ampl)) {
            this.problems.push({ message: `Line ${lineNumber}: Invalid amplitude in ${mnemonic} instruction`, isfatal: true, line: lineNumber });
            return null;
          } else {
            // Convert amplitude to 2-bit value (yes, it seems to be backwards-encoded - I check with SpinASM!)
            switch (ampl) {
              case 512: ampl = 3; break;
              case 1024: ampl = 2; break;
              case 2048: ampl = 1; break;
              case 4096: ampl = 0; break;
            }
          }
          return (1 << 30 | rmpLfo << 29 | (freq & 0xFFFF) << 13 | ampl << 5 | instruction.opcode) >>> 0; // >>>0 ensures unsigned value
        }

      case 'JAM': // 0000000000000000000000001N010011
        {
          let rmpLfo = this.parseInteger(operands[0], 2);       // Translated to 1-bit value below

          if (rmpLfo === null) {
            this.problems.push({ message: `Line ${lineNumber}: Invalid operand in ${mnemonic} instruction`, isfatal: true, line: lineNumber });
            return null;
          }
          // Convert rmpLfo to 1-bit value
          if (![0, 1, 2, 3].includes(rmpLfo)) {
            this.problems.push({ message: `Line ${lineNumber}: Invalid LFO selection in ${mnemonic} instruction`, isfatal: true, line: lineNumber });
            return null;
          } else {
            // Convert LFO selection to a 1-bit value (this is another error in the FV-1 datasheet!)
            switch (rmpLfo) {
              case 0: rmpLfo = 0; break;
              case 1: rmpLfo = 1; break;
              case 2: rmpLfo = 0; break;  // RMP0 constant
              case 3: rmpLfo = 1; break;  // RMP1 constant
            }
          }

          return (1 >> 7 | rmpLfo << 6 | instruction.opcode) >>> 0; // >>>0 ensures unsigned value
        }

      // Instructions with no operands (aliases for other instructions with zeroed operands)
      case 'CLR':
      case 'NOT':
      case 'ABSA':
      case 'NOP': // No Operation - equivalent to SKP 0,0
        return instruction.opcode;

      default:
        this.problems.push({ message: `Line ${lineNumber}: Unsupported instruction '${mnemonic}'`, isfatal: true, line: lineNumber });
        break;
    }
    return null;
  }

  private parseFixedPointNumber(value: string, format: SignedFixedPointNumber, lineNumber: number,
    mnemonic: string, tryHexIntOfWidth: number = 0): number | null {
    if (tryHexIntOfWidth > 0 && value.startsWith('$')) {
      const parsed = this.parseInteger(value, tryHexIntOfWidth);
      if (parsed !== null) {
        return parsed;
      }
    }
    const encoded = format.encode(value, this.options.clampReals, (msg) => {
      this.problems.push({ message: `Line ${lineNumber}: ${msg} in ${mnemonic} instruction`, isfatal: true, line: lineNumber });
    });
    if (encoded === null) {
      this.problems.push({ message: `Line ${lineNumber}: Invalid fixed-point number '${value}' in ${mnemonic} instruction`, isfatal: true, line: lineNumber });
    }
    return encoded;
  }

  private parseDelayMemoryAddress(value: string, lineNumber?: number, mnemonic?: string): number | null {
    // Try to parse as an unsigned int first
    let addr = this.parseInteger(value);
    if (addr === null) {
      let name = value.toUpperCase();
      let base = -1;
      let offset = 0;
      // If that fails, look for any '+' or '-' offsets specified
      const firstSignMatch = value.match(/[+-](?=\d)/);
      if (firstSignMatch) {
        const idx = firstSignMatch.index!;
        name = value.slice(0, idx).toUpperCase().trim();
        const potentialBase = this.parseInteger(name);
        if (potentialBase !== null) {
          base = potentialBase;
        }

        // Get any plus/minus offset tokens
        const offsetsStr = value.slice(idx);
        const potentialOffset = this.parseInteger(offsetsStr, 0, true);
        if (potentialOffset !== null) {
          offset = potentialOffset;
        }
      }

      if (base === -1) {
        // If we couldn't parse a base, it must be a MEM label
        for (const mem of this.memories) {
          if (mem.name === name || (mem.name + '#') === name || (mem.name + '^') === name) {
            base = mem.start;
            if (name.endsWith('#')) {
              base = FV1Assembler.getEndAddr(mem.start, mem.size, !!this.options.fv1AsmMemBug);
            } else if (name.endsWith('^')) {
              base = FV1Assembler.getMiddleAddr(mem.start, mem.size);
            }
            break;
          }
        }
        if (base === -1 && lineNumber) {
          if (lineNumber !== undefined && mnemonic !== undefined) {
            this.problems.push({ message: `Line ${lineNumber}: Undefined memory label '${name}' in ${mnemonic} instruction`, isfatal: true, line: lineNumber });
          }
          return null;
        }
      }
      addr = base + offset;
    }

    if (addr !== null) {
      if (addr > this.options.delaySize) {
        if (lineNumber !== undefined && mnemonic !== undefined) {
          this.problems.push({ message: `Line ${lineNumber}: Delay memory address out of range in ${mnemonic} instruction`, isfatal: true, line: lineNumber });
        }
        return null;
      }
    }
    return addr;
  }

  private getMemoryAddressString(memName: string, lineNumber?: number, mnemonic?: string): string {
    const name = memName.toUpperCase().trim();
    for (const mem of this.memories) {
      if (name === (mem.name + '#')) {
        return this.options.fv1AsmMemBug ? (mem.end + 1).toString() : mem.end.toString();
      }
      if (name === (mem.name + '^')) {
        return mem.middle.toString();
      }
      if (name === mem.name) {
        return mem.start.toString();
      }
    }
    if (lineNumber !== undefined && mnemonic !== undefined) {
      this.problems.push({ message: `Line ${lineNumber}: Unknown delay memory '${memName}' in ${mnemonic} instruction`, isfatal: true, line: lineNumber });
    }
    return memName;
  }

  private trackRegister(addr: number | null) {
    if (addr !== null && addr >= 32 && addr <= 63) {
      this.usedRegisters.add(addr);
    }
  }

  private getInstruction(mnemonic: string, lineNumber: number, operands: string[]): FV1Instruction | null {
    if (this.instructions.has(mnemonic)) {
      const instruction = this.instructions.get(mnemonic);
      if (instruction.numOperands >= 0 && operands.length !== instruction.numOperands) {
        this.problems.push({ message: `Instruction '${mnemonic}' expects ${instruction.numOperands} operands`, isfatal: true, line: lineNumber });
        return null;
      }
      return instruction;
    } else {
      this.problems.push({ message: `Line ${lineNumber}: Unknown instruction '${mnemonic}'`, isfatal: true, line: lineNumber });
    }
    return null;
  }

  public static formatMachineCode(machineCode: number[]): string {
    return machineCode
      .map((word, index) => {
        const hex = word.toString(16).toUpperCase().padStart(8, '0');
        return `${index.toString().padStart(4, '0')}\t${hex}`;
      })
      .join('\n');
  }

  public static toUint8Array(machineCode: number[]): Uint8Array {
    const buffer = new ArrayBuffer(machineCode.length * 4);
    const view = new DataView(buffer);

    for (let i = 0; i < machineCode.length; i++) {
      view.setUint32(i * 4, machineCode[i], false); // Big-endian
    }

    return new Uint8Array(buffer);
  }
}

// Export for use
export { FV1Assembler, FV1AssemblerOptions, FV1AssemblerResult };
