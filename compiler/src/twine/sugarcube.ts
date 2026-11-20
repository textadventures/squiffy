// Converts a SugarCube passage to Squiffy text.
//
// The passage is parsed into a tree of text, <<macros>> (with the bodies of container macros
// such as <<if>>...<</if>>), links and naked variables, which is then written out as Squiffy:
// <<if>> becomes {{#if}}, <<set>> becomes @set or {{set}}, links with setters become links with
// setters, and <<link>> and friends become links to generated passages and sections.

import { delayValue, display, isDynamicTarget, isListCall, lengthOf, member as memberOf, print, randomInteger, skipString, targetName, Tokens, Unconvertible, unescapeString } from "./expression.js";
import type { BinaryOp, Expr } from "./expression.js";
import { audioHelper, leadingAudio, pickSource, STOP_ALL_AUDIO } from "./audio.js";
import type { AudioAction, StoryAudio } from "./audio.js";
import { dynamicSectionLink, escapeText, isUrl, urlLink, passageLink, sectionLink, setter } from "./convert.js";
import type { ConvertedPassage, PassageContext } from "./convert.js";

interface Macro {
    t: "macro";
    name: string;
    args: string;
    raw: string;
    // For container macros: the body, split by child macros such as <<elseif>> and <<case>>
    clauses?: Clause[];
}

interface Clause {
    // The macro that starts the clause: the container itself for the first one
    name: string;
    args: string;
    raw: string;
    nodes: Node[];
}

type Node =
    | { t: "text", s: string }
    | { t: "raw", s: string }
    | Macro
    | { t: "link", raw: string, text: string, target: string, setter?: string }
    | { t: "image", raw: string, src: string, title?: string, link?: string }
    | { t: "var", raw: string }
    | { t: "comment", text: string, reason: string };

const containers = new Set([
    "if", "for", "switch", "link", "button", "linkreplace", "linkappend", "linkprepend", "nobr", "silently", "capture",
    "script", "timed", "repeat", "widget", "cycle", "listbox", "append", "prepend", "replace", "type", "done", "do",
    "click", "createplaylist", "createaudiogroup",
]);

const childMacros: Record<string, string[]> = {
    if: ["elseif", "else"],
    switch: ["case", "default"],
    timed: ["next"],
    cycle: ["option", "optionsfrom"],
    listbox: ["option", "optionsfrom"],
    repeat: [],
};

class Parser {
    // The story's container widgets (#450), whose calls wrap text like <<say "Ann">>Hi<</say>>
    constructor(private readonly src: string, private readonly containerWidgets: ReadonlySet<string> = new Set()) {}

    // Parses until the end, or until the end of the container, or one of its child macros
    parse(start: number, container?: string): { nodes: Node[], end: number, stop?: { name: string, args: string, raw: string, close: boolean } } {
        const src = this.src;
        const nodes: Node[] = [];
        let text = "";
        const flush = () => {
            if (text) nodes.push({ t: "text", s: text });
            text = "";
        };
        let i = start;
        while (i < src.length) {
            const rest = src.substring(i, i + 300);
            if (rest.startsWith("<<")) {
                const macro = readMacro(src, i);
                if (macro) {
                    const close = /^\/(\w+)$|^end\s*(\w+)$/.exec(macro.name);
                    if (close) {
                        const closing = close[1] ?? close[2];
                        if (container && closing == container) {
                            flush();
                            return { nodes, end: macro.end, stop: { name: closing, args: "", raw: macro.raw, close: true } };
                        }
                        // A stray closing tag: left out
                        flush();
                        i = macro.end;
                        continue;
                    }
                    const name = macro.name == "else" && /^\s*if\b/.test(macro.args) ? "elseif" : macro.name;
                    const args = name == "elseif" && macro.name == "else" ? macro.args.replace(/^\s*if\b/, "") : macro.args;
                    if (container && childMacros[container]?.includes(name)) {
                        flush();
                        return { nodes, end: macro.end, stop: { name, args, raw: macro.raw, close: false } };
                    }
                    flush();
                    if (containers.has(name) || this.containerWidgets.has(name)) {
                        const node: Macro = { t: "macro", name, args, raw: macro.raw, clauses: [] };
                        let clause: Clause = { name, args, raw: macro.raw, nodes: [] };
                        let j = macro.end;
                        for (;;) {
                            const body = this.parse(j, name);
                            clause.nodes = body.nodes;
                            node.clauses!.push(clause);
                            j = body.end;
                            if (!body.stop || body.stop.close) {
                                node.raw = src.substring(i, j);
                                break;
                            }
                            clause = { name: body.stop.name, args: body.stop.args, raw: body.stop.raw, nodes: [] };
                        }
                        nodes.push(node);
                        i = j;
                        continue;
                    }
                    nodes.push({ t: "macro", name, args, raw: macro.raw });
                    i = macro.end;
                    continue;
                }
            }
            if (rest.startsWith("/*") || rest.startsWith("/%")) {
                const closer = rest.startsWith("/*") ? "*/" : "%/";
                const end = src.indexOf(closer, i + 2);
                flush();
                i = end == -1 ? src.length : end + 2;
                continue;
            }
            if (rest.startsWith("<!--")) {
                const end = src.indexOf("-->", i + 4);
                const stop = end == -1 ? src.length : end + 3;
                flush();
                nodes.push({ t: "raw", s: src.substring(i, stop).replace(/\n/g, " ") });
                i = stop;
                continue;
            }
            if (rest.startsWith("\"\"\"")) {
                const end = src.indexOf("\"\"\"", i + 3);
                if (end != -1) {
                    flush();
                    nodes.push({ t: "raw", s: escapeText(escapeHtml(src.substring(i + 3, end))) });
                    i = end + 3;
                    continue;
                }
            }
            if (/^<nowiki>/i.test(rest)) {
                const end = src.toLowerCase().indexOf("</nowiki>", i);
                if (end != -1) {
                    flush();
                    nodes.push({ t: "raw", s: escapeText(src.substring(i + 8, end)) });
                    i = end + 9;
                    continue;
                }
            }
            if (rest.startsWith("{{{")) {
                const end = src.indexOf("}}}", i + 3);
                if (end != -1) {
                    flush();
                    nodes.push({ t: "raw", s: `<code>${escapeText(escapeHtml(src.substring(i + 3, end)))}</code>` });
                    i = end + 3;
                    continue;
                }
            }
            const scriptMatch = /^<(script|style)\b/i.exec(rest);
            if (scriptMatch) {
                const closeTag = `</${scriptMatch[1].toLowerCase()}>`;
                const end = src.toLowerCase().indexOf(closeTag, i);
                const stop = end == -1 ? src.length : end + closeTag.length;
                flush();
                nodes.push({ t: "comment", text: src.substring(i, stop), reason: `A <${scriptMatch[1]}> in a passage isn't run by Squiffy. Move it to the story's JavaScript or CSS file.` });
                i = stop;
                continue;
            }
            const image = /^\[[<>]?img\[(?:([^|\]]*)\|)?([^\]]*)\](?:\[([^\]]*)\])?\]/i.exec(rest);
            if (image) {
                flush();
                nodes.push({ t: "image", raw: image[0], title: image[1], src: image[2], link: image[3] });
                i += image[0].length;
                continue;
            }
            const link = /^\[\[((?:[^\]]|\](?!\]|\[))*)\](?:\[((?:[^\]]|\](?!\]))*)\])?\]/.exec(rest);
            if (link) {
                flush();
                nodes.push(parseLink(link[1], link[0], link[2]));
                i += link[0].length;
                continue;
            }
            const variable = /^(?:\$[A-Za-z_]|_[A-Za-z])\w*(?:\.[A-Za-z_$][\w$]*|\[(?:[^\]\n]+)\])*/.exec(rest);
            if (variable && (rest[0] == "$" || !/\w/.test(src[i - 1] ?? "")) && !/\w/.test(src[i - 1] ?? "")) {
                flush();
                nodes.push({ t: "var", raw: variable[0] });
                i += variable[0].length;
                continue;
            }
            text += src[i];
            i++;
        }
        flush();
        return { nodes, end: i };
    }
}

// Reads <<name args>> at start, or null if it isn't a macro
function readMacro(src: string, start: number): { name: string, args: string, raw: string, end: number } | null {
    const head = /^<<(\/?[A-Za-z][\w-]*|=|-|end\s+\w+)/.exec(src.substring(start, start + 100));
    if (!head) return null;
    let i = start + head[0].length;
    while (i < src.length) {
        const c = src[i];
        if (c == "\"" || c == "'" || c == "`") {
            const end = skipString(src, i);
            if (end == -1) return null;
            i = end;
            continue;
        }
        if (src.startsWith("[[", i)) {
            const end = src.indexOf("]]", i);
            if (end == -1) return null;
            i = end + 2;
            continue;
        }
        if (src.startsWith("/*", i)) {
            const end = src.indexOf("*/", i + 2);
            if (end == -1) return null;
            i = end + 2;
            continue;
        }
        if (src.startsWith(">>", i)) {
            const name = head[1] == "=" || head[1] == "-" ? "print" : head[1].replace(/\s+/g, "");
            return { name: name.toLowerCase(), args: src.substring(start + head[0].length, i).trim(), raw: src.substring(start, i + 2), end: i + 2 };
        }
        i++;
    }
    return null;
}

