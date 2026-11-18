// Converts setters in @set, links and the set= option of {{section}} and {{passage}} from the
// Squiffy 6 rules to the rules of a story with a squiffy.json (#373), where the right-hand side is
// an expression, as in {{#if}}:
//
//   Squiffy 6                     With a squiffy.json
//   @set weapon = sword           @set weapon = "sword"
//   @set best = @score            @set best = score
//   @set gold += @price           @set gold += price
//   [[Go]](next, name = Bob)      [[Go]](next, name = "Bob")
//
// Numbers, true and false, flags (has_key, not has_key), := and @inc/@dec mean the same under
// both rules, so they're left alone. The Squiffy 6 rules are simple enough that the conversion is
// exact: a converted story runs the same as before, once it has a squiffy.json. Anything that
// can't be converted exactly is left as it is and listed as a problem.
//
// Conversion isn't idempotent: a converted @set best = score would be converted again to
// @set best = "score". So it's only for stories without a squiffy.json.

import { parse } from "./parse.js";
import type { LinkNode, Range, SectionNode, PassageNode, SnippetNode, SquiffyFile } from "./syntax.js";

export interface SetterConversionProblem {
    // 1-based line number
    line: number;
    text: string;
    reason: string;
}

export interface SetterConversionResult {
    script: string;
    // The number of setters changed
    converted: number;
    problems: SetterConversionProblem[];
}

// The result of converting one setter: its new text, or why it can't be converted
export type SetterConversion = { text: string } | { problem: string };

// The same as the tokenizer's numbers and literals in runtime/src/infixExpressions.ts
const numberPattern = /^-?\d+(\.\d+)?$/;
const reservedWords = new Set(["and", "or", "not", "true", "false", "null", "undefined"]);

// Text as a quoted string. preferSingle is for setters inside a set="..." string, where double
// quotes would need escaping.
function quote(text: string, preferSingle: boolean): string | null {
    // The tokenizer treats a backslash as escaping the next character, but Handlebars doesn't
    // remove it (except before a quote), so text with a backslash can't be written exactly
    if (text.includes("\\")) return null;
    const hasDouble = text.includes("\"");
    const hasSingle = text.includes("'");
    if (hasDouble && hasSingle) return null;
    if (hasDouble || (preferSingle && !hasSingle)) return `'${text}'`;
    return `"${text}"`;
}

// @name as an attribute in an expression: the name, or [name] if it isn't a plain word
function attribute(name: string): string | null {
    if (/^\w+$/.test(name) && !reservedWords.has(name) && !/^\d/.test(name)) return name;
    if (name === "" || name.includes("]")) return null;
    return `[${name}]`;
}

// The value side of name = value under the Squiffy 6 rules, as an expression
function convertValue(rhs: string, preferSingle: boolean): SetterConversion {
    if (rhs === "true" || rhs === "false") return { text: rhs };
    if (rhs === "") return { problem: "it has no value" };
    // Squiffy 6 treated anything that isn't NaN as a number, using parseFloat
    if (!isNaN(rhs as unknown as number)) {
        if (numberPattern.test(rhs)) return { text: rhs };
        const n = String(parseFloat(rhs));
        return numberPattern.test(n) ? { text: n } : { problem: `"${rhs}" isn't a plain number` };
    }
    if (rhs.startsWith("@")) {
        const name = attribute(rhs.substring(1));
        return name === null ? { problem: `"${rhs}" isn't an attribute name that can be converted` } : { text: name };
    }
    const quoted = quote(rhs, preferSingle);
    return quoted === null ? { problem: "the text has both kinds of quote, or a backslash, in it" } : { text: quoted };
}

