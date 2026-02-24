import { Lexer, Parser, ASTNode, Expression, ParserError } from './FV1Parser.js';
import { INSTRUCTION_SET, Encoder } from './FV1Encoder.js';

export interface FV1AssemblerOptions {
  fv1AsmMemBug?: boolean;
  clampReals?: boolean;
  regCount?: number;
  progSize?: number;
  delaySize?: number;
}

export interface FV1AssemblerProblem {
  message: string;
  isfatal: boolean;
  line: number;
}

export interface FV1Memory {
  size: number;
  start?: number;
  middle?: number;
  end?: number;
  name: string;
  line: number;
  original: string;
}

export interface FV1Symbol {
  name: string;
  value: string;
  line?: number;
  original?: string;
}

export interface FV1AssemblerResult {
  machineCode: number[];
  problems: FV1AssemblerProblem[];
  labels: Map<string, { line: number, instructionLine: number }>;
  symbols: FV1Symbol[];
  memories: FV1Memory[];
  addressToLineMap: Map<number, number>;
  usedRegistersCount: number;
}

export class FV1Assembler {
  private options: Required<FV1AssemblerOptions>;
  private problems: FV1AssemblerProblem[] = [];
  private symbols = new Map<string, number>();
  private memories: FV1Memory[] = [];
  private labels = new Map<string, { line: number, instructionLine: number }>();
  private addressToLineMap = new Map<number, number>();
  private usedRegisters = new Set<number>();
  private userSymbols = new Set<string>();
  private symbolLines = new Map<string, number>();

  private PREDEFINED_SYMBOLS: Record<string, number> = {
    'SIN0_RATE': 0x00, 'SIN0_RANGE': 0x01, 'SIN1_RATE': 0x02, 'SIN1_RANGE': 0x03,
    'RMP0_RATE': 0x04, 'RMP0_RANGE': 0x05, 'RMP1_RATE': 0x06, 'RMP1_RANGE': 0x07,
    'POT0': 0x10, 'POT1': 0x11, 'POT2': 0x12, 'ADCL': 0x14, 'ADCR': 0x15,
    'DACL': 0x16, 'DACR': 0x17, 'ADDR_PTR': 0x18,
    'SIN0': 0x00, 'SIN1': 0x01, 'RMP0': 0x02, 'RMP1': 0x03,
    'COS0': 0x08, 'COS1': 0x09,
    'RDA': 0x00, 'SOF': 0x02, 'RDAL': 0x03,
    'SIN': 0x00, 'COS': 0x01, 'REG': 0x02, 'COMPC': 0x04,
    'COMPA': 0x08, 'RPTR2': 0x10, 'NA': 0x20,
    'RUN': 0x10, 'ZRC': 0x08, 'ZRO': 0x04,
    'GEZ': 0x02, 'NEG': 0x01
  };

  constructor(options: FV1AssemblerOptions = {}) {
    this.options = {
      fv1AsmMemBug: options.fv1AsmMemBug ?? true,
      clampReals: options.clampReals ?? true,
      regCount: options.regCount ?? 32,
      progSize: options.progSize ?? 128,
      delaySize: options.delaySize ?? 32768
    };
    this.reset();
  }

  private reset() {
    this.problems = [];
    this.symbols.clear();
    this.memories = [];
    this.labels.clear();
    this.addressToLineMap.clear();
    this.usedRegisters.clear();
    this.userSymbols.clear();
    this.symbolLines.clear(); // Added this line
    this.initSymbols();       // Added this line
  }

  private initSymbols() {
    // Load predefined symbols
    for (const [key, val] of Object.entries(this.PREDEFINED_SYMBOLS)) {
      this.symbols.set(key, val);
    }
    // Load REG0-31
    for (let i = 0; i < this.options.regCount; i++) {
      this.symbols.set(`REG${i}`, 0x20 + i);
    }
  }

