// The matches of a search in a document, for the panel's "3 of 17".
import type { EditorState } from "@codemirror/state";
import type { SearchQuery } from "@codemirror/search";

export interface Match {
    from: number;
    to: number;
}

export interface Matches {
    // In document order, up to the limit
    list: Match[];
    // There are more than the limit
    capped: boolean;
}

// Enough for any count an author will read, and quick in a long document
export const MATCH_LIMIT = 1000;

export const NO_MATCHES: Matches = { list: [], capped: false };

export function findMatches(state: EditorState, query: SearchQuery, limit = MATCH_LIMIT): Matches {
    if (!query.search || !query.valid) return NO_MATCHES;
    const list: Match[] = [];
    const cursor = query.getCursor(state);
    for (let next = cursor.next(); !next.done; next = cursor.next()) {
        if (list.length === limit) return { list, capped: true };
        list.push({ from: next.value.from, to: next.value.to });
    }
    return { list, capped: false };
}

// Which match a selection is, counting from 0, or -1 if it isn't one
export function matchIndex(matches: Matches, from: number, to: number): number {
    const { list } = matches;
    let low = 0;
    let high = list.length - 1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (list[mid].from < from) low = mid + 1;
        else if (list[mid].from > from) high = mid - 1;
        else return list[mid].to === to ? mid : -1;
    }
    return -1;
}

// The first match at or after a position, going round to the top
export function matchFrom(matches: Matches, pos: number): Match | null {
    const { list } = matches;
    if (!list.length) return null;
    return list.find(m => m.from >= pos) ?? list[0];
}
