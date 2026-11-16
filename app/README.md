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
- **The code editor** (`src/components/CodeEditor.svelte`, from Quest Viva's) takes its extensions from outside: the highlighting mode in `src/lib/squiffy-lang.ts`, and diagnostics and the outline from `src/lib/language/codemirror.ts`.

Parts copied from Quest Viva's `src/AppShell` are noted in their comments. Fixes to the shared parts (`app.css`, `theme-store.ts`, `CodeEditor.svelte`, `codemirror-theme.ts`, `DropdownMenu.svelte`) may need porting between the two.