  public assemble(source: string): FV1AssemblerResult {
    this.reset();

    try {
      const lexer = new Lexer(source);
      const tokens = lexer.tokenize();
      const parser = new Parser(tokens);
      const ast = parser.parse();

      this.pass1_ResolveDirectives(ast);
      this.pass2_ResolveLabels(ast);
      const machineCode = this.pass3_GenerateCode(ast);

      return {
        machineCode,
        problems: this.problems,
        labels: this.labels,
        symbols: Array.from(this.symbols.entries())
          .filter(([name]) => this.userSymbols.has(name))
          .map(([name, value]) => ({ name, value: value.toString(), line: this.symbolLines.get(name) })),
        memories: this.memories,
        addressToLineMap: this.addressToLineMap,
        usedRegistersCount: this.usedRegisters.size
      };
    } catch (e) {
      const line = (e instanceof ParserError) ? e.line : 1;
      this.problems.push({ message: `Parser error: ${e instanceof Error ? e.message : String(e)}`, isfatal: true, line });
      return {
        machineCode: [],
        problems: this.problems,
        labels: new Map(),
        symbols: [],
        memories: [],
        addressToLineMap: new Map(),
        usedRegistersCount: 0
      };
    }
  }

  private pass1_ResolveDirectives(ast: ASTNode[]) {
    let nextDelayAddr = 0;
    for (const node of ast) {
      if (node.type === 'Directive') {
        if (node.name === 'EQU') {
          const value = this.evaluateExpression(node.expression, node.line);
          this.symbols.set(node.identifier, value);
          this.userSymbols.add(node.identifier);
          this.symbolLines.set(node.identifier, node.line);
        } else if (node.name === 'MEM') {
          const size = this.evaluateExpression(node.expression, node.line);
          const start = nextDelayAddr;
          const middle = start + (size % 2 ? (size - 1) / 2 - 1 : size / 2);
          const end = start + size - 1;
          const buggyEnd = end + (this.options.fv1AsmMemBug ? 1 : 0);

          const mem: FV1Memory = { name: node.identifier, size, start, middle, end, line: node.line, original: '' };
          this.memories.push(mem);

          // Register special suffixes
          this.symbols.set(node.identifier, start);
          this.symbols.set(node.identifier + '^', middle);
          this.symbols.set(node.identifier + '#', buggyEnd);

          nextDelayAddr = buggyEnd + 1;
        }
      }
    }
  }

  private pass2_ResolveLabels(ast: ASTNode[]) {
    let pc = 0;
    for (const node of ast) {
      if (node.type === 'Label') {
        this.labels.set(node.name, { line: node.line, instructionLine: pc });
      } else if (node.type === 'Instruction') {
        pc++;
      }
    }
  }

