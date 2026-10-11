// Detects Squiffy 5 text processor syntax (e.g. {if x:yes}{else:no}, {x}, {@x+=1}), which
// Squiffy 6 replaced with Handlebars, and converts it to the equivalent Handlebars syntax.
//
// Only story text is looked at: JavaScript blocks, @ui blocks, snippets, directives like @set,
// Handlebars expressions ({{...}}) and Markdown code spans are all skipped.

export interface V5SyntaxMatch {
    // 1-based line number in the script
    line: number;
    // The v5 text, e.g. "{if x:yes}"
    text: string;
    // The Squiffy 6 equivalent, if it can be converted on its own
    suggestion?: string;
}

export interface V5ConversionProblem {
    line: number;
    text: string;
    reason: string;
}

export interface V5ConversionResult {
    script: string;
    // The number of v5 commands converted
    converted: number;
    // v5 commands that were left as-is, because they couldn't be converted reliably
    problems: V5ConversionProblem[];
}

interface TextBlock {
    // Offsets into the (\n-normalised) script
    start: number;
    end: number;
    // Name of the section the block belongs to, if any
    section: string | null;
}

interface Command {
    start: number;
    // Exclusive
    end: number;
    inner: string;
    kind: CommandKind;
}

type CommandKind = "if" | "else" | "label" | "rotate" | "set" | "seen" | "embed" | "attribute";

interface Names {
    sections: Set<string>;
    passages: Map<string, Set<string>>;
}

interface Problem {
    // Offset into the script
    offset: number;
    text: string;
    reason: string;
}

class ConversionError extends Error {}

const sectionRegex = /^\[\[(.*)\]\]:$/;
const snippetRegex = /^\[snippet:\s*(.+)\]:$/;
const passageRegex = /^\[(.*)\]:$/;
const directiveRegex = /^@(title|import|start|set|unset|ui) |^@(inc|dec) \S+(?: \d+)?$|^@(clear|ui)$/;
const jsRegex = /^(\t| {4})/;

const identifierRegex = /^[A-Za-z_]\w*$/;
const numberRegex = /^-?\d+(\.\d+)?$/;
const reservedWords = new Set(["if", "else", "this", "true", "false", "null", "undefined", "and", "or", "not"]);

// Finds the parts of the script that the compiler treats as story text. This mirrors the
// line handling in compile(), in compiler.ts.
function findTextBlocks(script: string): { blocks: TextBlock[], names: Names } {
    const blocks: TextBlock[] = [];
    const names: Names = { sections: new Set(), passages: new Map() };
    let section: string | null = null;
    let textStarted = false;
    let inUiBlock = false;
    let inSnippet = false;
    let block: TextBlock | null = null;
    let offset = 0;
    let autoSectionCount = 0;

    const endBlock = () => {
        if (block) {
            blocks.push(block);
            block = null;
        }
    };

    for (const line of script.split("\n")) {
        const lineStart = offset;
        offset += line.length + 1;
        const stripLine = line.trim();
        let isText = false;

        let match: RegExpExecArray | null;
        if (snippetRegex.test(stripLine)) {
            inSnippet = true;
            section = null;
            textStarted = false;
        }
        else if ((match = sectionRegex.exec(stripLine))) {
            inSnippet = false;
            section = match[1];
            names.sections.add(section);
            textStarted = false;
        }
        else if (inSnippet) {
            // snippets aren't compiled
        }
        else if ((match = passageRegex.exec(stripLine))) {
            if (section !== null) {
                if (!names.passages.has(section)) names.passages.set(section, new Set());
                names.passages.get(section)!.add(match[1]);
            }
            textStarted = false;
        }
        else if (stripLine.startsWith("+++") || stripLine == "---") {
            // These start a new automatically-named section
            if (stripLine == "---") inUiBlock = false;
            autoSectionCount++;
            section = `\uE000${autoSectionCount}`;
            textStarted = false;
        }
        else if (directiveRegex.test(stripLine)) {
            if (stripLine == "@ui") inUiBlock = true;
        }
        else if (!textStarted && jsRegex.test(line)) {
            // JavaScript
        }
        else if ((textStarted || stripLine.length > 0) && !inUiBlock) {
            textStarted = true;
            isText = true;
        }

        if (isText) {
            if (block) {
                block.end = lineStart + line.length;
            }
            else {
                block = { start: lineStart, end: lineStart + line.length, section };
            }
        }
        else {
            endBlock();
        }
    }
    endBlock();

    return { blocks, names };
}

