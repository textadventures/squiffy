// Expressions shared by the Harlowe and SugarCube converters: each parses its own format's
// expressions into this tree, which is written out as a Squiffy expression, as {{#if}}, @set and
// {{set}} take (see runtime/src/infixExpressions.ts).

// "contains" is whether a list, text or object has the value in it (#446)
export type BinaryOp = "or" | "and" | "=" | "!=" | ">" | ">=" | "<" | "<=" | "contains" | "+" | "-" | "*" | "/" | "%";

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
    // test ? then : otherwise (#446)
    | { k: "cond", test: Expr, then: Expr, otherwise: Expr }
    // A Squiffy helper, e.g. (seen "cave")
    | { k: "call", fn: string, args: Expr[] }
    | { k: "array", items: Expr[] }
    // An object, { name: value } (#442)
    | { k: "object", entries: [string, Expr][] }
    // A value inside an object or list whose name or position is worked out as the story runs,
    // e.g. inventory[i]. One that's a fixed word is part of a var's name instead: hero.hp.
    | { k: "member", e: Expr, key: Expr }
    // A loop's item ({{this}}) or position ({{@index}}), in an {{#each}} up levels out from the
    // innermost one. array is the attribute a loop by position goes through, so $list[_i] can be
    // its item.
    | { k: "loop", kind: "item" | "index", up: number, array?: string };

// Thrown when something can't be converted. The message says why, for the list of problems.
export class Unconvertible extends Error {}

const precedence: Record<BinaryOp, number> = {
    "or": 1, "and": 2,
    "=": 4, "!=": 4, ">": 4, ">=": 4, "<": 4, "<=": 4, "contains": 4,
    "+": 5, "-": 5,
    "*": 6, "/": 6, "%": 6,
};
const notPrecedence = 3;
const atomPrecedence = 8;

function precedenceOf(e: Expr): number {
    if (e.k == "cond") return 0;
    if (e.k == "bin") return precedence[e.op];
    if (e.k == "not") return notPrecedence;
    if (e.k == "neg") return 7;
    return atomPrecedence;
}

export interface PrintOptions {
    // Quote text with single quotes where possible, for setters in links, which end up in a
    // set="..." string
    preferSingle?: boolean;
    // For setters in links, which run when the link is clicked, after its loop has finished: a
    // loop's item is filled in where the link is, as '{{this}}'
    inLink?: boolean;
}

