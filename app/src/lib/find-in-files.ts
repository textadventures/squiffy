// Find in Files: a search of every text file in the project (Ctrl/Cmd+Shift+F), with the same
// matching as the editor's Find panel.
import { searchText, type SearchSpec, type TextMatch } from "@textadventures/editor-search";
import { isTextFile } from "./file-types.js";
import { isBuildPath } from "./file-tree.js";

export interface FileResult {
    file: string;
    matches: TextMatch[];
}

export interface FindResults {
    files: FileResult[];
    total: number;
    // There are more matches than the limit
    capped: boolean;
}

export const RESULT_LIMIT = 2000;

export const NO_RESULTS: FindResults = { files: [], total: 0, capped: false };

// Files the editor can open, other than the CLI's build folder, which only has copies
export const isSearchable = (path: string) => isTextFile(path) && !isBuildPath(path);

// Searches each file in turn. `read` gives a file's text, or undefined if it can't be read.
export async function findInFiles(
    paths: string[],
    read: (path: string) => Promise<string | undefined>,
    spec: SearchSpec,
    limit = RESULT_LIMIT,
): Promise<FindResults> {
    const files: FileResult[] = [];
    let total = 0;
    for (const file of paths) {
        const text = await read(file);
        if (text === undefined) continue;
        // One more than there's room for, to know whether there are more
        const matches = searchText(text, spec, limit - total + 1);
        if (!matches.length) continue;
        if (total + matches.length > limit) {
            const room = matches.slice(0, limit - total);
            if (room.length) files.push({ file, matches: room });
            return { files, total: limit, capped: true };
        }
        files.push({ file, matches });
        total += matches.length;
    }
    return { files, total, capped: false };
}

export interface Excerpt {
    before: string;
    match: string;
    after: string;
}

const BEFORE = 40;
const MATCH = 200;
const AFTER = 200;

// A match's line, cut down to show in a row of results: indentation dropped, and a long line
// (some stories are all on one) shortened around the match.
export function excerpt(match: TextMatch): Excerpt {
    const { lineText, column } = match;
    const end = match.endLine === match.line ? match.endColumn : lineText.length;
    let before = lineText.slice(0, column).trimStart();
    if (before.length > BEFORE) before = "…" + before.slice(before.length - BEFORE);
    let found = lineText.slice(column, end);
    if (found.length > MATCH) found = found.slice(0, MATCH) + "…";
    let after = lineText.slice(end);
    if (after.length > AFTER) after = after.slice(0, AFTER) + "…";
    return { before, match: found, after };
}

export function summary(results: FindResults): string {
    if (!results.total) return "No results";
    const count = `${results.total}${results.capped ? "+" : ""} result${results.total === 1 ? "" : "s"}`;
    return `${count} in ${results.files.length} file${results.files.length === 1 ? "" : "s"}`;
}
