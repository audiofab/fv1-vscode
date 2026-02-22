export class ParserError extends Error {
    constructor(message: string, public line: number, public column: number) {
        super(message);
        this.name = 'ParserError';
    }
}

export enum TokenType {
    IDENTIFIER,
    NUMBER,
    MNEMONIC,
    DIRECTIVE,
    OPERATOR,
    COMMA,
    COLON,
    NEWLINE,
    EOF,
    LPAREN,
    RPAREN
}

export interface Token {
    type: TokenType;
    value: string;
    line: number;
    column: number;
}

export class Lexer {
    private pos = 0;
    private line = 1;
    private column = 1;

    constructor(private source: string) { }

    private peek(): string {
        return this.source[this.pos] || '';
    }

    private advance(): string {
        const char = this.peek();
        this.pos++;
        if (char === '\n') {
            this.line++;
            this.column = 1;
        } else {
            this.column++;
        }
        return char;
    }

    public tokenize(): Token[] {
        const tokens: Token[] = [];
        while (this.pos < this.source.length) {
            const char = this.peek();

            if (/\s/.test(char) && char !== '\n') {
                this.advance();
            } else if (char === ';') {
                // Skip comments
                while (this.peek() !== '\n' && this.pos < this.source.length) {
                    this.advance();
                }
            } else if (char === '\n') {
                tokens.push({ type: TokenType.NEWLINE, value: '\n', line: this.line, column: this.column });
                this.advance();
            } else if (char === ',') {
                tokens.push({ type: TokenType.COMMA, value: ',', line: this.line, column: this.column });
                this.advance();
            } else if (char === ':') {
                tokens.push({ type: TokenType.COLON, value: ':', line: this.line, column: this.column });
                this.advance();
            } else if (char === '(') {
                tokens.push({ type: TokenType.LPAREN, value: '(', line: this.line, column: this.column });
                this.advance();
            } else if (char === ')') {
                tokens.push({ type: TokenType.RPAREN, value: ')', line: this.line, column: this.column });
                this.advance();
            } else if (/[a-zA-Z_]/.test(char)) {
                tokens.push(this.readIdentifier());
            } else if (/[0-9.]/.test(char) || char === '$' || char === '%') {
                tokens.push(this.readNumber());
            } else if (/[-+*/|&<>^!]/.test(char)) {
                tokens.push({ type: TokenType.OPERATOR, value: this.advance(), line: this.line, column: this.column });
            } else {
                // Unknown character
                this.advance();
            }
        }
        tokens.push({ type: TokenType.EOF, value: '', line: this.line, column: this.column });
        return tokens;
    }

    private readIdentifier(): Token {
        let value = '';
        const startLine = this.line;
        const startCol = this.column;

        while (/[a-zA-Z0-9_#^.]/.test(this.peek())) {
            value += this.advance();
        }

        const upper = value.toUpperCase();
        if (['EQU', 'MEM'].includes(upper)) {
            return { type: TokenType.DIRECTIVE, value: upper, line: startLine, column: startCol };
        }

        // Mnemonics are checked during parsing or here. Let's keep them as identifiers for now 
        // and resolve them in the parser.
        return { type: TokenType.IDENTIFIER, value: upper, line: startLine, column: startCol };
    }

    private readNumber(): Token {
        let value = '';
        const startLine = this.line;
        const startCol = this.column;

        if (this.peek() === '$') {
            value += this.advance();
            while (/[0-9a-fA-F]/.test(this.peek())) value += this.advance();
        } else if (this.peek() === '%') {
            value += this.advance();
            while (/[01_]/.test(this.peek())) value += this.advance();
        } else if (this.peek() === '0' && (this.source[this.pos + 1] || '').toLowerCase() === 'x') {
            value += this.advance(); // 0
            value += this.advance(); // x
            while (/[0-9a-fA-F]/.test(this.peek())) value += this.advance();
        } else {
            while (/[0-9\.]/.test(this.peek())) value += this.advance();
        }

        return { type: TokenType.NUMBER, value, line: startLine, column: startCol };
    }
}

export type ASTNode =
    | { type: 'Instruction', mnemonic: string, operands: Expression[], line: number }
    | { type: 'Directive', name: string, identifier: string, expression: Expression, line: number }
    | { type: 'Label', name: string, line: number };

export type Expression =
    | { type: 'Number', value: number }
    | { type: 'Identifier', name: string }
    | { type: 'Binary', left: Expression, operator: string, right: Expression }
    | { type: 'Unary', operator: string, expression: Expression };

export class Parser {
    private tokens: Token[];
    private pos = 0;

    constructor(tokens: Token[]) {
        this.tokens = tokens.filter((t, i) => t.type !== TokenType.NEWLINE || this.isNextSignificant(tokens, i));
    }

    private isNextSignificant(tokens: Token[], index: number): boolean {
        // Only keep newlines if they are followed by something that isn't a newline or EOF
        for (let i = index + 1; i < tokens.length; i++) {
            if (tokens[i].type !== TokenType.NEWLINE) {
                return tokens[i].type !== TokenType.EOF;
            }
        }
        return false;
    }

