// Reads Quest's script language (ASL), as it's written in a gamebook's page scripts: statements
// such as msg ("..."), if (...) { } else { }, firsttime { }, and calls to the gamebook's functions,
// such as SetFlagOn ("lamp") or MovePlayer (Page2). Anything it can't read is kept as a "raw"
// statement, with its source, so the converter can report it rather than lose it.

export type QExpr =
    | { k: "num", v: number }
    | { k: "str", v: string }
    | { k: "bool", v: boolean }
    | { k: "null" }
    // A name, such as lamp or Page2, or an attribute, such as game.lamp or player.parent. Each
    // part can be a page name with spaces in it, such as Room 551.
    | { k: "path", parts: string[] }
    | { k: "call", fn: string, args: QExpr[] }
    | { k: "bin", op: string, l: QExpr, r: QExpr }
    | { k: "not", e: QExpr }
    | { k: "neg", e: QExpr };

export type QStmt = { src: string } & (
    | { k: "if", branches: { cond: QExpr, body: QStmt[] }[], otherwise?: QStmt[] }
    | { k: "firsttime", body: QStmt[], otherwise?: QStmt[] }
    | { k: "switch", value: QExpr, cases: { values: QExpr[], body: QStmt[] }[], otherwise?: QStmt[] }
    // A call, such as msg ("Hi") or GetInput () { ... }, with its callback if it has one. Commands
    // that are two words, such as play sound, are written with a space: "play sound".
    | { k: "call", fn: string, args: QExpr[], callback?: QStmt[] }
    | { k: "assign", target: QExpr, value: QExpr }
    // Something that couldn't be read
    | { k: "raw" }
);

interface Token {
    type: "word" | "num" | "str" | "op" | "nl" | "other";
    text: string;
    // The string's value, for a "str"
    value?: string;
    start: number;
    end: number;
}

class ParseError extends Error {}

function tokenize(source: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    while (i < source.length) {
        const c = source[i];
        if (c == "\n") {
            tokens.push({ type: "nl", text: "\n", start: i, end: i + 1 });
            i++;
        }
        else if (/\s/.test(c)) {
            i++;
        }
        else if (c == "/" && source[i + 1] == "/") {
            while (i < source.length && source[i] != "\n") i++;
        }
        else if (c == "\"") {
            let value = "";
            let j = i + 1;
            for (; j < source.length && source[j] != "\""; j++) {
                if (source[j] == "\\" && j + 1 < source.length) {
                    j++;
                    value += source[j] == "n" ? "\n" : source[j];
                }
                else {
                    value += source[j];
                }
            }
            tokens.push({ type: "str", text: source.substring(i, j + 1), value, start: i, end: j + 1 });
            i = j + 1;
        }
        else if (/\d/.test(c)) {
            // A number, or a name that starts with one, such as 1B in the page name Option 1B
            const m = /^\d+\.\d+(?![\p{L}_])|^[\p{L}\p{N}_]+/u.exec(source.substring(i))!;
            tokens.push({ type: /^[\d.]+$/.test(m[0]) ? "num" : "word", text: m[0], start: i, end: i + m[0].length });
            i += m[0].length;
        }
        else if (/[\p{L}_]/u.test(c)) {
            const m = /^[\p{L}\p{N}_]+/u.exec(source.substring(i))!;
            tokens.push({ type: "word", text: m[0], start: i, end: i + m[0].length });
            i += m[0].length;
        }
        else {
            const two = source.substring(i, i + 2);
            const op = ["<=", ">=", "<>", "!=", "==", "&&", "||"].includes(two) ? two : c;
            tokens.push({ type: "+-*/%=<>(){},.[]!".includes(op) || op.length == 2 ? "op" : "other", text: op, start: i, end: i + op.length });
            i += op.length;
        }
    }
    return tokens;
}

const keywords = new Set(["and", "or", "not", "true", "false", "null", "if", "else", "firsttime", "otherwise", "switch", "case", "default"]);

export class ScriptParser {
    private tokens: Token[];
    private pos = 0;

    // names: the names of the game's objects, such as its pages, which can have spaces in them
    constructor(private readonly source: string, private readonly names: Set<string>) {
        this.tokens = tokenize(source);
    }

    static parse(source: string, names: Set<string>): QStmt[] {
        const parser = new ScriptParser(source, names);
        const body = parser.statements(false);
        return body;
    }

    private peek(offset = 0): Token | undefined {
        return this.tokens[this.pos + offset];
    }

    private is(text: string, offset = 0): boolean {
        const t = this.peek(offset);
        return !!t && t.type != "str" && t.text == text;
    }

    private expect(text: string): Token {
        const t = this.peek();
        if (!t || t.type == "str" || t.text != text) throw new ParseError(`expected "${text}"`);
        this.pos++;
        return t;
    }

    private skipNewlines() {
        while (this.peek()?.type == "nl") this.pos++;
    }

