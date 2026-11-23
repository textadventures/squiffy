# Squiffy for VS Code

Write [Squiffy](https://squiffystory.com) interactive stories in VS Code, with a live preview.

- Syntax highlighting, folding and snippets for `.squiffy` files
- Problems as you type, for the whole story, including links to sections that don't exist, dead
  ends and sections nothing links to
- The Outline view and breadcrumbs, Go to Definition, Find All References and Rename for sections
  and passages
- Completion of section and passage names, attributes and directives, hover, and quick fixes
- **Squiffy: Show Preview** runs the story beside the editor, updating as you type.
  **Start Preview at This Section** (in the editor's context menu) starts it at the section the
  cursor is in. The attributes the story sets are logged in the Squiffy Preview output.
- **Squiffy: Export** builds the playable story (`index.html`, `story.js`, the page's stylesheets
  and the story's images, sounds and other files) into a folder, or a zip to upload to a website,
  as the Squiffy editor and command line tool build it
- **Squiffy: New Story** makes a new story in a folder: a `squiffy.json` and a `story.squiffy` to
  start from. **New Squiffy Story Here** in the Explorer's context menu makes one in that folder.
- **Squiffy: Add Section** and **Add Passage** (also in the editor's context menu) add a section
  or passage header at the cursor, to type its name into
- **Squiffy: Convert from Squiffy 5** converts a Squiffy 5 file's text processor syntax

It works in VS Code on the desktop, and on [vscode.dev](https://vscode.dev) and github.dev.

## Stories and their files

A folder with a `squiffy.json` is a story, made of every `.squiffy`, `.css` and `.js` file in it,
as the Squiffy editor and command line tool see it. A `.squiffy` file anywhere else is part of
the story in its own folder, whose main file is the first one opened there (with the files it
`@import`s). **Squiffy: Use as Main File** picks another.

## Development

This is the `vscode/` workspace in the [Squiffy repository](https://github.com/textadventures/squiffy)
(#309). It's a thin host over the shared core the Squiffy editor uses:

- `src/server/` is the language server: the compiler's language service
  (`squiffy-compiler/language-service`) over LSP. It runs in a Node process on the desktop and in a
  Web Worker on the web, and reads files through the client (`src/protocol.ts`), with
  `workspace.fs`, so it works the same in both.
- `src/client/` is the extension: it starts the server and adds the commands, and the preview
  (`preview.ts`), which runs squiffy-runtime's preview page in a webview with
  `squiffy-runtime/preview-host`. Export (`export.ts`) asks the server for the story built by
  squiffy-packager's `createPackage()`, and adds the story's assets, read and written with
  `workspace.fs`, zipping them with fflate for a zip. New Story (`new-story.ts`) uses the editor's
  starter story (`src/client/new-story.test.ts` checks it matches `app/src/lib/project.svelte.ts`).
- The grammar is the compiler's (`compiler/syntaxes/squiffy.tmLanguage.json`), copied into `dist/`
  by the build. The snippets are the editor's, with tab stops (`src/snippets.test.ts` checks they
  match `app/src/lib/snippets.ts`).

```bash
npm run build      # type-check, then bundle into dist/ with esbuild
npm test
npm run package    # build squiffy-vscode-<version>.vsix
```

Build the compiler and runtime first, as the extension bundles them from their `dist/` folders.

To try it in VS Code on the desktop, run `code --extensionDevelopmentPath=$PWD ../examples/gameshow`
from this folder, or install the `.vsix` with **Extensions: Install from VSIX...**. To try the web
build, `npm run open-web` opens VS Code for the web on `examples/`, in a browser.