function parseLink(inner: string, raw: string, setter?: string): Node {
    let text: string;
    let target: string;
    const bar = inner.lastIndexOf("|");
    const arrow = inner.lastIndexOf("->");
    const back = inner.indexOf("<-");
    if (bar != -1) {
        text = inner.substring(0, bar);
        target = inner.substring(bar + 1);
    }
    else if (arrow != -1) {
        text = inner.substring(0, arrow);
        target = inner.substring(arrow + 2);
    }
    else if (back != -1) {
        target = inner.substring(0, back);
        text = inner.substring(back + 2);
    }
    else {
        text = target = inner;
    }
    return { t: "link", raw, text, target: target.trim(), ...(setter === undefined ? {} : { setter }) };
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---- Expressions ----

interface Token {
    type: "str" | "num" | "var" | "temp" | "ident" | "op" | "punct";
    text: string;
    value?: string | number;
}

const symbols = [
    "===", "!==", "**", "==", "!=", ">=", "<=", "&&", "||", "+=", "-=", "*=", "/=", "%=", "++", "--", "=>",
    "+", "-", "*", "/", "%", ">", "<", "=", "!", "?", ":", "(", ")", "[", "]", "{", "}", ",", ".", ";", "&", "|",
];
const wordOperators: Record<string, string> = {
    to: "=", eq: "==", neq: "!=", is: "===", isnot: "!==", gt: ">", gte: ">=", lt: "<", lte: "<=",
    and: "&&", or: "||", not: "!", def: "def", ndef: "ndef", typeof: "typeof", new: "new", instanceof: "instanceof",
};

function tokenize(s: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    while (i < s.length) {
        const c = s[i];
        if (/\s/.test(c)) {
            i++;
            continue;
        }
        if (c == "\"" || c == "'") {
            const end = skipString(s, i);
            if (end == -1) throw new Unconvertible("an expression with a string that isn't closed");
            tokens.push({ type: "str", text: s.substring(i, end), value: unescapeString(s.substring(i, end)) });
            i = end;
            continue;
        }
        if (s.startsWith("/*", i)) {
            const end = s.indexOf("*/", i + 2);
            i = end == -1 ? s.length : end + 2;
            continue;
        }
        if (c == "`") throw new Unconvertible("a JavaScript template literal");
        const num = /^(\d+(?:\.\d+)?|\.\d+)(ms|s)?(?![\w])/i.exec(s.substring(i));
        if (num) {
            let value = parseFloat(num[1]);
            if (num[2]?.toLowerCase() == "s") value *= 1000;
            tokens.push({ type: "num", text: num[0], value });
            i += num[0].length;
            continue;
        }
        const variable = /^([$_])([A-Za-z_]\w*)/.exec(s.substring(i));
        if (variable && (variable[1] == "$" || !/\w/.test(s[i - 1] ?? ""))) {
            tokens.push({ type: variable[1] == "$" ? "var" : "temp", text: variable[0], value: variable[2] });
            i += variable[0].length;
            continue;
        }
        const word = /^[A-Za-z_$][\w$]*/.exec(s.substring(i));
        if (word) {
            const op = wordOperators[word[0]];
            tokens.push(op ? { type: "op", text: op } : { type: "ident", text: word[0] });
            i += word[0].length;
            continue;
        }
        const symbol = symbols.find(o => s.startsWith(o, i));
        if (symbol) {
            // & and | on true and false work as && and ||, and are usually a typo for them
            const text = symbol == "&" ? "&&" : symbol == "|" ? "||" : symbol;
            tokens.push({ type: "(),[]{}.;:?".includes(symbol) ? "punct" : "op", text });
            i += symbol.length;
            continue;
        }
        throw new Unconvertible(`an expression Squiffy can't read ("${s.substring(i, i + 10)}")`);
    }
    return tokens;
}

// A JavaScript value, before it's known what it's used for: a Squiffy expression, or a function
// or object SugarCube provides
type Value =
    | { v: "expr", e: Expr }
    // A variable with a property or method, e.g. $inventory.includes
    | { v: "member", object: Value, property: string }
    | { v: "global", name: string }
    // An object literal, { key: value }, which can only be assigned to a variable
    | { v: "object", entries: [string, Value][] };

export class SugarCubeExpressions {
    constructor(readonly ctx: PassageContext) {}

    attribute(name: string, temp: boolean): string {
        return this.ctx.story.attribute(name, temp);
    }

    variable(name: string, temp: boolean): Expr {
        // Inside a container widget, the text its call wraps (#450)
        if (temp && name == "contents" && this.inContainerWidget) return { k: "call", fn: "content", args: [] };
        return this.ctx.story.variable(name, temp);
    }

    // Whether a container widget's body is being converted
    inContainerWidget = false;

    parse(source: string): Expr {
        const tokens = new Tokens(tokenize(source));
        const e = new ExpressionParser(this, tokens).expression();
        if (!tokens.done) throw new Unconvertible(`an expression Squiffy can't read (at "${tokens.peek()!.text}")`);
        return e;
    }

    // Statements, as in <<set>> and <<run>>: assignments and changes to arrays
    statements(source: string): Statement[] {
        const tokens = new Tokens(tokenize(source));
        const parser = new ExpressionParser(this, tokens);
        const result: Statement[] = [];
        while (!tokens.done) {
            result.push(...parser.statement());
            if (!tokens.accept(",") && !tokens.accept(";")) break;
        }
        if (!tokens.done) throw new Unconvertible(`a statement Squiffy can't read (at "${tokens.peek()!.text}")`);
        return result;
    }

    // A value used as a passage name, for <<goto>>, <<include>> and links
    passageName(source: string): { name: string } | { expr: Expr } {
        const link = /^\[\[(.*)\]\]$/.exec(source.trim());
        if (link) {
            const node = parseLink(link[1], source) as { target: string };
            return { name: node.target };
        }
        // A bare word that isn't a variable is a passage name, e.g. <<goto Library>>
        if (/^[^"'`$_[(\s][^\s]*$/.test(source.trim())) {
            try {
                const e = this.parse(source);
                if (e.k == "str") return { name: e.v };
            }
            catch {
                // Treated as a name
            }
            return { name: source.trim() };
        }
        const e = this.parse(source);
        if (e.k == "str") return { name: e.v };
        return { expr: e };
    }
}

export type Statement =
    | { kind: "set" | "inc" | "dec", name: string, value: Expr, op?: "*=" | "/=" }
    | { kind: "append" | "remove", name: string, value: Expr }
    | { kind: "unset", name: string };

// A comparison, where x.indexOf(y) compared with -1 or 0 to see whether y is there is x contains y
// (#446). Anything else .indexOf() is for can't be converted: see print().
function indexOfCheck(left: Expr, op: BinaryOp, right: Expr): Expr {
    if (left.k != "call" || left.fn != "__indexof") return { k: "bin", op, l: left, r: right };
    const n = right.k == "num" ? right.v : right.k == "neg" && right.e.k == "num" ? -right.e.v : null;
    const contains: Expr = { k: "bin", op: "contains", l: left.args[0], r: left.args[1] };
    if ((n == -1 && (op == "!=" || op == ">")) || (n == 0 && op == ">=")) return contains;
    if ((n == -1 && (op == "=" || op == "<=")) || (n == 0 && op == "<")) return { k: "not", e: contains };
    return { k: "bin", op, l: left, r: right };
}

class ExpressionParser {
    constructor(private readonly s: SugarCubeExpressions, private readonly tokens: Tokens<Token>) {}

    // Including test ? a : b (#446), which is right-associative
    expression(): Expr {
        const test = this.or();
        if (!this.tokens.accept("?")) return test;
        const then = this.expression();
        this.tokens.expect(":");
        return { k: "cond", test, then, otherwise: this.expression() };
    }

    statement(): Statement[] {
        const target = this.postfixValue();
        if (target.v == "expr" && target.e.k == "loop") throw new Unconvertible("changing a loop's variable inside the loop");
        return [this.singleStatement(target, this.tokens.peek())];
    }

    // An object literal, or an ordinary expression
    private postfixOrObject(): Value {
        if (this.tokens.is("{")) return this.primary();
        return { v: "expr", e: this.expression() };
    }

    private singleStatement(target: Value, t: Token | undefined): Statement {
        // An attribute, or a value inside one, such as hero.hp or inventory[i].name (#442)
        const name = target.v == "expr" ? targetName(target.e) : null;
        if (name !== null) {
            if (t?.text == "++" || t?.text == "--") {
                this.tokens.next();
                return { kind: t.text == "++" ? "inc" : "dec", name, value: { k: "num", v: 1 } };
            }
            if (t && ["=", "+=", "-=", "*=", "/="].includes(t.text)) {
                this.tokens.next();
                const value = this.expression();
                switch (t.text) {
                    case "+=":
                        if (value.k == "array") return this.arrayChange("append", name, value);
                        return { kind: "inc", name, value };
                    case "-=": return { kind: "dec", name, value };
                    case "*=": case "/=": return { kind: "set", name, value, op: t.text };
                }
                // $x to $x + 1
                if (value.k == "bin" && (value.op == "+" || value.op == "-") && targetName(value.l) == name) {
                    if (value.r.k == "array") return this.arrayChange(value.op == "+" ? "append" : "remove", name, value.r);
                    if (value.r.k == "num" || value.op == "-") return { kind: value.op == "+" ? "inc" : "dec", name, value: value.r };
                }
                return { kind: "set", name, value };
            }
            throw new Unconvertible("a statement that isn't an assignment");
        }
        if (target.v == "expr" && target.e.k == "call" && target.e.fn == "__statement") {
            const [kind, name, value] = target.e.args as [{ k: "str", v: string }, { k: "str", v: string }, Expr];
            return { kind: kind.v as "append" | "remove", name: name.v, value };
        }
        throw new Unconvertible("a statement Squiffy can't convert");
    }

    private arrayChange(kind: "append" | "remove", name: string, array: Extract<Expr, { k: "array" }>): Statement {
        if (array.items.length != 1) throw new Unconvertible("adding or removing more than one item at once");
        return { kind, name, value: array.items[0] };
    }

    private or(): Expr {
        let left = this.and();
        while (this.tokens.is("||")) {
            this.tokens.next();
            left = { k: "bin", op: "or", l: left, r: this.and() };
        }
        return left;
    }

    private and(): Expr {
        let left = this.equality();
        while (this.tokens.is("&&")) {
            this.tokens.next();
            left = { k: "bin", op: "and", l: left, r: this.equality() };
        }
        return left;
    }

    private equality(): Expr {
        let left = this.relational();
        for (;;) {
            const t = this.tokens.peek()?.text;
            if (t == "==" || t == "===") {
                this.tokens.next();
                left = indexOfCheck(left, "=", this.relational());
            }
            else if (t == "!=" || t == "!==") {
                this.tokens.next();
                left = indexOfCheck(left, "!=", this.relational());
            }
            else if (t == "=") {
                throw new Unconvertible("an assignment (=) in a condition");
            }
            else {
                return left;
            }
        }
    }

    private relational(): Expr {
        let left = this.additive();
        for (;;) {
            const t = this.tokens.peek()?.text;
            if (t == ">" || t == "<" || t == ">=" || t == "<=") {
                this.tokens.next();
                left = indexOfCheck(left, t, this.additive());
            }
            else {
                return left;
            }
        }
    }

    private additive(): Expr {
        let left = this.multiplicative();
        while (this.tokens.is("+") || this.tokens.is("-")) {
            const op = this.tokens.next().text as BinaryOp;
            left = { k: "bin", op, l: left, r: this.multiplicative() };
        }
        return left;
    }

    private multiplicative(): Expr {
        let left = this.unary();
        while (this.tokens.is("*") || this.tokens.is("/") || this.tokens.is("%")) {
            const op = this.tokens.next().text as BinaryOp;
            left = { k: "bin", op, l: left, r: this.unary() };
        }
        return left;
    }

    private unary(): Expr {
        const t = this.tokens.peek()?.text;
        if (t == "!") {
            this.tokens.next();
            return { k: "not", e: this.unary() };
        }
        if (t == "-") {
            this.tokens.next();
            const e = this.unary();
            return e.k == "num" ? { k: "num", v: -e.v } : { k: "neg", e };
        }
        if (t == "+") {
            this.tokens.next();
            return this.unary();
        }
        if (t == "def" || t == "ndef") {
            this.tokens.next();
            const e = this.unary();
            return t == "def" ? { k: "bin", op: "!=", l: e, r: { k: "null" } } : { k: "bin", op: "=", l: e, r: { k: "null" } };
        }
        if (t == "typeof" || t == "new") throw new Unconvertible(`"${t}"`);
        return this.postfix();
    }

    private postfix(): Expr {
        return this.toExpr(this.postfixValue());
    }

    private toExpr(v: Value): Expr {
        if (v.v == "expr") return v.e;
        if (v.v == "object") return { k: "object", entries: v.entries.map(([key, value]) => [key, this.toExpr(value)]) };
        if (v.v == "member") {
            // A list's or text's length (#446)
            if (v.property == "length") return lengthOf(this.toExpr(v.object));
            throw new Unconvertible(`properties of variables (.${v.property})`);
        }
        throw new Unconvertible(`"${v.name}"`);
    }

    // The first argument of contains and length: the attribute's name, or an array
    private collection(v: Value): Expr {
        if (v.v == "expr" && v.e.k == "var") return { k: "str", v: v.e.name };
        // A list inside an object, e.g. $hero.items
        if (v.v == "expr" && (v.e.k == "array" || v.e.k == "member" || (v.e.k == "loop" && v.e.kind == "item"))) return v.e;
        throw new Unconvertible("an array method on something other than a variable");
    }

    private postfixValue(): Value {
        let value = this.primary();
        for (;;) {
            if (this.tokens.accept(".")) {
                const property = this.tokens.next();
                if (property.type != "ident") throw new Unconvertible("an expression Squiffy can't read");
                // A value inside an object: $player.hp is player.hp (#442)
                if (value.v == "expr" && value.e.k != "array" && value.e.k != "call" && !this.tokens.is("(") && property.text != "length") {
                    value = { v: "expr", e: memberOf(value.e, { k: "str", v: property.text }) };
                    continue;
                }
                value = this.member(value, property.text);
            }
            else if (this.tokens.is("[")) {
                this.tokens.next();
                const index = this.expression();
                this.tokens.expect("]");
                if (value.v == "expr" && value.e.k == "var" && index.k == "loop" && index.kind == "index" && index.array == value.e.name) {
                    value = { v: "expr", e: { k: "loop", kind: "item", up: index.up } };
                    continue;
                }
                // A value inside an object or list, e.g. $inventory[_i] or $player["hp"] (#442)
                if (value.v == "expr") {
                    value = { v: "expr", e: memberOf(value.e, index) };
                    continue;
                }
                throw new Unconvertible("array indexes and object properties ([...]) of something other than a value");
            }
            else if (this.tokens.is("(")) {
                this.tokens.next();
                const args: Expr[] = [];
                if (!this.tokens.accept(")")) {
                    do args.push(this.expression());
                    while (this.tokens.accept(","));
                    this.tokens.expect(")");
                }
                value = { v: "expr", e: this.call(value, args) };
            }
            else {
                return value;
            }
        }
    }

    // State.variables.x is $x, and State.temporary.x is _x
    private member(object: Value, property: string): Value {
        if (object.v == "global") {
            const path = `${object.name}.${property}`;
            if (path == "State.variables" || path == "State.temporary" || path == "SugarCube.State") return { v: "global", name: path };
            if (object.name == "State.variables" || object.name == "variables") return { v: "expr", e: { k: "var", name: this.s.attribute(property, false) } };
            if (object.name == "State.temporary" || object.name == "temporary") return { v: "expr", e: this.s.variable(property, true) };
            return { v: "global", name: path };
        }
        return { v: "member", object, property };
    }

    private call(callee: Value, args: Expr[]): Expr {
        const str = (e: Expr | undefined, what: string): string => {
            if (e?.k == "str") return e.v;
            throw new Unconvertible(`${what} with something other than a passage name`);
        };
        if (callee.v == "global") {
            switch (callee.name) {
                case "visited":
                case "hasVisited": {
                    if (args.length == 0) return { k: "call", fn: "visits", args: [{ k: "str", v: this.s.ctx.section }] };
                    if (args.length > 1) throw new Unconvertible(`${callee.name}() with more than one passage`);
                    const section = this.s.ctx.story.sectionForUnknown(str(args[0], `${callee.name}()`));
                    return callee.name == "visited" ? { k: "call", fn: "visits", args: [{ k: "str", v: section }] } : { k: "call", fn: "seen", args: [{ k: "str", v: section }] };
                }
                case "turns":
                    return { k: "var", name: "turns" };
                case "random":
                    if (args.length == 1) return randomInteger({ k: "num", v: 0 }, args[0]);
                    return randomInteger(args[0], args[1]);
                case "either":
                    return { k: "call", fn: "random", args: [{ k: "array", items: args }] };
                case "passage":
                    return { k: "str", v: this.s.ctx.passage.name };
                case "tags":
                    // Only as tags().includes("tag")
                    return { k: "call", fn: "__tags", args: [] };
                // Numbers (#446)
                case "Math.round":
                case "Math.floor":
                case "Math.ceil":
                case "Math.abs":
                    if (args.length != 1) throw new Unconvertible(`${callee.name}() with ${args.length ? "more than one value" : "no value"}`);
                    return { k: "call", fn: callee.name.substring(5), args };
                case "Math.min":
                case "Math.max":
                    if (!args.length) throw new Unconvertible(`${callee.name}() with no values`);
                    return { k: "call", fn: callee.name.substring(5), args };
                case "Number":
                case "String":
                case "parseInt":
                case "parseFloat":
                    if (args.length < 1) throw new Unconvertible(`${callee.name}()`);
                    return args[0];
            }
            throw new Unconvertible(`${callee.name}()`);
        }
        if (callee.v == "member" && callee.object.v == "expr" && callee.object.e.k == "call" && callee.object.e.fn == "__tags") {
            // tags().includes("x"): whether this is one of the passages tagged x
            if ((callee.property == "includes" || callee.property == "contains") && args[0]?.k == "str") {
                const tag = args[0].v;
                const sections = this.s.ctx.story.twine.passages
                    .filter(p => p.tags.includes(tag))
                    .map(p => this.s.ctx.story.sectionFor(p.name))
                    .filter((s): s is string => s !== undefined);
                return { k: "call", fn: "at", args: [{ k: "array", items: sections.map(s => ({ k: "str" as const, v: s })) }] };
            }
            throw new Unconvertible("tags()");
        }
        if (callee.v == "member") {
            const collection = (): Expr => this.collection(callee.object);
            const value = (): Expr => this.toExpr(callee.object);
            const noArguments = () => {
                if (args.length) throw new Unconvertible(`.${callee.property}() with a value`);
            };
            switch (callee.property) {
                // A list or text that has a value in it (#446)
                case "includes":
                case "contains":
                    if (args.length != 1) throw new Unconvertible(`.${callee.property}() with more than one value`);
                    return { k: "bin", op: "contains", l: value(), r: args[0] };
                // Only to check whether something is there, e.g. .indexOf(x) != -1: see indexOfCheck
                case "indexOf":
                    if (args.length != 1) throw new Unconvertible(`.${callee.property}() with more than one value`);
                    return { k: "call", fn: "__indexof", args: [value(), args[0]] };
                // Text (#446)
                case "toLowerCase":
                case "toLocaleLowerCase":
                    noArguments();
                    return { k: "call", fn: "lower", args: [value()] };
                case "toUpperCase":
                case "toLocaleUpperCase":
                    noArguments();
                    return { k: "call", fn: "upper", args: [value()] };
                case "toUpperFirst":
                case "toLocaleUpperFirst":
                    noArguments();
                    return { k: "call", fn: "capitalise", args: [value()] };
                case "random":
                    if (callee.object.v == "expr") return { k: "call", fn: "random", args: [callee.object.e] };
                    break;
                // Lists (#447). JavaScript's .join() puts a comma with no space between the items.
                case "join":
                    if (args.length > 1) throw new Unconvertible(".join() with more than one value");
                    return { k: "call", fn: "join", args: [value(), args[0] ?? { k: "str", v: "," }] };
                case "sort":
                case "shuffle":
                    // Squiffy's give back a new list, and leave the attribute as it was
                    if (args.length) throw new Unconvertible(`.${callee.property}() with a function to compare the items`);
                    return { k: "call", fn: callee.property, args: [value()] };
                case "slice":
                    if (args.length > 2) throw new Unconvertible(".slice() with more than two values");
                    return { k: "call", fn: "slice", args: [value(), args[0] ?? { k: "num", v: 0 }, ...args.slice(1)] };
                case "first":
                case "last":
                    noArguments();
                    return { k: "call", fn: callee.property, args: [value()] };
                case "count":
                    if (args.length != 1) throw new Unconvertible(".count() with a position to start from");
                    return { k: "call", fn: "count", args: [value(), args[0]] };
                case "push":
                case "pushUnique":
                case "delete": {
                    const target = collection();
                    if (target.k != "str" || args.length != 1) throw new Unconvertible(`.${callee.property}() with more than one value`);
                    return { k: "call", fn: "__statement", args: [{ k: "str", v: callee.property == "delete" ? "remove" : "append" }, target, args[0]] };
                }
            }
            throw new Unconvertible(`the .${callee.property}() method`);
        }
        throw new Unconvertible("calling something that isn't a function");
    }

    private primary(): Value {
        const t = this.tokens.next();
        switch (t.type) {
            case "str": return { v: "expr", e: { k: "str", v: t.value as string } };
            case "num": return { v: "expr", e: { k: "num", v: t.value as number } };
            case "var": return { v: "expr", e: this.s.variable(t.value as string, false) };
            case "temp": return { v: "expr", e: this.s.variable(t.value as string, true) };
            case "ident":
                switch (t.text) {
                    case "true": return { v: "expr", e: { k: "bool", v: true } };
                    case "false": return { v: "expr", e: { k: "bool", v: false } };
                    case "null": case "undefined": return { v: "expr", e: { k: "null" } };
                }
                return { v: "global", name: t.text };
            case "punct":
                if (t.text == "(") {
                    const e = this.expression();
                    this.tokens.expect(")");
                    return { v: "expr", e };
                }
                if (t.text == "[") {
                    const items: Expr[] = [];
                    if (!this.tokens.accept("]")) {
                        do items.push(this.expression());
                        while (this.tokens.accept(","));
                        this.tokens.expect("]");
                    }
                    return { v: "expr", e: { k: "array", items } };
                }
                if (t.text == "{") {
                    const entries: [string, Value][] = [];
                    if (!this.tokens.accept("}")) {
                        do {
                            if (this.tokens.is("}")) break;
                            const key = this.tokens.next();
                            if (key.type != "ident" && key.type != "str" && key.type != "num") throw new Unconvertible("a JavaScript object Squiffy can't read");
                            if (!/^[A-Za-z_]\w*$/.test(String(key.value ?? key.text))) throw new Unconvertible("a JavaScript object with keys that aren't words");
                            this.tokens.expect(":");
                            entries.push([String(key.value ?? key.text), this.postfixOrObject()]);
                        }
                        while (this.tokens.accept(","));
                        this.tokens.expect("}");
                    }
                    return { v: "object", entries };
                }
                break;
        }
        throw new Unconvertible(`an expression Squiffy can't read (at "${t.text}")`);
    }
}

// SugarCube macro arguments: separated by spaces, each a string, number, $variable, [[link]],
// `expression` or bare word
function splitMacroArgs(args: string): string[] {
    const result: string[] = [];
    let i = 0;
    while (i < args.length) {
        const c = args[i];
        if (/\s/.test(c)) {
            i++;
            continue;
        }
        let end: number;
        if (c == "\"" || c == "'" || c == "`") {
            end = skipString(args, i);
            if (end == -1) end = args.length;
        }
        else if (args.startsWith("[[", i)) {
            end = args.indexOf("]]", i);
            end = end == -1 ? args.length : end + 2;
        }
        else {
            end = i;
            while (end < args.length && !/\s/.test(args[end])) end++;
        }
        result.push(args.substring(i, end));
        i = end;
    }
    return result;
}

// ---- Writing Squiffy ----

interface EmitState {
    leading: boolean;
    directives: string[];
    // Inside <<nobr>> or a nobr passage: line breaks are spaces
    nobr: boolean;
}

class Writer {
    private readonly expr: SugarCubeExpressions;
    private open = new Set<string>();
    private atLineStart = true;
    // Widget name -> the section it's converted to
    private readonly widgets: Map<string, string>;
    // The widgets whose calls wrap text (#450)
    readonly containerWidgets: ReadonlySet<string>;
    // Element ids targeted by <<replace>> and friends, which become labels
    private readonly targets = new Map<string, string>();

    constructor(private readonly ctx: PassageContext) {
        this.expr = new SugarCubeExpressions(ctx);
        this.widgets = sugarCubeWidgets(ctx.story);
        this.containerWidgets = sugarCubeContainerWidgets(ctx.story);
    }

    // A widget passage: each <<widget>> in it, converted to a section
    widgetSections(nodes: Node[]): { section: string, converted: ConvertedPassage }[] {
        const result: { section: string, converted: ConvertedPassage }[] = [];
        for (const n of nodes) {
            if (n.t != "macro" || n.name != "widget") continue;
            const name = /^["']?([\w-]+)/.exec(n.args)?.[1]?.toLowerCase();
            const section = name ? this.widgets.get(name) : undefined;
            if (!section) continue;
            // An embedded section's directives don't run, so everything is a helper
            const state: EmitState = { leading: false, directives: [], nobr: false };
            this.open.clear();
            this.atLineStart = true;
            this.expr.inContainerWidget = this.containerWidgets.has(name!);
            let body: string;
            try {
                body = this.nodes(n.clauses?.[0]?.nodes ?? [], state);
            } finally {
                this.expr.inContainerWidget = false;
            }
            for (const tag of [...this.open].reverse()) body += `</${tag}>`;
            result.push({ section, converted: { directives: [], body } });
        }
        return result;
    }

    // A call to a widget embeds the widget's section, with its arguments as the parameter args, a
    // list, as _args is in SugarCube. A container widget's call wraps text, which the widget shows
    // as _contents (#450).
    private widgetCall(m: Macro, section: string, state: EmitState): string {
        const items = splitMacroArgs(m.args).map(a => {
            let value: Expr;
            try {
                value = /^[^"'`$_[(\-\d\s][^\s]*$/.test(a) && !["true", "false", "null"].includes(a) ? { k: "str", v: a } : this.expr.parse(a);
            }
            catch {
                value = { k: "str", v: a };
            }
            return value;
        });
        // With no arguments, an empty list, so that a widget that changes _args doesn't change
        // the story's attribute
        const params = items.length || sugarCubeWidgetsUsingArgs(this.ctx.story).has(m.name)
            ? ` ${this.expr.attribute("args", true)}=${print({ k: "array", items })}`
            : "";
        const name = print({ k: "str", v: section });
        if (m.clauses) return `{{#embed ${name}${params}}}${this.body(m, state)}{{/embed}}`;
        return `{{embed ${name}${params}}}`;
    }

    // Finds the ids that <<replace "#id">> and friends change, so they can be labels
    findTargets(source: string): string {
        for (const m of source.matchAll(/<<(?:replace|append|prepend|remove)\s+["']#([\w-]+)["']/g)) {
            if (!this.targets.has(m[1])) this.targets.set(m[1], this.ctx.newLabel(m[1]));
        }
        let result = source;
        for (const [id, label] of this.targets) {
            const span = new RegExp(`<(span|div)\\b[^>]*\\bid=["']${id}["'][^>]*>([^<]*)</\\1>`, "g");
            result = result.replace(span, (_m, _tag, inner: string) => `\uE000label ${label}\uE001${inner}\uE000/label\uE001`);
        }
        return result;
    }

    passage(nodes: Node[], nobr: boolean): ConvertedPassage {
        const state: EmitState = { leading: true, directives: [], nobr };
        let body = this.nodes(nodes, state);
        for (const tag of [...this.open].reverse()) body += `</${tag}>`;
        body = body.replace(/\uE000label ([\w-]+)\uE001/g, "{{#label \"$1\"}}").replace(/\uE000\/label\uE001/g, "{{/label}}");
        return { directives: state.directives, body };
    }

    nodes(nodes: Node[], state: EmitState): string {
        let out = "";
        for (const node of nodes) {
            const written = this.node(node, state);
            if (node.t != "text" && written) this.atLineStart = false;
            out += written;
        }
        return out;
    }

    private node(node: Node, state: EmitState): string {
        switch (node.t) {
            case "text":
                if (node.s.trim()) state.leading = false;
                return this.text(node.s, state);
            case "raw":
                return node.s;
            case "comment":
                return this.ctx.unconvertible(node.text, node.reason);
            case "var":
                state.leading = false;
                try {
                    return display(this.expr.parse(node.raw));
                }
                catch (e) {
                    if (!(e instanceof Unconvertible)) throw e;
                    return this.ctx.unconvertible(node.raw, `This couldn't be converted: ${e.message}.`);
                }
            case "link":
                state.leading = false;
                return this.link(node);
            case "image": {
                state.leading = false;
                const alt = node.title ? ` alt="${escapeAttribute(node.title)}"` : "";
                if (/^data:|\.\w{2,4}$|^https?:/i.test(node.src) === false) {
                    this.ctx.approximate(node.raw, "Images stored in the story (Twine.image passages) aren't converted. Put the image in a file next to the story.");
                }
                const img = `<img src="${escapeAttribute(node.src)}"${alt}>`;
                if (!node.link) return img;
                const target = this.ctx.story.sectionFor(node.link.trim());
                return target === undefined ? img : `{{section ${print({ k: "str", v: target })} text=${print({ k: "str", v: img })}}}`;
            }
            case "macro":
                return this.macro(node, state);
        }
    }

    private link(node: Extract<Node, { t: "link" }>): string {
        const text = this.inlineText(node.text);
        if (isUrl(node.target)) return urlLink(text, node.target);
        let setters: string[] = [];
        if (node.setter !== undefined) {
            try {
                setters = this.setters(node.setter);
            }
            catch (e) {
                if (!(e instanceof Unconvertible)) throw e;
                return this.ctx.unconvertible(node.raw, `This link's setter couldn't be converted: ${e.message}.`);
            }
        }
        if (/^[$_][A-Za-z]/.test(node.target) || /\(/.test(node.target) && !this.ctx.story.sectionFor(node.target)) {
            try {
                const target = this.expr.parse(node.target);
                return dynamicSectionLink(node.text, target, setters);
            }
            catch {
                // Treated as a passage name
            }
        }
        const target = this.ctx.story.sectionFor(node.target);
        if (target === undefined) {
            this.ctx.approximate(node.raw, `There's no passage called "${node.target}".`);
            return sectionLink(text, this.ctx.story.sectionForUnknown(node.target), setters);
        }
        return sectionLink(text, target, setters);
    }

    // Converts a link's setter ([[text|passage][$x to 1]]) to Squiffy setters
    private setters(source: string, inLink = true): string[] {
        return this.expr.statements(source).map(s => {
            switch (s.kind) {
                case "set": return setter(s.name, s.op ?? "=", s.value, inLink);
                case "inc": return setter(s.name, "+=", s.value, inLink);
                case "dec": return setter(s.name, "-=", s.value, inLink);
                default: throw new Unconvertible("changing an array in a link");
            }
        });
    }

    private inlineText(text: string): string {
        const nodes = new Parser(text, this.containerWidgets).parse(0).nodes;
        return this.nodes(nodes, { leading: false, directives: [], nobr: true }).replace(/\n/g, " ");
    }

    private text(s: string, state: EmitState): string {
        let out = "";
        for (let i = 0; i < s.length;) {
            const rest = s.substring(i, i + 200);
            if (this.atLineStart) {
                this.atLineStart = false;
                const lineEnd = rest.indexOf("\n");
                const line = lineEnd == -1 ? rest : rest.substring(0, lineEnd);
                const heading = /^(!{1,6})\s*/.exec(line);
                if (heading) {
                    out += "#".repeat(heading[1].length) + " ";
                    i += heading[0].length;
                    continue;
                }
                const bullet = /^([*#]+)\s+/.exec(line);
                if (bullet) {
                    out += "  ".repeat(bullet[1].length - 1) + (bullet[1].endsWith("#") ? "1. " : "* ");
                    i += bullet[0].length;
                    continue;
                }
                if (/^\s*-{4,}\s*$/.test(line)) {
                    out += "<hr>";
                    i += line.length;
                    continue;
                }
                const number = /^(\s*\d+)\.(\s)/.exec(line);
                if (number) {
                    // Not a Markdown list
                    out += number[1] + "&#46;" + number[2];
                    i += number[0].length;
                    continue;
                }
            }
            const c = s[i];
            if (c == "\n") {
                out += state.nobr ? " " : "\n";
                this.atLineStart = !state.nobr;
                i++;
                continue;
            }
            if (c == "\\" && s[i + 1] == "\n") {
                // Joins the line to the next
                i += 2;
                continue;
            }
            const style = /^@@([^;@]*);/.exec(rest);
            if (style) {
                const end = s.indexOf("@@", i + style[0].length);
                if (end != -1) {
                    out += `<span${cssAttributes(style[1])}>`;
                    // The text in it is converted with the rest, and @@ closes the span
                    this.open.add("span@@");
                    i += style[0].length;
                    continue;
                }
            }
            if (rest.startsWith("@@") && this.open.has("span@@")) {
                this.open.delete("span@@");
                out += "</span>";
                i += 2;
                continue;
            }
            const toggle = this.toggle(s, i);
            if (toggle) {
                out += toggle.text;
                i += toggle.length;
                continue;
            }
            if (c == "<") {
                const tag = /^<\/?[A-Za-z][^<>]*>/.exec(rest);
                if (tag) {
                    out += this.htmlTag(tag[0]);
                    i += tag[0].length;
                    continue;
                }
            }
            out += escapeProse(s, i);
            i++;
        }
        return out;
    }

    // An HTML tag, with SugarCube's data-passage links turned into Squiffy links
    private htmlTag(tag: string): string {
        if (/\s@[\w-]+=/.test(tag)) {
            this.ctx.approximate(tag, "SugarCube's attribute directives (@attribute=\"...\") aren't converted.");
        }
        return tag.replace(/\{\{/g, "&#123;{").replace(/\[/g, "&#91;").replace(/\]/g, "&#93;");
    }

    private toggle(s: string, i: number): { text: string, length: number } | null {
        const marks: [string, string][] = [["''", "b"], ["//", "i"], ["__", "u"], ["==", "s"], ["^^", "sup"], ["~~", "sub"]];
        for (const [mark, tag] of marks) {
            if (!s.startsWith(mark, i)) continue;
            if (mark == "//" && s[i - 1] == ":") return null;
            if (this.open.has(tag)) {
                this.open.delete(tag);
                return { text: `</${tag}>`, length: mark.length };
            }
            const end = s.indexOf(mark, i + mark.length);
            if (end == -1) return null;
            this.open.add(tag);
            return { text: `<${tag}>`, length: mark.length };
        }
        return null;
    }

    // ---- Macros ----

    // <<audio "tracks" actions>>
    private audio(m: Macro, args: string[]): string {
        const tracks = args[0] && /^["']/.test(args[0]) ? unescapeString(args[0]) : null;
        if (tracks === null) throw new Unconvertible("<<audio>> with tracks that aren't fixed");
        const action: AudioAction = { play: false, stop: false, loop: false };
        const num = (i: number) => {
            const raw = args[i] && /^["']/.test(args[i]) ? unescapeString(args[i]) : args[i];
            const n = Number(raw);
            if (raw === undefined || raw.trim() === "" || isNaN(n)) throw new Unconvertible(`<<audio>> with "${args[i - 1]}" and a value that isn't a fixed number`);
            return n;
        };
        for (let i = 1; i < args.length; i++) {
            const word = args[i].toLowerCase();
            switch (word) {
                case "play":
                case "fadein":
                    action.play = true;
                    break;
                case "stop":
                case "fadeout":
                    action.stop = true;
                    break;
                case "loop":
                    action.loop = true;
                    break;
                case "unloop":
                    break;
                case "volume":
                    action.volume = num(++i);
                    break;
                case "fadeoverto":
                case "fadeto": {
                    if (word == "fadeoverto") action.fade = num(++i);
                    const level = num(++i);
                    if (level > 0) action.play = true;
                    else action.stop = true;
                    break;
                }
                case "pause":
                    throw new Unconvertible("pausing a track");
                case "mute":
                case "unmute":
                    throw new Unconvertible("muting a track");
                case "time":
                    throw new Unconvertible("playing a track from part of the way through");
                case "goto":
                    throw new Unconvertible("<<audio>> with goto");
                default:
                    throw new Unconvertible(`<<audio>> with "${args[i]}"`);
            }
        }
        const audio = sugarCubeAudio(this.ctx.story);
        const ids = tracks.split(/\s+/).filter(t => t);
        const results = new Set<string>();
        for (const id of ids) {
            if (id.startsWith(":")) {
                // A group: only stopping it can be converted. Looped tracks are music.
                if (!action.stop || !/^:(all|playing|looped)$/.test(id)) throw new Unconvertible("audio groups");
                if (id != ":looped") results.add("{{stopsounds}}");
                results.add(`{{stopmusic${action.fade === undefined ? "" : ` fade=${action.fade}`}}}`);
                continue;
            }
            results.add(audioHelper(this.ctx, m.raw, audio, id, action));
        }
        return [...results].join("");
    }

    private macro(m: Macro, state: EmitState): string {
        try {
            return this.macroOrThrow(m, state);
        }
        catch (e) {
            if (!(e instanceof Unconvertible)) throw e;
            state.leading = false;
            return this.ctx.unconvertible(m.raw, `This couldn't be converted: ${e.message}.`);
        }
    }

    private body(m: Macro, state: EmitState, clause = 0): string {
        return this.nodes(m.clauses?.[clause]?.nodes ?? [], { ...state, leading: false });
    }

    private macroOrThrow(m: Macro, state: EmitState): string {
        const args = splitMacroArgs(m.args);
        switch (m.name) {
            case "set":
                return this.set(this.expr.statements(m.args), state);
            case "unset": {
                const statements = m.args.split(",").map(a => {
                    const match = /^\s*([$_])([A-Za-z_]\w*)\s*$/.exec(a);
                    if (!match) throw new Unconvertible("<<unset>> of something other than a variable");
                    return { kind: "unset" as const, name: this.expr.attribute(match[2], match[1] == "_") };
                });
                return this.set(statements, state);
            }
            case "run": {
                return this.set(this.expr.statements(m.args), state);
            }
            case "print":
                state.leading = false;
                return display(this.expr.parse(m.args));
            case "if": {
                state.leading = false;
                const clauses = m.clauses!;
                let out = "";
                clauses.forEach((c, n) => {
                    const cond = c.name == "else" ? null : this.expr.parse(c.args);
                    out += n == 0 ? `{{#if ${print(cond!)}}}` : cond ? `{{else if ${print(cond)}}}` : "{{else}}";
                    out += this.nodes(c.nodes, { ...state, leading: false });
                });
                return out + "{{/if}}";
            }
            case "switch": {
                state.leading = false;
                const subject = this.expr.parse(m.args);
                let out = "";
                let first = true;
                for (const c of m.clauses!.slice(1)) {
                    let cond: Expr | null = null;
                    if (c.name == "case") {
                        const values = splitMacroArgs(c.args).map(a => this.expr.parse(a));
                        cond = values.map((v): Expr => ({ k: "bin", op: "=", l: subject, r: v }))
                            .reduce((a, b) => ({ k: "bin", op: "or", l: a, r: b }));
                    }
                    out += first ? (cond ? `{{#if ${print(cond)}}}` : "{{#if true}}") : cond ? `{{else if ${print(cond)}}}` : "{{else}}";
                    first = false;
                    out += this.nodes(c.nodes, { ...state, leading: false });
                }
                return first ? "" : out + "{{/if}}";
            }
            case "include":
            case "display": {
                state.leading = false;
                const target = this.expr.passageName(args[0] ?? "");
                if ("name" in target) return `{{embed ${print({ k: "str", v: this.sectionName(target.name, m.raw) })}}}`;
                return `{{embed ${print(target.expr)}}}`;
            }
            case "goto":
                state.leading = false;
                return this.goto(args[0] ?? "", m.raw);
            case "link":
            case "button":
            case "click":
                state.leading = false;
                return this.linkMacro(m, args);
            case "linkreplace":
            case "linkappend":
            case "linkprepend": {
                state.leading = false;
                const text = this.linkText(args[0] ?? "");
                const content = this.body(m, state);
                const label = this.ctx.newLabel(text.plain);
                const replacement = m.name == "linkreplace" ? content : m.name == "linkappend" ? text.squiffy + content : content + text.squiffy;
                const passage = this.ctx.addPassage(text.plain, `{{#replace "${label}"}}${replacement}{{/replace}}`);
                return `{{#label "${label}"}}${passageLink(text.squiffy, passage)}{{/label}}`;
            }
            case "actions":
            case "choice": {
                state.leading = false;
                const links = args.map(a => {
                    const target = this.expr.passageName(a);
                    if (!("name" in target)) throw new Unconvertible(`<<${m.name}>> with a passage that isn't fixed`);
                    return sectionLink(escapeText(target.name), this.sectionName(target.name, m.raw));
                });
                return m.name == "actions" ? "\n" + links.map(l => `* ${l}`).join("\n") + "\n" : links.join(" ");
            }
            case "nobr":
                return this.nodes(m.clauses![0].nodes, { ...state, nobr: true });
            case "silently": {
                const content = this.nodes(m.clauses![0].nodes, state);
                // Only the helpers, which write nothing
                return (content.match(/\{\{(?:[^{}]|\{\{[^{}]*\}\})*\}\}/g) ?? []).join("");
            }
            case "capture":
            case "done":
            case "do":
                if (m.name == "done") this.ctx.approximate(m.raw, "<<done>> has been converted to its contents, which are shown straight away.");
                return this.nodes(m.clauses![0].nodes, state);
            case "timed": {
                state.leading = false;
                // Each <<next>> waits after the one before, for its own delay, or, with none, the
                // delay before it. A delay can be worked out as the story runs (#451).
                let delay: Expr = { k: "num", v: 0 };
                // The time since the text was shown, while every delay is a number
                let total: number | null = 0;
                let out = "";
                m.clauses!.forEach((c, i) => {
                    const d = splitMacroArgs(c.args)[0];
                    if (d) delay = this.expr.parse(d);
                    total = total !== null && delay.k == "num" ? total + delay.v : null;
                    const goto = this.gotoOnly(c.nodes);
                    if (goto) {
                        // {{goto}} waits from when the text is shown, so it needs the delays added up
                        if (i > 0 && total === null) throw new Unconvertible("<<goto>> in a <<next>> after a delay that isn't fixed");
                        out += goto.replace(/\}\}$/, ` after=${i == 0 ? delayValue(delay) : total}}}`);
                    }
                    else {
                        // Animations play one after another, so each waits after the one before
                        out += `{{#animate "fadeIn" start=${delayValue(delay)}}}${this.nodes(c.nodes, { ...state, leading: false })}{{/animate}}`;
                    }
                });
                return out;
            }
            case "type": {
                state.leading = false;
                const speed = this.expr.parse(args[0] ?? "40ms");
                const interval = speed.k == "num" ? ` interval=${speed.v}` : "";
                return `{{#animate "typewriter"${interval}}}${this.body(m, state)}{{/animate}}`;
            }
            case "textbox":
            case "textarea":
            case "numberbox": {
                state.leading = false;
                const bound = this.receiver(args[0] ?? "");
                const defaultValue = args[1] ? this.expr.parse(args[1]) : null;
                if (args.slice(2).some(a => a != "autofocus")) {
                    this.ctx.approximate(m.raw, "Squiffy's text boxes don't go to a passage when Enter is pressed.");
                }
                const value = defaultValue?.k == "str" || defaultValue?.k == "num" ? String(defaultValue.v) : null;
                const set = defaultValue ? `{{set "${bound}" ${print(defaultValue)}}}` : "";
                if (m.name == "textarea") return `${set}<textarea data-attribute="${bound}">${escapeText(escapeHtml(value ?? ""))}</textarea>`;
                const type = m.name == "numberbox" ? "number" : "text";
                return `${set}<input type="${type}" data-attribute="${bound}"${value === null ? "" : ` value="${escapeAttribute(value)}"`}>`;
            }
            case "checkbox": {
                state.leading = false;
                const bound = this.receiver(args[0] ?? "");
                this.ctx.approximate(m.raw, "Check how this checkbox works in Squiffy.");
                return `<input type="checkbox" data-attribute="${bound}">`;
            }
            case "radiobutton": {
                state.leading = false;
                const bound = this.receiver(args[0] ?? "");
                const value = this.expr.parse(args[1] ?? "");
                if (value.k != "str" && value.k != "num") throw new Unconvertible("<<radiobutton>> with a value that isn't fixed");
                this.ctx.approximate(m.raw, "Check how this radio button works in Squiffy.");
                return `<input type="radio" name="${bound}" data-attribute="${bound}" value="${escapeAttribute(String(value.v))}">`;
            }
            case "cycle":
            case "listbox": {
                state.leading = false;
                const bound = this.receiver(args[0] ?? "");
                const options: { label: string, value: string }[] = [];
                for (const c of m.clauses!.slice(1)) {
                    if (c.name == "optionsfrom") throw new Unconvertible("<<optionsfrom>>");
                    const [label, value] = splitMacroArgs(c.args).map(a => this.expr.parse(a));
                    if (label?.k != "str" && label?.k != "num") throw new Unconvertible("an option that isn't fixed text");
                    const v = value ? value : label;
                    if (v.k != "str" && v.k != "num") throw new Unconvertible("an option that isn't fixed text");
                    options.push({ label: String(label.v), value: String(v.v) });
                }
                if (m.name == "listbox") {
                    return `<select data-attribute="${bound}">${options.map(o => `<option value="${escapeAttribute(o.value)}">${escapeText(escapeHtml(o.label))}</option>`).join("")}</select>`;
                }
                if (options.some(o => o.label != o.value)) {
                    this.ctx.approximate(m.raw, "Squiffy's {{rotate}} sets the attribute to the text shown, not the option's value.");
                }
                return `{{rotate ${print({ k: "array", items: options.map(o => ({ k: "str" as const, v: o.label })) })} set="${bound}"}}`;
            }
            case "replace":
            case "append":
            case "prepend":
            case "remove": {
                state.leading = false;
                const target = /^["']#([\w-]+)["']$/.exec(args[0] ?? "");
                if (!target) throw new Unconvertible(`<<${m.name}>> on something other than an element with an id ("#id")`);
                const label = this.targets.get(target[1])!;
                const content = m.name == "remove" ? "" : this.body(m, state);
                if (m.name == "append" || m.name == "prepend") {
                    this.ctx.approximate(m.raw, `<<${m.name}>> has been converted to {{#replace}}, which replaces the text rather than adding to it.`);
                }
                return `{{#replace "${label}"}}${content}{{/replace}}`;
            }
            case "script":
                throw new Unconvertible("<<script>>, which runs SugarCube JavaScript");
            case "for": {
                state.leading = false;
                if (/<<\s*(?:break|continue)\s*>>/.test(m.raw)) throw new Unconvertible("<<break>> and <<continue>>");
                const loop = this.forLoop(m.args);
                const numbers = loop.collection.k == "call" && loop.collection.fn == "range";
                const body = this.ctx.story.inLoop(loop.vars, loop.array, () => this.body(m, state), numbers);
                return `{{#each ${print(loop.collection)}}}${body}{{/each}}`;
            }
            case "widget":
                return "";
            case "back":
            case "return":
                // Left out on purpose (#445): a screen the player visits and leaves is a panel in Squiffy
                throw new Unconvertible(`<<${m.name}>>. For a screen like an inventory, use a panel. Squiffy has its own Back button`);
            case "audio":
                return leadingAudio(this.audio(m, args), state);
            case "cacheaudio":
            case "waitforaudio":
                // The tracks are found before the story's converted, and Squiffy loads every
                // sound file when the story starts
                return "";
            case "masteraudio":
                if (args.length == 1 && args[0].toLowerCase() == "stop") return leadingAudio(STOP_ALL_AUDIO, state);
                throw new Unconvertible("<<masteraudio>>, which changes all the story's sound at once, except to stop it");
            case "playlist":
            case "createplaylist":
            case "removeplaylist":
            case "track":
                throw new Unconvertible("playlists");
            case "createaudiogroup":
            case "removeaudiogroup":
                throw new Unconvertible("audio groups");
            case "addclass":
            case "removeclass":
            case "toggleclass": {
                // On the page (#449), which in Squiffy is the story's element. Classes on other
                // elements can't be converted.
                if (!/^["'](?:html|body|#story|#passages)["']$/i.test(args[0] ?? "")) {
                    throw new Unconvertible(`<<${m.name}>> on something other than the page ("body")`);
                }
                if (args.length != 2) throw new Unconvertible(`<<${m.name}>> without one class to change`);
                state.leading = false;
                return `{{${m.name} ${print(this.expr.parse(args[1]))}}}`;
            }
            case "repeat": {
                // <<repeat 1s>>: its text is added again every second, until a <<stop>> (#451)
                state.leading = false;
                if (!args[0]) throw new Unconvertible("<<repeat>> without a delay");
                const delay = delayValue(this.expr.parse(args[0]));
                return `{{#every ${delay} append=true}}${this.body(m, { ...state, leading: false })}{{/every}}`;
            }
            case "stop":
                return "{{stop}}";
            case "silent":
                return "";
            case "elseif":
            case "else":
            case "case":
            case "default":
            case "next":
            case "option":
                throw new Unconvertible(`<<${m.name}>> outside the macro it belongs to`);
            default:
                if (this.widgets.has(m.name)) {
                    state.leading = false;
                    return this.widgetCall(m, this.widgets.get(m.name)!, state);
                }
                if (!knownMacros.has(m.name)) throw new Unconvertible(`the <<${m.name}>> macro, which isn't one of SugarCube's own: it's probably added by the story's JavaScript`);
                throw new Unconvertible(`the <<${m.name}>> macro, which Squiffy has no equivalent for`);
        }
    }

    // What a <<for>> goes through, as {{#each}} does, and the variables (with their $ or _) that
    // stand for its item and position. It can go through an array with range, or by position:
    // <<for _i to 0; _i lt $list.length; _i++>>. Either way, $list[_i] is the item.
    private forLoop(args: string): { collection: Expr, vars: Map<string, "item" | "index">, array?: string } {
        const range = /^\s*([$_][A-Za-z_]\w*)\s*(?:,\s*([$_][A-Za-z_]\w*)\s*)?\brange\b([\s\S]+)$/.exec(args);
        if (range) {
            const vars = new Map<string, "item" | "index">(range[2] ? [[range[1], "index"], [range[2], "item"]] : [[range[1], "item"]]);
            const collection = this.expr.parse(range[3]);
            if (collection.k != "var" && collection.k != "array" && !(collection.k == "loop" && collection.kind == "item") && !isListCall(collection)) {
                throw new Unconvertible("<<for>> with range over something other than an array");
            }
            // With a position as well, $list[_i] is the item too
            return { collection, vars, array: collection.k == "var" ? collection.name : undefined };
        }
        const counted = /^\s*_([A-Za-z_]\w*)\s*(?:to|=)\s*0\s*;\s*_\1\s*(?:lt|<)\s*([$_])([A-Za-z_]\w*)\.length\s*;\s*(?:_\1\s*\+\+|\+\+\s*_\1|_\1\s*\+=\s*1)\s*$/.exec(args);
        if (counted) {
            const array = this.expr.attribute(counted[3], counted[2] == "_");
            return { collection: { k: "var", name: array }, vars: new Map([["_" + counted[1], "index"]]), array };
        }
        // Counting, <<for _i to 1; _i lte 5; _i++>>, goes through (range 1 5), with _i as the item (#447)
        const counting = /^\s*_([A-Za-z_]\w*)\s*(?:to|=)\s*([^;]+);\s*_\1\s*(lte|lt|gte|gt|<=|>=|<|>)\s*([^;]+);\s*(_\1\s*\+\+|\+\+\s*_\1|_\1\s*\+=\s*1|_\1\s*--|--\s*_\1|_\1\s*-=\s*1)\s*$/.exec(args);
        if (counting) {
            const from = this.expr.parse(counting[2]);
            const bound = this.expr.parse(counting[4]);
            const up = counting[5].includes("+");
            const op = ({ "lt": "<", "lte": "<=", "gt": ">", "gte": ">=" } as Record<string, string>)[counting[3]] ?? counting[3];
            if (up != op.startsWith("<")) throw new Unconvertible("a <<for>> loop that counts away from where it stops");
            // < 5 counting up stops at 4, and > 0 counting down at 1
            const to: Expr = op.length == 2 ? bound
                : bound.k == "num" ? { k: "num", v: bound.v + (up ? -1 : 1) }
                : { k: "bin", op: up ? "-" : "+", l: bound, r: { k: "num", v: 1 } };
            return { collection: { k: "call", fn: "range", args: [from, to] }, vars: new Map([["_" + counting[1], "item"]]) };
        }
        throw new Unconvertible("<<for>> loops, except ones that go through an array (with range), or count up or down by 1");
    }

    // The attribute a form macro like <<textbox "$name">> sets
    private receiver(arg: string): string {
        const match = /^["']([$_])([A-Za-z_]\w*)["']$/.exec(arg);
        if (!match) throw new Unconvertible("a form control that doesn't set a plain variable");
        return this.expr.attribute(match[2], match[1] == "_");
    }

    private linkText(arg: string): { plain: string, squiffy: string } {
        if (arg.startsWith("[[")) {
            const node = parseLink(arg.slice(2, -2), arg) as { text: string };
            return { plain: node.text, squiffy: this.inlineText(node.text) };
        }
        const e = this.expr.parse(arg);
        if (e.k == "str") return { plain: e.v, squiffy: this.inlineText(e.v) };
        // Text worked out as the story runs, e.g. a loop's item: named after the expression
        return { plain: arg.replace(/[^\w\s]+/g, " ").trim() || "link", squiffy: display(e) };
    }

    private sectionName(passage: string, raw: string): string {
        const section = this.ctx.story.sectionFor(passage);
        if (section === undefined) {
            this.ctx.approximate(raw, `There's no passage called "${passage}".`);
            return this.ctx.story.sectionForUnknown(passage);
        }
        return section;
    }

    private goto(arg: string, raw: string): string {
        const target = this.expr.passageName(arg);
        if ("name" in target) return `{{goto ${print({ k: "str", v: this.sectionName(target.name, raw) })}}}`;
        return `{{goto ${print(target.expr)}}}`;
    }

    private gotoOnly(nodes: Node[]): string | null {
        const significant = nodes.filter(n => !(n.t == "text" && n.s.trim() == ""));
        if (significant.length != 1) return null;
        const n = significant[0];
        if (n.t != "macro" || n.name != "goto") return null;
        return this.goto(splitMacroArgs(n.args)[0] ?? "", n.raw);
    }

    // <<link>>, <<button>>: the body runs when it's clicked, then the story goes to the passage
    // given, if there is one
    private linkMacro(m: Macro, args: string[]): string {
        let text: { plain: string, squiffy: string };
        let passage: string | null = null;
        let setters: string[] = [];
        let setterSource: string | null = null;
        let dynamicDestination: Expr | null = null;
        if (args[0]?.startsWith("[[")) {
            const link = /^\[\[(.*?)\](?:\[(.*)\])?\]$/.exec(args[0]);
            if (!link) throw new Unconvertible("a link Squiffy can't read");
            const node = parseLink(link[1], args[0]) as { text: string, target: string };
            text = { plain: node.text, squiffy: this.inlineText(node.text) };
            passage = node.target;
            if (link[2]) {
                setters = this.setters(link[2]);
                setterSource = link[2];
            }
        }
        else {
            text = this.linkText(args[0] ?? "");
            if (args[1]) {
                const target = this.expr.passageName(args[1]);
                if ("name" in target) passage = target.name;
                else dynamicDestination = target.expr;
            }
        }

        const body = m.clauses?.[0]?.nodes ?? [];
        const significant = body.filter(n => !(n.t == "text" && n.s.trim() == ""));
        // A trailing <<goto>> is where the link goes
        const last = significant[significant.length - 1];
        let gotoArg: string | null = null;
        if (last?.t == "macro" && last.name == "goto") {
            gotoArg = splitMacroArgs(last.args)[0] ?? "";
            significant.pop();
        }
        const destination = gotoArg !== null ? this.expr.passageName(gotoArg)
            : passage !== null ? { name: passage }
                : dynamicDestination ? { expr: dynamicDestination } : null;

        // Only <<set>>s: a link with setters
        const bodySetters = this.bodySetters(significant);
        if (destination && bodySetters) {
            const all = [...setters, ...bodySetters];
            if ("name" in destination) return sectionLink(text.squiffy, this.sectionName(destination.name, m.raw), all);
            return dynamicSectionLink(text.plain, destination.expr, all);
        }

        const state: EmitState = { leading: true, directives: [], nobr: false };
        // In a loop, the body can use the loop's item, which the link sets an attribute to (#448)
        const { result: [content, directives], setters: loopSetters } = this.ctx.story.linkBody(() => {
            const content = this.nodes(body, state);
            return [content, [...(setterSource === null ? [] : this.setters(setterSource, false).map(s => `@set ${s}`)), ...state.directives]] as const;
        });
        if (destination) {
            // Run the body in a section of its own, which then goes on to the passage
            const goto = gotoArg !== null ? "" : "\n" + ("name" in destination
                ? `{{goto ${print({ k: "str", v: this.sectionName(destination.name, m.raw) })}}}`
                : `{{goto ${print(destination.expr)}}}`);
            const section = this.ctx.addSection(`${this.ctx.section}: ${text.plain}`, { directives: [...directives], body: content + goto });
            return sectionLink(text.squiffy, section, loopSetters);
        }
        // Stays in this passage: a passage link, whose passage does what the body does
        const name = this.ctx.addPassage(text.plain, { directives: [...directives], body: content });
        return passageLink(text.squiffy, name, loopSetters);
    }

    // The setters for nodes that are only <<set>>s, or null
    private bodySetters(nodes: Node[]): string[] | null {
        const result: string[] = [];
        for (const n of nodes) {
            if (n.t != "macro" || n.name != "set") return null;
            try {
                result.push(...this.setters(n.args));
            }
            catch (e) {
                if (e instanceof Unconvertible) return null;
                throw e;
            }
        }
        return result;
    }

    private set(statements: Statement[], state: EmitState): string {
        let out = "";
        for (const s of statements) {
            if (state.leading) {
                switch (s.kind) {
                    case "set":
                        state.directives.push(`@set ${setter(s.name, s.op ?? "=", s.value, false)}`);
                        continue;
                    case "inc":
                    case "dec": {
                        const amount = s.value.k == "num" && Number.isInteger(s.value.v) && s.value.v >= 0 ? s.value.v : null;
                        state.directives.push(amount === null || isDynamicTarget(s.name)
                            ? `@set ${setter(s.name, s.kind == "inc" ? "+=" : "-=", s.value, false)}`
                            : `@${s.kind} ${s.name}${amount == 1 ? "" : " " + amount}`);
                        continue;
                    }
                    case "unset":
                        state.directives.push(`@unset ${s.name}`);
                        continue;
                }
            }
            state.leading = false;
            if (isDynamicTarget(s.name)) throw new Unconvertible("setting a value inside an object or list, by a variable's value, after the start of the passage");
            const name = print({ k: "str", v: s.name });
            switch (s.kind) {
                case "set":
                    out += s.op
                        ? `{{set ${name} ${print({ k: "bin", op: s.op == "*=" ? "*" : "/", l: { k: "var", name: s.name }, r: s.value })}}}`
                        : `{{set ${name} ${print(s.value)}}}`;
                    break;
                case "inc":
                case "dec":
                    out += s.value.k == "num" && s.value.v == 1 ? `{{${s.kind} ${name}}}` : `{{${s.kind} ${name} ${print(s.value)}}}`;
                    break;
                case "append":
                case "remove":
                    out += `{{${s.kind} ${name} ${print(s.value)}}}`;
                    break;
                case "unset":
                    out += `{{unset ${name}}}`;
                    break;
            }
        }
        return out;
    }
}

const knownMacros = new Set([
    "capture", "set", "unset", "run", "script", "include", "nobr", "print", "silently", "type", "if", "switch", "for",
    "break", "continue", "back", "return", "actions", "choice", "link", "button", "linkappend", "linkprepend",
    "linkreplace", "checkbox", "cycle", "listbox", "numberbox", "radiobutton", "textarea", "textbox", "addclass",
    "append", "copy", "prepend", "remove", "removeclass", "replace", "toggleclass", "audio", "cacheaudio",
    "createaudiogroup", "createplaylist", "masteraudio", "playlist", "removeaudiogroup", "removeplaylist",
    "waitforaudio", "done", "goto", "repeat", "stop", "timed", "widget", "display", "click", "do", "redo", "track",
]);

// The story's tracks: the files <<cacheaudio>> gives them, and the ones <<audio>> sets to loop
export function sugarCubeAudio(story: PassageContext["story"]): StoryAudio {
    return story.cached("sugarcube-audio", () => {
        const audio: StoryAudio = { files: new Map(), looping: new Set() };
        const strings = (args: string) => splitMacroArgs(args).filter(a => /^["']/.test(a)).map(unescapeString);
        for (const p of story.twine.passages) {
            for (const m of p.text.matchAll(/<<\s*cacheaudio\s+([\s\S]*?)>>/g)) {
                const [track, ...sources] = strings(m[1]);
                // A source can say its format first: "mp3|music/theme.mp3"
                const file = pickSource(sources.map(s => s.replace(/^\w+\|/, "")));
                if (track && file && !audio.files.has(track)) audio.files.set(track, file);
            }
            for (const m of p.text.matchAll(/<<\s*audio\s+([\s\S]*?)>>/g)) {
                const args = splitMacroArgs(m[1]);
                if (!args.slice(1).some(a => a.toLowerCase() == "loop") || !/^["']/.test(args[0] ?? "")) continue;
                for (const track of unescapeString(args[0]).split(/\s+/)) if (track) audio.looping.add(track);
            }
        }
        // Tracks added in the story's JavaScript
        for (const m of story.twine.script.matchAll(/SimpleAudio\.tracks\.add\(\s*(["'])([^"']+)\1\s*,\s*(["'])([^"']+)\3/g)) {
            if (!audio.files.has(m[2])) audio.files.set(m[2], m[4].replace(/^\w+\|/, ""));
        }
        return audio;
    });
}

// The story's widgets, by name, with the section each is converted to
export function sugarCubeWidgets(story: PassageContext["story"]): Map<string, string> {
    return story.cached("sugarcube-widgets", () => {
        const result = new Map<string, string>();
        for (const p of story.twine.passages) {
            if (!p.tags.includes("widget")) continue;
            for (const m of p.text.matchAll(/<<widget\s+["']?([\w-]+)/g)) {
                const name = m[1].toLowerCase();
                if (!result.has(name)) result.set(name, story.uniqueSectionName(`widget ${name}`));
            }
        }
        return result;
    });
}

// The story's widgets that use _args (#450)
function sugarCubeWidgetsUsingArgs(story: PassageContext["story"]): Set<string> {
    return story.cached("sugarcube-widgets-using-args", () => {
        const result = new Set<string>();
        for (const p of story.twine.passages) {
            if (!p.tags.includes("widget")) continue;
            for (const m of p.text.matchAll(/<<widget\s+["']?([\w-]+)["']?[^>]*>>([\s\S]*?)<<\/widget>>/g)) {
                if (/\b_args\b/.test(m[2])) result.add(m[1].toLowerCase());
            }
        }
        return result;
    });
}

// The story's container widgets (#450), <<widget "name" container>>, whose calls wrap text
function sugarCubeContainerWidgets(story: PassageContext["story"]): Set<string> {
    return story.cached("sugarcube-container-widgets", () => {
        const result = new Set<string>();
        for (const p of story.twine.passages) {
            if (!p.tags.includes("widget")) continue;
            for (const m of p.text.matchAll(/<<widget\s+["']?([\w-]+)["']?([^>]*)>>/g)) {
                if (/\bcontainer\b/.test(m[2])) result.add(m[1].toLowerCase());
            }
        }
        return result;
    });
}

export function convertSugarCubeWidgets(text: string, ctx: PassageContext): { section: string, converted: ConvertedPassage }[] {
    const writer = new Writer(ctx);
    const nodes = new Parser(writer.findTargets(text.replace(/\\\r?\n/g, "")), writer.containerWidgets).parse(0).nodes;
    return writer.widgetSections(nodes);
}

function cssAttributes(spec: string): string {
    const classes: string[] = [];
    const styles: string[] = [];
    let id = "";
    for (const part of spec.split(/\s+/).filter(p => p)) {
        if (part.startsWith(".")) classes.push(...part.substring(1).split(".").filter(c => c));
        else if (part.startsWith("#")) id = part.substring(1);
        else styles.push(part);
    }
    let attrs = "";
    if (id) attrs += ` id="${escapeAttribute(id)}"`;
    if (classes.length) attrs += ` class="${escapeAttribute(classes.join(" "))}"`;
    if (styles.length) attrs += ` style="${escapeAttribute(styles.join(" "))}"`;
    return attrs;
}

function escapeAttribute(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/\[/g, "&#91;").replace(/\]/g, "&#93;").replace(/\{\{/g, "&#123;{");
}

// A character of SugarCube prose, which isn't Markdown: * and _ would be emphasis
function escapeProse(s: string, i: number): string {
    const c = s[i];
    if (c == "*") return "&#42;";
    if (c == "`") return "&#96;";
    if (c == "_" && !(/\w/.test(s[i - 1] ?? "") && /\w/.test(s[i + 1] ?? ""))) return "&#95;";
    if (c == "{" && s[i + 1] == "{") return "&#123;";
    if (c == "}" && s[i + 1] == "}") return "&#125;";
    return escapeText(c);
}

export function convertSugarCubePassage(text: string, ctx: PassageContext): ConvertedPassage {
    const writer = new Writer(ctx);
    // A backslash at the end of a line joins it to the next
    const source = writer.findTargets(text.replace(/\\\r?\n/g, ""));
    const nodes = new Parser(source, writer.containerWidgets).parse(0).nodes;
    return writer.passage(nodes, ctx.passage.tags.includes("nobr"));
}