    // Statements, up to the end of the script, or the } that ends a block
    private statements(inBlock: boolean): QStmt[] {
        const result: QStmt[] = [];
        for (;;) {
            this.skipNewlines();
            const t = this.peek();
            if (!t) {
                if (inBlock) throw new ParseError("a block with no }");
                return result;
            }
            if (inBlock && this.is("}")) return result;
            result.push(this.statement());
        }
    }

    private block(): QStmt[] {
        this.skipNewlines();
        this.expect("{");
        const body = this.statements(true);
        this.expect("}");
        return body;
    }

    // One statement. If it can't be read, it's kept as raw text, up to the end of its line (and
    // any block that starts on it).
    private statement(): QStmt {
        const start = this.pos;
        try {
            const stmt = this.statementOrThrow();
            this.endOfStatement();
            return stmt;
        }
        catch (e) {
            if (!(e instanceof ParseError)) throw e;
            this.pos = start;
            this.skipRawStatement();
            return { k: "raw", src: this.sourceFrom(start) };
        }
    }

    private endOfStatement() {
        const t = this.peek();
        if (t && t.type != "nl" && !this.is("}")) throw new ParseError("more after the end of a statement");
    }

    private skipRawStatement() {
        let depth = 0;
        while (this.peek()) {
            const t = this.peek()!;
            if (t.type == "nl" && depth <= 0) return;
            if (t.type == "op" && (t.text == "{" || t.text == "(")) depth++;
            if (t.type == "op" && (t.text == "}" || t.text == ")")) {
                if (depth <= 0) return;
                depth--;
                this.pos++;
                // A block ends the statement, unless else or otherwise follows it
                if (depth == 0 && t.text == "}") {
                    let j = 0;
                    while (this.peek(j)?.type == "nl") j++;
                    if (!this.is("else", j) && !this.is("otherwise", j)) return;
                }
                continue;
            }
            this.pos++;
        }
    }

    private sourceFrom(startToken: number): string {
        const first = this.tokens[startToken];
        const last = this.tokens[this.pos - 1];
        if (!first || !last || this.pos <= startToken) return "";
        return this.source.substring(first.start, last.end).trim();
    }

    private statementOrThrow(): QStmt {
        const start = this.pos;
        const t = this.peek()!;
        const src = () => this.sourceFrom(start);
        if (t.type != "word") throw new ParseError("a statement that doesn't start with a name");

        if (t.text == "if") {
            const branches: { cond: QExpr, body: QStmt[] }[] = [];
            let otherwise: QStmt[] | undefined;
            this.pos++;
            branches.push({ cond: this.condition(), body: this.block() });
            for (;;) {
                let j = 0;
                while (this.peek(j)?.type == "nl") j++;
                if (!this.is("else", j)) break;
                this.pos += j + 1;
                if (this.is("if")) {
                    this.pos++;
                    branches.push({ cond: this.condition(), body: this.block() });
                }
                else {
                    otherwise = this.block();
                    break;
                }
            }
            return { k: "if", branches, otherwise, src: src() };
        }
        if (t.text == "firsttime") {
            this.pos++;
            const body = this.block();
            let j = 0;
            while (this.peek(j)?.type == "nl") j++;
            let otherwise: QStmt[] | undefined;
            if (this.is("otherwise", j)) {
                this.pos += j + 1;
                otherwise = this.block();
            }
            return { k: "firsttime", body, otherwise, src: src() };
        }
        if (t.text == "switch") {
            this.pos++;
            const value = this.condition();
            this.skipNewlines();
            this.expect("{");
            const cases: { values: QExpr[], body: QStmt[] }[] = [];
            let otherwise: QStmt[] | undefined;
            for (;;) {
                this.skipNewlines();
                if (this.is("}")) break;
                if (this.is("case")) {
                    this.pos++;
                    this.expect("(");
                    const values = this.expressionList(")");
                    this.expect(")");
                    cases.push({ values, body: this.block() });
                }
                else if (this.is("default")) {
                    this.pos++;
                    otherwise = this.block();
                }
                else {
                    throw new ParseError("expected case or default");
                }
            }
            this.expect("}");
            return { k: "switch", value, cases, otherwise, src: src() };
        }
        // Two-word commands
        const second = this.peek(1);
        const twoWord = second?.type == "word" && ({ play: ["sound"], stop: ["sound"], list: ["add", "remove"], dictionary: ["add", "remove"], on: ["ready"] } as Record<string, string[]>)[t.text]?.includes(second.text);
        if (twoWord && t.text == "on") {
            this.pos += 2;
            return { k: "call", fn: "on ready", args: [], callback: this.block(), src: src() };
        }
        if (twoWord) {
            this.pos += 2;
            const args = this.is("(") ? this.arguments() : [];
            return { k: "call", fn: `${t.text} ${second!.text}`, args, src: src() };
        }

        // An assignment, such as game.lamp = true, or a local variable, such as x = 1
        const save = this.pos;
        if (!keywords.has(t.text)) {
            try {
                const target = this.path();
                if (this.is("=")) {
                    this.pos++;
                    const value = this.expression();
                    return { k: "assign", target, value, src: src() };
                }
            }
            catch (e) {
                if (!(e instanceof ParseError)) throw e;
            }
        }
        this.pos = save;

        // A call, with or without brackets, and a callback if it has one. Its name can have dots
        // in it, such as JS.eval.
        let fn = t.text;
        this.pos++;
        while (this.is(".") && this.peek(1)?.type == "word") {
            fn += "." + this.peek(1)!.text;
            this.pos += 2;
        }
        const args = this.is("(") ? this.arguments() : [];
        let callback: QStmt[] | undefined;
        let j = 0;
        while (this.peek(j)?.type == "nl") j++;
        if (this.is("{", j) && (j == 0 || t.text == "GetInput" || t.text == "ShowMenu")) {
            callback = this.block();
        }
        return { k: "call", fn, args, callback, src: src() };
    }