function findClose(text: string, open: number): number {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] == "{") depth++;
        else if (text[i] == "}") {
            depth--;
            if (depth == 0) return i;
        }
    }
    return -1;
}

function classify(inner: string, section: string | null, names: Names): CommandKind | null {
    if (/^if\s/.test(inner) && inner.includes(":")) return "if";
    if (inner.startsWith("else:")) return "else";
    if (inner.startsWith("label:")) return "label";
    if (/^(rotate|sequence)[: ]/.test(inner)) return "rotate";
    if (/^@\S/.test(inner)) return "set";
    if (/^seen\s+\S/.test(inner)) return "seen";
    if ((section !== null && names.passages.get(section)?.has(inner)) || names.sections.has(inner)) return "embed";
    if (identifierRegex.test(inner) && !reservedWords.has(inner)) return "attribute";
    return null;
}

// Finds the top-level v5 commands in some text. Handlebars expressions and Markdown code
// spans are skipped.
function findCommands(text: string, section: string | null, names: Names): Command[] {
    const commands: Command[] = [];
    let i = 0;
    while (i < text.length) {
        if (text.startsWith("{{", i)) {
            const closeToken = text.startsWith("{{{", i) ? "}}}" : "}}";
            const close = text.indexOf(closeToken, i + 2);
            i = close == -1 ? i + 2 : close + closeToken.length;
            continue;
        }
        if (text[i] == "`") {
            const fence = /^`+/.exec(text.slice(i))![0];
            const close = text.indexOf(fence, i + fence.length);
            i = close == -1 ? i + fence.length : close + fence.length;
            continue;
        }
        if (text[i] == "{") {
            const close = findClose(text, i);
            if (close != -1) {
                const inner = text.slice(i + 1, close);
                const kind = classify(inner, section, names);
                if (kind) {
                    commands.push({ start: i, end: close + 1, inner, kind });
                    i = close + 1;
                    continue;
                }
            }
        }
        i++;
    }
    return commands;
}

function quote(s: string): string {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

function value(s: string): string {
    if (numberRegex.test(s)) return s;
    return quote(s);
}

function attributeName(s: string, what: string): string {
    s = s.trim();
    if (!identifierRegex.test(s) || reservedWords.has(s)) {
        throw new ConversionError(`'${s}' isn't a valid ${what}`);
    }
    return s;
}

function convertCondition(condition: string): string {
    const comparison = /^([\w ]*)(=|<=|>=|<>|<|>)(.*)$/.exec(condition);
    if (comparison) {
        const lhs = attributeName(comparison[1], "attribute name");
        const op = comparison[2] == "<>" ? "!=" : comparison[2];
        const rhs = comparison[3].trim();
        const rhsValue = rhs.startsWith("@") ? attributeName(rhs.substring(1), "attribute name") : value(rhs);
        return `${lhs} ${op} ${rhsValue}`;
    }

    let prefix = "";
    if (condition.startsWith("not ")) {
        prefix = "not ";
        condition = condition.substring(4);
    }
    if (condition.startsWith("seen ")) {
        return `${prefix}(seen ${quote(condition.substring(5).trim())})`;
    }
    return prefix + attributeName(condition, "condition");
}

const replaceMessage = "@replace can't be converted automatically. In Squiffy 6, use {{#replace \"label\"}}...{{/replace}}";

function convertSetter(setter: string): string {
    if (setter.startsWith("@replace ")) {
        throw new ConversionError(replaceMessage);
    }
    if (setter.includes(":=")) {
        throw new ConversionError("':=' can't be converted automatically");
    }
    const set = /^(\w*)\s*=\s*(.*)$/.exec(setter);
    if (set) {
        const name = attributeName(set[1], "attribute name");
        const rhs = set[2].trim();
        const rhsValue = rhs.startsWith("@") ? attributeName(rhs.substring(1), "attribute name") : value(rhs);
        return `{{set ${quote(name)} ${rhsValue}}}`;
    }
    const incDec = /^(\w*)\s*([+\-*/])=\s*(.*)$/.exec(setter);
    if (incDec) {
        const name = attributeName(incDec[1], "attribute name");
        const op = incDec[2];
        if (op == "*" || op == "/") {
            throw new ConversionError(`'${op}=' has no equivalent helper in Squiffy 6`);
        }
        const rhs = incDec[3].trim();
        let amount: string;
        if (rhs.startsWith("@")) {
            amount = attributeName(rhs.substring(1), "attribute name");
        }
        else if (numberRegex.test(rhs)) {
            amount = rhs;
        }
        else {
            throw new ConversionError(`'${rhs}' isn't a number`);
        }
        const helper = op == "+" ? "inc" : "dec";
        return amount == "1" ? `{{${helper} ${quote(name)}}}` : `{{${helper} ${quote(name)} ${amount}}}`;
    }
    if (setter.startsWith("not ")) {
        return `{{unset ${quote(attributeName(setter.substring(4), "attribute name"))}}}`;
    }
    return `{{set ${quote(attributeName(setter, "attribute name"))} true}}`;
}

function convertRotate(inner: string): string {
    const type = inner.startsWith("rotate") ? "rotate" : "sequence";
    let options: string;
    let attribute = "";
    if (inner[type.length] == " ") {
        const colon = inner.indexOf(":");
        if (colon == -1) {
            throw new ConversionError("there's no ':' before the options");
        }
        attribute = attributeName(inner.substring(type.length + 1, colon), "attribute name");
        options = inner.substring(colon + 1);
    }
    else {
        options = inner.substring(type.length + 1);
    }
    if (options.includes("{")) {
        throw new ConversionError("the options contain text processor commands");
    }
    const items = options.split(":").map(quote).join(" ");
    return `{{${type} (array ${items})${attribute ? ` set=${quote(attribute)}` : ""}}}`;
}

class Converter {
    problems: Problem[] = [];
    converted = 0;

    constructor(private names: Names, private section: string | null) {}

    // Converts the v5 commands in some text. base is the text's offset in the script,
    // so that problems can be reported with the right line number.
    convertText(text: string, base: number): string {
        const commands = findCommands(text, this.section, this.names);
        let output = "";
        let pos = 0;
        for (let i = 0; i < commands.length; i++) {
            const command = commands[i];
            output += text.slice(pos, command.start);
            pos = command.end;

            const original = text.slice(command.start, command.end);
            const report = (reason: string) => {
                this.problems.push({ offset: base + command.start, text: original, reason });
                output += original;
            };

            if (command.kind == "else") {
                report("this {else:...} doesn't directly follow an {if ...:...}, so it's not clear which {if} it belongs to");
                continue;
            }

            if (command.kind == "if") {
                const next = commands[i + 1];
                const between = next ? text.slice(command.end, next.start) : "";
                const hasElse = next?.kind == "else" && /^\s*$/.test(between);
                const colon = command.inner.indexOf(":");
                const ifText = command.inner.substring(colon + 1);

                if (hasElse && findCommands(ifText, this.section, this.names).some(c => c.kind == "if")) {
                    // In v5, an {else} pairs with the last {if} that ran, which could be this one or
                    // one nested inside it.
                    report("this {if} contains another {if} and is followed by an {else}, so it's not clear which {if} the {else} belongs to");
                    continue;
                }

                let condition: string;
                try {
                    condition = convertCondition(command.inner.substring(3, colon).trim());
                }
                catch (e) {
                    if (!(e instanceof ConversionError)) throw e;
                    report(`the condition can't be converted: ${e.message}`);
                    continue;
                }

                const ifBase = base + command.start + 1 + colon + 1;
                output += `{{#if ${condition}}}${this.convertText(ifText, ifBase)}`;
                this.converted++;
                if (hasElse) {
                    const elseText = next.inner.substring("else:".length);
                    const elseBase = base + next.start + 1 + "else:".length;
                    output += `${between}{{else}}${this.convertText(elseText, elseBase)}`;
                    this.converted++;
                    pos = next.end;
                    i++;
                }
                output += "{{/if}}";
                continue;
            }

            if (command.kind == "label") {
                const eq = command.inner.indexOf("=");
                if (eq == -1) {
                    report("there's no '=' after the label name");
                    continue;
                }
                const name = command.inner.substring("label:".length, eq).trim();
                if (!/^\w+$/.test(name)) {
                    report(`'${name}' isn't a valid label name`);
                    continue;
                }
                const labelText = command.inner.substring(eq + 1);
                const labelBase = base + command.start + 1 + eq + 1;
                output += `{{#label ${quote(name)}}}${this.convertText(labelText, labelBase)}{{/label}}`;
                this.converted++;
                continue;
            }

            if (command.kind == "seen") {
                report("{seen ...} only works as an {if} condition. In Squiffy 6, use {{#if (seen \"name\")}}...{{/if}}");
                continue;
            }

            let result: string;
            try {
                switch (command.kind) {
                    case "rotate":
                        result = convertRotate(command.inner);
                        break;
                    case "set":
                        if (command.inner.startsWith("@replace ")) {
                            throw new ConversionError(replaceMessage);
                        }
                        result = command.inner.substring(1).split(",").map(s => convertSetter(s.trim())).join("");
                        break;
                    case "embed":
                        result = `{{embed ${quote(command.inner)}}}`;
                        break;
                    case "attribute":
                        result = `{{${command.inner}}}`;
                        break;
                }
            }
            catch (e) {
                if (!(e instanceof ConversionError)) throw e;
                report(e.message);
                continue;
            }
            output += result;
            this.converted++;
        }
        output += text.slice(pos);
        return output;
    }
}

// Returns a function that converts an offset in the script to a 1-based line number
function lineFinder(script: string): (offset: number) => number {
    const lineStarts = [0];
    for (let i = 0; i < script.length; i++) {
        if (script[i] == "\n") lineStarts.push(i + 1);
    }
    return (offset: number) => {
        let low = 0;
        let high = lineStarts.length - 1;
        while (low < high) {
            const mid = Math.ceil((low + high) / 2);
            if (lineStarts[mid] <= offset) low = mid;
            else high = mid - 1;
        }
        return low + 1;
    };
}

function normaliseLineEndings(script: string) {
    return script.replace(/\r/g, "");
}

// Finds Squiffy 5 text processor commands in a script. Nested commands aren't listed
// separately from the command that contains them.
export function findV5Syntax(script: string): V5SyntaxMatch[] {
    script = normaliseLineEndings(script);
    const { blocks, names } = findTextBlocks(script);
    const lineAt = lineFinder(script);
    const result: V5SyntaxMatch[] = [];

    for (const block of blocks) {
        const text = script.slice(block.start, block.end);
        for (const command of findCommands(text, block.section, names)) {
            const original = text.slice(command.start, command.end);
            const match: V5SyntaxMatch = { line: lineAt(block.start + command.start), text: original };
            if (command.kind != "else") {
                const converter = new Converter(names, block.section);
                const converted = converter.convertText(original, 0);
                if (converter.problems.length == 0) {
                    match.suggestion = converted;
                }
            }
            result.push(match);
        }
    }

    return result;
}

// Converts Squiffy 5 text processor commands in a script to Squiffy 6 Handlebars syntax.
// Anything that can't be converted reliably is left as-is and listed in the problems.
export function convertV5Syntax(script: string): V5ConversionResult {
    const crlf = script.includes("\r\n");
    script = normaliseLineEndings(script);
    const { blocks, names } = findTextBlocks(script);
    const lineAt = lineFinder(script);
    let output = "";
    let pos = 0;
    let converted = 0;
    const problems: V5ConversionProblem[] = [];

    for (const block of blocks) {
        const converter = new Converter(names, block.section);
        output += script.slice(pos, block.start);
        output += converter.convertText(script.slice(block.start, block.end), block.start);
        pos = block.end;
        converted += converter.converted;
        problems.push(...converter.problems.map(p => ({ line: lineAt(p.offset), text: p.text, reason: p.reason })));
    }
    output += script.slice(pos);

    return {
        script: crlf ? output.replace(/\n/g, "\r\n") : output,
        converted,
        problems,
    };
}
