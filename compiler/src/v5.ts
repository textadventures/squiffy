// Detects Squiffy 5 text processor syntax (e.g. {if x:yes}{else:no}, {x}, {@x+=1}), which
// Squiffy 6 replaced with Handlebars, and converts it to the equivalent Handlebars syntax.
// It also converts the other parts of a Squiffy 5 story that work differently now: @replace in
// links and on lines of their own, and the jQuery that Squiffy 5 loaded for the story's
// JavaScript (#660).
//
// Only story text is looked at for the text processor: JavaScript blocks, @ui blocks, snippets,
// directives like @set, Handlebars expressions ({{...}}) and Markdown code spans are all skipped.

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
    // A line of JavaScript, which uses jQuery. The editor doesn't mark these as problems, as
    // Squiffy 7 stories can load jQuery themselves.
    javascript?: true;
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
    // The index of the part of the script it's in (see Part)
    part: number;
    // It's @replace lines with JavaScript after them. In v5 they didn't start the text, as they
    // were read like @set, so the JavaScript after them was still JavaScript.
    beforeJs?: boolean;
}

// A section of the script, or the text before the first section, or a snippet: from one
// header line to the next. Passages that the conversion adds go at the end of their part.
interface Part {
    section: string | null;
    // Where the next part starts, or the end of the script
    end: number;
}

// A line of JavaScript
interface JsLine {
    start: number;
    end: number;
}

interface Link {
    // The link text, e.g. "Go" in [[Go]](cave, x=1)
    text: string;
    section: boolean;
    // What's in the brackets after it, split on commas as v5 did, e.g. ["cave", "x=1"]
    items: string[];
}

interface Command {
    start: number;
    // Exclusive
    end: number;
    inner: string;
    kind: CommandKind;
    link?: Link;
}

// "link" is a link with @replace in it, "replace" an @replace line, and "brace" a { or } that
// v5 showed as it was, next to a link or a command, which needs escaping now that links and
// commands are Handlebars: [[go]]} would be {{section "go"}}}
type CommandKind = "if" | "else" | "label" | "rotate" | "set" | "seen" | "embed" | "attribute" | "link" | "replace" | "brace";

interface Names {
    sections: Set<string>;
    passages: Map<string, Set<string>>;
}

interface Problem {
    // Offset into the script
    offset: number;
    text: string;
    reason: string;
    javascript?: true;
}

// Passages that the conversion adds to a part of the script, for links with @replace
interface AddedPassages {
    // The passage names in the section, including the ones added
    used: Set<string>;
    // Each added passage, with its header
    added: string[];
}

class ConversionError extends Error {}

const sectionRegex = /^\[\[(.*)\]\]:$/;
const snippetRegex = /^\[snippet:\s*(.+)\]:$/;
const passageRegex = /^\[(.*)\]:$/;
const directiveRegex = /^@(title|import|start|set|unset|ui) |^@(inc|dec) \S+(?: \d+)?$|^@(clear|ui)$/;
const jsRegex = /^(\t| {4})/;

// Attribute names can have letters from any language in them, e.g. Zähler
const identifierRegex = /^[\p{L}_][\p{L}\p{N}_]*$/u;
const numberRegex = /^-?\d+(\.\d+)?$/;
const reservedWords = new Set(["if", "else", "this", "true", "false", "null", "undefined", "and", "or", "not"]);

// v5's link patterns, in squiffy 5's compiler.js
const sectionLinkRegex = /\[\[([^\]]*?)\]\]\((.*?)\)/y;
const passageLinkRegex = /\[([^\]]*?)\]\(((?!https?:\/\/).*?)\)/y;
// An @replace line: label=text
const replaceLineRegex = /^[ \t]*@replace (.*)$/;