    private condition(): QExpr {
        this.expect("(");
        const e = this.expression();
        this.expect(")");
        return e;
    }

    private arguments(): QExpr[] {
        this.expect("(");
        const args = this.expressionList(")");
        this.expect(")");
        return args;
    }

    private expressionList(end: string): QExpr[] {
        const items: QExpr[] = [];
        this.skipNewlines();
        if (this.is(end)) return items;
        for (;;) {
            this.skipNewlines();
            items.push(this.expression());
            this.skipNewlines();
            if (!this.is(",")) return items;
            this.pos++;
        }
    }

    expression(): QExpr {
        return this.binary(0);
    }

    private static readonly levels: string[][] = [
        ["or", "||"],
        ["and", "&&"],
        ["=", "==", "<>", "!=", "<", ">", "<=", ">="],
        ["+", "-"],
        ["*", "/", "%"],
    ];

    private binary(level: number): QExpr {
        if (level >= ScriptParser.levels.length) return this.unary();
        let left = this.binary(level + 1);
        for (;;) {
            const t = this.peek();
            if (!t || t.type == "str" || !ScriptParser.levels[level].includes(t.text)) return left;
            this.pos++;
            this.skipNewlines();
            const op = t.text == "||" ? "or" : t.text == "&&" ? "and" : t.text == "==" ? "=" : t.text == "!=" ? "<>" : t.text;
            left = { k: "bin", op, l: left, r: this.binary(level + 1) };
        }
    }

    private unary(): QExpr {
        if (this.is("not") || this.is("!")) {
            this.pos++;
            return { k: "not", e: this.unary() };
        }
        if (this.is("-")) {
            this.pos++;
            return { k: "neg", e: this.unary() };
        }
        return this.primary();
    }

    private primary(): QExpr {
        const t = this.peek();
        if (!t) throw new ParseError("an expression that ends too soon");
        if (t.type == "str") {
            this.pos++;
            return { k: "str", v: t.value! };
        }
        if (t.type == "num" && !this.objectName()) {
            this.pos++;
            return { k: "num", v: Number(t.text) };
        }
        if (this.is("(")) {
            this.pos++;
            const e = this.expression();
            this.expect(")");
            return e;
        }
        if (t.type == "word" && (t.text == "true" || t.text == "false")) {
            this.pos++;
            return { k: "bool", v: t.text == "true" };
        }
        if (t.type == "word" && t.text == "null") {
            this.pos++;
            return { k: "null" };
        }
        if ((t.type == "word" || t.type == "num") && !keywords.has(t.text)) {
            // A function call, such as GetBoolean (game, "lamp")
            if (t.type == "word" && this.is("(", 1) && !this.objectName()) {
                this.pos++;
                const args = this.arguments();
                return { k: "call", fn: t.text, args };
            }
            return this.path();
        }
        throw new ParseError(`unexpected "${t.text}"`);
    }

    // The name of one of the game's objects at the current token, which can be several words,
    // e.g. Room 551 Weather. Returns how many tokens it is, or 0.
    private objectName(): number {
        let best = 0;
        let name = "";
        for (let n = 0; n < 12; n++) {
            const t = this.peek(n);
            if (!t || (t.type != "word" && t.type != "num")) break;
            if (n > 0) {
                const gap = this.source.substring(this.peek(n - 1)!.end, t.start);
                if (gap != " ") break;
            }
            name += (n > 0 ? " " : "") + t.text;
            if (this.names.has(name)) best = n + 1;
        }
        return best;
    }

    // A name, or a dotted path such as player.parent or game.lamp
    private path(): QExpr {
        const parts: string[] = [];
        for (;;) {
            const t = this.peek();
            if (!t || (t.type != "word" && t.type != "num") || keywords.has(t.text)) throw new ParseError("expected a name");
            const words = this.objectName();
            if (words > 1) {
                parts.push(this.tokens.slice(this.pos, this.pos + words).map(w => w.text).join(" "));
                this.pos += words;
            }
            else {
                if (t.type == "num" && parts.length == 0 && words == 0) throw new ParseError("expected a name");
                parts.push(t.text);
                this.pos++;
            }
            if (!this.is(".")) return { k: "path", parts };
            this.pos++;
        }
    }
}
