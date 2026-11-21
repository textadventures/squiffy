// Searching text that isn't in an editor, for Find in Files. It uses @codemirror/search's own
// query, so match case, whole word and regular expressions mean what they do in the Find panel.
import { Text } from "@codemirror/state";
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