    private peek(): Token {
        return this.tokens[this.pos] || { type: TokenType.EOF, value: '', line: -1, column: -1 };
    }

    private advance(): Token {
        return this.tokens[this.pos++];
    }

    private match(type: TokenType): Token | null {
        if (this.peek().type === type) return this.advance();
        return null;
    }

    public parse(): ASTNode[] {
        const nodes: ASTNode[] = [];
        while (this.peek().type !== TokenType.EOF) {
            const node = this.parseStatement();
            if (node) nodes.push(node);

            // Consume optional newline
            while (this.match(TokenType.NEWLINE));
        }
        return nodes;
    }

    private parseStatement(): ASTNode | null {
        const token = this.peek();

        if (token.type === TokenType.IDENTIFIER) {
            const next = this.tokens[this.pos + 1];

            // Label: IDENTIFIER:
            if (next && next.type === TokenType.COLON) {
                const label = this.advance();
                this.advance(); // consume :
                return { type: 'Label', name: label.value, line: label.line };
            }

            // Directive: IDENTIFIER EQU EXPR or EQU IDENTIFIER EXPR
            if (next && next.type === TokenType.DIRECTIVE) {
                const id = this.advance();
                const dir = this.advance();
                const expr = this.parseExpression();
                return { type: 'Directive', name: dir.value, identifier: id.value, expression: expr, line: dir.line };
            }
        }

        if (token.type === TokenType.DIRECTIVE) {
            const dir = this.advance();
            const id = this.match(TokenType.IDENTIFIER);
            if (!id) throw new ParserError(`Expected identifier after ${dir.value}`, dir.line, dir.column);
            const expr = this.parseExpression();
            return { type: 'Directive', name: dir.value, identifier: id.value, expression: expr, line: dir.line };
        }

        if (token.type === TokenType.IDENTIFIER) {
            const mnemonic = this.advance();
            const operands: Expression[] = [];

            if (this.peek().type !== TokenType.NEWLINE && this.peek().type !== TokenType.EOF) {
                operands.push(this.parseExpression());
                while (this.match(TokenType.COMMA)) {
                    operands.push(this.parseExpression());
                }
            }
            return { type: 'Instruction', mnemonic: mnemonic.value, operands, line: mnemonic.line };
        }

        this.advance(); // Skip unknown
        return null;
    }

    private parseExpression(): Expression {
        return this.parseBitwise();
    }

    private parseBitwise(): Expression {
        let left = this.parseShift();
        while (this.peek().type === TokenType.OPERATOR && (['|', '&', '^'].includes(this.peek().value))) {
            const operator = this.advance().value;
            const right = this.parseShift();
            left = { type: 'Binary', left, operator, right };
        }
        return left;
    }

    private parseShift(): Expression {
        let left = this.parseAdditive();
        while (this.peek().type === TokenType.OPERATOR && (['<', '>'].includes(this.peek().value))) {
            const operator = this.advance().value;
            const right = this.parseAdditive();
            left = { type: 'Binary', left, operator, right };
        }
        return left;
    }

    private parseAdditive(): Expression {
        let left = this.parseMultiplicative();
        while (this.peek().type === TokenType.OPERATOR && (this.peek().value === '+' || this.peek().value === '-')) {
            const operator = this.advance().value;
            const right = this.parseMultiplicative();
            left = { type: 'Binary', left, operator, right };
        }
        return left;
    }

    private parseMultiplicative(): Expression {
        let left = this.parsePrimary();
        while (this.peek().type === TokenType.OPERATOR && (this.peek().value === '*' || this.peek().value === '/')) {
            const operator = this.advance().value;
            const right = this.parsePrimary();
            left = { type: 'Binary', left, operator, right };
        }
        return left;
    }

    private parsePrimary(): Expression {
        const token = this.peek();

        if (token.type === TokenType.NUMBER) {
            return { type: 'Number', value: this.parseNumberValue(this.advance().value) };
        }

        if (token.type === TokenType.IDENTIFIER) {
            return { type: 'Identifier', name: this.advance().value };
        }

        if (token.type === TokenType.LPAREN) {
            this.advance();
            const expr = this.parseExpression();
            if (!this.match(TokenType.RPAREN)) throw new ParserError(`Expected )`, token.line, token.column);
            return expr;
        }

        if (token.type === TokenType.OPERATOR && (token.value === '-' || token.value === '+')) {
            const operator = this.advance().value;
            return { type: 'Unary', operator, expression: this.parsePrimary() };
        }

        throw new ParserError(`Unexpected token ${token.value}`, token.line, token.column);
    }

    private parseNumberValue(val: string): number {
        const upper = val.toUpperCase();
        if (upper.startsWith('$')) return parseInt(val.slice(1), 16);
        if (upper.startsWith('0X')) return parseInt(val, 16);
        if (upper.startsWith('%')) return parseInt(val.slice(1).replace(/_/g, ''), 2);
        return parseFloat(val);
    }
}
