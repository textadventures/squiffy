// Finds Handlebars syntax errors in a section's or passage's text, which the runtime would
// otherwise only report when the text is shown ("Template error: Parse error on line 6...").
//
// The text is parsed the way the runtime's text processor compiles it: after the compiler has
// turned links into helpers, and after rewriteInfixExpressions. (The runtime also adds a __body=
// to each {{#every}} first, but that's only ever a string parameter, so it can't make a
// difference to whether the text parses.)

import Handlebars from "handlebars";
import { findTagEnd, InfixEdit, InfixRewriteError, mapRewrittenPosition, rewriteInfixExpressions } from "./infix-expressions.js";

export interface TemplateError {
    // The range in the text the error is about, usually a whole {{...}} tag
    start: number;
    end: number;
    message: string;
}

// The parser keeps where it had got to in its lexer, which is where a parse error is
interface Location {
    first_line: number;
    first_column: number;
}
const lexer = (Handlebars as unknown as { Parser: { lexer: { yylloc?: Location } } }).Parser.lexer;

// Handlebars' own errors (as opposed to the parser's) say where, from the node they're about
interface HandlebarsException {
    message: string;
    lineNumber?: number;
    column?: number;
}

export function findTemplateError(text: string): TemplateError | null {
    if (!text.includes("{{")) return null;
    const edits: InfixEdit[] = [];
    let rewritten: string;
    try {
        rewritten = rewriteInfixExpressions(text, edits);
    } catch (e) {
        // An expression it can't read, e.g. {{set "gold" gold +}}
        if (!(e instanceof InfixRewriteError)) throw e;
        const end = e.end + (text.startsWith("~}}", e.end) ? 3 : 2);
        return { start: e.start, end, message: `${describeTag(text.slice(e.start, end))} isn't valid: ${e.message}` };
    }
    try {
        Handlebars.parse(rewritten);
        return null;
    } catch (e) {
        const error = e as HandlebarsException;
        const lineStarts = [0];
        for (let i = 0; i < rewritten.length; i++) {
            if (rewritten[i] == "\n") lineStarts.push(i + 1);
        }
        const offset = (line: number, column: number) =>
            mapRewrittenPosition(edits, Math.min((lineStarts[line - 1] ?? rewritten.length) + column, rewritten.length));

        if (error.lineNumber !== undefined) {
            return handlebarsError(text, error.message, offset(error.lineNumber, error.column ?? 0));
        }
        const loc = lexer.yylloc;
        const pos = loc ? offset(loc.first_line, loc.first_column) : 0;
        return parseError(text, error.message, pos);
    }
}

// "unless doesn't match if - 1:3", or "Invalid path: a/this - 1:31"
function handlebarsError(text: string, message: string, pos: number): TemplateError {
    message = message.replace(/ - \d+:\d+$/, "");
    const tag = tagAt(text, pos) ?? { start: pos, end: pos };
    const tagText = describeTag(text.slice(tag.start, tag.end));
    const mismatch = /^(.+) doesn't match (.+)$/.exec(message);
    if (mismatch) {
        return { ...tag, message: `${tagText} is closed by {{/${mismatch[2]}}}, but it needs a {{/${mismatch[1]}}}` };
    }
    return { ...tag, message: `${tagText} isn't valid Handlebars: ${message}` };
}

function parseError(text: string, message: string, pos: number): TemplateError {
    // The last line says what the parser expected, e.g. "Expecting 'ID', 'STRING', ..., got 'INVALID'"
    const got = /got '([^']+)'\s*$/.exec(message)?.[1];
    if (got == "EOF") {
        const open = unclosedBlock(text);
        if (open) {
            return { ...open, message: `${describeTag(text.slice(open.start, open.end))} has no {{/${open.name}}} to close it` };
        }
    }
    const tag = tagAt(text, pos);
    if (!tag) {
        const end = Math.min(pos + 1, text.length);
        return { start: Math.min(pos, end), end, message: "this text isn't valid Handlebars" + (got ? ` (it found ${got == "EOF" ? "the end of the text" : `'${got}'`} where it didn't expect it)` : "") };
    }
    const tagText = text.slice(tag.start, tag.end);
    return { ...tag, message: `${describeTag(tagText)} isn't valid Handlebars${hint(tagText)}` };
}

// Suggests {{= ...}} for what looks like an expression in a plain {{...}}, e.g. {{round + 1}}
function hint(tagText: string): string {
    const inner = tagText.replace(/^\{\{\{?~?\s*/, "").replace(/\s*~?\}?\}\}$/, "");
    if (/^[#/=!>^&]|^else\b/.test(inner)) return "";
    if (!/\s(?:[-+*/%<>?]|[=!<>]=|&&|\|\||and|or|contains)\s/.test(` ${inner} `)) return "";
    return `. To show the result of an expression, start it with "=": {{= ${inner}}}`;
}

// The {{...}} tag that pos is in, if any
function tagAt(text: string, pos: number): { start: number; end: number } | null {
    let start = text.lastIndexOf("{{", pos);
    if (start == -1) return null;
    if (text[start - 1] == "{") start--;
    const bodyStart = text.startsWith("{{{", start) ? start + 3 : start + 2;
    const close = findTagEnd(text, bodyStart);
    if (close == -1) {
        const lineEnd = text.indexOf("\n", start);
        return { start, end: lineEnd == -1 ? text.length : lineEnd };
    }
    let end = close + (text.startsWith("~}}", close) ? 3 : 2);
    if (text[end] == "}" && bodyStart == start + 3) end++;
    if (pos >= end && pos > start) return null;
    return { start, end };
}

// The innermost {{#block}} with no {{/block}} after it
function unclosedBlock(text: string): { start: number; end: number; name: string } | null {
    const tags = /(\\*)\{\{~?\s*([#/])\s*([^\s}~]+)/g;
    const open: { start: number; end: number; name: string }[] = [];
    let match: RegExpExecArray | null;
    while ((match = tags.exec(text)) !== null) {
        if (match[1].length % 2 == 1) continue;
        const start = match.index + match[1].length;
        if (match[2] == "#") {
            const close = findTagEnd(text, start + 2);
            const end = close == -1 ? text.length : close + (text.startsWith("~}}", close) ? 3 : 2);
            open.push({ start, end, name: match[3].replace(/^>/, "") });
        } else {
            const index = open.map(o => o.name).lastIndexOf(match[3]);
            if (index != -1) open.length = index;
        }
    }
    return open.pop() ?? null;
}

function describeTag(tagText: string) {
    const oneLine = tagText.replace(/\s*\n\s*/g, " ");
    return oneLine.length > 60 ? oneLine.substring(0, 57) + "..." : oneLine;
}