// Converts one setter, e.g. "weapon = sword" to "weapon = \"sword\"". Whitespace around it is
// kept. The result is the same text if nothing needs changing.
export function convertSetter(setter: string, options: { preferSingleQuotes?: boolean } = {}): SetterConversion {
    const preferSingle = options.preferSingleQuotes ?? false;
    const leading = setter.match(/^\s*/)![0];
    const trailing = setter.substring(leading.length).match(/\s*$/)![0];
    const expr = setter.substring(leading.length, setter.length - trailing.length);
    const wrap = (c: SetterConversion): SetterConversion => "text" in c ? { text: leading + c.text + trailing } : c;

    // name := text processes {{...}} in the text, under both rules
    if (/^\w*\s*:=/.test(expr)) return { text: setter };

    const set = /^(\w*)(\s*=\s*)(.*)$/.exec(expr);
    if (set) {
        const [, lhs, eq, rhs] = set;
        if (!lhs) return { problem: "it has no attribute name before \"=\"" };
        const value = convertValue(rhs, preferSingle);
        return "text" in value ? wrap({ text: lhs + eq + value.text }) : value;
    }

    const operate = /^(\w*)(\s*[+\-*/]=\s*)(.*)$/.exec(expr);
    if (operate) {
        const [, lhs, op, rhs] = operate;
        if (!lhs) return { problem: "it has no attribute name" };
        const value = convertValue(rhs.trim(), preferSingle);
        return "text" in value ? wrap({ text: lhs + op + value.text }) : value;
    }

    // A flag: name or not name
    if (/^(not )?\w+$/.test(expr)) return { text: setter };
    return { problem: "it isn't an attribute name, or name = value" };
}

// Converts a comma-separated list of setters. Squiffy 6 split them on every comma.
function convertSetterList(setters: string, preferSingle: boolean): { text: string, converted: number, problems: string[] } {
    let converted = 0;
    const problems: string[] = [];
    const parts = setters.split(",").map(part => {
        if (part.trim() === "") return part;
        const result = convertSetter(part, { preferSingleQuotes: preferSingle });
        if ("problem" in result) {
            problems.push(`${part.trim()}: ${result.problem}`);
            return part;
        }
        if (result.text !== part) converted++;
        return result.text;
    });
    return { text: parts.join(","), converted, problems };
}

interface Edit {
    line: number;
    start: number;
    end: number;
    text: string;
}

