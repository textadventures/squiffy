# Developing Squiffy for VS Code

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
  `workspace.fs`, zipping them with fflate for a zip. For a single HTML file, it sends the assets
  to the server (in base64), which puts them in the page. New Story (`new-story.ts`) uses the editor's
  starter story (`src/client/new-story.test.ts` checks it matches `app/src/lib/project.svelte.ts`).
  Share as a Link and Play in Browser (`share.ts`) make the link with the editor's
  `story-link.ts` (exported by `@textadventures/squiffy-app`), from every file in the story's
  folder but the build folder, tests and backups. Publish to textadventures.co.uk (`publish.ts`)
  uploads Export's zip with the editor's `publish-api.ts` (after the server's `squiffy/newProjectFile`
  works out a `squiffy.json` for a story with none, and its converted setters, as `--convert-v6` does), with `fetch`, as the web extension host
  is a worker, and asks what became of it until it's published.
  Convert Twine Story and Convert Quest Gamebook (`convert.ts`) pick the file and a folder, and
  write what `convert-story.ts` makes with the compiler's converters, as the command line tool does
  (`cli/src/convert-twine.ts` and `convert-quest.ts`), with `workspace.fs`.
- `src/map/` is the story map's page (#615), which runs in a webview: a Svelte page around
  `@textadventures/graph-map`'s `GraphMap.svelte`, with the editor's `story-map.ts` and
  `StoryMapNode.svelte` (which the app exports for it), styled with VS Code's theme variables.
  Vite builds it into `dist/map/`, and the webview loads it with `asWebviewUri`, so it works on
  the web too. `src/client/map.ts` gets the graph from the server, and makes the map's edits (a
  link, with `map-edits.ts`, and positions in `squiffy.json`) as `WorkspaceEdit`s, so Undo works.
- The sidebar's Sections view (#616) is a `TreeDataProvider` (`src/client/sections-view.ts`) over
  the same graph as the map, made into a tree by `sections.ts`, which marks it as the map does.
- The grammar is the compiler's (`compiler/syntaxes/squiffy.tmLanguage.json`), copied into `dist/`
  by the build. The snippets are the editor's (`compiler/src/snippets.ts`), which the language
  server offers as completions, rather than VS Code's own snippets, which can't tell `{{#if` from
  `if`.

```bash
npm run build      # type-check, then bundle into dist/ with esbuild (and the map's page with Vite)
npm test
npm run package    # build squiffy-<version>.vsix
```

Build the compiler and runtime first, as the extension bundles them from their `dist/` folders.

The extension has the same version as the rest of Squiffy, which release-please sets. Each
release's `.vsix` is attached to its GitHub Release by `.github/workflows/vscode-publish.yml`, and
a stable release is published to the VS Code Marketplace. The Marketplace doesn't take prerelease
versions such as `7.0.0-beta.14`, so a beta is only on the GitHub Release.

To try it in VS Code on the desktop, run `code --extensionDevelopmentPath=$PWD ../examples/gameshow`
from this folder, or install the `.vsix` with **Extensions: Install from VSIX...**. To try the web
build, `npm run open-web` opens VS Code for the web on `examples/`, in a browser.