// How a loop's item or position is written in Handlebars, e.g. this, ../this or @index
function loopRef(e: Expr & { k: "loop" }): string {
    const up = "../".repeat(e.up);
    return e.kind == "item" ? up + "this" : "@" + up + "index";
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

const word = /^[A-Za-z_]\w*$/;

// Whether an attribute name is a path to a value inside an object, written with dots, such as
// hero.hp (#442). The converters only make names of one word, so a dot can only be a path.
function isPath(name: string): boolean {
    const parts = name.split(".");
    return parts.length > 1 && parts.every(part => word.test(part)) && !reservedWords.has(parts[0]);
}

// An attribute name in an expression: the name, or [name] if it isn't one word. A path to a
// value inside an object, hero.hp or inventory[i].name, is written as it is.
export function attributeRef(name: string): string {
    if ((word.test(name) && !reservedWords.has(name)) || isPath(name) || isDynamicTarget(name)) return name;
    return `[${name}]`;
}

// Whether a statement's target is a value inside an object found as the story runs, such as
// inventory[i].name, which only a setter can set: {{set}} and the like take a fixed name
export function isDynamicTarget(name: string): boolean {
    return /^[A-Za-z_]\w*[.[]/.test(name) && name.includes("[");
}

// A value inside an object or list: hero.hp for a fixed word inside an attribute, otherwise
// inventory[i] (#442)
export function member(e: Expr, key: Expr): Expr {
    if (e.k == "var" && key.k == "str" && word.test(key.v) && (word.test(e.name) || isPath(e.name)) && !reservedWords.has(e.name)) {
        return { k: "var", name: `${e.name}.${key.v}` };
    }
    return { k: "member", e, key };
}

// The text of a setter's target, e.g. hero.hp or inventory[i].name, or null if it isn't
// something that can be set
export function targetName(e: Expr): string | null {
    if (e.k == "var") return e.name;
    if (e.k == "member" && targetName(e.e) !== null) return print(e);
    return null;
}

export function print(e: Expr, options: PrintOptions = {}): string {
    switch (e.k) {
        case "num": return String(e.v);
        case "str": return quote(e.v, options);
        case "bool": return String(e.v);
        case "null": return "null";
        case "var": return attributeRef(e.name);
        case "loop":
            if (!options.inLink) return loopRef(e);
            // A link fills in its setters with only its own loop's item
            if (e.up) throw new Unconvertible("a link in a loop that sets a variable to an outer loop's item");
            return `'{{${loopRef(e)}}}'`;
        case "array": return `(array${e.items.map(i => " " + printArgument(i, options)).join("")})`;
        // Always a space before "}", so nested objects never have the "}}" that would end a tag
        case "object":
            if (!e.entries.length) return "{ }";
            return `{ ${e.entries.map(([key, value]) => `${word.test(key) ? key : quote(key, options)}: ${print(value, options)}`).join(", ")} }`;
        case "member": {
            if (e.e.k == "loop" && options.inLink) throw new Unconvertible("a link in a loop that sets a variable to a value inside the loop's item");
            const base = printArgument(e.e, options);
            if (e.key.k == "str" && word.test(e.key.v) && (e.e.k == "member" || (e.e.k == "loop" && e.e.kind == "item"))) {
                return `${base}.${e.key.v}`;
            }
            return `${base}[${print(e.key, options)}]`;
        }
        case "call":
            // .indexOf() that isn't checking whether something is there (see sugarcube.ts) (#447)
            if (e.fn == "__indexof") return print({ ...e, fn: "indexof" }, options);
            return `(${e.fn}${e.args.map(a => " " + printArgument(a, options)).join("")})`;
        case "neg": {
            const inner = print(e.e, options);
            return precedenceOf(e.e) < atomPrecedence ? `-(${inner})` : `-${inner}`;
        }
        case "not": {
            const inner = print(e.e, options);
            return `not ${precedenceOf(e.e) < notPrecedence ? `(${inner})` : inner}`;
        }
        case "cond": {
            // Right-associative, so only a condition in the test or the first value needs brackets
            const test = print(e.test, options);
            const then = print(e.then, options);
            return `${e.test.k == "cond" ? `(${test})` : test} ? ${e.then.k == "cond" ? `(${then})` : then} : ${print(e.otherwise, options)}`;
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

// Whether an expression is a call to a helper that makes a new list (#447), which {{#each}} can
// go through as it can an attribute
export function isListCall(e: Expr): boolean {
    return e.k == "call" && ["range", "sort", "shuffle", "slice"].includes(e.fn);
}

// Whether an expression can only be true or false, for Harlowe's "$a is 1 or 2"
export function isBoolean(e: Expr): boolean {
    if (e.k == "bool" || e.k == "not") return true;
    if (e.k == "bin") return precedence[e.op] <= 4;
    if (e.k == "call") return e.fn == "seen" || e.fn == "contains" || e.fn == "at";
    return false;
}

// The length of a list or text, which Handlebars gives as its length property: name.length (#446)
export function lengthOf(e: Expr): Expr {
    if (e.k == "str") return { k: "num", v: e.v.length };
    if (e.k == "array") return { k: "num", v: e.items.length };
    return member(e, { k: "str", v: "length" });
}

// Harlowe's (cond: test, a, test2, b, otherwise), as a ? b : c
export function conditional(values: Expr[], what: string): Expr {
    if (values.length < 3 || values.length % 2 == 0) throw new Unconvertible(`${what} without a condition and two values for each`);
    const [test, then, ...rest] = values;
    return { k: "cond", test, then, otherwise: rest.length == 1 ? rest[0] : conditional(rest, what) };
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
        return (word.test(e.name) && !reservedWords.has(e.name)) || isPath(e.name) ? `{{${e.name}}}` : `{{get ${quote(e.name)}}}`;
    }
    if (e.k == "loop") return `{{${loopRef(e)}}}`;
    // A helper call is written as it is, unless an argument needs an expression, such as
    // (abs (-hp)), which only {{= }} rewrites
    if (e.k == "call" && e.args.every(isPlain)) return `{{${print(e).slice(1, -1)}}}`;
    return `{{= ${print(e)}}}`;
}

// Whether a value is written the same in Handlebars as in an expression
function isPlain(e: Expr): boolean {
    if (e.k == "num" || e.k == "str" || e.k == "bool" || e.k == "null" || e.k == "loop") return true;
    if (e.k == "var") return !isDynamicTarget(e.name);
    if (e.k == "call") return e.args.every(isPlain);
    if (e.k == "array") return e.items.every(isPlain);
    return false;
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
