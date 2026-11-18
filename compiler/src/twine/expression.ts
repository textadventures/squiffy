// Expressions shared by the Harlowe and SugarCube converters: each parses its own format's
// expressions into this tree, which is written out as a Squiffy expression, as {{#if}}, @set and
// {{set}} take (see runtime/src/infixExpressions.ts).

export type BinaryOp = "or" | "and" | "=" | "!=" | ">" | ">=" | "<" | "<=" | "+" | "-" | "*" | "/" | "%";

export type Expr =
    | { k: "num", v: number }
    | { k: "str", v: string }
    | { k: "bool", v: boolean }
    | { k: "null" }
    // A Squiffy attribute
    | { k: "var", name: string }
    | { k: "bin", op: BinaryOp, l: Expr, r: Expr }
    | { k: "not", e: Expr }
    | { k: "neg", e: Expr }
    // A Squiffy helper, e.g. (seen "cave")
    | { k: "call", fn: string, args: Expr[] }
    | { k: "array", items: Expr[] };

// Thrown when something can't be converted. The message says why, for the list of problems.
export class Unconvertible extends Error {}

const precedence: Record<BinaryOp, number> = {
    "or": 1, "and": 2,
    "=": 4, "!=": 4, ">": 4, ">=": 4, "<": 4, "<=": 4,
    "+": 5, "-": 5,
    "*": 6, "/": 6, "%": 6,
};
const notPrecedence = 3;
const atomPrecedence = 8;

function precedenceOf(e: Expr): number {
    if (e.k == "bin") return precedence[e.op];
    if (e.k == "not") return notPrecedence;
    if (e.k == "neg") return 7;
    return atomPrecedence;
}

export interface PrintOptions {
    // Quote text with single quotes where possible, for setters in links, which end up in a
    // set="..." string
    preferSingle?: boolean;
}

// Text as a quoted string. Handlebars and Squiffy's expression tokenizer both take a backslash
// before the quote character, but Handlebars leaves other backslashes in, so those can't be
// written exactly.
export function quote(text: string, options: PrintOptions = {}): string {
    if (text.includes("\\")) throw new Unconvertible("text with a backslash in it");
    // }} would end the {{...}} the expression is in
    text = text.replace(/\}\}/g, "}&#125;").replace(/\n/g, " ");
    const hasDouble = text.includes("\"");
    const hasSingle = text.includes("'");
    if (hasDouble && hasSingle) return `"${text.replace(/"/g, "&quot;")}"`;
    if (hasDouble || (options.preferSingle && !hasSingle)) return `'${text}'`;
    return `"${text}"`;
}

const reservedWords = new Set(["and", "or", "not", "true", "false", "null", "undefined"]);

// An attribute name in an expression: the name, or [name] if it isn't one word
export function attributeRef(name: string): string {
    if (/^[A-Za-z_]\w*$/.test(name) && !reservedWords.has(name)) return name;
    return `[${name}]`;
}

export function print(e: Expr, options: PrintOptions = {}): string {
    switch (e.k) {
        case "num": return String(e.v);
        case "str": return quote(e.v, options);
        case "bool": return String(e.v);
        case "null": return "null";
        case "var": return attributeRef(e.name);
        case "array": return `(array${e.items.map(i => " " + printArgument(i, options)).join("")})`;
        case "call": return `(${e.fn}${e.args.map(a => " " + printArgument(a, options)).join("")})`;
        case "neg": {
            const inner = print(e.e, options);
            return precedenceOf(e.e) < atomPrecedence ? `-(${inner})` : `-${inner}`;
        }
        case "not": {
            const inner = print(e.e, options);
            return `not ${precedenceOf(e.e) < notPrecedence ? `(${inner})` : inner}`;
        }
        case "bin": {
            const p = precedence[e.op];
            const comparison = p == 4;
            const left = print(e.l, options);
            const right = print(e.r, options);
            const lp = precedenceOf(e.l);
            const rp = precedenceOf(e.r);
            const l = lp < p || (comparison && lp == p) ? `(${left})` : left;
            const r = rp <= p || e.r.k == "neg" ? `(${right})` : right;
            return `${l} ${e.op} ${r}`;
        }
    }
}

