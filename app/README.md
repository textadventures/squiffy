# Squiffy 7 editor

The rebuilt Squiffy editor (#278), on the same stack and app shell as Quest Viva's editor: SvelteKit + Skeleton, with CodeMirror 6. It replaces `editor/` once it reaches parity; until then `editor/` keeps shipping 6.x to app.squiffystory.com. The plan is in the comments on #278.

```bash
npm run dev     # http://localhost:5180
npm run check   # svelte-check
npm test
```

## How it fits together

- **Projects** are a `ProjectFileSystem` from `@textadventures/project-fs` plus the path of the main `.squiffy` file (`src/lib/project.svelte.ts`). They come from a folder opened with File System Access (Chromium), or a draft in the browser's origin-private file system (New, and Open file, which imports a file into a new draft). Edits autosave a second after typing stops.
- **The language service** (`squiffy-compiler/language-service`) runs in a Web Worker (`src/lib/language/worker.ts`). It reads project files by calling back to the page (`src/lib/rpc.ts`), since some back ends, such as the Electron bridge, only exist there. The page sends it the text being edited as it changes.
- **The preview** (`src/components/PreviewPanel.svelte`) runs the story in squiffy-runtime's preview page, in a sandboxed `srcdoc` iframe, through `squiffy-runtime/preview-host`. The worker compiles it from the language service's analysis (`compile` in `src/lib/language/worker.ts`), so the story isn't parsed twice. Edits hot-update the running story; following a link in the preview moves the editor there. The page is loaded only when the preview first opens.
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

Parts copied from Quest Viva's `src/AppShell` are noted in their comments. Fixes to the shared parts (`app.css`, `theme-store.ts`, `CodeEditor.svelte`, `codemirror-theme.ts`, `DropdownMenu.svelte`) may need porting between the two.

## Deployment

Until it replaces `editor/`, the app is its own Cloudflare Pages project, `squiffy-app-next`, connected to this repo like `squiffy-app` and `squiffy-site`, so every PR gets a preview of it. Its settings:

| Setting | Value |
|---|---|
| Root directory | (the repo root) |
| Build command | `npx lerna run build --scope @textadventures/squiffy-app --include-dependencies` |
| Build output directory | `app/build` |
| Production branch | `main` |

It has no `404.html`, so Pages serves `index.html` for every path, which the app's client-side routing needs. `static/_headers` caches SvelteKit's hashed assets for a year.

When the app takes over app.squiffystory.com, `deploy-app.yml` builds it instead of `editor/` and uploads it to the `squiffy-app` project, and this project is deleted.
