// Searching text that isn't in an editor, for Find in Files. It uses @codemirror/search's own
// query, so match case, whole word and regular expressions mean what they do in the Find panel.
import { ChangeSet, Text } from "@codemirror/state";
import { SearchQuery } from "@codemirror/search";

export interface SearchSpec {
    search: string;
    caseSensitive?: boolean;
    wholeWord?: boolean;
    regexp?: boolean;
}

export interface TextMatch {
    // Lines and columns count from 0. A match of a regular expression can end on a later line.
    line: number;
    column: number;
    endLine: number;
    endColumn: number;
    // The line the match starts on
    lineText: string;
}

// False for a regular expression that doesn't parse (and for an empty search)
export function isValidSearch(spec: SearchSpec): boolean {
    return new SearchQuery(spec).valid;
}

// The matches in a text, in order, up to a limit
export function searchText(text: string, spec: SearchSpec, limit = Infinity): TextMatch[] {
    const query = new SearchQuery(spec);
    if (!query.valid) return [];
    const doc = Text.of(text.split(/\r\n?|\n/));
    const matches: TextMatch[] = [];
    const cursor = query.getCursor(doc);
    for (let next = cursor.next(); !next.done && matches.length < limit; next = cursor.next()) {
        const { from, to } = next.value;
        const line = doc.lineAt(from);
        const endLine = to <= line.to ? line : doc.lineAt(to);
        matches.push({
            line: line.number - 1,
            column: from - line.from,
            endLine: endLine.number - 1,
            endColumn: to - endLine.from,
            lineText: line.text,
        });
    }
    return matches;
}

export interface TextChange {
    from: number;
    to: number;
    insert: string;
}

// As @codemirror/search reads a search or replacement that isn't a regular expression's: \n, \r
// and \t are a line break, a return and a tab, and \\ is a backslash
function unquote(text: string): string {
    return text.replace(/\\([nrt\\])/g, (_, ch: string) => (ch === "n" ? "\n" : ch === "r" ? "\r" : ch === "t" ? "\t" : "\\"));
}

// What replaces a match: for a regular expression, $1 is its first group, $& the whole match and
// $$ a dollar sign, as in the Find panel
function replacement(replace: string, match: RegExpExecArray | undefined): string {
    const text = unquote(replace);
    if (!match) return text;
    return text.replace(/\$([$&]|\d+)/g, (whole, name: string) => {
        if (name === "&") return match[0];
        if (name === "$") return "$";
        for (let length = name.length; length > 0; length--) {
            const group = Number(name.slice(0, length));
            if (group > 0 && group < match.length) return (match[group] ?? "") + name.slice(length);
        }
        return whole;
    });
}

// The changes that replace every match in a document, or with `only`, the match that starts at
// that line and column (none, if the text there no longer matches)
export function replaceChanges(doc: Text, spec: SearchSpec, replace: string, only?: { line: number; column: number }): TextChange[] {
    const query = new SearchQuery(spec);
    if (!query.valid) return [];
    let onlyFrom = -1;
    if (only) {
        if (only.line >= doc.lines) return [];
        onlyFrom = doc.line(only.line + 1).from + only.column;
    }
    const changes: TextChange[] = [];
    const cursor = query.getCursor(doc) as Iterator<{ from: number; to: number; match?: RegExpExecArray }>;
    for (let next = cursor.next(); !next.done; next = cursor.next()) {
        const { from, to, match } = next.value;
        if (only && from !== onlyFrom) {
            if (from > onlyFrom) break;
            continue;
        }
        changes.push({ from, to, insert: replacement(replace, spec.regexp ? match : undefined) });
        if (only) break;
    }
    return changes;
}

// A text with its matches replaced, and how many there were. It keeps the text's own line breaks.
export function replaceInText(text: string, spec: SearchSpec, replace: string, only?: { line: number; column: number }): { text: string; count: number } {
    const doc = Text.of(text.split(/\r\n?|\n/));
    const changes = replaceChanges(doc, spec, replace, only);
    if (!changes.length) return { text, count: 0 };
    const lineBreak = text.includes("\r\n") ? "\r\n" : "\n";
    const changed = ChangeSet.of(changes, doc.length).apply(doc);
    return { text: changed.sliceString(0, changed.length, lineBreak), count: changes.length };
}
