// Rewrites infix conditions in {{#if}}, {{#unless}}, {{else if}} and {{else unless}}
// into the equivalent prefix helper calls, before the text reaches Handlebars. e.g.
//   {{#if score > 100 and has_key}}  ->  {{#if (and (gt score 100) has_key)}}
//
// Precedence, from tightest to loosest: comparisons, not/!, and/&&, or/||. So "not" applies to
// a whole comparison, as it reads in English: not gender = "male" means not (gender = "male").
// Conditions that don't use any infix operator are passed through unchanged.

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

const symbolicOps = ["==", "!=", ">=", "<=", "&&", "||", "=", ">", "<", "!"];
const keywordOps = ["and", "or", "not"];
const literals = ["true", "false", "null", "undefined"];

// Characters that end an identifier/path. "[" starts a Handlebars literal segment,
// e.g. [my attribute], which may contain any of these.
const identTerminators = new Set([..." \t\r\n!\"'()<>=&|{}~"]);

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
        const op = symbolicOps.find(o => expr.startsWith(o, i));
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
        } else if (literals.includes(word) || /^-?\d+(\.\d+)?$/.test(word)) {
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
        const left = this.parsePrimary();
        const opToken = this.peek();
        if (opToken?.type !== "op" || !(opToken.text in comparisonHelpers)) {
            return left;
        }
        this.next();
        if (!this.peek()) {
            throw new ExpressionError(`expected a value after '${opToken.text}'`);
        }
        const right = this.parsePrimary();
        const following = this.peek();
        if (following?.type === "op" && following.text in comparisonHelpers) {
            throw new ExpressionError(`comparisons can't be chained (at '${following.text}'), use "and" to combine them`);
        }
        this.usedInfix = true;
        return { kind: "call", name: comparisonHelpers[opToken.text], args: [left, right] };
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

// Rewrites a single condition. Returns null if it doesn't use infix syntax.
export function rewriteInfixCondition(condition: string): string | null {
    let tokens: Token[];
    try {
        tokens = tokenize(condition);
    } catch {
        // Leave anything we can't tokenize for Handlebars to report
        return null;
    }
    const hasOperators = tokens.some(t => t.type === "op");
    const parser = new Parser(tokens);
    let nodes: Node[];
    let error: ExpressionError | null = null;
    try {
        nodes = parser.parseCondition();
    } catch (e) {
        if (!hasOperators || !(e instanceof ExpressionError)) return null;
        error = e;
        nodes = [];
    }
    if (error) {
        throw new Error(`Invalid condition "${condition.trim()}": ${error.message}`);
    }
    if (!parser.usedInfix) return null;
    return nodes.map(emit).join(" ");
}

const blockStart = /(\\*)\{\{(~?\s*)(#if|#unless|else\s+if|else\s+unless)(?=[\s(!])/g;

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
    blockStart.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = blockStart.exec(text)) !== null) {
        // An odd number of backslashes escapes the mustache
        if (match[1].length % 2 === 1) continue;

        const argStart = match.index + match[0].length;
        const argEnd = findTagEnd(text, argStart);
        if (argEnd === -1) break;

        const condition = text.slice(argStart, argEnd);
        const rewritten = rewriteInfixCondition(condition);
        if (rewritten !== null) {
            result += text.slice(last, argStart) + " " + rewritten;
            last = argEnd;
        }
        blockStart.lastIndex = argEnd;
    }
    return result + text.slice(last);
}
