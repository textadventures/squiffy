# Squiffy 7 editor

The Squiffy editor at app.squiffystory.com (#278), on the same stack and app shell as Quest Viva's editor: SvelteKit + Skeleton, with CodeMirror 6. It replaced the 6.x editor in 7.0. The plan is in the comments on #278.

```bash
npm run dev     # http://localhost:5180
npm run check   # svelte-check
npm test
```

## How it fits together

- **Projects** are a `ProjectFileSystem` from `@textadventures/project-fs` plus the path of the main `.squiffy` file (`src/lib/project.svelte.ts`), which `@import`s the others. Each open file has a tab and its own editor, so it keeps its cursor and undo history, and saves on its own. A new `.squiffy` file is `@import`ed from the main file straight away. Images and other assets are files in the project too, managed from the Assets dialog (`AssetManagerModal.svelte`, from Quest Viva's), and referred to by their path from the main file's folder. They come from a folder opened with File System Access (Chromium), or a draft in the browser's origin-private file system (New, and Open file, which imports a file into a new draft). Edits autosave a second after typing stops.
- **The language service** (`squiffy-compiler/language-service`) runs in a Web Worker (`src/lib/language/worker.ts`). It reads project files by calling back to the page (`src/lib/rpc.ts`), since some back ends, such as the Electron bridge, only exist there. The page sends it the text being edited as it changes.
- **Export** (`src/lib/export.ts`): the File menu publishes the story with `@textadventures/squiffy-packager` (HTML and JavaScript as a zip, one HTML file, or the JavaScript), in the language worker, from its existing analysis; the packager is loaded only when it's needed. Download project zips every file, with unsaved changes, and Open file reads such a zip back as a new draft, which is how to keep a copy of a draft.
- **Offline:** `src/service-worker.ts` (SvelteKit's own service worker support, not `vite-plugin-pwa`) caches every file of the version when it installs, plus worker chunks SvelteKit's list leaves out the first time they're fetched, and serves the app's page for any route when there's no network. A new version waits until the update banner's Reload (`src/lib/updates.svelte.ts`, `UpdateBanner.svelte`). With `static/manifest.webmanifest` and the icons, the editor can be installed as an app, as the 6.x editor can.
- **Recent folders** (`src/lib/recent.ts`): folders opened with File System Access, kept in IndexedDB, are listed on the home page. Opening one asks the browser for permission again if it needs to. The editor's URL has the folder's id, so a reload reopens it while the browser still allows it.
- **The preview** (`src/components/PreviewPanel.svelte`) runs the story in squiffy-runtime's preview page, in a sandboxed `srcdoc` iframe, through `squiffy-runtime/preview-host`. The worker compiles it from the language service's analysis (`compile` in `src/lib/language/worker.ts`), so the story isn't parsed twice. The story's assets go to the preview as Blobs. Edits hot-update the running story; following a link in the preview moves the editor there, opening the file it's in. The page is loaded only when the preview first opens.
- **The code editor** (`src/components/CodeEditor.svelte`, from Quest Viva's) takes its extensions from outside: the highlighting mode in `src/lib/squiffy-lang.ts`, and the language features from `src/lib/language/codemirror.ts`, which sends the editor's text to the worker before each query.

## Language features

| | |
|---|---|
| Problems | Lint markers, with quick fixes: create a missing section or passage, convert Squiffy 5 syntax |
| Completion | Section and passage names in links, attributes after `@set` and friends, snippets (Ctrl+Space) |
| Hover | The start of the section or passage a link goes to |
| Go to definition | F12, or Ctrl/Cmd+click |
| Find references | Shift+F12, in a panel under the editor |
| Rename | F2, across every link to the section or passage |
| Folding | Sections and passages |
| Go to section or passage | Ctrl/Cmd+Shift+O, the outline's search box |
| Run | Ctrl/Cmd+Enter from the start; Ctrl/Cmd+Shift+Enter from the section the cursor is in |
| Add | A section or passage (from the selection, if there is one), or a snippet: the 6.x editor's built-in ones and the story's own `[snippet:...]` blocks |
| Squiffy 5 | Opening a file that uses the Squiffy 5 text processor offers to convert all of it |

Parts copied from Quest Viva's `src/AppShell` are noted in their comments. Fixes to the shared parts (`app.css`, `theme-store.ts`, `CodeEditor.svelte`, `codemirror-theme.ts`, `DropdownMenu.svelte`) may need porting between the two.

## Deployment

`deploy-app.yml` builds this for each release and uploads it to the `squiffy-app` Cloudflare Pages project: stable releases to app.squiffystory.com, and prereleases to app-beta.squiffystory.com, whose home page says it's the beta (`VITE_BETA_APP`). `squiffy-app` also builds a preview for every PR and push. Its build settings:

| Setting | Value |
|---|---|
| Root directory | (the repo root) |
| Build command | `npx lerna run build --scope @textadventures/squiffy-app --include-dependencies` |
| Build output directory | `app/build` |

It has no `404.html`, so Pages serves `index.html` for every path, which the app's client-side routing needs. `static/_headers` caches SvelteKit's hashed assets for a year.

### From the 6.x editor

The 6.x editor ran at the same addresses, so:

- `static/sw.js` replaces its service worker (Workbox, at `/sw.js`), which would otherwise keep serving the 6.x editor from its cache. It clears the 6.x caches, unregisters itself and reloads the page.
- Its unsaved work (idb-keyval's default store, key `autosave`) is offered as a draft on the home page (`src/lib/legacy.ts`).