  private pass3_GenerateCode(ast: ASTNode[]): number[] {
    const code: number[] = [];
    let pc = 0;
    for (const node of ast) {
      if (node.type === 'Instruction') {
        const schema = INSTRUCTION_SET[node.mnemonic];
        if (!schema) {
          this.problems.push({ message: `Unknown instruction ${node.mnemonic}`, isfatal: true, line: node.line });
          code.push(0);
          continue;
        }

        let operands = node.operands.map(op => {
          // Special case for labels in JMP/SKP
          if (op.type === 'Identifier' && this.labels.has(op.name)) {
            return this.labels.get(op.name)!.instructionLine - pc - 1;
          }
          return this.evaluateExpression(op, node.line);
        });

        // --- Specialized Encoding Logic ---

        if (node.mnemonic === 'CHO') {
          const mode = operands[0];
          const n = operands[1];
          const rdaMode = this.symbols.get('RDA');
          const sofMode = this.symbols.get('SOF');
          const rdalMode = this.symbols.get('RDAL');

          if (mode === rdalMode) {
            // CHO RDAL, N -> [mode, flags=0x02(fixed bit 25), n, param=0]
            operands = [mode, 0x02, n, 0];
          } else if (mode === rdaMode || mode === sofMode) {
            const flags = operands[2];
            const param = operands[3];
            operands = [mode, flags, n, param];
          }
        } else if (node.mnemonic === 'WLDR') {
          // Match previous backwards-encoded amplitude
          let ampl = operands[2];
          switch (ampl) {
            case 512: ampl = 3; break;
            case 1024: ampl = 2; break;
            case 2048: ampl = 1; break;
            case 4096: ampl = 0; break;
            default:
              this.problems.push({ message: `Invalid amplitude ${ampl} for WLDR`, isfatal: true, line: node.line });
          }
          // Handle RMP LFO mapping
          let rmpLfo = operands[0];
          if ([0, 2].includes(rmpLfo)) rmpLfo = 0;
          else if ([1, 3].includes(rmpLfo)) rmpLfo = 1;

          operands = [rmpLfo, operands[1], ampl];
        } else if (node.mnemonic === 'JAM') {
          let rmpLfo = operands[0];
          if ([0, 2].includes(rmpLfo)) rmpLfo = 0;
          else if ([1, 3].includes(rmpLfo)) rmpLfo = 1;
          operands = [rmpLfo];
        }

        // Track register usage
        schema.fields.forEach((field, i) => {
          if (field.type === 'REG' && operands[i] !== undefined) {
            this.trackRegister(operands[i], node.line);
          }
        });

        code.push(Encoder.assembleInstruction(node.mnemonic, operands, schema));
        this.addressToLineMap.set(pc, node.line);
        pc++;
      }
    }

    // Pad to progSize
    while (code.length < this.options.progSize) code.push(0x00000011); // NOP
    return code;
  }

  private trackRegister(addr: number, line: number) {
    if (addr >= 0x20 && addr <= 0x3F) {
      const regNum = addr - 0x20;
      if (regNum >= this.options.regCount) {
        this.problems.push({ message: `Register REG${regNum} exceeds limit ${this.options.regCount}`, isfatal: true, line });
      }
      this.usedRegisters.add(regNum);
    }
  }

  private evaluateExpression(expr: Expression, line: number): number {
    switch (expr.type) {
      case 'Number': return expr.value;
      case 'Identifier':
        if (this.symbols.has(expr.name)) return this.symbols.get(expr.name)!;
        this.problems.push({ message: `Undefined symbol ${expr.name}`, isfatal: true, line });
        return 0;
      case 'Binary':
        const left = this.evaluateExpression(expr.left, line);
        const right = this.evaluateExpression(expr.right, line);
        switch (expr.operator) {
          case '+': return left + right;
          case '-': return left - right;
          case '*': return left * right;
          case '/': return left / right;
          case '|': return left | right;
          case '&': return left & right;
          case '^': return left ^ right;
          case '<': return (left << right) >>> 0;
          case '>': return (left >>> right);
          default: return 0;
        }
      case 'Unary':
        const val = this.evaluateExpression(expr.expression, line);
        if (expr.operator === '-') return -val;
        if (expr.operator === '!') return (~Math.floor(val)) >>> 0;
        return val;
    }
  }

  public static formatMachineCode(machineCode: number[]): string {
    return machineCode.map((word, index) => `${index.toString().padStart(4, '0')}\t${word.toString(16).toUpperCase().padStart(8, '0')}`).join('\n');
  }

  public static toUint8Array(machineCode: number[]): Uint8Array {
    const buffer = new ArrayBuffer(machineCode.length * 4);
    const view = new DataView(buffer);
    machineCode.forEach((val, i) => view.setUint32(i * 4, val, false));
    return new Uint8Array(buffer);
  }

  public static getMiddleAddr(start: number, size: number): number {
    return start + (size % 2 ? (size - 1) / 2 - 1 : size / 2);
  }

  public static getEndAddr(start: number, size: number, fv1AsmMemBug: boolean): number {
    return start + size - 1 + (fv1AsmMemBug ? 1 : 0);
  }
}
