// Rewrites infix expressions into the equivalent prefix helper calls, before the text reaches
// Handlebars. They're accepted in:
//   conditions:  {{#if score > 100 and has_key}}  ->  {{#if (and (gt score 100) has_key)}}
//                (also {{#unless}}, {{else if}} and {{else unless}})
//   values:      {{set "gold" gold + price * 2}}  ->  {{set "gold" (add gold (mul price 2))}}
//                (also {{inc}} and {{dec}})
//   display:     {{= price * 2}}                  ->  {{mul price 2}}
//
// Precedence, from tightest to loosest: unary minus, * / %, + -, comparisons, not/!, and/&&,
// or/||. So "not" applies to a whole comparison, as it reads in English: not gender = "male"
// means not (gender = "male").
// Expressions that don't use any infix operator are passed through unchanged (except {{= }},
// which isn't valid Handlebars, so it's always rewritten).
//
// "-" and "/" can appear inside Handlebars names and paths (my-score, ../score), so they're only
// operators at the start of a token: a - b and a -b subtract, but a-b is the attribute "a-b".

type TokenType = "op" | "(" | ")" | "value" | "ident";

interface Token {
    type: TokenType;
    text: string;
}

type Node =
    | { kind: "raw", text: string }
    | { kind: "call", name: string, args: Node[] };

const comparisonHelpers: Record<string, string> = {
    "=": "eq",
    "==": "eq",
    "!=": "ne",
    ">": "gt",
    "<": "lt",
    ">=": "gte",
    "<=": "lte",
};

const arithmeticHelpers: Record<string, string> = {
    "+": "add",
    "-": "sub",
    "*": "mul",
    "/": "div",
    "%": "mod",
};

const symbolicOps = ["==", "!=", ">=", "<=", "&&", "||", "=", ">", "<", "!", "+", "*", "%", "-", "/"];
const keywordOps = ["and", "or", "not"];
const literals = ["true", "false", "null", "undefined"];

// Characters that end an identifier/path. "[" starts a Handlebars literal segment,
// e.g. [my attribute], which may contain any of these.
// "-" and "/" aren't here: see above.
const identTerminators = new Set([..." \t\r\n!\"'()<>=&|{}~+*%"]);

const numberPattern = /^-?\d+(\.\d+)?$/;

class ExpressionError extends Error {}

function tokenize(expr: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    while (i < expr.length) {
        const c = expr[i];
        if (/\s/.test(c)) {
            i++;
            continue;
        }
        if (c === "(" || c === ")") {
            tokens.push({ type: c, text: c });
            i++;
            continue;
        }
        if (c === "\"" || c === "'") {
            let j = i + 1;
            while (j < expr.length && expr[j] !== c) {
                if (expr[j] === "\\") j++;
                j++;
            }
            if (j >= expr.length) {
                throw new ExpressionError("unterminated string");
            }
            tokens.push({ type: "value", text: expr.slice(i, j + 1) });
            i = j + 1;
            continue;
        }
        // A "-" before a digit starts a negative number, as before (the parser treats
        // a -1 as a - 1 where it needs an operator)
        const op = symbolicOps.find(o => expr.startsWith(o, i) && !(o === "-" && /\d/.test(expr[i + 1] ?? "")));
        if (op) {
            tokens.push({ type: "op", text: op });
            i += op.length;
            continue;
        }
        let j = i;
        while (j < expr.length && !identTerminators.has(expr[j])) {
            if (expr[j] === "[") {
                const close = expr.indexOf("]", j);
                if (close === -1) {
                    throw new ExpressionError("missing ']'");
                }
                j = close;
            }
            j++;
        }
        if (j === i) {
            throw new ExpressionError(`unexpected '${c}'`);
        }
        const word = expr.slice(i, j);
        if (keywordOps.includes(word)) {
            tokens.push({ type: "op", text: word });
        } else if (literals.includes(word) || numberPattern.test(word)) {
            tokens.push({ type: "value", text: word });
        } else {
            tokens.push({ type: "ident", text: word });
        }
        i = j;
    }
    return tokens;
}

class Parser {
    private pos = 0;
    usedInfix = false;

    constructor(private tokens: Token[]) {}

    private peek(offset = 0): Token | undefined {
        return this.tokens[this.pos + offset];
    }

    private next(): Token {
        return this.tokens[this.pos++];
    }

    private isOp(token: Token | undefined, ...ops: string[]) {
        return token?.type === "op" && ops.includes(token.text);
    }

    private startsPrimary(token: Token | undefined) {
        return token?.type === "ident" || token?.type === "value" || token?.type === "(";
    }

    private describe(token: Token | undefined) {
        return token ? `'${token.text}'` : "end of expression";
    }

    // A value: an expression with nothing after it
    parseExpression(): Node {
        const result = this.parseOr();
        if (this.peek()) {
            throw new ExpressionError(`unexpected ${this.describe(this.peek())}`);
        }
        return result;
    }

    // Arguments to a helper: `count` plain values (e.g. the attribute name), then an expression
    parseArguments(count: number): Node[] {
        const result: Node[] = [];
        for (let i = 0; i < count; i++) {
            result.push(this.parsePrimary());
        }
        if (!this.peek()) {
            throw new ExpressionError("expected a value");
        }
        result.push(this.parseExpression());
        return result;
    }

