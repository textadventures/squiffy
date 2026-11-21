// A Find and Replace panel and a Go to line bar for CodeMirror 6.
//
//     extensions: [editorSearch(), keymap.of(editorSearchKeymap)]
//
// in place of @codemirror/search's searchKeymap, which opens its own panel and dialog.
import type { Extension } from "@codemirror/state";
import type { KeyBinding } from "@codemirror/view";
import { gotoLine, search, searchKeymap } from "@codemirror/search";
import { gotoLineState, openGotoLine } from "./goto-line.js";
import { openReplacePanel, replaceOpen, SearchPanel } from "./panel.js";
import { searchTheme } from "./theme.js";

export interface EditorSearchConfig {
    // Options for @codemirror/search, other than its panel
    caseSensitive?: boolean;
    wholeWord?: boolean;
    regexp?: boolean;
}

export function editorSearch(config: EditorSearchConfig = {}): Extension {
    return [
        search({ ...config, top: true, createPanel: view => new SearchPanel(view) }),
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
export { searchText, isValidSearch, type SearchSpec, type TextMatch } from "./text-search.js";
