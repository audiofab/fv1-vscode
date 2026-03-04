import { Token, TokenType } from './FV1Parser.js';

export enum AlgTokenType {
    IDENTIFIER,
    NUMBER,
    OPERATOR,
    ASSIGN,
    LPAREN,
    RPAREN,
    COMMA,
    EOF
}

export interface AlgToken {
    type: AlgTokenType;
    value: string;
    pos: number;
}

export class AlgebraicLexer {
    private pos = 0;

    constructor(private source: string) { }

    private peek(): string {
        return this.source[this.pos] || '';
    }

    private advance(): string {
        return this.source[this.pos++] || '';
    }

    public tokenize(): AlgToken[] {
        const tokens: AlgToken[] = [];

        while (this.pos < this.source.length) {
            const char = this.peek();

            if (/\s/.test(char)) {
                this.advance();
            } else if (char === '(') {
                tokens.push({ type: AlgTokenType.LPAREN, value: this.advance(), pos: this.pos - 1 });
            } else if (char === ')') {
                tokens.push({ type: AlgTokenType.RPAREN, value: this.advance(), pos: this.pos - 1 });
            } else if (char === ',') {
                tokens.push({ type: AlgTokenType.COMMA, value: this.advance(), pos: this.pos - 1 });
            } else if (/[a-zA-Z_@\$]/.test(char)) {
                tokens.push(this.readIdentifier());
            } else if (/[0-9\.\-]/.test(char) && this.isNumberStart(tokens.length > 0 ? tokens[tokens.length - 1] : null)) {
                tokens.push(this.readNumber());
            } else if (/[=+\-*/&|^]/.test(char)) {
                tokens.push(this.readOperatorOrAssign());
            } else {
                throw new Error(`Unexpected character '${char}' at position ${this.pos}`);
            }
        }

        tokens.push({ type: AlgTokenType.EOF, value: '', pos: this.pos });
        return tokens;
    }

    private isNumberStart(prevToken: AlgToken | null): boolean {
        const char = this.peek();
        if (/[0-9\.]/.test(char)) return true;

        // Handle negative numbers like -1.0 vs subtraction
        if (char === '-') {
            const next = this.source[this.pos + 1];
            if (next && /[0-9\.]/.test(next)) {
                // Heuristic: if previous token was an identifier, number, or closing paren, it's subtraction.
                // Otherwise it's unary minus/negative number.
                if (prevToken) {
                    if (prevToken.type === AlgTokenType.IDENTIFIER ||
                        prevToken.type === AlgTokenType.NUMBER ||
                        prevToken.type === AlgTokenType.RPAREN) {
                        return false; // It's subtraction
                    }
                }
                return true; // Unary minus (negative number)
            }
        }
        return false;
    }

    private readIdentifier(): AlgToken {
        let value = '';
        const startPos = this.pos;
        while (/[a-zA-Z0-9_\.\@\$\{\}]/.test(this.peek())) {
            value += this.advance();
        }
        return { type: AlgTokenType.IDENTIFIER, value, pos: startPos };
    }

    private readNumber(): AlgToken {
        let value = '';
        const startPos = this.pos;
        if (this.peek() === '-') value += this.advance();
        while (/[0-9\.]/.test(this.peek())) {
            value += this.advance();
        }
        return { type: AlgTokenType.NUMBER, value, pos: startPos };
    }

    private readOperatorOrAssign(): AlgToken {
        const startPos = this.pos;
        const char = this.advance();
        const next = this.peek();

        if (next === '=') {
            this.advance();
            return { type: AlgTokenType.ASSIGN, value: char + '=', pos: startPos };
        }

        if (char === '=') {
            return { type: AlgTokenType.ASSIGN, value: '=', pos: startPos };
        }

        return { type: AlgTokenType.OPERATOR, value: char, pos: startPos };
    }
}

export type Expr =
    | { type: 'Identifier', name: string }
    | { type: 'Number', value: string }
    | { type: 'Binary', left: Expr, operator: string, right: Expr }
    | { type: 'Call', name: string, args: Expr[] };

export type Statement =
    | { type: 'Assignment', left: Expr, operator: string, right: Expr };

export class AlgebraicParser {
    private pos = 0;

    constructor(private tokens: AlgToken[]) { }

    private peek(): AlgToken {
        return this.tokens[this.pos] || { type: AlgTokenType.EOF, value: '', pos: -1 };
    }

    private advance(): AlgToken {
        return this.tokens[this.pos++];
    }

    private match(type: AlgTokenType): AlgToken | null {
        if (this.peek().type === type) return this.advance();
        return null;
    }

    public parse(): Statement | null {
        if (this.tokens.length === 0 || this.peek().type === AlgTokenType.EOF) return null;

        // Try to parse an assignment statement
        const left = this.parseExpression();
        const assignToken = this.match(AlgTokenType.ASSIGN);

        if (assignToken) {
            const right = this.parseExpression();
            return { type: 'Assignment', left, operator: assignToken.value, right };
        }

        return null; // Not an assignment
    }