    // Top level: an expression, optionally followed by hash arguments (e.g. includeZero=true)
    parseCondition(): Node[] {
        const result = [this.parseOr()];
        while (this.peek()?.type === "ident" && this.isOp(this.peek(1), "=")) {
            result.push(this.parseHashPair());
        }
        if (this.peek()) {
            throw new ExpressionError(`unexpected ${this.describe(this.peek())}`);
        }
        return result;
    }

    private parseHashPair(): Node {
        const key = this.next().text;
        this.next(); // "="
        return { kind: "raw", text: `${key}=${emit(this.parsePrimary())}` };
    }

    private parseOr(): Node {
        return this.parseChain(["or", "||"], "or", () => this.parseAnd());
    }

    private parseAnd(): Node {
        return this.parseChain(["and", "&&"], "and", () => this.parseNot());
    }

    private parseChain(ops: string[], helper: string, parseOperand: () => Node): Node {
        const operands = [parseOperand()];
        while (this.isOp(this.peek(), ...ops)) {
            const op = this.next().text;
            if (!this.peek()) {
                throw new ExpressionError(`expected a value after '${op}'`);
            }
            operands.push(parseOperand());
        }
        if (operands.length === 1) return operands[0];
        this.usedInfix = true;
        return { kind: "call", name: helper, args: operands };
    }

    private parseNot(): Node {
        if (this.isOp(this.peek(), "not", "!")) {
            const op = this.next().text;
            if (!this.peek()) {
                throw new ExpressionError(`expected a value after '${op}'`);
            }
            this.usedInfix = true;
            return { kind: "call", name: "not", args: [this.parseNot()] };
        }
        return this.parseComparison();
    }

    private parseComparison(): Node {
        const left = this.parseAdditive();
        const opToken = this.peek();
        if (opToken?.type !== "op" || !(opToken.text in comparisonHelpers)) {
            return left;
        }
        this.next();
        if (!this.peek()) {
            throw new ExpressionError(`expected a value after '${opToken.text}'`);
        }
        const right = this.parseAdditive();
        const following = this.peek();
        if (following?.type === "op" && following.text in comparisonHelpers) {
            throw new ExpressionError(`comparisons can't be chained (at '${following.text}'), use "and" to combine them`);
        }
        this.usedInfix = true;
        return { kind: "call", name: comparisonHelpers[opToken.text], args: [left, right] };
    }

    private parseAdditive(): Node {
        return this.parseArithmetic(["+", "-"], () => this.parseMultiplicative());
    }

    private parseMultiplicative(): Node {
        return this.parseArithmetic(["*", "/", "%"], () => this.parseUnary());
    }

    // Left-associative, so a - b - c is (a - b) - c
    private parseArithmetic(ops: string[], parseOperand: () => Node): Node {
        let left = parseOperand();
        for (;;) {
            let op: string;
            const token = this.peek();
            if (this.isOp(token, ...ops)) {
                op = this.next().text;
                if (!this.peek()) {
                    throw new ExpressionError(`expected a value after '${op}'`);
                }
            } else if (ops.includes("-") && token?.type === "value" && token.text.startsWith("-") && numberPattern.test(token.text)) {
                // a -1 means a - 1. Split the negative number into the operator and the number.
                op = "-";
                this.tokens[this.pos] = { type: "value", text: token.text.slice(1) };
            } else {
                return left;
            }
            this.usedInfix = true;
            left = { kind: "call", name: arithmeticHelpers[op], args: [left, parseOperand()] };
        }
    }

    private parseUnary(): Node {
        if (this.isOp(this.peek(), "-")) {
            this.next();
            if (!this.peek()) {
                throw new ExpressionError("expected a value after '-'");
            }
            this.usedInfix = true;
            return { kind: "call", name: "sub", args: [{ kind: "raw", text: "0" }, this.parseUnary()] };
        }
        return this.parsePrimary();
    }

    private parsePrimary(): Node {
        const token = this.peek();
        if (token?.type === "ident" || token?.type === "value") {
            this.next();
            return { kind: "raw", text: token.text };
        }
        if (token?.type === "(") {
            this.next();
            const node = this.isHelperCall() ? this.parseHelperCall() : this.parseOr();
            if (this.peek()?.type !== ")") {
                throw new ExpressionError(`expected ')' but found ${this.describe(this.peek())}`);
            }
            this.next();
            return node;
        }
        if (this.isOp(token, "not", "!")) {
            const example = token?.text === "!" ? "!value" : "not value";
            throw new ExpressionError(`'${token?.text}' must be inside parentheses here, e.g. (${example})`);
        }
        if (token?.type === "op") {
            throw new ExpressionError(`expected a value before '${token.text}'`);
        }
        throw new ExpressionError(token ? `unexpected ${this.describe(token)}` : "expected a value");
    }

