// A Find and Replace panel and a Go to line bar for CodeMirror 6.
//
//     extensions: [editorSearch(), keymap.of(editorSearchKeymap)]
//
// in place of @codemirror/search's searchKeymap, which opens its own panel and dialog.
import { EditorState, type Extension } from "@codemirror/state";
import type { KeyBinding } from "@codemirror/view";
import { gotoLine, search, searchKeymap, SearchQuery, setSearchQuery } from "@codemirror/search";
import { gotoLineState, openGotoLine } from "./goto-line.js";
import { openReplacePanel, replaceOpen, SearchPanel } from "./panel.js";
import { searchTheme } from "./theme.js";

export interface EditorSearchConfig {
    // Options for @codemirror/search, other than its panel
    caseSensitive?: boolean;
    wholeWord?: boolean;
    regexp?: boolean;
    // The part of the document to search, when only part of it is shown (the rest is hidden by
    // the host, say): matches outside it aren't found, counted or replaced. Null for all of it.
    within?: (state: EditorState) => { from: number; to: number } | null;
}

export function editorSearch(config: EditorSearchConfig = {}): Extension {
    const { within, ...options } = config;
    const test = within && ((_match: string, state: EditorState, from: number, to: number) => {
        const range = within(state);
        return !range || (from >= range.from && to <= range.to);
    });
    return [
        search({ ...options, top: true, createPanel: view => new SearchPanel(view, test) }),
        // A query set from outside the panel (from the selection, when Find is pressed) is
        // searched for in the same part of the document
        test ? EditorState.transactionFilter.of(tr => {
            const set = tr.effects.filter(e => e.is(setSearchQuery)).pop();
            if (!set || set.value.test === test) return tr;
            const { search: text, caseSensitive, literal, regexp, replace, wholeWord } = set.value;
            return [tr, { effects: setSearchQuery.of(new SearchQuery({ search: text, caseSensitive, literal, regexp, replace, wholeWord, test })) }];
        }) : [],
        replaceOpen,
        gotoLineState,
        searchTheme,
    ];
}

// @codemirror/search's bindings, with Go to line opening this package's bar, and a key for Find
// with the Replace row showing: Ctrl+H, or Cmd+Alt+F on a Mac (where Cmd+H hides the app).
export const editorSearchKeymap: readonly KeyBinding[] = [
    ...searchKeymap.map(binding => (binding.run === gotoLine ? { ...binding, run: openGotoLine } : binding)),
    { key: "Mod-h", mac: "Mod-Alt-f", run: openReplacePanel, scope: "editor search-panel", preventDefault: true },
];

export { openGotoLine, closeGotoLine, parseLineTarget } from "./goto-line.js";
export { openReplacePanel, setReplaceOpen } from "./panel.js";
export { findMatches, matchIndex, MATCH_LIMIT, type Match, type Matches } from "./matches.js";
export { searchText, isValidSearch, replaceChanges, replaceInText, type SearchSpec, type TextMatch, type TextChange } from "./text-search.js";
