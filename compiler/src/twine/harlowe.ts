// Converts a Harlowe passage to Squiffy text.
//
// The passage is parsed into a tree (text, macros with the hooks attached to them, links,
// variables), which is then written out: (if:) chains become {{#if}}, (set:) becomes @set or
// {{set}}, (link:) and friends become links to generated passages and sections, and Harlowe's
// markup becomes Markdown and HTML.

import { conditional, display, isBoolean, lengthOf, member, print, randomInteger, targetName, skipBalanced, skipString, Tokens, Unconvertible, unescapeString } from "./expression.js";
import type { BinaryOp, Expr } from "./expression.js";
import { dynamicSectionLink, escapeText, isUrl, urlLink, passageLink, sectionLink, setter } from "./convert.js";
import type { ConvertedPassage, PassageContext } from "./convert.js";

type Node =
    | { t: "text", s: string }
    // Squiffy text, already converted
    | { t: "raw", s: string }
    | { t: "macro", name: string, raw: string, args: string, changers: Macro[], hook?: Hook }
    | { t: "hook", hook: Hook }
    | { t: "link", raw: string, text: string, target: string }
    | { t: "var", name: string, temp: boolean, raw: string }
    | { t: "collapse", nodes: Node[] }
    | { t: "comment", text: string, reason: string };

type Macro = Extract<Node, { t: "macro" }>;

interface Hook {
    nodes: Node[];
    raw: string;
    name?: string;
    hidden?: boolean;
}

// Macro names ignore case, - and _
function normalise(name: string): string {
    return name.toLowerCase().replace(/[-_]/g, "");
}

// Macros that change a hook, so may have whitespace between them and it
const changers = new Set([
    "if", "elseif", "else", "unless", "link", "linkreveal", "linkrepeat", "linkrerun", "linkrevealgoto", "after",
    "live", "textstyle", "textcolour", "textcolor", "colour", "color", "background", "bg", "font", "textsize", "size",
    "align", "css", "transition", "t8n", "transitiontime", "t8ntime", "transitiondepart", "t8ndepart",
    "transitionarrive", "t8narrive", "transitiondelay", "t8ndelay", "transitionskip", "t8nskip", "hidden", "nobr",
    "collapse", "verbatim", "v6m", "replace", "append", "prepend", "click", "clickreplace", "clickappend",
    "clickprepend", "mouseover", "mouseout", "hover", "hoverstyle", "for", "loop", "event", "show", "linkshow",
    "opacity", "textrotate", "textrotatez", "box", "border", "b4r", "bordercolour", "bordercolor", "b4rcolour",
    "cornerradius", "textindent", "float", "hookname", "action", "linkundo", "linkfullscreen", "more",
    "clickgoto", "mouseovergoto", "mouseoverreplace", "mouseoverappend", "mouseoverprepend", "mouseoutreplace",
    "linkstyle", "charstyle", "linestyle", "button", "textshadow", "outline", "hiddenhook", "seqlink",
]);

class Parser {
    constructor(private readonly src: string) {}