// Finds the parts of the script that the compiler treats as story text, and its JavaScript.
// This mirrors the line handling in compile(), in compiler.ts.
function findTextBlocks(script: string): { blocks: TextBlock[], names: Names, parts: Part[], js: JsLine[] } {
    const blocks: TextBlock[] = [];
    const names: Names = { sections: new Set(), passages: new Map() };
    const parts: Part[] = [{ section: null, end: script.length }];
    const js: JsLine[] = [];
    let section: string | null = null;
    let textStarted = false;
    let inUiBlock = false;
    let inSnippet = false;
    let block: TextBlock | null = null;
    // Blocks of @replace lines before the text starts, which JavaScript could follow
    let replaceBlocks: TextBlock[] = [];
    let offset = 0;
    let autoSectionCount = 0;

    const endBlock = () => {
        if (block) {
            blocks.push(block);
            block = null;
        }
    };
    const newPart = (lineStart: number) => {
        parts[parts.length - 1].end = lineStart;
        parts.push({ section, end: script.length });
    };

    for (const line of script.split("\n")) {
        const lineStart = offset;
        offset += line.length + 1;
        const stripLine = line.trim();
        let isText = false;
        let isReplace = false;

        let match: RegExpExecArray | null;
        if (snippetRegex.test(stripLine)) {
            inSnippet = true;
            section = null;
            textStarted = false;
            replaceBlocks = [];
            newPart(lineStart);
        }
        else if ((match = sectionRegex.exec(stripLine))) {
            inSnippet = false;
            section = match[1];
            names.sections.add(section);
            textStarted = false;
            replaceBlocks = [];
            newPart(lineStart);
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
            replaceBlocks = [];
        }
        else if (stripLine.startsWith("+++") || stripLine == "---") {
            // These start a new automatically-named section
            if (stripLine == "---") inUiBlock = false;
            autoSectionCount++;
            section = `${autoSectionCount}`;
            textStarted = false;
            replaceBlocks = [];
            newPart(lineStart);
        }
        else if (directiveRegex.test(stripLine)) {
            if (stripLine == "@ui") inUiBlock = true;
            // A line like @set in the middle of the text is taken out of it, so the text before and
            // after it is one text, and a command can go across it. findCommands skips the line.
            else if (textStarted && !inUiBlock) isText = true;
        }
        else if (!inUiBlock && replaceLineRegex.test(stripLine)) {
            // v5 read @replace lines like @set, so they didn't start the text. Squiffy 7 reads them
            // as text, which is what they're converted to.
            isText = true;
            isReplace = !textStarted;
        }
        else if (!textStarted && jsRegex.test(line)) {
            if (!inUiBlock) {
                js.push({ start: lineStart, end: lineStart + line.length });
                for (const replaceBlock of replaceBlocks) replaceBlock.beforeJs = true;
            }
        }
        else if ((textStarted || stripLine.length > 0) && !inUiBlock) {
            textStarted = true;
            replaceBlocks = [];
            isText = true;
        }

        if (isText) {
            if (block) {
                block.end = lineStart + line.length;
            }
            else {
                block = { start: lineStart, end: lineStart + line.length, section, part: parts.length - 1 };
            }
            if (isReplace && !replaceBlocks.includes(block)) replaceBlocks.push(block);
        }
        else {
            endBlock();
        }
    }
    endBlock();

    return { blocks, names, parts, js };
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

// The link that starts at i, if there is one
function linkAt(text: string, i: number): { link: Link, end: number } | null {
    for (const [regex, section] of [[sectionLinkRegex, true], [passageLinkRegex, false]] as const) {
        regex.lastIndex = i;
        const match = regex.exec(text);
        if (match) {
            return { link: { text: match[1], section, items: match[2].split(",").map(item => item.trim()) }, end: regex.lastIndex };
        }
    }
    return null;
}

// Finds the top-level v5 commands in some text. Handlebars expressions and Markdown code
// spans are skipped. startsLine is whether the text starts at the start of a line in the
// script, which an @replace line has to.
function findCommands(text: string, section: string | null, names: Names, startsLine = false): Command[] {
    const commands: Command[] = [];
    // The number of {s that aren't commands, whose } is still to come
    let unclosed = 0;
    let i = 0;
    while (i < text.length) {
        if (text.startsWith("{{", i)) {
            // A comment ends at --}}, and can have }} in it before that
            const closeToken = text.startsWith("{{!--", i) ? "--}}" : text.startsWith("{{{", i) ? "}}}" : "}}";
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
        if ((i == 0 && startsLine) || (i > 0 && text[i - 1] == "\n")) {
            const lineEnd = text.indexOf("\n", i);
            const end = lineEnd == -1 ? text.length : lineEnd;
            const line = text.slice(i, end);
            if (replaceLineRegex.test(line)) {
                commands.push({ start: i, end, inner: line, kind: "replace" });
                i = end;
                continue;
            }
            if (directiveRegex.test(line.trim())) {
                i = end;
                continue;
            }
        }
        if (text[i] == "[") {
            const found = linkAt(text, i);
            if (found && found.link.items.some(item => item.startsWith("@replace "))) {
                commands.push({ start: i, end: found.end, inner: text.slice(i, found.end), kind: "link", link: found.link });
                i = found.end;
                continue;
            }
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
                unclosed++;
            }
            else if (text[i + 1] == "[" || text[i + 1] == "{") {
                commands.push({ start: i, end: i + 1, inner: "{", kind: "brace" });
            }
        }
        else if (text[i] == "}") {
            if (unclosed > 0) {
                unclosed--;
            }
            else if ("])}".includes(text[i - 1] ?? "")) {
                // After a link, or a command, which ends with }} once it's converted
                commands.push({ start: i, end: i + 1, inner: "}", kind: "brace" });
            }
        }
        i++;
    }
    return commands;
}

// What processing some v5 text could do that matters to an {else:...} after it: run an {if}, which
// the {else} would then belong to, or change an attribute, which could change what the {if}
// before it found
interface Effects {
    ifs: boolean;
    changes: boolean;
}

function effects(text: string, section: string | null, names: Names): Effects {
    // Handlebars could do anything
    const result: Effects = { ifs: false, changes: text.includes("{{") };
    for (const command of findCommands(text, section, names)) {
        const effect = commandEffects(command, section, names);
        result.ifs ||= effect.ifs;
        result.changes ||= effect.changes;
    }
    return result;
}

function commandEffects(command: Command, section: string | null, names: Names): Effects {
    const none = { ifs: false, changes: false };
    switch (command.kind) {
        case "if":
            return { ifs: true, changes: effects(command.inner.substring(command.inner.indexOf(":") + 1), section, names).changes };
        case "else":
            return effects(command.inner.substring("else:".length), section, names);
        case "label": {
            const eq = command.inner.indexOf("=");
            return eq == -1 ? none : effects(command.inner.substring(eq + 1), section, names);
        }
        case "set":
            return { ifs: false, changes: true };
        case "embed":
            // The section or passage could have anything in it
            return { ifs: true, changes: true };
        case "rotate":
            // {rotate attribute:...} sets the attribute when it's shown
            return { ifs: false, changes: command.inner[command.inner.startsWith("rotate") ? 6 : 8] == " " };
        default:
            return none;
    }
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
    const comparison = /^([\p{L}\p{N}_ ]*)(=|<=|>=|<>|<|>)(.*)$/u.exec(condition);
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

const replaceMessage = "@replace can't be converted here. In Squiffy 6, use {{#replace \"label\"}}...{{/replace}}";

function convertSetter(setter: string): string {
    if (setter.startsWith("@replace ")) {
        throw new ConversionError(replaceMessage);
    }
    if (setter.includes(":=")) {
        throw new ConversionError("':=' can't be converted automatically");
    }
    const set = /^([\p{L}\p{N}_]*)\s*=\s*(.*)$/u.exec(setter);
    if (set) {
        const name = attributeName(set[1], "attribute name");
        const rhs = set[2].trim();
        const rhsValue = rhs.startsWith("@") ? attributeName(rhs.substring(1), "attribute name") : value(rhs);
        return `{{set ${quote(name)} ${rhsValue}}}`;
    }
    const incDec = /^([\p{L}\p{N}_]*)\s*([+\-*/])=\s*(.*)$/u.exec(setter);
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

// label=text, from @replace label=text, as v5's replaceLabel read it
function replacement(expr: string): { label: string, text: string } {
    const match = /^(\w*)\s*=\s*(.*)$/.exec(expr);
    if (!match || !match[1]) {
        throw new ConversionError(`'${expr}' isn't a label name, then '=', then the text to replace it with`);
    }
    return { label: match[1], text: match[2] };
}

// Text that's fine as a passage name, and as the text of a link to it
const passageNameRegex = /^[^[\](){}`<>@*_\\,=\s](?:[^[\](){}`<>*_\\,=]*[^[\](){}`<>*_\\,=\s])?$/;

// The last {if} before an {else:...} that doesn't directly follow it. In v5, {else:...} shows its
// text if the last {if} that ran was false.
type LastIf = { condition: string, changed: boolean } | { problem: string } | null;

class Converter {
    problems: Problem[] = [];
    converted = 0;

    constructor(private names: Names, private section: string | null, readonly passages: AddedPassages, private beforeJs = false) {}

    // Converts the v5 commands in some text. base is the text's offset in the script,
    // so that problems can be reported with the right line number. startsLine is whether
    // the text starts at the start of a line.
    convertText(text: string, base: number, startsLine = false): string {
        const commands = findCommands(text, this.section, this.names, startsLine);
        let output = "";
        let pos = 0;
        let lastIf = null as LastIf;
        // Something that could run an {if}, or change an attribute, after the last {if}
        const after = (effect: Effects, what: string) => {
            if (!lastIf || !("condition" in lastIf)) return;
            if (effect.ifs) lastIf = { problem: `${what} between them could run an {if} of its own, which it would then belong to` };
            else if (effect.changes) lastIf.changed = true;
        };

        for (let i = 0; i < commands.length; i++) {
            const command = commands[i];
            const before = text.slice(pos, command.start);
            output += before;
            after({ ifs: false, changes: before.includes("{{") }, "Handlebars");
            pos = command.end;

            const original = text.slice(command.start, command.end);
            const report = (reason: string) => {
                this.problems.push({ offset: base + command.start, text: original, reason });
                output += original;
            };

            if (command.kind == "else") {
                const elseText = command.inner.substring("else:".length);
                const elseBase = base + command.start + 1 + "else:".length;
                if (!lastIf) {
                    report("there's no {if ...:...} before this {else:...} in the same text, so it's not clear which {if} it belongs to");
                }
                else if ("problem" in lastIf) {
                    report(`it's not clear which {if} this {else:...} belongs to: ${lastIf.problem}`);
                }
                else if (lastIf.changed) {
                    report("this {else:...} doesn't directly follow its {if}, and something between them could change what the {if} depends on");
                }
                else {
                    output += `{{#unless ${lastIf.condition}}}${this.convertText(elseText, elseBase)}{{/unless}}`;
                    this.converted++;
                }
                after(effects(elseText, this.section, this.names), "the {else:...} before this one");
                continue;
            }

            if (command.kind == "if") {
                const next = commands[i + 1];
                const between = next ? text.slice(command.end, next.start) : "";
                const hasElse = next?.kind == "else" && /^\s*$/.test(between);
                const colon = command.inner.indexOf(":");
                const ifText = command.inner.substring(colon + 1);

                let condition: string;
                try {
                    condition = convertCondition(command.inner.substring(3, colon).trim());
                }
                catch (e) {
                    if (!(e instanceof ConversionError)) throw e;
                    report(`the condition can't be converted: ${e.message}`);
                    lastIf = { problem: "the {if} before it can't be converted" };
                    continue;
                }

                // In v5, an {if} remembers whether it was true after the text inside it has run,
                // so an {if} nested inside it doesn't change which one an {else} belongs to
                const ifBase = base + command.start + 1 + colon + 1;
                output += `{{#if ${condition}}}${this.convertText(ifText, ifBase)}`;
                this.converted++;
                lastIf = { condition, changed: effects(ifText, this.section, this.names).changes };
                if (hasElse) {
                    const elseText = next.inner.substring("else:".length);
                    const elseBase = base + next.start + 1 + "else:".length;
                    output += `${between}{{else}}${this.convertText(elseText, elseBase)}`;
                    this.converted++;
                    after(effects(elseText, this.section, this.names), "the {else:...} before this one");
                    pos = next.end;
                    i++;
                }
                output += "{{/if}}";
                continue;
            }

            if (command.kind == "label") {
                after(commandEffects(command, this.section, this.names), "the {label:...}");
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

            after(commandEffects(command, this.section, this.names), command.kind == "embed" ? "the section or passage embedded" : "a command");

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
                    case "link":
                        result = this.convertLink(command.link!, base + command.start);
                        break;
                    case "replace":
                        result = this.convertReplaceLine(command.inner, base + command.start);
                        break;
                    case "brace":
                        // An HTML entity, so it doesn't make a link's }} into }}}
                        result = command.inner == "{" ? "&#123;" : "&#125;";
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

    // The text to replace a label with, from @replace in a link: in v5, a passage in the section,
    // or a section, if it names one
    private replacementText(text: string, base: number): string {
        if ((this.section !== null && this.names.passages.get(this.section)?.has(text)) || this.names.sections.has(text)) {
            return `{{embed ${quote(text)}}}`;
        }
        return this.convertText(text, base);
    }

    // In v5, a passage link could replace labels, e.g. [eat it](@replace 1=nothing, full). Squiffy 7
    // replaces them from a passage's text, so that's a new passage, added to the end of the
    // section, for the link to go to.
    private convertLink(link: Link, base: number): string {
        const replaces = link.items.filter(item => item.startsWith("@replace ")).map(item => replacement(item.substring("@replace ".length)));
        if (!link.items[0].startsWith("@replace ")) {
            throw new ConversionError(`a link can't replace a label in Squiffy 7. Take the @replace out of the link, and put {{#replace "${replaces[0].label}"}}...{{/replace}} in the ${link.section ? "section" : "passage"} it goes to`);
        }
        if (link.section) {
            throw new ConversionError("this section link doesn't name a section to go to");
        }
        const setters = link.items.filter(item => !item.startsWith("@replace "));
        const text = replaces.map(r => `{{#replace ${quote(r.label)}}}${this.replacementText(r.text, base)}{{/replace}}`).join("");

        const used = this.passages.used;
        const simple = passageNameRegex.test(link.text);
        let name = link.text;
        if (!simple || used.has(name)) {
            const stem = simple ? link.text : `replace ${replaces[0].label}`;
            name = stem;
            for (let n = 2; used.has(name); n++) name = `${stem} ${n}`;
        }
        used.add(name);
        this.passages.added.push(`[${name}]:\n${text}`);

        const target = [...(name == link.text && setters.length == 0 ? [] : [name]), ...setters];
        return target.length ? `[${link.text}](${target.join(", ")})` : `[${link.text}]`;
    }

    // An @replace line, which replaces a label when the section or passage is shown
    private convertReplaceLine(line: string, base: number): string {
        if (this.beforeJs) {
            throw new ConversionError("there's JavaScript after it, which would be read as text once this line is converted. Move this line below the JavaScript, then convert again");
        }
        const expr = replaceLineRegex.exec(line)![1];
        // v5 split it at the first "=", then read the label from what's before it
        const eq = expr.indexOf("=");
        const { label } = replacement(eq == -1 ? expr : expr.substring(0, eq).trim() + "=");
        const text = expr.substring(eq + 1).trimStart();
        return `{{#replace ${quote(label)}}}${this.convertText(text, base + line.length - text.length)}{{/replace}}`;
    }
}

const jQueryRegex = /(?<![\w$.])(?:jQuery|\$)\s*[(.]/;
// jQuery("#id"), and what can follow it before .val()
const jQuerySelectorRegex = /(?<![\w$.])(?:jQuery|\$)\(\s*(["'])#([\w-]+)\1\s*\)/g;
const disableRegex = /\.prop\(\s*(["'])disabled\1\s*,\s*true\s*\)/y;
const removeIdRegex = /\.removeAttr\(\s*(["'])id\1\s*\)/y;
const valRegex = /\.val\(\s*\)/y;

// Converts a line of JavaScript's jQuery("#id").val(), which is how the v5 docs said to read a text
// box (#660), to the browser's own methods. Squiffy 7 doesn't load jQuery.
function convertJsLine(line: string): { line: string, converted: number } {
    let output = "";
    let pos = 0;
    let converted = 0;
    for (const match of line.matchAll(jQuerySelectorRegex)) {
        if (match.index < pos) continue;
        let i = match.index + match[0].length;
        let disable = false;
        let removeId = false;
        for (;;) {
            disableRegex.lastIndex = i;
            removeIdRegex.lastIndex = i;
            if (disableRegex.test(line)) {
                disable = true;
                i = disableRegex.lastIndex;
            }
            else if (removeIdRegex.test(line)) {
                removeId = true;
                i = removeIdRegex.lastIndex;
            }
            else break;
        }
        valRegex.lastIndex = i;
        if (!valRegex.test(line)) continue;
        const element = `document.getElementById(${quote(match[2])})`;
        const replacement = !disable && !removeId
            ? `${element}?.value`
            : `(element => { if (!element) return undefined; ${disable ? "element.disabled = true; " : ""}${removeId ? "element.removeAttribute(\"id\"); " : ""}return element.value; })(${element})`;
        output += line.slice(pos, match.index) + replacement;
        pos = valRegex.lastIndex;
        converted++;
    }
    return { line: output + line.slice(pos), converted };
}

// A link's text is in quotes once it's compiled ({{section "cave" text="..."}}), so text in
// quotes in Handlebars in it, as in [[Talk to {{#if dad = "yes"}}Dad{{/if}}]](talk), is in single
// quotes instead
function singleQuoteLinkText(text: string): string {
    return text.replace(/(\[\[?)([^\]]*?)(\]\]?\()/g, (link, open: string, linkText: string, close: string) =>
        open + linkText.replace(/\{\{[^}]*\}\}/g, expression => expression.replace(/"([^"'\\]*)"/g, "'$1'")) + close);
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

function addedPassages(names: Names, section: string | null): AddedPassages {
    return { used: new Set(section === null ? [] : names.passages.get(section)), added: [] };
}

// Finds Squiffy 5 text processor commands in a script, and links and lines with @replace.
// Nested commands aren't listed separately from the command that contains them.
export function findV5Syntax(script: string): V5SyntaxMatch[] {
    script = normaliseLineEndings(script);
    const { blocks, names } = findTextBlocks(script);
    const lineAt = lineFinder(script);
    const result: V5SyntaxMatch[] = [];

    for (const block of blocks) {
        const text = script.slice(block.start, block.end);
        for (const command of findCommands(text, block.section, names, true)) {
            // A stray brace is fine in Squiffy 5 and 7, so long as it's not next to a link
            if (command.kind == "brace") continue;
            const original = text.slice(command.start, command.end);
            const match: V5SyntaxMatch = { line: lineAt(block.start + command.start), text: original };
            if (command.kind != "else") {
                const converter = new Converter(names, block.section, addedPassages(names, block.section), block.beforeJs);
                const converted = converter.convertText(original, 0, true);
                if (converter.problems.length == 0 && converter.passages.added.length == 0) {
                    match.suggestion = converted;
                }
            }
            result.push(match);
        }
    }

    return result;
}

// Converts Squiffy 5 text processor commands in a script to Squiffy 6 Handlebars syntax, and
// the other Squiffy 5 things that work differently now (see the top of this file). Anything that
// can't be converted reliably is left as-is and listed in the problems.
export function convertV5Syntax(script: string): V5ConversionResult {
    const crlf = script.includes("\r\n");
    script = normaliseLineEndings(script);
    const { blocks, names, parts, js } = findTextBlocks(script);
    const lineAt = lineFinder(script);
    const passages = parts.map(part => addedPassages(names, part.section));
    const edits: { start: number, end: number, text: string }[] = [];
    let converted = 0;
    const problems: Problem[] = [];

    for (const block of blocks) {
        const converter = new Converter(names, block.section, passages[block.part], block.beforeJs);
        edits.push({ start: block.start, end: block.end, text: singleQuoteLinkText(converter.convertText(script.slice(block.start, block.end), block.start, true)) });
        converted += converter.converted;
        problems.push(...converter.problems);
    }

    for (const line of js) {
        const result = convertJsLine(script.slice(line.start, line.end));
        if (result.converted) {
            edits.push({ start: line.start, end: line.end, text: result.line });
            converted += result.converted;
        }
        if (jQueryRegex.test(result.line)) {
            problems.push({
                offset: line.start,
                text: result.line.trim(),
                reason: "this JavaScript uses jQuery, which Squiffy 7 doesn't load. Use the browser's own methods, such as document.getElementById(\"id\"), instead",
                javascript: true,
            });
        }
    }

    // The passages added for links with @replace, at the end of their section
    parts.forEach((part, i) => {
        if (passages[i].added.length == 0) return;
        const text = passages[i].added.join("\n\n");
        const at = part.end;
        if (at == script.length) {
            edits.push({ start: at, end: at, text: (script.endsWith("\n") ? "\n" : "\n\n") + text + (script.endsWith("\n") ? "\n" : "") });
        }
        else {
            edits.push({ start: at, end: at, text: (script.slice(0, at).endsWith("\n\n") ? "" : "\n") + text + "\n\n" });
        }
    });

    edits.sort((a, b) => a.start - b.start);
    let output = "";
    let pos = 0;
    for (const edit of edits) {
        output += script.slice(pos, edit.start) + edit.text;
        pos = edit.end;
    }
    output += script.slice(pos);

    problems.sort((a, b) => a.offset - b.offset);
    return {
        script: crlf ? output.replace(/\n/g, "\r\n") : output,
        converted,
        problems: problems.map(p => ({ line: lineAt(p.offset), text: p.text, reason: p.reason, ...(p.javascript ? { javascript: true as const } : {}) })),
    };
}
