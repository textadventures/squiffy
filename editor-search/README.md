# @textadventures/editor-search

A Find and Replace panel and a Go to line bar for CodeMirror 6, in place of the ones `@codemirror/search` draws. Built for the Squiffy editor, and meant for Quest Viva's too.

It has **no Squiffy imports** and no framework: the panels are plain DOM, so it builds with `tsc` and works in any CodeMirror 6 editor. For now it's a private workspace, versioned with the rest of the repo. The plan is to move it to a repo of its own, shared by both editors, once Quest Viva uses it.

```bash
npm run build   # into dist/
npm test
```

## Using it

```ts
import { editorSearch, editorSearchKeymap } from "@textadventures/editor-search";

new EditorView({
    extensions: [editorSearch(), keymap.of(editorSearchKeymap)],
});
```

`editorSearchKeymap` goes in place of `searchKeymap`. It has the same bindings, with Go to line (Ctrl/Cmd+Alt+G) opening this package's bar, and one more: Ctrl+H (Cmd+Alt+F on a Mac) opens Find with the Replace row showing.

`@codemirror/search` still does the searching, highlighting and replacing, since this is its panel (`search({ createPanel })`). So its commands (`openSearchPanel`, `findNext`, `replaceAll`...) and `getSearchQuery` work as before.

## What it does

- **Find**: searches as you type, going to the first match from the cursor, with a count ("3 of 17", up to `MATCH_LIMIT`). Toggles for match case, whole word and regular expression (Alt+C, Alt+W, Alt+R). Enter and Shift+Enter go to the next and previous match.
- **Replace**: a second row, shown by the chevron and remembered while the panel is closed. Enter replaces the match, Ctrl/Cmd+Enter replaces them all. Hidden in a read-only editor.
- **Go to line**: `12`, `12:5` (line and column), `+3` or `-3` (from the cursor), `50%`.

## Colours

The layout is a CodeMirror base theme. The colours come from custom properties, set on the editor from the app's own theme. With none set, they fall back to tints of the editor's text colour.

| Property | For |
|---|---|
| `--ed-search-bg` | the bar |
| `--ed-search-border` | the line under it, and round the fields |
| `--ed-search-field-bg` | the fields |
| `--ed-search-muted` | the match count, and icons |
| `--ed-search-accent` | the focus ring, and a toggle that's on |
| `--ed-search-accent-fg` | text on the accent colour |
| `--ed-search-error` | a field with no results |

## Translating

Every label goes through `state.phrase()`, so `EditorState.phrases` translates them: `Find`, `Replace`, `Replace all`, `Match case`, `Match whole word`, `Use regular expression`, `Previous match`, `Next match`, `Close`, `No results`, `Invalid pattern`, `$1 of $2`, `$ result`, `$ results`, `Go to line`, `Go`, `1 to $, or line:column`.
