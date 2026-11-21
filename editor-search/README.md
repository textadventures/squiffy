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

`editorSearch()` takes @codemirror/search's `caseSensitive`, `wholeWord` and `regexp` defaults, and `within`: a function from the editor's state to the part of the document to search (`{ from, to }`, or null for all of it), for a host that shows only part of it. Matches outside it aren't found, counted or replaced. The Squiffy editor uses it while one section is being written from the story map, with the rest of the script hidden.

## What it does

- **Find**: searches as you type, going to the first match from the cursor, with a count ("3 of 17", up to `MATCH_LIMIT`). Toggles for match case, whole word and regular expression (Alt+C, Alt+W, Alt+R). Enter and Shift+Enter go to the next and previous match.
- **Replace**: a second row, shown by the chevron and remembered while the panel is closed. Enter replaces the match, Ctrl/Cmd+Enter replaces them all. Hidden in a read-only editor.
- **Go to line**: `12`, `12:5` (line and column), `+3` or `-3` (from the cursor), `50%`.

## Searching other text

`searchText(text, { search, caseSensitive, wholeWord, regexp }, limit)` gives the matches in a string, by line and column, with the same matching as the panel. It's for a search of files that aren't open in an editor, such as Squiffy's Find in Files.

`replaceInText(text, spec, replace)` gives the text with every match replaced, and how many there were, keeping its line breaks. `replaceChanges(doc, spec, replace)` gives the same as changes to a CodeMirror document, for a file that's open in an editor, so it's one step to undo. Both take a line and column to replace one match only. In a regular expression's replacement, `$1` is its first group, `$&` the whole match and `$$` a dollar sign, as in the Find panel.

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