    private parseExpression(): Expr {
        return this.parseTerm();
    }

    private parseTerm(): Expr {
        let left = this.parseFactor();

        while (this.peek().type === AlgTokenType.OPERATOR && ['+', '-'].includes(this.peek().value)) {
            const op = this.advance().value;
            const right = this.parseFactor();
            left = { type: 'Binary', left, operator: op, right };
        }

        return left;
    }

    private parseFactor(): Expr {
        let left = this.parsePrimary();

        while (this.peek().type === AlgTokenType.OPERATOR && ['*', '/', '&', '|', '^'].includes(this.peek().value)) {
            const op = this.advance().value;
            const right = this.parsePrimary();
            left = { type: 'Binary', left, operator: op, right };
        }

        return left;
    }

    private parsePrimary(): Expr {
        const token = this.peek();

        if (token.type === AlgTokenType.NUMBER) {
            return { type: 'Number', value: this.advance().value };
        }

        if (token.type === AlgTokenType.IDENTIFIER) {
            const id = this.advance();

            // Check for function call
            if (this.peek().type === AlgTokenType.LPAREN) {
                this.advance();
                const args: Expr[] = [];
                if (this.peek().type !== AlgTokenType.RPAREN) {
                    args.push(this.parseExpression());
                    while (this.match(AlgTokenType.COMMA)) {
                        args.push(this.parseExpression());
                    }
                }
                if (!this.match(AlgTokenType.RPAREN)) throw new Error('Expected )');
                return { type: 'Call', name: id.value, args };
            }

            return { type: 'Identifier', name: id.value };
        }

        if (token.type === AlgTokenType.LPAREN) {
            this.advance();
            const expr = this.parseExpression();
            if (!this.match(AlgTokenType.RPAREN)) throw new Error('Expected )');
            return expr;
        }

        throw new Error(`Unexpected token: ${token.value}`);
    }
}

export class AlgebraicCompiler {
    /**
     * Attempts to compile an algebraic line into an FV-1 assembly instruction.
     * Returns the compiled instruction string, or null if it's not a valid algebraic expression.
     */
    public compileLine(line: string, isMemoryCheck: (id: string) => boolean, onError?: (msg: string) => void): string | null {
        // Only process lines that look vaguely algebraic to save time
        if (!line.includes('=')) return null;

        let tokens: AlgToken[];
        try {
            const lexer = new AlgebraicLexer(line);
            tokens = lexer.tokenize();
        } catch (e: any) {
            // Not complaining on lexer error as it might just be normal assembly that contains equal signs or other weird things
            return null;
        }

        // Let's filter out comments if they managed to sneak in
        const cleanTokens = tokens.filter(t => t.type !== AlgTokenType.EOF);
        if (cleanTokens.length === 0) return null;

        let stmt: Statement | null = null;
        try {
            const parser = new AlgebraicParser(cleanTokens);
            stmt = parser.parse();
        } catch (e: any) {
            // If the left side heavily implied it was an algebraic assignment but failed, bubble error up
            if (line.trim().startsWith('@acc =') || line.trim().startsWith('@acc=')) {
                if (onError) onError(`Syntax error parsing algebraic statement '${line}': ${e.message}`);
            }
            return null;
        }

        if (!stmt) return null;

        const result = this.generateCode(stmt, isMemoryCheck);

        // If we successfully parsed it into an AST statement but generateCode couldn't map it to an FV-1 opcode
        if (result === null && (line.trim().startsWith('@acc =') || line.trim().startsWith('@acc='))) {
            if (onError) onError(`Unsupported algebraic operation in '${line}'. Check variable mapping and operators!`);
        }

        return result;
    }

