// Rewrites infix expressions into the equivalent prefix helper calls, before the text reaches
// Handlebars. They're accepted in:
//   conditions:  {{#if score > 100 and has_key}}  ->  {{#if (and (gt score 100) has_key)}}
//                (also {{#unless}}, {{else if}} and {{else unless}})
//   values:      {{set "gold" gold + price * 2}}  ->  {{set "gold" (add gold (mul price 2))}}
//                (also {{inc}} and {{dec}})
//   display:     {{= price * 2}}                  ->  {{mul price 2}}
//
// Two operators work on values rather than numbers (#446):
//   bag contains "key"          ->  (__contains bag "key")   (lists, text and objects)
//   hp > 0 ? "alive" : "dead"   ->  (cond (gt hp 0) "alive" "dead")
//
// Precedence, from tightest to loosest: unary minus, * / %, + -, comparisons (and contains),
// not/!, and/&&, or/||, and then ? :. So "not" applies to a whole comparison, as it reads in English: not gender = "male"
// means not (gender = "male").
// Expressions that don't use any infix operator are passed through unchanged (except {{= }},
// which isn't valid Handlebars, so it's always rewritten).
//
// "-" and "/" can appear inside Handlebars names and paths (my-score, ../score), so they're only
// operators at the start of a token: a - b and a -b subtract, but a-b is the attribute "a-b".
//
// Objects and lists (#442):
//   { hp: 10, name: "Ann" }   ->  (__object "hp" 10 "name" "Ann")
//   [1, 2, 3]                 ->  (array 1 2 3)
//   inventory[i].name         ->  (lookup (lookup inventory i) "name")
// hero.hp needs no rewriting: it's a Handlebars path. A "[" at the start of a value is a list if
// it's empty, or has a comma in it, or starts with a literal value; otherwise it's a Handlebars
// name that isn't a plain word, such as [my attribute], as before. A list of one attribute is
// written (array name).

// "index" is a "[" straight after a value, and "[" one that starts a list
type TokenType = "op" | "(" | ")" | "value" | "ident" | "index" | "[" | "]" | "{" | "}" | ":" | ",";

interface Token {
    type: TokenType;
    text: string;
}

type Node =
    | { kind: "raw", text: string }
    | { kind: "call", name: string, args: Node[] };

const punctuation = new Set(["{", "}", ":", ",", "]"]);

const comparisonHelpers: Record<string, string> = {
    "=": "eq",
    "==": "eq",
    "!=": "ne",
    ">": "gt",
    "<": "lt",
    ">=": "gte",
    "<=": "lte",
    // a contains b (#446): see the __contains helper
    "contains": "__contains",
};

const arithmeticHelpers: Record<string, string> = {
    "+": "add",
    "-": "sub",
    "*": "mul",
    "/": "div",
    "%": "mod",
};

const symbolicOps = ["==", "!=", ">=", "<=", "&&", "||", "=", ">", "<", "!", "+", "*", "%", "-", "/", "?"];
const keywordOps = ["and", "or", "not"];
const literals = ["true", "false", "null", "undefined"];

// Characters that end an identifier/path. "[" starts a Handlebars literal segment,
// e.g. [my attribute], which may contain any of these.
// "-" and "/" aren't here: see above.
const identTerminators = new Set([..." \t\r\n!\"'()<>=&|{}~+*%:,]?"]);

const numberPattern = /^-?\d+(\.\d+)?$/;

class ExpressionError extends Error {}