// {{section ...}} or {{passage ...}} with a set="..." or set='...' string
const helperSetPattern = /\{\{~?\s*(?:section|passage)\b[^}]*?\bset=("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g;

// Converts every setter in a .squiffy file. See the top of this file.
export function convertSetters(script: string): SetterConversionResult {
    const crlf = script.includes("\r\n");
    const lines = script.replace(/\r/g, "").split("\n");
    const file = parse(script);
    const edits: Edit[] = [];
    const problems: SetterConversionProblem[] = [];
    let converted = 0;

    const problem = (line: number, text: string, reason: string) => {
        problems.push({ line: line + 1, text, reason });
    };
    const replace = (range: Range, text: string) => {
        edits.push({ line: range.start.line, start: range.start.character, end: range.end.character, text });
    };

    const containers: (SectionNode | PassageNode)[] = [];
    for (const section of [file.preamble, ...file.sections] as (SectionNode | SnippetNode)[]) {
        if (section.type !== "section") continue;
        containers.push(section, ...section.passages);
    }

    for (const container of containers) {
        for (const node of container.body) {
            if (node.type === "attribute" && node.directive === "set") {
                const result = convertSetter(node.value);
                if ("problem" in result) {
                    problem(node.range.start.line, node.value, result.problem);
                }
                else if (result.text !== node.value) {
                    replace(node.valueRange, result.text);
                    converted++;
                }
            }
            else if (node.type === "text") {
                for (const match of node.text.matchAll(helperSetPattern)) {
                    const literal = match[1];
                    const delimiter = literal[0];
                    // The setters as Handlebars reads the string
                    const inner = literal.slice(1, -1).replace(new RegExp(`\\\\${delimiter}`, "g"), delimiter);
                    const result = convertSetterList(inner, delimiter === "\"");
                    for (const reason of result.problems) problem(node.range.start.line, literal, reason);
                    if (result.converted) {
                        const escaped = result.text.replace(new RegExp(delimiter, "g"), `\\${delimiter}`);
                        const start = node.range.start.character + match.index! + match[0].length - literal.length;
                        replace({ start: { line: node.range.start.line, character: start }, end: { line: node.range.start.line, character: start + literal.length } },
                            delimiter + escaped + delimiter);
                        converted += result.converted;
                    }
                }
            }
        }
        for (const link of container.links) {
            converted += convertLink(link, lines, replace, problem);
        }
    }

    // Apply the edits from the end of each line, so earlier positions stay right
    edits.sort((a, b) => b.line - a.line || b.start - a.start);
    for (const edit of edits) {
        const line = lines[edit.line];
        lines[edit.line] = line.substring(0, edit.start) + edit.text + line.substring(edit.end);
    }
    const output = lines.join("\n");
    return { script: crlf ? output.replace(/\n/g, "\r\n") : output, converted, problems };
}

// A link's setters: everything after the first comma of its target. For a next link, the target
// is just the setters part, e.g. ", gold=1".
function convertLink(link: LinkNode, lines: string[], replace: (range: Range, text: string) => void,
    problem: (line: number, text: string, reason: string) => void): number {
    if (link.form === "unnamed") return 0;
    const comma = link.target.indexOf(",");
    if (comma === -1) return 0;
    const { targetRange } = link;
    if (targetRange.start.line !== targetRange.end.line
        || lines[targetRange.start.line].substring(targetRange.start.character, targetRange.end.character) !== link.target) {
        problem(link.range.start.line, link.target, "the link's setters couldn't be found");
        return 0;
    }
    const result = convertSetterList(link.target.substring(comma + 1), false);
    for (const reason of result.problems) problem(link.range.start.line, link.target, reason);
    if (result.converted) {
        replace(targetRange, link.target.substring(0, comma + 1) + result.text);
    }
    return result.converted;
}

// ---- @name in a story that uses expressions ----

export interface AtAttribute {
    // The @name, e.g. "@score"
    text: string;
    range: Range;
}

// Finds "@name" on the right-hand side of setters, outside quotes. Under the Squiffy 6 rules that's
// how a setter used another attribute, but with expressions it's just name: Handlebars reads
// @name as one of its own data variables, which is never set.
export function findAtAttributes(file: SquiffyFile): AtAttribute[] {
    const result: AtAttribute[] = [];
    // Scans text that starts at (line, character) in the file
    const scan = (text: string, line: number, character: number) => {
        let quote: string | null = null;
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (quote) {
                if (c === "\\") i++;
                else if (c === quote) quote = null;
            }
            else if (c === "\"" || c === "'") quote = c;
            else if (c === "@" && !/\w/.test(text[i - 1] ?? "") && /\w/.test(text[i + 1] ?? "")) {
                const name = /^@\w+/.exec(text.substring(i))![0];
                result.push({ text: name, range: { start: { line, character: character + i }, end: { line, character: character + i + name.length } } });
                i += name.length - 1;
            }
        }
    };

    for (const section of [file.preamble, ...file.sections] as (SectionNode | SnippetNode)[]) {
        if (section.type !== "section") continue;
        for (const container of [section, ...section.passages]) {
            for (const node of container.body) {
                if (node.type === "attribute" && node.directive === "set") {
                    scan(node.value, node.valueRange.start.line, node.valueRange.start.character);
                }
                else if (node.type === "text") {
                    for (const match of node.text.matchAll(helperSetPattern)) {
                        const start = match.index! + match[0].length - match[1].length + 1;
                        scan(match[1].slice(1, -1), node.range.start.line, node.range.start.character + start);
                    }
                }
            }
            for (const link of container.links) {
                const comma = link.target.indexOf(",");
                const { targetRange } = link;
                if (link.form === "unnamed" || comma === -1 || targetRange.start.line !== targetRange.end.line) continue;
                scan(link.target.substring(comma + 1), targetRange.start.line, targetRange.start.character + comma + 1);
            }
        }
    }
    return result;
}

// ---- Text without quotes in a story that uses expressions ----

// One setter, and where it is in the file
interface SetterSite {
    text: string;
    line: number;
    character: number;
    // Inside a set="..." string, where single quotes save escaping
    inHelperString: boolean;
}

// Splits a list of setters with the rules of a story that uses expressions (as splitSetters in
// runtime/src/infixExpressions.ts does): on commas outside quotes and brackets. Keeps offsets.
function splitWithOffsets(setters: string): { text: string, offset: number }[] {
    const result: { text: string, offset: number }[] = [];
    let depth = 0;
    let quote: string | null = null;
    let start = 0;
    for (let i = 0; i <= setters.length; i++) {
        const c = setters[i];
        if (i < setters.length && quote) {
            if (c === "\\") i++;
            else if (c === quote) quote = null;
        }
        else if (c === "\"" || c === "'") quote = c;
        else if (c === "(") depth++;
        else if (c === ")") depth = Math.max(0, depth - 1);
        else if (i === setters.length || (c === "," && depth === 0)) {
            result.push({ text: setters.slice(start, i), offset: start });
            start = i + 1;
        }
    }
    return result;
}

// Every setter in a file: @set, link setters and set="..." on {{section}} and {{passage}}
function setterSites(file: SquiffyFile): SetterSite[] {
    const sites: SetterSite[] = [];
    const addList = (text: string, line: number, character: number, inHelperString: boolean) => {
        for (const part of splitWithOffsets(text)) {
            sites.push({ text: part.text, line, character: character + part.offset, inHelperString });
        }
    };
    for (const section of [file.preamble, ...file.sections] as (SectionNode | SnippetNode)[]) {
        if (section.type !== "section") continue;
        for (const container of [section, ...section.passages]) {
            for (const node of container.body) {
                if (node.type === "attribute" && node.directive === "set") {
                    sites.push({ text: node.value, line: node.valueRange.start.line, character: node.valueRange.start.character, inHelperString: false });
                }
                else if (node.type === "text") {
                    for (const match of node.text.matchAll(helperSetPattern)) {
                        const start = match.index! + match[0].length - match[1].length + 1;
                        addList(match[1].slice(1, -1), node.range.start.line, node.range.start.character + start, match[1][0] === "\"");
                    }
                }
            }
            for (const link of container.links) {
                const comma = link.target.indexOf(",");
                const { targetRange } = link;
                if (link.form === "unnamed" || comma === -1 || targetRange.start.line !== targetRange.end.line) continue;
                addList(link.target.substring(comma + 1), targetRange.start.line, targetRange.start.character + comma + 1, false);
            }
        }
    }
    return sites;
}

// The names of the attributes a file sets, or might: those on the left of a setter, those of
// @inc, @dec and @unset, and anything in quotes, which covers {{set "x" ...}}, data-attribute="x",
// id="x" on an input, squiffy.set("x", ...) in JavaScript, and so on.
export function attributesSetIn(file: SquiffyFile, text: string): Set<string> {
    const names = new Set<string>();
    for (const site of setterSites(file)) {
        const name = /^\s*(?:not\s+)?(\w+)/.exec(site.text);
        if (name) names.add(name[1]);
    }
    for (const section of [file.preamble, ...file.sections] as (SectionNode | SnippetNode)[]) {
        if (section.type !== "section") continue;
        for (const container of [section, ...section.passages]) {
            for (const node of container.body) {
                if (node.type === "attribute" && node.directive !== "set") names.add(node.value.trim());
            }
        }
    }
    for (const match of text.matchAll(/"([^"\\\n]*)"|'([^'\\\n]*)'/g)) {
        names.add((match[1] ?? match[2]).trim());
    }
    return names;
}