    private generateCode(stmt: Statement, isMemoryCheck: (id: string) => boolean): string | null {
        const { left, operator, right } = stmt;

        // Ensure left side is an identifier
        if (left.type !== 'Identifier') return null;

        const isAcc = (name: string) => name.toLowerCase() === '@acc' || name.toLowerCase() === 'acc';

        // 1. Accumulator Assignment
        if (isAcc(left.name)) {
            // @acc += src * C
            if (operator === '+=' || operator === '-=') {
                return this.compileAccumulate(right, operator === '-=', isMemoryCheck);
            }

            // @acc *= src
            if (operator === '*=') {
                if (right.type === 'Identifier') return `MULX ${right.name}`;
                return null;
            }

            // @acc &= mask
            if (operator === '&=') {
                if (right.type === 'Identifier' || right.type === 'Number') {
                    const val = right.type === 'Identifier' ? right.name : right.value;
                    return `AND ${val}`;
                }
                return null;
            }
            if (operator === '|=') {
                if (right.type === 'Identifier' || right.type === 'Number') {
                    const val = right.type === 'Identifier' ? right.name : right.value;
                    return `OR ${val}`;
                }
                return null;
            }
            if (operator === '^=') {
                if (right.type === 'Identifier' || right.type === 'Number') {
                    const val = right.type === 'Identifier' ? right.name : right.value;
                    return `XOR ${val}`;
                }
                return null;
            }

            // @acc = ...
            if (operator === '=') {
                // @acc = 0
                if (right.type === 'Number' && parseFloat(right.value) === 0) {
                    return 'CLR';
                }

                // @acc = POT0 (implicit LDAX POT0)
                if (right.type === 'Identifier') {
                    if (isMemoryCheck(right.name)) {
                        return `CLR\nRDA ${right.name}, 1.0`;
                    } else {
                        return `LDAX ${right.name}`;
                    }
                }

                // @acc = abs(@acc) or @acc = lpf(...)
                if (right.type === 'Call') {
                    if (right.name.toLowerCase() === 'abs' && right.args.length === 1) {
                        const arg = right.args[0];
                        if (arg.type === 'Identifier' && isAcc(arg.name)) {
                            return 'ABSA';
                        }
                    } else {
                        // Check if it's a filter operation
                        const filterCode = this.compileFilter(right);
                        if (filterCode) return filterCode;
                    }
                }

                // @acc = -@acc
                if (right.type === 'Binary' && right.operator === '-' && right.left.type === 'Number' && parseFloat(right.left.value) === 0) {
                    // 0 - @acc (effectively -@acc) handled poorly by parser if unary minus didn't catch it. 
                    // Let's rely on SOF for now.
                }

                // @acc = @acc * C + D  (SOF)
                if (right.type === 'Binary') {
                    // Try to match @acc * C + D
                    if (right.operator === '+') {
                        const mulTerm = right.left;
                        const dTerm = right.right;

                        if (mulTerm.type === 'Binary' && mulTerm.operator === '*') {
                            const accTerm = mulTerm.left;
                            const cTerm = mulTerm.right;

                            const valC = this.evaluateConstant(cTerm);
                            const valD = this.evaluateConstant(dTerm);

                            if (accTerm.type === 'Identifier' && isAcc(accTerm.name) && valC !== null && valD !== null) {
                                return `SOF ${valC}, ${valD}`;
                            }
                        }
                    }

                    // Try @acc * C
                    if (right.operator === '*') {
                        const leftTerm = right.left;
                        const rightTerm = right.right;

                        const valRight = this.evaluateConstant(rightTerm);

                        if (leftTerm.type === 'Identifier' && isAcc(leftTerm.name) && valRight !== null) {
                            return `SOF ${valRight}, 0.0`;
                        }
                    }
                }

                // Try @acc = src * C
                if (right.type === 'Binary' && right.operator === '*') {
                    let srcName = '';
                    let coeff = '1.0';
                    if (right.left.type === 'Identifier' && right.right.type === 'Number') {
                        srcName = right.left.name;
                        coeff = right.right.value;
                    } else if (right.right.type === 'Identifier' && right.left.type === 'Number') {
                        srcName = right.right.name;
                        coeff = right.left.value;
                    }

                    if (srcName && !isAcc(srcName)) {
                        if (isMemoryCheck(srcName)) {
                            return `CLR\nRDA ${srcName}, ${coeff}`;
                        } else {
                            return `CLR\nRDAX ${srcName}, ${coeff}`;
                        }
                    }
                }

                // Unary minus -@acc
                // If lexer parses -@acc differently, we might need a unary operator in AST. Currently we dont have one.
            }
        } else {
            // 2. Register/Memory Assignment
            // dest = @acc * C
            if (operator === '=') {
                let coeff = '0.0'; // Default, typically WRAX clears ACC if no coeff
                let isAccSrc = false;

                // Check for filter routing (dest = lpf(state, freq))
                if (right.type === 'Call') {
                    const filterCode = this.compileFilter(right, left.name);
                    if (filterCode) return filterCode;
                }

                if (right.type === 'Identifier' && isAcc(right.name)) {
                    isAccSrc = true;
                    // dest = @acc implies WRAX dest, 0.0 (clears the accumulator after writing)
                    // If you wanted to keep accumulator, you'd do dest = @acc * 1.0
                } else if (right.type === 'Binary' && right.operator === '*') {
                    if (right.left.type === 'Identifier' && isAcc(right.left.name) && right.right.type === 'Number') {
                        isAccSrc = true;
                        coeff = right.right.value;
                    } else if (right.right.type === 'Identifier' && isAcc(right.right.name) && right.left.type === 'Number') {
                        isAccSrc = true;
                        coeff = right.left.value;
                    }
                }

                if (isAccSrc) {
                    if (isMemoryCheck(left.name)) {
                        return `WRA ${left.name}, ${coeff}`;
                    } else {
                        return `WRAX ${left.name}, ${coeff}`;
                    }
                }
            }
        }

        return null;
    }