// Whether the "[" at `open`, at the start of a value, starts a list rather than a Handlebars name
// like [my attribute]: it's empty, or it has a comma in it, or it starts with a literal value
function startsList(expr: string, open: number): boolean {
    const after = expr.substring(open + 1).trimStart();
    if (/^[\]"'{[(\d-]/.test(after)) return true;
    const close = expr.indexOf("]", open);
    return close !== -1 && expr.substring(open, close).includes(",");
}

// Whether a token can be the end of a value, so that what follows it is an operator
function endsValue(token: Token | undefined) {
    return token?.type === "ident" || token?.type === "value" || token?.type === ")" || token?.type === "]" || token?.type === "}";
}

function tokenize(expr: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    while (i < expr.length) {
        const c = expr[i];
        if (/\s/.test(c)) {
            i++;
            continue;
        }
        if (c === "(" || c === ")" || punctuation.has(c)) {
            tokens.push({ type: c as TokenType, text: c });
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
        // A "[" straight after a value is an index, as in inventory[0] or inventory[i][j]
        if (c === "[" && /[\w\])]/.test(expr[i - 1] ?? "")) {
            tokens.push({ type: "index", text: c });
            i++;
            continue;
        }
        if (c === "[" && startsList(expr, i)) {
            tokens.push({ type: "[", text: c });
            i++;
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
            // A "[" straight after a name is an index, as in inventory[0]. After "." or "/", or at
            // the start, it's a Handlebars name, as in inventory.[0] or [my attribute].
            if (expr[j] === "[" && j > i && expr[j - 1] !== "." && expr[j - 1] !== "/") {
                break;
            }
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
        if (keywordOps.includes(word) || (word === "contains" && endsValue(tokens[tokens.length - 1]))) {
            // "contains" is only an operator after a value, so (contains "bag" "key") is still
            // the helper
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
        return token?.type === "ident" || token?.type === "value" || token?.type === "(" || token?.type === "[" || token?.type === "{";
    }

    private describe(token: Token | undefined) {
        return token ? `'${token.text}'` : "end of expression";
    }

    // A value: an expression with nothing after it
    parseExpression(): Node {
        const result = this.parseConditional();
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
        const result = [this.parseConditional()];
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

    // test ? a : b (#446), the loosest of all, and right-associative, so a ? b : c ? d : e
    // is a ? b : (c ? d : e)
    private parseConditional(): Node {
        const test = this.parseOr();
        if (!this.isOp(this.peek(), "?")) return test;
        this.next();
        if (!this.peek()) {
            throw new ExpressionError("expected a value after '?'");
        }
        const ifTrue = this.parseConditional();
        this.expect(":");
        if (!this.peek()) {
            throw new ExpressionError("expected a value after ':'");
        }
        const ifFalse = this.parseConditional();
        this.usedInfix = true;
        return { kind: "call", name: "cond", args: [test, ifTrue, ifFalse] };
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

    // A value, then any [index] or .name after it, e.g. inventory[i].name
    private parsePrimary(): Node {
        let node = this.parseAtom();
        for (;;) {
            const token = this.peek();
            if (token?.type === "index") {
                this.next();
                const index = this.parseConditional();
                this.expect("]");
                this.usedInfix = true;
                node = { kind: "call", name: "lookup", args: [node, index] };
            }
            else if (token?.type === "ident" && token.text.startsWith(".") && this.tokens[this.pos - 1]?.type === "]") {
                // .name after an index: a name, or Handlebars' .[name]
                this.next();
                for (const part of token.text.substring(1).split(".")) {
                    const name = /^\[(.*)\]$/.exec(part)?.[1] ?? part;
                    if (!name) throw new ExpressionError(`unexpected '${token.text}'`);
                    node = { kind: "call", name: "lookup", args: [node, { kind: "raw", text: JSON.stringify(name) }] };
                }
            }
            else {
                return node;
            }
        }
    }

    private expect(type: TokenType) {
        if (this.peek()?.type !== type) {
            throw new ExpressionError(`expected '${type}' but found ${this.describe(this.peek())}`);
        }
        this.next();
    }

    // { name: value, ... } (#442)
    private parseObject(): Node {
        const args: Node[] = [];
        while (this.peek()?.type !== "}") {
            const key = this.next();
            if (!key) throw new ExpressionError("expected '}' but found end of expression");
            if ((key.type === "ident" || key.type === "value") && /^\w+$/.test(key.text)) {
                args.push({ kind: "raw", text: `"${key.text}"` });
            } else if (key.type === "value" && /^["']/.test(key.text)) {
                args.push({ kind: "raw", text: key.text });
            } else {
                throw new ExpressionError(`expected a name in the object, e.g. { hp: 10 }, but found '${key.text}'`);
            }
            this.expect(":");
            args.push(this.parseConditional());
            if (this.peek()?.type !== ",") break;
            this.next();
        }
        this.expect("}");
        this.usedInfix = true;
        return { kind: "call", name: "__object", args };
    }

    // [value, ...] (#442)
    private parseList(): Node {
        const args: Node[] = [];
        while (this.peek()?.type !== "]") {
            if (!this.peek()) throw new ExpressionError("expected ']' but found end of expression");
            args.push(this.parseConditional());
            if (this.peek()?.type !== ",") break;
            this.next();
        }
        this.expect("]");
        this.usedInfix = true;
        return { kind: "call", name: "array", args };
    }

    private parseAtom(): Node {
        const token = this.peek();
        if (token?.type === "{") {
            this.next();
            return this.parseObject();
        }
        if (token?.type === "[") {
            this.next();
            return this.parseList();
        }
        if (token?.type === "ident" || token?.type === "value") {
            this.next();
            return { kind: "raw", text: token.text };
        }
        if (token?.type === "(") {
            this.next();
            const node = this.isHelperCall() ? this.parseHelperCall() : this.parseConditional();
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

// "value" is a whole expression whose value is used, e.g. the right-hand side of @set
type Mode = "condition" | "arguments" | "display" | "value";

// Parses `text` and returns the rewritten nodes, or null if it should be left alone: it
// doesn't use infix syntax, or it can't be parsed and has no operators (which leaves malformed
// prefix syntax for Handlebars to report).
function rewrite(text: string, mode: Mode, label: string): Node[] | null {
    // Whether errors are always reported, and the result always returned, rather than leaving
    // anything that isn't infix syntax for Handlebars
    const strict = mode === "display" || mode === "value";
    // Errors are thrown after the try/catch blocks, as new errors with the expression in the message
    let error: ExpressionError | null = null;
    let tokens: Token[] = [];
    try {
        tokens = tokenize(text);
    } catch (e) {
        // Leave anything we can't tokenize for Handlebars to report, except {{= }}
        if (!strict || !(e instanceof ExpressionError)) return null;
        error = e;
    }
    const hasOperators = tokens.some(t => t.type === "op" || t.type === "index" || t.type === "[" || t.type === "{");
    const parser = new Parser(tokens);
    let nodes: Node[] = [];
    if (!error) {
        try {
            nodes = mode === "condition" ? parser.parseCondition()
                : mode === "arguments" ? parser.parseArguments(1)
                : [parser.parseExpression()];
        } catch (e) {
            if (!(e instanceof ExpressionError) || (!hasOperators && !strict)) return null;
            error = e;
        }
    }
    if (error) {
        throw new Error(`Invalid ${label} "${text.trim()}": ${error.message}`);
    }
    if (!parser.usedInfix && !strict) return null;
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

// Rewrites an expression whose value is used (the right-hand side of @set and link setters, when a
// story uses expressions there) into a Handlebars value: a helper call in parentheses, an
// attribute name or a literal. Throws if it isn't a valid expression.
export function rewriteValueExpression(expression: string): string {
    return emit(rewrite(expression, "value", "expression")![0]);
}

// Splits a list of link setters on the commas between them, but not on commas inside quotes or
// brackets: greeting = "Hi, there", gold -= price is two setters, and so is
// hero = { hp: 10, name: "Ann" }, gold = 0.
export function splitSetters(setters: string): string[] {
    const result: string[] = [];
    let depth = 0;
    let quote: string | null = null;
    let start = 0;
    for (let i = 0; i < setters.length; i++) {
        const c = setters[i];
        if (quote) {
            if (c === "\\") i++;
            else if (c === quote) quote = null;
        }
        else if (c === "\"" || c === "'") quote = c;
        else if (c === "(" || c === "[" || c === "{") depth++;
        else if (c === ")" || c === "]" || c === "}") depth = Math.max(0, depth - 1);
        else if (c === "," && depth === 0) {
            result.push(setters.slice(start, i));
            start = i + 1;
        }
    }
    result.push(setters.slice(start));
    return result.map(s => s.trim()).filter(s => s !== "");
}

const tagStart = /(\\*)\{\{(~?\s*)(?:(#if|#unless|else\s+if|else\s+unless)(?=[\s(!])|(set|inc|dec)(?=\s)|(=))/g;

// Finds the end of a mustache tag starting at `from`, skipping over quoted strings and objects,
// such as {{set "hero" { hp: 10 }}}. Returns the index of the closing "}}" (or "~}}"), or -1.
function findTagEnd(text: string, from: number): number {
    let quote: string | null = null;
    let braces = 0;
    for (let i = from; i < text.length; i++) {
        const c = text[i];
        if (quote) {
            if (c === "\\") i++;
            else if (c === quote) quote = null;
        } else if (c === "\"" || c === "'") {
            quote = c;
        } else if (c === "{") {
            braces++;
        } else if (c === "}" && braces > 0) {
            braces--;
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