    // Parses until the end, or the given closing character at this level
    parse(start: number, close?: "]" | "}"): { nodes: Node[], end: number } {
        const src = this.src;
        const nodes: Node[] = [];
        let text = "";
        const flush = () => {
            if (text) nodes.push({ t: "text", s: text });
            text = "";
        };
        let i = start;
        while (i < src.length) {
            const c = src[i];
            if (c == close) {
                flush();
                return { nodes, end: i };
            }
            const rest = src.substring(i, i + 200);

            if (rest.startsWith("<!--")) {
                const end = src.indexOf("-->", i + 4);
                const stop = end == -1 ? src.length : end + 3;
                flush();
                nodes.push({ t: "raw", s: src.substring(i, stop).replace(/\n/g, " ") });
                i = stop;
                continue;
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
            if (c == "`") {
                let n = 0;
                while (src[i + n] == "`") n++;
                const fence = "`".repeat(n);
                let end = src.indexOf(fence, i + n);
                while (end != -1 && src[end + n] == "`") end = src.indexOf(fence, end + n + 1);
                if (end != -1) {
                    flush();
                    nodes.push({ t: "raw", s: escapeText(escapeHtml(src.substring(i + n, end))) });
                    i = end + n;
                    continue;
                }
            }
            if (rest.startsWith("[[") && !rest.startsWith("[[[")) {
                const end = src.indexOf("]]", i + 2);
                const inner = end == -1 ? "" : src.substring(i + 2, end);
                if (end != -1 && !inner.includes("[") && !inner.includes("\n")) {
                    flush();
                    nodes.push(parseLink(inner, src.substring(i, end + 2)));
                    i = end + 2;
                    continue;
                }
            }
            const namedHook = /^\|([\w-]+)([>)])\[/.exec(rest);
            if (namedHook) {
                flush();
                const hook = this.hook(i + namedHook[0].length - 1);
                hook.hook.name = namedHook[1];
                hook.hook.hidden = namedHook[2] == ")";
                nodes.push({ t: "hook", hook: hook.hook });
                i = hook.end;
                continue;
            }
            if (c == "[") {
                flush();
                const hook = this.hook(i);
                nodes.push({ t: "hook", hook: hook.hook });
                i = hook.end;
                continue;
            }
            const macroStart = /^\(([A-Za-z][\w-]*):/.exec(rest);
            if (macroStart) {
                const end = skipBalanced(src, i, "(", ")");
                if (end != -1) {
                    flush();
                    const result = this.macro(i, end);
                    nodes.push(result.node);
                    i = result.end;
                    continue;
                }
            }
            if (/^\(\$[\w]+:/.test(rest) || /^\(_[\w]+:/.test(rest)) {
                // A call to a custom macro
                const end = skipBalanced(src, i, "(", ")");
                if (end != -1) {
                    flush();
                    nodes.push({ t: "comment", text: src.substring(i, end), reason: "Custom macros, made with (macro:), can't be converted." });
                    i = end;
                    continue;
                }
            }
            const variable = /^([$_])([A-Za-z]\w*)/.exec(rest);
            if (variable && (variable[1] == "$" || !/\w/.test(src[i - 1] ?? ""))) {
                const after = src.substring(i + variable[0].length, i + variable[0].length + 4);
                const property = /^(?:'s\s+(?:[A-Za-z]\w*|\d+(?:st|nd|rd|th)|"[^"\n]*"|'[^'\n]*'))+/.exec(src.substring(i + variable[0].length, i + variable[0].length + 200));
                if (property) {
                    // $player's hp: shown as (print:) would show it
                    flush();
                    const raw = variable[0] + property[0];
                    nodes.push({ t: "macro", name: "print", raw, args: raw, changers: [] });
                    i += raw.length;
                    continue;
                }
                if (after.startsWith("[")) {
                    // A changer stored in a variable attached to a hook
                    const end = this.hook(i + variable[0].length).end;
                    flush();
                    nodes.push({ t: "comment", text: src.substring(i, end), reason: "A changer stored in a variable can't be converted." });
                    i = end;
                    continue;
                }
                flush();
                nodes.push({ t: "var", name: variable[2], temp: variable[1] == "_", raw: variable[0] });
                i += variable[0].length;
                continue;
            }
            if (c == "{") {
                const inner = this.parse(i + 1, "}");
                if (inner.end < src.length) {
                    flush();
                    nodes.push({ t: "collapse", nodes: inner.nodes });
                    i = inner.end + 1;
                    continue;
                }
            }
            text += c;
            i++;
        }
        flush();
        return { nodes, end: i };
    }

    // A hook, from its opening [, with any name after its closing ]
    private hook(open: number): { hook: Hook, end: number } {
        const inner = this.parse(open + 1, "]");
        let end = Math.min(inner.end + 1, this.src.length);
        const hook: Hook = { nodes: inner.nodes, raw: this.src.substring(open, end) };
        const named = /^([<(])([\w-]+)\|/.exec(this.src.substring(end, end + 100));
        if (named) {
            hook.name = named[2];
            hook.hidden = named[1] == "(";
            end += named[0].length;
        }
        return { hook, end };
    }

    private macro(start: number, end: number): { node: Node, end: number } {
        const src = this.src;
        const raw = src.substring(start, end);
        const colon = raw.indexOf(":");
        const name = normalise(raw.substring(1, colon));
        const node: Macro = { t: "macro", name, raw, args: raw.substring(colon + 1, raw.length - 1), changers: [] };
        let i = end;
        // Changers added together: (if: $x)+(text-style: "bold")[...]
        for (;;) {
            const plus = /^\s*\+\s*\(([A-Za-z][\w-]*):/.exec(src.substring(i, i + 100));
            if (!plus) break;
            const open = i + plus[0].indexOf("(");
            const close = skipBalanced(src, open, "(", ")");
            if (close == -1) break;
            const extra = src.substring(open, close);
            const extraColon = extra.indexOf(":");
            node.changers.push({ t: "macro", name: normalise(extra.substring(1, extraColon)), raw: extra, args: extra.substring(extraColon + 1, extra.length - 1), changers: [] });
            node.raw += src.substring(i, close);
            i = close;
        }
        // Changers can be separated from their hooks by whitespace, even line breaks
        let hookStart = i;
        if (changers.has(name) || name.startsWith("click") || name.startsWith("mouse")) {
            while (/\s/.test(src[hookStart] ?? "")) hookStart++;
            if (src[hookStart] != "[" && !src.startsWith("|", hookStart)) hookStart = i;
        }
        if (src[hookStart] == "[" && !src.startsWith("[[", hookStart) || src.startsWith("[[[", hookStart)) {
            const hook = this.hook(hookStart);
            node.hook = hook.hook;
            return { node, end: hook.end };
        }
        const named = /^\|([\w-]+)([>)])\[/.exec(src.substring(hookStart, hookStart + 100));
        if (named && changers.has(name)) {
            const hook = this.hook(hookStart + named[0].length - 1);
            hook.hook.name = named[1];
            hook.hook.hidden = named[2] == ")";
            node.hook = hook.hook;
            return { node, end: hook.end };
        }
        return { node, end: i };
    }
}

function parseLink(inner: string, raw: string): Node {
    let text: string;
    let target: string;
    const arrow = inner.lastIndexOf("->");
    const back = inner.indexOf("<-");
    if (arrow != -1) {
        text = inner.substring(0, arrow);
        target = inner.substring(arrow + 2);
    }
    else if (back != -1) {
        target = inner.substring(0, back);
        text = inner.substring(back + 2);
    }
    else if (inner.includes("|")) {
        const bar = inner.lastIndexOf("|");
        text = inner.substring(0, bar);
        target = inner.substring(bar + 1);
    }
    else {
        text = target = inner;
    }
    return { t: "link", raw, text, target: target.trim() };
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Splits macro arguments on the commas between them
export function splitArgs(args: string): string[] {
    const result: string[] = [];
    let depth = 0;
    let current = "";
    for (let i = 0; i < args.length; i++) {
        const c = args[i];
        const possessive = c == "'" && args[i + 1] == "s" && /\s/.test(args[i + 2] ?? "") && /[\w)]/.test(args[i - 1] ?? "");
        if ((c == "\"" || c == "'") && !possessive) {
            const end = skipString(args, i);
            const stop = end == -1 ? args.length : end;
            current += args.substring(i, stop);
            i = stop - 1;
            continue;
        }
        if (c == "(" || c == "[") depth++;
        else if (c == ")" || c == "]") depth--;
        if (c == "," && depth == 0) {
            result.push(current);
            current = "";
        }
        else {
            current += c;
        }
    }
    if (current.trim() || result.length) result.push(current);
    return result.map(a => a.trim());
}

// ---- Expressions ----

interface Token {
    type: "str" | "num" | "var" | "temp" | "hook" | "op" | "word" | "(" | ")" | "," | "macro";
    text: string;
    value?: string | number;
}

const operators = [">=", "<=", "is not in", "is in", "is not", "does not contain", "'s", "+", "-", "*", "/", "%", ">", "<", "=", "!="];

function tokenize(s: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    while (i < s.length) {
        const c = s[i];
        if (/\s/.test(c)) {
            i++;
            continue;
        }
        if (s.startsWith("'s", i) && /\s/.test(s[i + 2] ?? "") && i > 0 && /[\w)]/.test(s[i - 1])) {
            tokens.push({ type: "op", text: "'s" });
            i += 2;
            continue;
        }
        const ordinal = /^(\d+)(st|nd|rd|th)\b/.exec(s.substring(i));
        if (ordinal) {
            tokens.push({ type: "word", text: "ordinal", value: parseInt(ordinal[1]) });
            i += ordinal[0].length;
            continue;
        }
        if (c == "\"" || c == "'") {
            const end = skipString(s, i);
            if (end == -1) throw new Unconvertible("an expression with a string that isn't closed");
            tokens.push({ type: "str", text: s.substring(i, end), value: unescapeString(s.substring(i, end)) });
            i = end;
            continue;
        }
        const num = /^(\d+(?:\.\d+)?|\.\d+)(ms|s)?(?![\w])/i.exec(s.substring(i));
        if (num) {
            let value = parseFloat(num[1]);
            if (num[2]?.toLowerCase() == "s") value *= 1000;
            tokens.push({ type: "num", text: num[0], value });
            i += num[0].length;
            continue;
        }
        const variable = /^([$_?])([A-Za-z]\w*)/.exec(s.substring(i));
        if (variable) {
            tokens.push({ type: variable[1] == "$" ? "var" : variable[1] == "_" ? "temp" : "hook", text: variable[0], value: variable[2] });
            i += variable[0].length;
            continue;
        }
        const macro = /^\(([A-Za-z][\w-]*):/.exec(s.substring(i));
        if (macro) {
            const end = skipBalanced(s, i, "(", ")");
            if (end == -1) throw new Unconvertible("an expression with a macro that isn't closed");
            tokens.push({ type: "macro", text: s.substring(i, end), value: normalise(macro[1]) });
            i = end;
            continue;
        }
        if (c == "(" || c == ")" || c == ",") {
            tokens.push({ type: c, text: c });
            i++;
            continue;
        }
        const op = operators.find(o => s.startsWith(o, i) && (!/\w$/.test(o) || !/\w/.test(s[i + o.length] ?? "")));
        if (op) {
            tokens.push({ type: "op", text: op });
            i += op.length;
            continue;
        }
        const word = /^[A-Za-z]\w*/.exec(s.substring(i));
        if (word) {
            tokens.push({ type: "word", text: word[0].toLowerCase(), value: word[0] });
            i += word[0].length;
            continue;
        }
        throw new Unconvertible(`an expression Squiffy can't read ("${s.substring(i, i + 10)}")`);
    }
    return tokens;
}

export class HarloweExpressions {
    constructor(readonly ctx: PassageContext) {}

    // The Squiffy attribute for a Harlowe variable
    attribute(name: string, temp: boolean): string {
        return this.ctx.story.attribute(name, temp);
    }

    // A Harlowe variable's value: its attribute, or inside a (for:), the loop's item
    variable(name: string, temp: boolean): Expr {
        return this.ctx.story.variable(name, temp);
    }

    parse(source: string, it?: Expr): Expr {
        const tokens = new Tokens(tokenize(source));
        const e = new ExpressionParser(this, tokens, it).expression();
        if (!tokens.done) throw new Unconvertible(`an expression Squiffy can't read (at "${tokens.peek()!.text}")`);
        return e;
    }

    // A Harlowe value used as a passage name, for (goto:), (display:) and links
    passageName(source: string): { name: string } | { expr: Expr } {
        const e = this.parse(source);
        if (e.k == "str") return { name: e.v };
        return { expr: e };
    }

    // A macro in an expression, e.g. (either: "a", "b")
    macro(name: string, raw: string, it?: Expr): Expr {
        const args = splitArgs(raw.substring(raw.indexOf(":") + 1, raw.length - 1));
        const values = () => args.map(a => this.parse(a, it));
        const one = () => {
            if (args.length != 1) throw new Unconvertible(`(${name}:) with ${args.length ? "more than one value" : "no value"}`);
            return values();
        };
        switch (name) {
            case "either":
                return { k: "call", fn: "random", args: [{ k: "array", items: values() }] };
            case "random": {
                const [min, max] = values();
                return randomInteger(min, max);
            }
            case "a":
            case "array":
                return { k: "array", items: values() };
            case "range": {
                // The whole numbers from one to the other
                const [from, to] = values();
                if (from?.k != "num" || to?.k != "num") throw new Unconvertible("(range:) with numbers that aren't fixed");
                const step = to.v >= from.v ? 1 : -1;
                if (Math.abs(to.v - from.v) > 100) throw new Unconvertible("(range:) of more than 100 numbers");
                const items: Expr[] = [];
                for (let n = Math.round(from.v); n != Math.round(to.v) + step; n += step) items.push({ k: "num", v: n });
                return { k: "array", items };
            }
            case "visited": {
                if (args.length == 0) return { k: "bin", op: ">", l: this.visits(), r: { k: "num", v: 0 } };
                const target = this.parse(args[0]);
                if (target.k != "str") throw new Unconvertible("(visited:) with something other than a passage name");
                return { k: "call", fn: "seen", args: [{ k: "str", v: this.ctx.story.sectionForUnknown(target.v) }] };
            }
            case "str":
            case "string":
            case "text":
            case "num":
            case "number":
                if (args.length != 1) throw new Unconvertible(`(${name}:) with more than one value`);
                return this.parse(args[0], it);
            case "history":
                throw new Unconvertible("(history:), except as (history:) contains \"passage\"");
            case "passage":
                throw new Unconvertible("(passage:)");
            case "dm":
            case "datamap": {
                // An object (#442)
                const items = values();
                if (items.length % 2) throw new Unconvertible("a datamap with a name that has no value");
                const entries: [string, Expr][] = [];
                for (let n = 0; n < items.length; n += 2) {
                    const key = items[n];
                    if (key.k != "str" && key.k != "num") throw new Unconvertible("a datamap with names that aren't fixed");
                    entries.push([String(key.v), items[n + 1]]);
                }
                return { k: "object", entries };
            }
            case "ds":
            case "dataset":
                throw new Unconvertible("Harlowe datasets");
            case "cond":
                return conditional(values(), "(cond:)");
            // Text and numbers (#446)
            case "lowercase":
            case "uppercase":
            case "upperfirst": {
                const [text] = one();
                return { k: "call", fn: name == "lowercase" ? "lower" : name == "uppercase" ? "upper" : "capitalise", args: [text] };
            }
            case "round":
            case "floor":
            case "ceil":
            case "abs":
                return { k: "call", fn: name, args: one() };
            case "min":
            case "max": {
                const items = values();
                if (!items.length) throw new Unconvertible(`(${name}:) with no values`);
                return { k: "call", fn: name, args: items };
            }
            default:
                throw new Unconvertible(`the (${name}:) macro`);
        }
    }

    // (visits:), the number of visits to this passage
    visits(): Expr {
        return { k: "call", fn: "visits", args: [{ k: "str", v: this.ctx.section }] };
    }
}

class ExpressionParser {
    // The left side of the last comparison, for "$a > 2 and < 5"
    private lastComparison?: { left: Expr, op: BinaryOp | "contains" | "in" | "notin" | "notcontains" };

    constructor(private readonly h: HarloweExpressions, private readonly tokens: Tokens<Token>, private readonly it?: Expr) {}

    expression(): Expr {
        return this.or();
    }

    private or(): Expr {
        let left = this.and();
        while (this.tokens.is("or")) {
            this.tokens.next();
            left = { k: "bin", op: "or", l: left, r: this.elided(this.and()) };
        }
        return left;
    }

    private and(): Expr {
        let left = this.not();
        while (this.tokens.is("and")) {
            this.tokens.next();
            left = { k: "bin", op: "and", l: left, r: this.elided(this.not()) };
        }
        return left;
    }

    // "$a is 1 or 2" means "$a is 1 or $a is 2"
    private elided(right: Expr): Expr {
        if (this.lastComparison && !isBoolean(right) && right.k != "var" && right.k != "call") {
            return this.compare(this.lastComparison.left, this.lastComparison.op, right);
        }
        return right;
    }

    private not(): Expr {
        if (this.tokens.is("not")) {
            this.tokens.next();
            return { k: "not", e: this.not() };
        }
        return this.comparison();
    }

    private comparisonOp(): BinaryOp | "contains" | "in" | "notin" | "notcontains" | null {
        const t = this.tokens.peek();
        if (!t) return null;
        if (t.type == "op") {
            switch (t.text) {
                case ">": case "<": case ">=": case "<=": return t.text;
                case "is not": return "!=";
                case "is in": return "in";
                case "is not in": return "notin";
                case "does not contain": return "notcontains";
                case "=": return "=";
                case "!=": return "!=";
            }
        }
        if (t.type == "word") {
            if (t.text == "is") return "=";
            if (t.text == "contains") return "contains";
        }
        return null;
    }

    private comparison(): Expr {
        // "and < 5", with the left side left out
        if (this.comparisonOp() && this.lastComparison) {
            const op = this.comparisonOp()!;
            this.tokens.next();
            return this.compare(this.lastComparison.left, op, this.additive());
        }
        const left = this.additive();
        const op = this.comparisonOp();
        if (!op) return left;
        this.tokens.next();
        const right = this.additive();
        this.lastComparison = { left, op };
        return this.compare(left, op, right);
    }

    private compare(left: Expr, op: BinaryOp | "contains" | "in" | "notin" | "notcontains", right: Expr): Expr {
        switch (op) {
            case "contains": return this.contains(left, right);
            case "notcontains": return { k: "not", e: this.contains(left, right) };
            case "in": return this.contains(right, left);
            case "notin": return { k: "not", e: this.contains(right, left) };
            default: return { k: "bin", op, l: left, r: right };
        }
    }

    // A list, text or datamap that contains a value (#446)
    private contains(collection: Expr, value: Expr): Expr {
        if (collection.k == "call" && collection.fn == "__history") {
            if (value.k != "str") throw new Unconvertible("(history:) contains something other than a passage name");
            return { k: "call", fn: "seen", args: [{ k: "str", v: this.h.ctx.story.sectionForUnknown(value.v) }] };
        }
        return { k: "bin", op: "contains", l: collection, r: value };
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
        if (this.tokens.is("-")) {
            this.tokens.next();
            const e = this.unary();
            return e.k == "num" ? { k: "num", v: -e.v } : { k: "neg", e };
        }
        return this.postfix();
    }

    private postfix(): Expr {
        let e = this.primary();
        while (this.tokens.is("'s") || (this.tokens.is("its"))) {
            this.tokens.next();
            const property = this.tokens.next();
            if (property.text == "length") {
                // A list's or text's length (#446)
                e = e.k == "call" && e.fn == "__history" ? { k: "var", name: "turns" } : lengthOf(e);
            }
            else if (property.text == "ordinal" && (e.k == "var" || e.k == "array" || e.k == "member")) {
                // $list's 1st
                e = member(e, { k: "num", v: (property.value as number) - 1 });
            }
            else if ((e.k == "var" || e.k == "member") && (property.type == "word" || property.type == "str")) {
                // A value in a datamap: $player's hp is player.hp (#442)
                e = member(e, { k: "str", v: String(property.value ?? property.text) });
            }
            else {
                throw new Unconvertible(`properties of variables ('s ${property.text})`);
            }
        }
        return e;
    }

    private primary(): Expr {
        const t = this.tokens.next();
        switch (t.type) {
            case "str": return { k: "str", v: t.value as string };
            case "num": return { k: "num", v: t.value as number };
            case "var": return this.h.variable(t.value as string, false);
            case "temp": return this.h.variable(t.value as string, true);
            case "hook": throw new Unconvertible("a hook name in an expression");
            case "(": {
                const e = this.expression();
                this.tokens.expect(")");
                return e;
            }
            case "macro": {
                if (t.value == "history") return { k: "call", fn: "__history", args: [] };
                return this.h.macro(t.value as string, t.text, this.it);
            }
            case "word":
                switch (t.text) {
                    case "true": return { k: "bool", v: true };
                    case "false": return { k: "bool", v: false };
                    case "it":
                        if (!this.it) throw new Unconvertible("\"it\" outside (set:)");
                        return this.it;
                    case "visits":
                    case "visit":
                        return this.h.visits();
                    case "turns":
                    case "turn":
                        return { k: "var", name: "turns" };
                    case "time":
                        throw new Unconvertible("\"time\", which Squiffy has no equivalent for");
                }
                throw new Unconvertible(`the word "${t.text}" in an expression`);
            default:
                throw new Unconvertible(`an expression Squiffy can't read (at "${t.text}")`);
        }
    }
}

// ---- Writing Squiffy ----

interface EmitState {
    // Whether we're still at the start of the passage, where (set:)s can become @set directives
    leading: boolean;
    directives: string[];
}

class Writer {
    private readonly expr: HarloweExpressions;
    // Named hooks in the passage, by Harlowe name, with the label each becomes
    private readonly hooks = new Map<string, { hook: Hook, label: string }>();
    // Hook names referred to with ?name anywhere in the story
    private readonly referenced: Set<string>;
    // (click: ?name) and friends, by the hook they make clickable
    private readonly clicks = new Map<string, Macro>();
    // Open emphasis: Harlowe's markup toggles on and off
    private open = new Set<string>();
    private align: string | null = null;
    // Whether the next text starts a line, for markup that only means something there
    private atLineStart = true;
    private storyletsShown = false;

    constructor(private readonly ctx: PassageContext) {
        this.expr = new HarloweExpressions(ctx);
        this.referenced = referencedHooks(ctx);
    }

    collectHooks(nodes: Node[]) {
        for (const node of nodes) {
            const hook = node.t == "hook" ? node.hook : node.t == "macro" ? node.hook : undefined;
            if (node.t == "collapse") this.collectHooks(node.nodes);
            if (node.t == "macro" && clickMacros.has(node.name)) {
                const target = /^\?([A-Za-z][\w-]*)$/.exec(splitArgs(node.args)[0] ?? "");
                if (target && !this.clicks.has(target[1])) this.clicks.set(target[1], node);
            }
            if (!hook) continue;
            if (hook.name && !this.hooks.has(hook.name)) {
                this.hooks.set(hook.name, { hook, label: labelName(hook.name) });
            }
            this.collectHooks(hook.nodes);
        }
    }

    passage(nodes: Node[]): ConvertedPassage {
        this.collectHooks(nodes);
        const state: EmitState = { leading: true, directives: [] };
        let body = this.nodes(nodes, state);
        body += this.closeAll();
        return { directives: state.directives, body };
    }

    private closeAll(): string {
        let s = "";
        for (const tag of [...this.open].reverse()) s += `</${tag}>`;
        this.open.clear();
        if (this.align) {
            s += "\n\n</div>";
            this.align = null;
        }
        return s;
    }

    nodes(nodes: Node[], state: EmitState): string {
        let out = "";
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            if (node.t == "macro" && (node.name == "if" || node.name == "unless")) {
                // An if chain: (if:)[...](else-if:)[...](else:)[...], with any whitespace between
                const chain: { cond: Expr | null, hook?: Hook, raw: string }[] = [];
                let conditionError: string | null = null;
                const condition = (m: Macro): Expr | null => {
                    try {
                        const e = this.expr.parse(m.args);
                        return m.name == "unless" ? { k: "not", e } : e;
                    }
                    catch (e) {
                        if (!(e instanceof Unconvertible)) throw e;
                        conditionError = conditionError ?? e.message;
                        return null;
                    }
                };
                chain.push({ cond: condition(node), hook: foldChangers(node), raw: node.raw });
                let j = i + 1;
                for (;;) {
                    let k = j;
                    while (k < nodes.length && nodes[k].t == "text" && (nodes[k] as { s: string }).s.trim() == "") k++;
                    const next = nodes[k];
                    if (next?.t != "macro" || (next.name != "elseif" && next.name != "else")) break;
                    chain.push({ cond: next.name == "else" ? null : condition(next), hook: foldChangers(next), raw: next.raw });
                    j = k + 1;
                    if (next.name == "else") break;
                }
                i = j - 1;
                state.leading = false;
                if (conditionError) {
                    out += this.ctx.unconvertible(chain.map(c => c.raw).join(""), `This condition couldn't be converted: ${conditionError}. Its hooks have been left out.`);
                    continue;
                }
                out += chain.map((c, n) => {
                    const tag = n == 0 ? `{{#if ${print(c.cond!)}}}` : c.cond ? `{{else if ${print(c.cond)}}}` : "{{else}}";
                    return tag + (c.hook ? this.hookContent(c.hook, state) : "");
                }).join("") + "{{/if}}";
                continue;
            }
            if (node.t == "macro" && (node.name == "elseif" || node.name == "else")) {
                // (else:) after a hook that isn't an (if:), e.g. after a (link:)
                state.leading = false;
                out += this.ctx.unconvertible(node.raw, "(else:) only converts after (if:) or (unless:).");
                if (node.hook) out += this.hookContent(node.hook, state);
                continue;
            }
            if (isPageClick(node)) {
                // (click: ?page)[A] (click: ?page)[B]: each click anywhere shows the next one, so
                // they become a chain of Continue links, each showing its hook and the next link
                const chain: Macro[] = [node as Macro];
                let j = i + 1;
                for (;;) {
                    let k = j;
                    while (k < nodes.length && nodes[k].t == "text" && (nodes[k] as { s: string }).s.trim() == "") k++;
                    if (k >= nodes.length || !isPageClick(nodes[k])) break;
                    chain.push(nodes[k] as Macro);
                    j = k + 1;
                }
                i = j - 1;
                state.leading = false;
                this.ctx.story.note("harlowe-page-click", "(click: ?page)", "Clicking anywhere on the page has been converted to Continue links");
                const links = chain.map(() => {
                    const label = this.ctx.newLabel("continue");
                    const passage = this.ctx.reservePassage("Continue");
                    return { label, passage, link: `{{#label "${label}"}}${passageLink("Continue", passage.name)}{{/label}}` };
                });
                chain.forEach((click, n) => {
                    const content = click.hook ? this.nodes(click.hook.nodes, { leading: false, directives: [] }) : "";
                    const next = links[n + 1] ? "\n\n" + links[n + 1].link : "";
                    links[n].passage.fill(`{{#replace "${links[n].label}"}}{{/replace}}${content}${next}`);
                });
                out += links[0].link;
                this.atLineStart = false;
                continue;
            }
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
                return this.text(node.s);
            case "raw":
                return node.s;
            case "comment":
                return this.ctx.unconvertible(node.text, node.reason);
            case "var":
                state.leading = false;
                return display(this.expr.variable(node.name, node.temp));
            case "link":
                state.leading = false;
                return this.link(node);
            case "collapse": {
                const inner = this.nodes(node.nodes, state);
                return collapseWhitespace(inner);
            }
            case "hook": {
                const hook = node.hook;
                if (hook.name && this.clicks.has(hook.name) && !hook.hidden) {
                    state.leading = false;
                    return this.clickable(hook, this.clicks.get(hook.name)!);
                }
                if (hook.hidden) {
                    // Shown later, by (show:)
                    if (!hook.name || !this.referenced.has(hook.name)) return "";
                    return `{{#label "${labelName(hook.name)}"}}{{/label}}`;
                }
                return this.hookContent(hook, state);
            }
            case "macro":
                return this.macro(node, state);
        }
    }

    // A hook's content, in a {{#label}} if it's named and something refers to it
    private hookContent(hook: Hook, state: EmitState): string {
        const content = this.nodes(hook.nodes, { ...state, leading: false });
        state.leading = state.leading && content.trim() == "";
        if (hook.name && !hook.hidden && this.referenced.has(hook.name)) {
            return `{{#label "${labelName(hook.name)}"}}${content}{{/label}}`;
        }
        return content;
    }

    // A named hook that (click:) or one of its friends makes into a link
    private clickable(hook: Hook, click: Macro): string {
        const content = this.nodes(hook.nodes, { leading: false, directives: [] });
        const text = content.replace(/\s+/g, " ").trim();
        const label = labelName(hook.name!);
        const args = splitArgs(click.args);
        let action: string;
        switch (click.name) {
            case "clickgoto":
            case "mouseovergoto": {
                if (click.name != "clickgoto") this.ctx.approximate(click.raw, "This has been converted to an ordinary link.");
                return `{{#label "${label}"}}${this.linkTo(text, args[1] ?? "", click.raw, [])}{{/label}}`;
            }
            case "clickreplace":
                action = `{{#replace "${label}"}}${click.hook ? this.nodes(click.hook.nodes, { leading: false, directives: [] }) : ""}{{/replace}}`;
                break;
            case "clickappend":
            case "clickprepend": {
                const extra = click.hook ? this.nodes(click.hook.nodes, { leading: false, directives: [] }) : "";
                action = `{{#replace "${label}"}}${click.name == "clickappend" ? content + extra : extra + content}{{/replace}}`;
                break;
            }
            default:
                if (click.name != "click") this.ctx.approximate(click.raw, "This has been converted to a link.");
                action = click.hook ? this.nodes(click.hook.nodes, { leading: false, directives: [] }) : "";
                // The text stops being a link once it's been clicked, as it does in Harlowe
                action = `{{#replace "${label}"}}${content}{{/replace}}` + action;
        }
        const passage = this.ctx.addPassage(text, action);
        return `{{#label "${label}"}}${passageLink(text, passage)}{{/label}}`;
    }

    private link(node: Extract<Node, { t: "link" }>): string {
        const text = this.inlineText(node.text);
        if (isUrl(node.target)) return urlLink(text, node.target);
        const target = this.ctx.story.sectionFor(node.target);
        if (target === undefined) {
            this.ctx.approximate(node.raw, `There's no passage called "${node.target}".`);
            return sectionLink(text, this.ctx.story.sectionForUnknown(node.target));
        }
        return sectionLink(text, target);
    }

    // Link text, with Harlowe's markup in it
    private inlineText(text: string): string {
        const nodes = new Parser(text).parse(0).nodes;
        return this.nodes(nodes, { leading: false, directives: [] }).replace(/\n/g, " ");
    }

    // Prose, with Harlowe's markup
    private text(s: string): string {
        let out = "";
        for (let i = 0; i < s.length;) {
            const rest = s.substring(i);
            if (this.atLineStart) {
                this.atLineStart = false;
                const lineEnd = rest.indexOf("\n");
                const line = lineEnd == -1 ? rest : rest.substring(0, lineEnd);
                const alignment = /^\s*(==+>|=+><=+|<==+>|<==+)\s*$/.exec(line);
                if (alignment) {
                    out += this.alignment(alignment[1]);
                    i += line.length;
                    continue;
                }
                if (/^\s*\|==+|^\s*=+\|\s*$|^\s*==+\|/.test(line)) {
                    out += this.ctx.unconvertible(line, "Harlowe's columns can't be converted.");
                    i += line.length;
                    continue;
                }
                const heading = /^(#{1,6})\s*(?=\S)/.exec(line);
                if (heading) {
                    out += heading[1] + " ";
                    i += heading[0].length;
                    continue;
                }
                const bullet = /^(\*+)\s+/.exec(line);
                if (bullet) {
                    out += "  ".repeat(bullet[1].length - 1) + "* ";
                    i += bullet[0].length;
                    continue;
                }
                const numbered = /^(0\.)+\s+/.exec(line);
                if (numbered) {
                    out += "1. ";
                    i += numbered[0].length;
                    continue;
                }
                if (/^\s*-{3,}\s*$/.test(line)) {
                    out += "<hr>";
                    i += line.length;
                    continue;
                }
            }
            const c = s[i];
            if (c == "\n") {
                out += "\n";
                this.atLineStart = true;
                i++;
                continue;
            }
            const toggle = this.toggle(s, i);
            if (toggle) {
                out += toggle.text;
                i += toggle.length;
                continue;
            }
            if (c == "<") {
                // HTML passes through as it is
                const tag = /^<\/?[A-Za-z][^<>]*>/.exec(rest);
                if (tag) {
                    out += tag[0].replace(/\{\{/g, "&#123;{");
                    i += tag[0].length;
                    continue;
                }
            }
            // {{ would start a helper
            out += (c == "{" && s[i + 1] == "{") ? "&#123;" : (c == "}" && s[i + 1] == "}") ? "&#125;" : escapeText(c);
            i++;
        }
        return out;
    }

    // Emphasis markup, which turns on and off: ''bold'', //italic//, **strong**, *em*,
    // ~~strike~~, ^^superscript^^
    private toggle(s: string, i: number): { text: string, length: number } | null {
        const marks: [string, string][] = [["''", "b"], ["//", "i"], ["**", "strong"], ["~~", "s"], ["^^", "sup"], ["*", "em"]];
        for (const [mark, tag] of marks) {
            if (!s.startsWith(mark, i)) continue;
            if (mark == "//" && s[i - 1] == ":") return null;
            if (this.open.has(tag)) {
                this.open.delete(tag);
                return { text: `</${tag}>`, length: mark.length };
            }
            // Only if it's closed later
            const end = s.indexOf(mark, i + mark.length);
            if (end == -1 || (mark == "*" && s.substring(i, end).includes("\n"))) return null;
            if (mark == "*" && s[i + 1] == " ") return null;
            this.open.add(tag);
            return { text: `<${tag}>`, length: mark.length };
        }
        return null;
    }

    private alignment(marker: string): string {
        let s = "";
        if (this.align) {
            s += "\n\n</div>";
            this.align = null;
        }
        // ==> right, =><= centre, <==> justified, <== left
        const align = marker.includes("><") ? "center"
            : marker.startsWith("<") && marker.endsWith(">") ? "justify"
                : marker.endsWith(">") ? "right" : "left";
        if (align != "left") {
            this.align = align;
            s += `<div style="text-align: ${align}">\n\n`;
        }
        return s;
    }

    // ---- Macros ----

    private macro(m: Macro, state: EmitState): string {
        try {
            const result = this.macroOrThrow(m, state);
            // A hook after a command, rather than a changer, is shown as it is
            if (m.hook && !changers.has(m.name) && !hookMacros.has(m.name)) return result + this.hookContent(m.hook, state);
            return result;
        }
        catch (e) {
            if (!(e instanceof Unconvertible)) throw e;
            state.leading = false;
            const reason = `This couldn't be converted: ${e.message}.`;
            if (m.hook && !["link", "linkreveal", "linkrepeat", "linkrerun", "click", "replace", "append", "prepend", "show", "for", "loop"].includes(m.name)) {
                // Keep the hook's text, since most changers only change how it looks
                return this.ctx.unconvertible(m.raw, reason) + this.hookContent(m.hook, state);
            }
            return this.ctx.unconvertible(m.raw + (m.hook?.raw ?? ""), reason);
        }
    }

    private macroOrThrow(m: Macro, state: EmitState): string {
        const args = splitArgs(m.args);
        const name = m.name;

        if (m.changers.length) {
            return this.macroOrThrow({ ...m, changers: [], hook: foldChangers(m) }, state);
        }

        switch (name) {
            case "set":
            case "put":
                return this.set(m, args, state);
            case "print":
                state.leading = false;
                if (args.length != 1) throw new Unconvertible("(print:) with more than one value");
                return display(this.expr.parse(args[0]));
            case "either":
            case "random":
                state.leading = false;
                return display(this.expr.macro(name, m.raw));
            case "display": {
                state.leading = false;
                const target = this.expr.passageName(args[0] ?? "");
                if ("name" in target) {
                    const section = this.ctx.story.sectionFor(target.name);
                    if (section === undefined) this.ctx.approximate(m.raw, `There's no passage called "${target.name}".`);
                    return `{{embed "${section ?? this.ctx.story.sectionForUnknown(target.name)}"}}`;
                }
                return `{{embed ${print(target.expr)}}}`;
            }
            case "goto":
            case "redirect":
                state.leading = false;
                return this.goto(args[0] ?? "", m.raw);
            case "linkgoto":
            case "clickgoto":
            case "mouseovergoto":
            case "linkrevealgoto": {
                state.leading = false;
                if (name == "clickgoto" || name == "mouseovergoto") {
                    // Handled where the hook is
                    const hookName = /^\s*\?([A-Za-z][\w-]*)\s*$/.exec(args[0] ?? "")?.[1];
                    if (hookName && this.hooks.has(hookName)) return "";
                    throw new Unconvertible(`(${name}:) on text rather than a named hook in this passage`);
                }
                const textExpr = this.expr.parse(args[0] ?? "");
                if (textExpr.k != "str") throw new Unconvertible("a link whose text isn't fixed");
                const targetSource = args.length > 1 ? args[1] : args[0];
                const setters = name == "linkrevealgoto" && m.hook ? this.setters(m.hook) : [];
                if (setters === null) {
                    // The hook does more than set variables: run it in a section of its own
                    const target = this.expr.passageName(targetSource);
                    const goto = "name" in target ? `{{goto "${this.sectionName(target.name, m.raw)}"}}` : `{{goto ${print(target.expr)}}}`;
                    const content = this.convertedHook(m.hook!);
                    const section = this.ctx.addSection(`${this.ctx.section}: ${textExpr.v}`, { ...content, body: content.body + "\n" + goto });
                    return sectionLink(this.inlineText(textExpr.v), section);
                }
                return this.linkTo(this.inlineText(textExpr.v), targetSource, m.raw, setters);
            }
            case "link":
            case "linkreplace":
            case "linkreveal":
            case "linkrepeat":
            case "linkrerun":
                state.leading = false;
                return this.linkMacro(m, args);
            case "linkshow": {
                state.leading = false;
                const textExpr = this.expr.parse(args[0] ?? "");
                if (textExpr.k != "str") throw new Unconvertible("a link whose text isn't fixed");
                const shows = args.slice(1).map(a => this.show(a, m.raw)).join("");
                const label = this.ctx.newLabel(textExpr.v);
                const passage = this.ctx.addPassage(textExpr.v, `{{#replace "${label}"}}${this.inlineText(textExpr.v)}{{/replace}}${shows}`);
                return `{{#label "${label}"}}${passageLink(this.inlineText(textExpr.v), passage)}{{/label}}`;
            }
            case "after": {
                state.leading = false;
                const delay = this.expr.parse(args[0] ?? "");
                if (delay.k != "num") throw new Unconvertible("(after:) with a delay that isn't fixed");
                if (!m.hook) return "";
                const goto = this.gotoOnly(m.hook);
                if (goto) return goto.replace(/\}\}$/, ` after=${delay.v}}}`);
                return `{{#animate "fadeIn" start=${delay.v}}}${this.hookContent(m.hook, state)}{{/animate}}`;
            }
            case "live": {
                state.leading = false;
                const delay = this.expr.parse(args[0] ?? "1s");
                if (delay.k != "num" || !m.hook) throw new Unconvertible("(live:)");
                const goto = this.gotoOnly(m.hook, true);
                if (goto) return goto.replace(/\}\}$/, ` after=${delay.v}}}`);
                throw new Unconvertible("(live:), which runs its hook again and again");
            }
            case "stop":
                return "";
            case "inputbox":
            case "forceinputbox":
            case "input":
            case "forceinput":
                state.leading = false;
                return this.input(args, m.raw);
            case "dropdown": {
                state.leading = false;
                const bound = this.bound(args[0] ?? "");
                if (!bound) throw new Unconvertible("(dropdown:) without bind");
                const options = args.slice(1).map(a => this.expr.parse(a));
                if (options.some(o => o.k != "str" && o.k != "num")) throw new Unconvertible("(dropdown:) with options that aren't fixed");
                const html = options.map(o => {
                    const v = escapeAttribute(String((o as { v: string | number }).v));
                    return `<option value="${v}">${v}</option>`;
                }).join("");
                return `<select data-attribute="${bound}">${html}</select>`;
            }
            case "checkbox": {
                state.leading = false;
                const bound = this.bound(args[0] ?? "");
                const label = args[1] ? this.expr.parse(args[1]) : null;
                if (!bound || (label && label.k != "str")) throw new Unconvertible("(checkbox:)");
                this.ctx.approximate(m.raw, "Check how this checkbox works in Squiffy.");
                return `<label><input type="checkbox" data-attribute="${bound}"> ${label ? escapeText((label as { v: string }).v) : ""}</label>`;
            }
            case "cyclinglink":
            case "seqlink":
            case "sequencelink": {
                state.leading = false;
                let bound: string | null = null;
                let rest = args;
                if (/^2?bind\s/.test(args[0] ?? "")) {
                    bound = this.bound(args[0]);
                    rest = args.slice(1);
                }
                const items = rest.map(a => this.expr.parse(a));
                const helper = name == "cyclinglink" ? "rotate" : "sequence";
                const set = bound ? ` set="${bound}"` : "";
                return `{{${helper} ${print({ k: "array", items })}${set}}}`;
            }
            case "textstyle":
            case "textcolour":
            case "textcolor":
            case "colour":
            case "color":
            case "background":
            case "bg":
            case "font":
            case "textsize":
            case "size":
            case "align":
            case "css":
            case "opacity":
                state.leading = false;
                return this.style(m, args, state);
            case "linkstyle":
            case "box":
            case "border":
            case "b4r":
            case "bordercolour":
            case "bordercolor":
            case "b4rcolour":
            case "b4rcolor":
            case "bordersize":
            case "b4rsize":
            case "cornerradius":
            case "textindent":
            case "float":
            case "textrotate":
            case "textrotatez":
            case "textrotatey":
            case "textrotatex":
            case "hoverstyle":
            case "charstyle":
            case "linestyle":
            case "button":
            case "hookname":
            case "outline":
            case "textshadow":
                this.ctx.story.note("harlowe-visual", m.raw.substring(0, m.raw.indexOf(":") + 1) + ")",
                    "These Harlowe changers only change how text looks, so they've been left out, and the text they changed has been kept");
                return m.hook ? this.hookContent(m.hook, state) : "";
            case "enchant":
            case "enchantin": {
                // Only how links or text look
                const visual = /\((t8n|transition|text-colou?r|colou?r|text-style|link-style|hover-style|font|background|bg|opacity|css|box|border)[\w-]*:/i;
                const changer = splitArgs(m.args)[1] ?? "";
                if (visual.test(changer) && !/\((replace|append|prepend|show|hide|goto|set):/i.test(changer)) {
                    this.ctx.story.note("harlowe-visual", "(enchant:)", "These Harlowe changers only change how text looks, so they've been left out, and the text they changed has been kept");
                    return "";
                }
                throw new Unconvertible("(enchant:)");
            }
            case "transition":
            case "t8n":
            case "transitiontime":
            case "t8ntime":
            case "transitiondelay":
            case "t8ndelay":
            case "transitionskip":
            case "t8nskip":
            case "transitiondepart":
            case "t8ndepart":
            case "transitionarrive":
            case "t8narrive":
                // Only how the text appears, which Squiffy does its own way
                return m.hook ? this.hookContent(m.hook, state) : "";
            case "nobr":
            case "collapse":
                return m.hook ? collapseWhitespace(this.hookContent(m.hook, state)) : "";
            case "verbatim":
            case "v6m":
                state.leading = false;
                return m.hook ? escapeText(escapeHtml(m.hook.raw.slice(1, -1))) : "";
            case "hidden":
                if (m.hook?.name) {
                    m.hook.hidden = true;
                    return this.node({ t: "hook", hook: m.hook }, state);
                }
                return "";
            case "show":
                state.leading = false;
                return args.map(a => this.show(a, m.raw)).join("");
            case "hide":
                state.leading = false;
                return args.map(a => {
                    const label = this.labelFor(a);
                    return `{{#replace "${label}"}}{{/replace}}`;
                }).join("");
            case "replace":
            case "append":
            case "prepend": {
                state.leading = false;
                if (!m.hook) return "";
                const content = this.hookContent(m.hook, state);
                return args.map(a => {
                    const target = a.trim();
                    if (!target.startsWith("?")) throw new Unconvertible(`(${name}:) on text rather than a named hook`);
                    const named = this.hooks.get(target.substring(1));
                    // A hook in another passage, e.g. a header: its label has the same name
                    if (!named && name == "replace") return `{{#replace "${labelName(target.substring(1))}"}}${content}{{/replace}}`;
                    if (!named) throw new Unconvertible(`(${name}:) on a hook that isn't in this passage`);
                    if (name == "replace") return `{{#replace "${named.label}"}}${content}{{/replace}}`;
                    this.ctx.approximate(m.raw, `(${name}:) has been converted to {{#replace}}, with the hook's original text. If the hook has changed by then, this will undo that.`);
                    const original = this.nodes(named.hook.nodes, { leading: false, directives: [] });
                    return `{{#replace "${named.label}"}}${name == "append" ? original + content : content + original}{{/replace}}`;
                }).join("");
            }
            case "click":
            case "clickreplace":
            case "clickappend":
            case "clickprepend":
            case "mouseover":
            case "mouseout": {
                const target = (args[0] ?? "").trim();
                const hookName = /^\?([A-Za-z][\w-]*)$/.exec(target)?.[1];
                // Handled where the hook is
                if (hookName && this.hooks.has(hookName)) return "";
                if ((hookName == "page" || hookName == "passage") && m.hook) {
                    state.leading = false;
                    this.ctx.story.note("harlowe-page-click", "(click: ?page)", "Clicking anywhere on the page has been converted to Continue links");
                    const content = this.nodes(m.hook.nodes, { leading: false, directives: [] });
                    const label = this.ctx.newLabel("continue");
                    const passage = this.ctx.addPassage("Continue", `{{#replace "${label}"}}{{/replace}}${content}`);
                    return `{{#label "${label}"}}${passageLink("Continue", passage)}{{/label}}`;
                }
                throw new Unconvertible(`(${name}:) on ${hookName ? "a hook that isn't in this passage" : "text rather than a named hook"}`);
            }
            case "for":
            case "loop": {
                state.leading = false;
                if (!m.hook) throw new Unconvertible(`(${name}:) without a hook`);
                // each _item, or _item where ... (which only shows the items it's true for)
                const lambda = /^\s*(each\s+)?_([A-Za-z_]\w*)(?:\s+where\s+([\s\S]+))?$/i.exec(args[0] ?? "");
                if (!lambda || (!lambda[1] && !lambda[3])) throw new Unconvertible(`(${name}:) with something other than "each _item" or "_item where ..."`);
                const collection = this.forCollection(args.slice(1), name);
                const hook = m.hook;
                return this.ctx.story.inLoop(new Map([["_" + lambda[2], "item"]]), undefined, () => {
                    const body = this.hookContent(hook, state);
                    const shown = lambda[3] ? `{{#if ${print(this.expr.parse(lambda[3]))}}}${body}{{/if}}` : body;
                    return `{{#each ${print(collection)}}}${shown}{{/each}}`;
                });
            }
            case "linkstorylet": {
                state.leading = false;
                // Every storylet whose condition is true, the first time (link-storylet:) is in a passage
                if (this.storyletsShown) return "";
                this.storyletsShown = true;
                const storylets = harloweStorylets(this.ctx);
                if (!storylets.length) throw new Unconvertible("(link-storylet:) in a story without storylets");
                this.ctx.story.note("harlowe-storylets", "(link-storylet:)", "Storylets have been converted to a link to each storylet whose condition is true, in the first place (link-storylet:) is in a passage. (urgency:) and (exclusivity:) have been left out");
                // All on one line, so the ones that aren't shown don't leave blank lines
                return storylets.map(st => {
                    const link = sectionLink(escapeText(st.section), st.section) + "<br>";
                    return st.condition ? `{{#if ${print(st.condition)}}}${link}{{/if}}` : link;
                }).join("");
            }
            case "storylet":
            case "urgency":
            case "exclusivity":
                // Converted where the storylets are listed
                return "";
            case "mockvisits":
            case "mockturns":
            case "debug":
            case "seed":
                return "";
            case "if":
            case "unless":
            case "elseif":
            case "else":
                // Handled in nodes()
                return "";
            default:
                throw new Unconvertible(`the (${m.raw.substring(1, m.raw.indexOf(":"))}:) macro, which Squiffy has no equivalent for`);
        }
    }

    // What a (for:) goes through: an array spread out (...$list), or values, as {{#each}} takes
    private forCollection(values: string[], name: string): Expr {
        const spread = (v: string) => /^\s*\.\.\./.test(v) ? this.expr.parse(v.replace(/^\s*\.\.\./, "")) : null;
        if (values.length == 1) {
            const e = spread(values[0]);
            if (e && (e.k == "var" || e.k == "array" || (e.k == "loop" && e.kind == "item"))) return e;
        }
        const items: Expr[] = [];
        for (const v of values) {
            const e = spread(v);
            if (!e) items.push(this.expr.parse(v));
            else if (e.k == "array") items.push(...e.items);
            else throw new Unconvertible(`(${name}:) with an array and other values`);
        }
        if (!items.length) throw new Unconvertible(`(${name}:) with nothing to go through`);
        return { k: "array", items };
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
        if ("name" in target) return `{{goto "${this.sectionName(target.name, raw)}"}}`;
        return `{{goto ${print(target.expr)}}}`;
    }

    // A link to a passage given as a Harlowe value, with setters
    private linkTo(text: string, targetSource: string, raw: string, setters: string[]): string {
        const target = this.expr.passageName(targetSource);
        if ("name" in target) return sectionLink(text, this.sectionName(target.name, raw), setters);
        return dynamicSectionLink(text, target.expr, setters);
    }

    // (link:) and friends, with a hook that runs when it's clicked
    private linkMacro(m: Macro, args: string[]): string {
        const textExpr = this.expr.parse(args[0] ?? "");
        if (textExpr.k != "str") throw new Unconvertible("a link whose text isn't fixed");
        const text = this.inlineText(textExpr.v);
        if (!m.hook) throw new Unconvertible("a link with no hook");

        // A link that only sets variables and goes to another passage is an ordinary link
        const navigation = this.navigation(m.hook);
        if (navigation) {
            if (navigation.setters) return this.linkTo(text, navigation.target, m.raw, navigation.setters);
            // It does more than set variables, so do that in a section of its own
            const section = this.ctx.addSection(`${this.ctx.section}: ${textExpr.v}`, navigation.content());
            return sectionLink(text, section);
        }

        const content = this.nodes(m.hook.nodes, { leading: false, directives: [] });
        if (m.name == "linkrepeat" || m.name == "linkrerun") {
            this.ctx.approximate(m.raw, "In Squiffy, this link can only be clicked once.");
            const passage = this.ctx.addPassage(textExpr.v, content);
            return passageLink(text, passage);
        }
        const label = this.ctx.newLabel(textExpr.v);
        const replacement = m.name == "linkreveal" ? text + content : content;
        const passage = this.ctx.addPassage(textExpr.v, `{{#replace "${label}"}}${replacement}{{/replace}}`);
        return `{{#label "${label}"}}${passageLink(text, passage)}{{/label}}`;
    }

    // If a hook only sets variables and then goes to a passage, the setters and the passage.
    // If it does other things before going to a passage, content is the Squiffy text for a
    // section that does those things and then goes there.
    private navigation(hook: Hook): { target: string, setters: string[] | null, content: () => ConvertedPassage } | null {
        const significant = hook.nodes.filter(n => !(n.t == "text" && n.s.trim() == ""));
        const last = significant[significant.length - 1];
        if (last?.t != "macro" || (last.name != "goto" && last.name != "redirect")) return null;
        // Only if the (goto:) isn't inside anything
        const target = splitArgs(last.args)[0] ?? "";
        const before = significant.slice(0, -1);
        const setters = this.setters({ nodes: before, raw: "" });
        return { target, setters, content: () => this.convertedHook(hook) };
    }

    // The setters for a hook that only has (set:) and (put:) in it, or null
    private setters(hook: Hook): string[] | null {
        const setters: string[] = [];
        for (const n of hook.nodes) {
            if (n.t == "text" && n.s.trim() == "") continue;
            if (n.t != "macro" || (n.name != "set" && n.name != "put") || n.hook) return null;
            for (const assignment of splitArgs(n.args)) {
                try {
                    for (const a of this.assignments(assignment, n.name == "put")) {
                        if (a.kind == "append" || a.kind == "remove") return null;
                        setters.push(a.kind == "inc" ? setter(a.name, "+=", a.value, true)
                            : a.kind == "dec" ? setter(a.name, "-=", a.value, true)
                                : setter(a.name, "=", a.value, true));
                    }
                }
                catch (e) {
                    if (e instanceof Unconvertible) return null;
                    throw e;
                }
            }
        }
        return setters;
    }

    // A hook as the text of a section of its own, where (set:)s at the start become @set
    private convertedHook(hook: Hook): ConvertedPassage {
        const state: EmitState = { leading: true, directives: [] };
        const body = this.nodes(hook.nodes, state);
        return { directives: state.directives, body };
    }

    // If a hook only has a (goto:) (and (stop:)), the {{goto}}
    private gotoOnly(hook: Hook, allowStop = false): string | null {
        const significant = hook.nodes.filter(n => !(n.t == "text" && n.s.trim() == "") && !(allowStop && n.t == "macro" && n.name == "stop"));
        if (significant.length != 1) return null;
        const n = significant[0];
        if (n.t != "macro" || (n.name != "goto" && n.name != "redirect")) return null;
        return this.goto(splitArgs(n.args)[0] ?? "", n.raw);
    }

    private labelFor(arg: string): string {
        const target = arg.trim();
        if (!target.startsWith("?")) throw new Unconvertible("a hook name that isn't ?name");
        return labelName(target.substring(1));
    }

    private show(arg: string, raw: string): string {
        const label = this.labelFor(arg);
        const named = this.hooks.get(arg.trim().substring(1));
        if (!named) throw new Unconvertible(`(show:) of a hook that isn't in this passage (${raw})`);
        const content = this.nodes(named.hook.nodes, { leading: false, directives: [] });
        return `{{#replace "${label}"}}${content}{{/replace}}`;
    }

    // The attribute for "bind $x", or null
    private bound(arg: string): string | null {
        const match = /^2?bind\s+([$_])([A-Za-z]\w*)$/.exec(arg.trim());
        if (!match) return null;
        return this.expr.attribute(match[2], match[1] == "_");
    }

    private input(args: string[], raw: string): string {
        const bound = this.bound(args[0] ?? "");
        if (!bound) throw new Unconvertible("an input box without bind");
        let defaultText: string | null = null;
        let rows = 1;
        for (const a of args.slice(1)) {
            const e = this.expr.parse(a);
            if (e.k == "num") rows = e.v;
            else if (e.k == "str" && /^[=<>]+$/.test(e.v)) continue;
            else if (e.k == "str") defaultText = e.v;
        }
        if (raw.toLowerCase().includes("force")) this.ctx.approximate(raw, "This has been converted to an ordinary input box.");
        const value = defaultText == null ? "" : ` value="${escapeAttribute(defaultText)}"`;
        const set = defaultText == null ? "" : `{{set "${bound}" ${print({ k: "str", v: defaultText })}}}`;
        if (rows > 1) return `${set}<textarea data-attribute="${bound}" rows="${rows}">${escapeText(escapeHtml(defaultText ?? ""))}</textarea>`;
        return `${set}<input type="text" data-attribute="${bound}"${value}>`;
    }

    private style(m: Macro, args: string[], state: EmitState): string {
        if (!m.hook) throw new Unconvertible(`(${m.name}:) without a hook (as a value, or saved in a variable)`);
        const content = this.hookContent(m.hook, state);
        const colourMacros = ["textcolour", "textcolor", "colour", "color", "background", "bg"];
        const value = colourMacros.includes(m.name) ? { k: "str" as const, v: this.colour(args[0] ?? "") } : this.expr.parse(args[0] ?? "");
        const str = (e: Expr): string => {
            if (e.k == "str") return e.v;
            if (e.k == "num") return String(e.v);
            throw new Unconvertible(`(${m.name}:) with a value that isn't fixed`);
        };
        switch (m.name) {
            case "textstyle": {
                let open = "";
                let close = "";
                for (const a of args) {
                    const style = str(this.expr.parse(a)).toLowerCase().replace(/[\s-]/g, "");
                    const tag = { bold: "b", italic: "i", underline: "u", strike: "s", superscript: "sup", subscript: "sub" }[style];
                    if (tag) {
                        open += `<${tag}>`;
                        close = `</${tag}>` + close;
                    }
                    else if (style != "none") {
                        this.ctx.story.note("harlowe-text-style", `"${style}"`, "Squiffy has no equivalent for these Harlowe text styles, so they've been left out");
                    }
                }
                return open + content + close;
            }
            case "align": {
                const marker = str(value);
                const align = marker.includes("<") && marker.includes(">") ? (marker.startsWith("<") ? "justify" : "center") : marker.includes(">") ? "right" : "left";
                return `<div style="text-align: ${align}">${content}</div>`;
            }
            case "css":
                return `<span style="${escapeAttribute(str(value))}">${content}</span>`;
            default: {
                const css = {
                    textcolour: "color", textcolor: "color", colour: "color", color: "color",
                    background: "background", bg: "background", font: "font-family", textsize: "font-size", size: "font-size",
                    opacity: "opacity",
                }[m.name]!;
                let v: string;
                if (value.k == "num" && (m.name == "textsize" || m.name == "size")) v = `${value.v * 1.5}em`;
                else if (value.k == "str" || value.k == "num") v = String(value.v);
                else throw new Unconvertible(`(${m.name}:) with a colour Squiffy can't read`);
                return `<span style="${css}: ${escapeAttribute(v)}">${content}</span>`;
            }
        }
    }

    // A Harlowe colour: a colour name or #rrggbb without quotes, a string, or (rgb:) and friends
    private colour(arg: string): string {
        const a = arg.trim();
        if (/^#[0-9a-f]{3,8}$/i.test(a) || /^[a-z]+$/i.test(a)) return a.toLowerCase();
        const fn = /^\((rgba?|hsla?):([\s\S]*)\)$/i.exec(a);
        if (fn) {
            const values = splitArgs(fn[2]).map(v => this.expr.parse(v));
            if (values.some(v => v.k != "num")) throw new Unconvertible(`(${fn[1]}:) with values that aren't fixed`);
            const numbers = values.map(v => (v as { v: number }).v);
            if (fn[1].toLowerCase().startsWith("hsl")) {
                const [h, sat, l, alpha] = numbers;
                return `hsl(${h} ${sat * 100}% ${l * 100}%${alpha === undefined ? "" : ` / ${alpha}`})`;
            }
            return `rgb(${numbers.slice(0, 3).join(" ")}${numbers[3] === undefined ? "" : ` / ${numbers[3]}`})`;
        }
        const e = this.expr.parse(a);
        if (e.k == "str") return e.v;
        throw new Unconvertible("a colour that isn't fixed");
    }

    // ---- (set:) ----

    private assignments(source: string, put: boolean): Assignment[] {
        return [this.assignment(source, put)];
    }

    private assignment(source: string, put: boolean): Assignment {
        let targetSource: string;
        let valueSource: string;
        const keyword = put ? /\binto\b/ : /\bto\b/;
        let tokens = splitOutsideStrings(source, keyword);
        // Not Harlowe, but some stories have (set: $x += 1), which some versions of Harlowe allowed
        const shorthand = /^\s*([$_][A-Za-z]\w*)\s*([+\-*/]?=)\s*([\s\S]*)$/.exec(source);
        if (!tokens && !put && shorthand) {
            const op = shorthand[2];
            tokens = [shorthand[1], op == "=" ? shorthand[3] : `${shorthand[1]} ${op[0]} (${shorthand[3]})`];
        }
        if (!tokens) throw new Unconvertible(put ? "(put:) without \"into\"" : "(set:) without \"to\"");
        if (put) [valueSource, targetSource] = tokens;
        else [targetSource, valueSource] = tokens;
        const target = /^([$_])([A-Za-z]\w*)((?:'s\s+(?:[A-Za-z_]\w*|"[A-Za-z_]\w*"))*)$/.exec(targetSource.trim());
        if (!target) throw new Unconvertible("setting something other than a variable");
        // $player's hp is player.hp (#442)
        const properties = [...target[3].matchAll(/'s\s+"?([A-Za-z_]\w*)"?/g)].map(m => m[1]);
        const variable = properties.reduce<Expr>((e, property) => member(e, { k: "str", v: property }),
            { k: "var", name: this.expr.attribute(target[2], target[1] == "_") });
        const name = targetName(variable)!;
        const value = this.expr.parse(valueSource, variable);

        // $x to it + 1, and $x to $x - 2
        if (value.k == "bin" && (value.op == "+" || value.op == "-") && value.l.k == "var" && value.l.name == name) {
            if (value.r.k == "array") {
                if (value.r.items.length != 1) throw new Unconvertible("adding or removing more than one item at once");
                return { kind: value.op == "+" ? "append" : "remove", name, value: value.r.items[0] };
            }
            if (value.r.k == "num" || value.op == "-") return { kind: value.op == "+" ? "inc" : "dec", name, value: value.r };
        }
        return { kind: "set", name, value };
    }

    private set(m: Macro, args: string[], state: EmitState): string {
        let out = "";
        for (const a of args.flatMap(source => this.assignments(source, m.name == "put"))) {
            const amount = a.value.k == "num" && Number.isInteger(a.value.v) && a.value.v >= 0 ? a.value.v : null;
            if (state.leading) {
                switch (a.kind) {
                    case "set":
                        state.directives.push(`@set ${setter(a.name, "=", a.value, false)}`);
                        continue;
                    case "inc":
                    case "dec":
                        if (amount !== null) {
                            state.directives.push(`@${a.kind} ${a.name}${amount == 1 ? "" : " " + amount}`);
                        }
                        else {
                            state.directives.push(`@set ${setter(a.name, a.kind == "inc" ? "+=" : "-=", a.value, false)}`);
                        }
                        continue;
                }
            }
            state.leading = false;
            const name = print({ k: "str", v: a.name });
            switch (a.kind) {
                case "set":
                    out += `{{set ${name} ${print(a.value)}}}`;
                    break;
                case "inc":
                case "dec":
                    out += amount === 1 ? `{{${a.kind} ${name}}}` : `{{${a.kind} ${name} ${print(a.value)}}}`;
                    break;
                case "append":
                case "remove":
                    out += `{{${a.kind} ${name} ${print(a.value)}}}`;
                    break;
            }
        }
        return out;
    }
}

// (a:)+(b:)[hook] is (a:) applied to (b:)[hook]: the hook, with the changers after the first
// applied to it
function foldChangers(m: Macro): Hook | undefined {
    if (!m.hook || !m.changers.length) return m.hook;
    let hook: Hook = m.hook;
    for (let n = m.changers.length - 1; n >= 0; n--) {
        const changer: Macro = { ...m.changers[n], hook, changers: [] };
        hook = { nodes: [changer], raw: changer.raw + hook.raw };
    }
    return hook;
}

// The story's storylets: passages with (storylet: when ...), with their conditions
function harloweStorylets(ctx: PassageContext): { section: string, condition: Expr | null }[] {
    return ctx.story.cached("harlowe-storylets", () => {
        const result: { section: string, condition: Expr | null }[] = [];
        for (const p of ctx.story.twine.passages) {
            const match = /\(storylet:\s*when\b/i.exec(p.text);
            if (!match) continue;
            const end = skipBalanced(p.text, match.index, "(", ")");
            const section = ctx.story.sectionFor(p.name);
            if (end == -1 || section === undefined) continue;
            const source = p.text.substring(match.index + match[0].length, end - 1);
            // "visits" in a storylet's condition means visits to the storylet
            const expressions = new HarloweExpressions({ ...ctx, section, passage: p });
            let condition: Expr | null;
            try {
                condition = expressions.parse(source);
            }
            catch (e) {
                if (!(e instanceof Unconvertible)) throw e;
                ctx.story.addProblem({ passage: p.name, text: p.text.substring(match.index, end), reason: `This storylet's condition couldn't be converted: ${e.message}. It's always listed.` });
                condition = null;
            }
            result.push({ section, condition });
        }
        return result;
    });
}

// (click: ?page) or (click: ?passage), with a hook
function isPageClick(node: Node | undefined): boolean {
    return node?.t == "macro" && node.name == "click" && !!node.hook && /^\s*\?(page|passage)\s*$/i.test(node.args);
}

// Macros whose hooks are converted with them, as well as the changers
const hookMacros = new Set(["linkreplace", "linkrepeat", "linkrerun", "linkreveal", "linkrevealgoto", "click", "clickreplace", "clickappend", "clickprepend"]);

const clickMacros = new Set(["click", "clickreplace", "clickappend", "clickprepend", "clickgoto", "mouseover", "mouseout", "mouseovergoto"]);

// The label a named hook becomes, the same in every passage, so (replace:) can change a hook in a
// header. The runtime replaces the latest label with the name.
function labelName(hook: string): string {
    return hook.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

// Every hook name referred to with ?name in the story
function referencedHooks(ctx: PassageContext): Set<string> {
    return ctx.story.cached("harlowe-hooks", () => {
        const result = new Set<string>();
        for (const p of ctx.story.twine.passages) {
            for (const m of p.text.matchAll(/\?([A-Za-z][\w-]*)/g)) result.add(m[1]);
        }
        return result;
    });
}

interface Assignment {
    kind: "set" | "inc" | "dec" | "append" | "remove";
    name: string;
    value: Expr;
}

// Splits "a to b" on the first keyword outside quotes and brackets
function splitOutsideStrings(s: string, keyword: RegExp): [string, string] | null {
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        // Harlowe's possessive: $player's hp
        if (c == "'" && s[i + 1] == "s" && /\s/.test(s[i + 2] ?? "") && /[\w)"]/.test(s[i - 1] ?? "")) continue;
        if (c == "\"" || c == "'") {
            const end = skipString(s, i);
            if (end == -1) return null;
            i = end - 1;
            continue;
        }
        if (c == "(") depth++;
        else if (c == ")") depth--;
        else if (depth == 0 && /\s/.test(c)) {
            const match = keyword.exec(s.substring(i + 1));
            if (match && match.index == 0 && /\s/.test(s[i + 1 + match[0].length] ?? "")) {
                return [s.substring(0, i), s.substring(i + 1 + match[0].length)];
            }
        }
    }
    return null;
}

function escapeAttribute(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/\[/g, "&#91;").replace(/\]/g, "&#93;").replace(/\{\{/g, "&#123;{");
}

// Harlowe's { } markup and (collapse:): runs of whitespace become one space
function collapseWhitespace(s: string): string {
    return s.replace(/\s+/g, " ").trim();
}

// (click: "text") makes text that's in the passage clickable. Its first appearance becomes a
// named hook, so it converts as (click: ?hook) does.
function clickableText(source: string, ctx: PassageContext): string {
    let result = source;
    let n = 0;
    for (;;) {
        const match = /\((click|click-replace|click-append|click-prepend|click-goto|mouseover|mouseover-goto|mouseout)\s*:\s*("[^"\n]+"|'[^'\n]+')/i.exec(result);
        if (!match) return result;
        const text = match[2].slice(1, -1);
        const hook = `click-text-${++n}`;
        const macroEnd = skipBalanced(result, match.index, "(", ")");
        const withHookName = result.substring(0, match.index) + `(${match[1]}: ?${hook}` + result.substring(match.index + match[0].length);
        // The text, outside any macro
        const macros: [number, number][] = [];
        for (const m of withHookName.matchAll(/\([A-Za-z][\w-]*:/g)) {
            const end = skipBalanced(withHookName, m.index, "(", ")");
            if (end != -1) macros.push([m.index, end]);
        }
        let at = -1;
        for (let from = 0; ; from = at + 1) {
            at = withHookName.indexOf(text, from);
            if (at == -1 || !macros.some(([start, end]) => at >= start && at < end)) break;
        }
        if (at == -1 || macroEnd == -1) {
            ctx.approximate(match[0], "The text this makes clickable isn't in the passage.");
            // Leave it for the macro converter to report
            return result.substring(0, match.index) + `(${match[1]}-text: ` + result.substring(match.index + match[0].length - match[2].length);
        }
        if (withHookName.indexOf(text, at + text.length) != -1) {
            ctx.approximate(match[0], "Only the first place this text appears has been made clickable.");
        }
        result = withHookName.substring(0, at) + `|${hook}>[${text}]` + withHookName.substring(at + text.length);
    }
}

export function convertHarlowePassage(text: string, ctx: PassageContext): ConvertedPassage {
    // A backslash at the end or start of a line joins it to the next or previous line
    const source = clickableText(text.replace(/\\\n/g, "").replace(/\n\\/g, ""), ctx);
    const nodes = new Parser(source).parse(0).nodes;
    return new Writer(ctx).passage(nodes);
}