    private evaluateConstant(expr: Expr): number | null {
        if (expr.type === 'Number') {
            const val = parseFloat(expr.value);
            return isNaN(val) ? null : val;
        }
        if (expr.type === 'Binary') {
            const left = this.evaluateConstant(expr.left);
            const right = this.evaluateConstant(expr.right);
            if (left === null || right === null) return null;
            switch (expr.operator) {
                case '+': return left + right;
                case '-': return left - right;
                case '*': return left * right;
                case '/': return left / right;
            }
        }
        if (expr.type === 'Call') {
            // Support Math functions like round()
            if (expr.name.toLowerCase() === 'round' && expr.args.length === 1) {
                const arg = this.evaluateConstant(expr.args[0]);
                if (arg !== null) return Math.round(arg);
            }
        }
        return null;
    }

    private compileFilter(call: Expr, targetDest?: string): string | null {
        if (call.type !== 'Call') return null;

        const fname = call.name.toLowerCase();
        if (!['lpf', 'hpf', 'lpf_alt', 'lpf_modulated'].includes(fname)) return null;

        if (call.args.length < 2) return null; // All filters need at least (state, freq)

        const stateArg = call.args[0];
        const freqArg = call.args[1];

        if (stateArg.type !== 'Identifier') return null;
        const stateReg = stateArg.name;

        let freqVal = '';
        if (freqArg.type === 'Identifier') freqVal = freqArg.name;
        else if (freqArg.type === 'Number') freqVal = freqArg.value;
        else return null;

        // If targetDest is provided (e.g. dest = lpf()), we route to dest and clear acc (0.0).
        // If targetDest is undefined (e.g. @acc = lpf()), we route to stateReg and keep acc (1.0).
        const scale = call.args.length > 2 && call.args[2].type === 'Number' ? call.args[2].value : (targetDest ? '0.0' : '1.0');

        let writeInstruction = '';
        let targetReg = stateReg; // Default write to the filter's own state memory 

        if (fname === 'lpf') writeInstruction = 'WRAX';
        else if (fname === 'hpf') writeInstruction = 'WRHX';
        else if (fname === 'lpf_alt') writeInstruction = 'WRLX';
        else if (fname === 'lpf_modulated') {
            if (call.args.length < 3 || call.args[2].type !== 'Identifier') return null; // Must have control_reg
            const controlReg = call.args[2].name;
            const wScale = targetDest ? '0.0' : '1.0';
            return `RDFX ${stateReg}, ${freqVal}\nMULX ${controlReg}\nRDAX ${stateReg}, 1.0\nWRAX ${stateReg}, ${wScale}${targetDest ? `\nWRAX ${targetDest}, 0.0` : ''}`;
        }

        let result = `RDFX ${stateReg}, ${freqVal}\n${writeInstruction} ${stateReg}, ${scale}`;

        if (targetDest && targetDest.toLowerCase() !== '@acc' && targetDest.toLowerCase() !== 'acc') {
            // WRAX / WRHX / WRLX does not natively route the output to a *different* register directly,
            // it modifies the filter state register. So the output remains in the accumulator.
            // If the user did `dest = lpf(state)`, the result is in ACC. We must now write it to `dest`.
            result += `\nWRAX ${targetDest}, 0.0`;
        }

        return result;
    }

    private compileAccumulate(expr: Expr, negate: boolean, isMemoryCheck: (id: string) => boolean): string | null {
        let srcName = '';
        let coeff = '1.0';

        if (expr.type === 'Number') {
            let offsetToken = expr.value;
            if (negate) {
                offsetToken = offsetToken.startsWith('-') ? offsetToken.substring(1) : '-' + offsetToken;
            }
            return `SOF 1.0, ${offsetToken}`;
        } else if (expr.type === 'Identifier') {
            srcName = expr.name;
        } else if (expr.type === 'Binary' && expr.operator === '*') {
            // src * C
            if (expr.left.type === 'Identifier' && expr.right.type === 'Number') {
                srcName = expr.left.name;
                coeff = expr.right.value;
            } else if (expr.right.type === 'Identifier' && expr.left.type === 'Number') {
                srcName = expr.right.name;
                coeff = expr.left.value;
            } else {
                return null;
            }
        } else {
            return null;
        }

        if (negate) {
            coeff = coeff.startsWith('-') ? coeff.substring(1) : '-' + coeff;
        }

        if (isMemoryCheck(srcName)) {
            return `RDA ${srcName}, ${coeff}`;
        } else {
            return `RDAX ${srcName}, ${coeff}`;
        }
    }
}