// A helper's argument: anything but a single value or call needs brackets
function printArgument(e: Expr, options: PrintOptions): string {
    const text = print(e, options);
    return precedenceOf(e) < atomPrecedence || e.k == "neg" ? `(${text})` : text;
}

// Whether an expression can only be true or false, for Harlowe's "$a is 1 or 2"
export function isBoolean(e: Expr): boolean {
    if (e.k == "bool" || e.k == "not") return true;
    if (e.k == "bin") return precedence[e.op] <= 4;
    if (e.k == "call") return e.fn == "seen" || e.fn == "contains" || e.fn == "at";
    return false;
}

// A random whole number from min to max, as Squiffy's {{random}} picks from an array
export function randomInteger(min: Expr, max: Expr): Expr {
    if (min.k != "num" || max.k != "num") throw new Unconvertible("a random number with a range that isn't fixed");
    const low = Math.ceil(Math.min(min.v, max.v));
    const high = Math.floor(Math.max(min.v, max.v));
    if (high - low > 100) throw new Unconvertible("a random number from a range of more than 100 numbers");
    const items: Expr[] = [];
    for (let n = low; n <= high; n++) items.push({ k: "num", v: n });
    return { k: "call", fn: "random", args: [{ k: "array", items }] };
}

// Expressions shown in text: {{name}} for an attribute, or {{= expression}}
export function display(e: Expr): string {
    // Fixed text is just text
    if (e.k == "str") return e.v.replace(/\[/g, "&#91;").replace(/\]/g, "&#93;").replace(/\{\{/g, "&#123;{").replace(/\}\}/g, "}&#125;");
    if (e.k == "num" || e.k == "bool") return String(e.v);
    if (e.k == "var") {
        return /^[A-Za-z_]\w*$/.test(e.name) && !reservedWords.has(e.name) ? `{{${e.name}}}` : `{{get ${quote(e.name)}}}`;
    }
    if (e.k == "call") return `{{${print(e).slice(1, -1)}}}`;
    return `{{= ${print(e)}}}`;
}

// A token stream for the expression parsers
export class Tokens<T extends { type: string, text: string }> {
    pos = 0;
    constructor(public readonly items: T[]) {}

    peek(offset = 0): T | undefined {
        return this.items[this.pos + offset];
    }

    next(): T {
        const token = this.items[this.pos++];
        if (!token) throw new Unconvertible("an expression that ends too soon");
        return token;
    }

    is(text: string, offset = 0): boolean {
        return this.peek(offset)?.text == text;
    }

    accept(text: string): boolean {
        if (this.is(text)) {
            this.pos++;
            return true;
        }
        return false;
    }

    expect(text: string) {
        if (!this.accept(text)) throw new Unconvertible(`an expression Squiffy can't read (expected "${text}")`);
    }

    get done(): boolean {
        return this.pos >= this.items.length;
    }
}

// Finds the end of a bracketed or quoted run, starting at the opening character. Returns the
// index just after the closing character, or -1.
export function skipBalanced(s: string, start: number, open: string, close: string, quotes = "\"'`"): number {
    let depth = 0;
    for (let i = start; i < s.length; i++) {
        const c = s[i];
        // Harlowe's possessive: $player's hp
        if (c == "'" && s[i + 1] == "s" && /\s/.test(s[i + 2] ?? "") && /[\w)]/.test(s[i - 1] ?? "")) continue;
        if (quotes.includes(c)) {
            const end = skipString(s, i);
            if (end == -1) return -1;
            i = end - 1;
        }
        else if (c == open) {
            depth++;
        }
        else if (c == close) {
            depth--;
            if (depth == 0) return i + 1;
        }
    }
    return -1;
}

// The index after a quoted string starting at start, or -1 if it isn't closed
export function skipString(s: string, start: number): number {
    const q = s[start];
    for (let i = start + 1; i < s.length; i++) {
        if (s[i] == "\\") i++;
        else if (s[i] == q) return i + 1;
    }
    return -1;
}

export function unescapeString(literal: string): string {
    return literal.slice(1, -1).replace(/\\(.)/g, (_m, c: string) => c == "n" ? "\n" : c == "t" ? "\t" : c);
}