    // Inside parentheses, decide between an existing prefix helper call like (seen "intro")
    // or (and a b), and an infix group like (score > 100).
    private isHelperCall() {
        const first = this.peek();
        const second = this.peek(1);
        if (this.isOp(first, "and", "or")) return true;
        return first?.type === "ident" && this.startsPrimary(second);
    }

    private parseHelperCall(): Node {
        const name = this.next().text;
        const args: Node[] = [];
        while (this.peek() && this.peek()?.type !== ")") {
            if (this.peek()?.type === "ident" && this.isOp(this.peek(1), "=")) {
                args.push(this.parseHashPair());
            } else {
                args.push(this.parsePrimary());
            }
        }
        return { kind: "call", name, args };
    }
}

function emit(node: Node): string {
    if (node.kind === "raw") return node.text;
    return `(${node.name} ${node.args.map(emit).join(" ")})`;
}

type Mode = "condition" | "arguments" | "display";

// Parses `text` and returns the rewritten nodes, or null if it should be left alone: it
// doesn't use infix syntax, or it can't be parsed and has no operators (which leaves malformed
// prefix syntax for Handlebars to report).
function rewrite(text: string, mode: Mode, label: string): Node[] | null {
    // Errors are thrown after the try/catch blocks, as new errors with the expression in the message
    let error: ExpressionError | null = null;
    let tokens: Token[] = [];
    try {
        tokens = tokenize(text);
    } catch (e) {
        // Leave anything we can't tokenize for Handlebars to report, except {{= }}
        if (mode !== "display" || !(e instanceof ExpressionError)) return null;
        error = e;
    }
    const hasOperators = tokens.some(t => t.type === "op");
    const parser = new Parser(tokens);
    let nodes: Node[] = [];
    if (!error) {
        try {
            nodes = mode === "condition" ? parser.parseCondition()
                : mode === "arguments" ? parser.parseArguments(1)
                : [parser.parseExpression()];
        } catch (e) {
            if (!(e instanceof ExpressionError) || (!hasOperators && mode !== "display")) return null;
            error = e;
        }
    }
    if (error) {
        throw new Error(`Invalid ${label} "${text.trim()}": ${error.message}`);
    }
    if (!parser.usedInfix && mode !== "display") return null;
    return nodes;
}

// Rewrites a single condition. Returns null if it doesn't use infix syntax.
export function rewriteInfixCondition(condition: string): string | null {
    const nodes = rewrite(condition, "condition", "condition");
    return nodes && nodes.map(emit).join(" ");
}

// Rewrites the arguments to {{set}}, {{inc}} or {{dec}}: an attribute name, then an expression.
// Returns null if the expression doesn't use infix syntax.
export function rewriteInfixArguments(args: string): string | null {
    const nodes = rewrite(args, "arguments", "expression");
    return nodes && nodes.map(emit).join(" ");
}

// Rewrites the expression in {{= expression}} into the contents of a mustache tag, i.e. a
// helper call without the outer parentheses, or an attribute name.
export function rewriteDisplayExpression(expression: string): string {
    const node = rewrite(expression, "display", "expression")![0];
    if (node.kind === "call") {
        return `${node.name} ${node.args.map(emit).join(" ")}`;
    }
    if (literals.includes(node.text) || numberPattern.test(node.text) || /^["']/.test(node.text)) {
        throw new Error(`Invalid expression "${expression.trim()}": expected an attribute or a calculation`);
    }
    return node.text;
}

const tagStart = /(\\*)\{\{(~?\s*)(?:(#if|#unless|else\s+if|else\s+unless)(?=[\s(!])|(set|inc|dec)(?=\s)|(=))/g;

// Finds the end of a mustache tag starting at `from`, skipping over quoted strings.
// Returns the index of the closing "}}" (or "~}}"), or -1.
function findTagEnd(text: string, from: number): number {
    let quote: string | null = null;
    for (let i = from; i < text.length; i++) {
        const c = text[i];
        if (quote) {
            if (c === "\\") i++;
            else if (c === quote) quote = null;
        } else if (c === "\"" || c === "'") {
            quote = c;
        } else if (text.startsWith("~}}", i)) {
            return i;
        } else if (text.startsWith("}}", i)) {
            return i;
        }
    }
    return -1;
}

export function rewriteInfixExpressions(text: string): string {
    if (!text.includes("{{")) return text;

    let result = "";
    let last = 0;
    tagStart.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = tagStart.exec(text)) !== null) {
        // An odd number of backslashes escapes the mustache
        if (match[1].length % 2 === 1) continue;

        const argStart = match.index + match[0].length;
        const argEnd = findTagEnd(text, argStart);
        if (argEnd === -1) break;

        const args = text.slice(argStart, argEnd);
        if (match[5]) {
            // {{= expression}}: replace the "=" too
            const tagOpen = match.index + match[1].length;
            result += text.slice(last, tagOpen) + "{{" + match[2] + rewriteDisplayExpression(args);
            last = argEnd;
        } else {
            const rewritten = match[3] ? rewriteInfixCondition(args) : rewriteInfixArguments(args);
            if (rewritten !== null) {
                result += text.slice(last, argStart) + " " + rewritten;
                last = argEnd;
            }
        }
        tagStart.lastIndex = argEnd;
    }
    return result + text.slice(last);
}