export interface UnquotedText {
    // The value, e.g. sword
    text: string;
    range: Range;
    // The attribute being set
    attribute: string;
    // "word": a single word that's no attribute the story sets. "words": several words, which
    // isn't an expression at all.
    kind: "word" | "words";
    // The value in quotes, if it can be quoted
    quoted: string | null;
}

// Finds setters whose value looks like text without quotes, written with the Squiffy 6 rules, in a
// story that uses expressions: name = sword, where sword isn't an attribute the story sets
// (isSet), or name = Hello there.
export function findUnquotedText(file: SquiffyFile, isSet: (name: string) => boolean): UnquotedText[] {
    const result: UnquotedText[] = [];
    for (const site of setterSites(file)) {
        // Only plain "=": text with +=, -=, *= or /= is an error whatever it's written as
        const match = /^(\s*)(\w+)(\s*=(?!=)\s*)(.*?)\s*$/.exec(site.text);
        if (!match) continue;
        const [, leading, attribute, eq, value] = match;
        let kind: UnquotedText["kind"] | null = null;
        if (/^[A-Za-z_]\w*$/.test(value)) {
            if (!reservedWords.has(value) && !value.startsWith("_") && !isSet(value)) kind = "word";
        }
        else if (/\s/.test(value) && /^[^"'()+*%<>=!&|{}[\]@\\/]+$/.test(value) && !/(^|\s)-|\b(and|or|not)\b/.test(value)) {
            kind = "words";
        }
        if (!kind) continue;
        const character = site.character + leading.length + attribute.length + eq.length;
        result.push({
            text: value,
            range: { start: { line: site.line, character }, end: { line: site.line, character: character + value.length } },
            attribute,
            kind,
            quoted: quote(value, site.inHelperString),
        });
    }
    return result;
}

// Attributes that Squiffy sets itself, which a story shouldn't set as well, with what they are
export const BUILT_IN_ATTRIBUTES: ReadonlyMap<string, string> = new Map([
    // #377: stories written before Squiffy counted turns often kept their own count called "turns"
    ["turns", "the number of links clicked in the story so far"],
    // #56: and a story may have kept track of where the player had been
    ["previous", "the section or passage the player saw just before this one"],
    ["previous_section", "the section the player was in before this one"],
]);

export interface BuiltInAttributeSet {
    name: string;
    // The attribute's name where it's set
    range: Range;
}

// Finds where a file sets one of the BUILT_IN_ATTRIBUTES: on the left of a setter, in @inc, @dec
// and @unset, and as the quoted first argument of set, inc, dec or unset, which covers
// {{set "turns" 1}} and squiffy.set("turns", 1) in JavaScript.
export function findBuiltInAttributeSets(file: SquiffyFile, text: string): BuiltInAttributeSet[] {
    const result: BuiltInAttributeSet[] = [];
    const add = (name: string, line: number, character: number) => {
        if (BUILT_IN_ATTRIBUTES.has(name)) {
            result.push({ name, range: { start: { line, character }, end: { line, character: character + name.length } } });
        }
    };
    for (const site of setterSites(file)) {
        const match = /^(\s*(?:not\s+)?)(\w+)/.exec(site.text);
        if (match) add(match[2], site.line, site.character + match[1].length);
    }
    for (const section of [file.preamble, ...file.sections] as (SectionNode | SnippetNode)[]) {
        if (section.type !== "section") continue;
        for (const container of [section, ...section.passages]) {
            for (const node of container.body) {
                if (node.type !== "attribute" || node.directive === "set") continue;
                const match = /^(\s*)(\w+)/.exec(node.value);
                if (match) add(match[2], node.valueRange.start.line, node.valueRange.start.character + match[1].length);
            }
        }
    }
    text.replace(/\r/g, "").split("\n").forEach((line, i) => {
        for (const match of line.matchAll(/\b(?:set|inc|dec|unset)\s*\(?\s*(["'])(\w+)\1/g)) {
            add(match[2], i, match.index! + match[0].length - match[2].length - 1);
        }
    });
    return result.sort((a, b) => a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character);
}
