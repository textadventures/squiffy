# Squiffy desktop app

The Squiffy desktop app (#276): the editor from app.squiffystory.com (`app/`) in an Electron window, with stories kept in folders on disk. It's modelled on Quest Viva's `src/ElectronApp`, but it's a separate app, not shared with it (#304). The compiler and runtime are plain JavaScript, so there's no backend process: it's the Electron shell plus project-fs's Electron bridge.

From the repo root, `./electron.sh` builds the editor, the packages it uses and the desktop app, and launches it (`--skip-build` to just launch; a `.squiffy` file path opens its folder). Or by hand:

```bash
# from the repo root, once
npm run build

cd desktop
npm install
npm start      # builds the main process and opens the app on app/build
npm run dev    # the same, but on the editor's dev server (npm run dev in app/ first), so it hot-reloads
npm run check  # type-check
```

`npm start` uses the editor's last build, so rebuild `app/` (`npm run build` there) to pick up changes to it. Electron downloads its binary the first time it runs.

This folder isn't one of the repo's npm workspaces, so the root `npm install` (and the Cloudflare builds) don't download Electron. It has its own `package-lock.json`, and depends on `project-fs` as `file:../project-fs`, so build `project-fs` first. Its version is kept in step with the rest of the repo by release-please (`release-please-config.json`).

## How it fits together

- **`src/main.ts`**, the main process: one editor window, the native menu, the single-instance lock, `.squiffy` files the OS asks the app to open (on the command line, or macOS's `open-file`), and saving before the window closes.
- **`src/app-protocol.ts`** serves the editor's static build from `app://squiffy/`, a privileged scheme of the app's own, with `index.html` for any route that isn't a file. A fixed origin means localStorage and IndexedDB (the theme, font size and so on) carry over between launches, as they do on the web. Quest Viva serves its editor from a loopback server on a random port instead, so it keeps those settings in files.
- **`src/preload.ts`** runs sandboxed, so `scripts/build.mjs` bundles it with esbuild into one CommonJS file. It exposes project-fs's bridge as `window.projectFs`, and the app's own API (`src/api.ts`) as `window.squiffyDesktop`. The editor has a copy of those types in `app/src/lib/desktop.ts`: keep the two in step. Windows the editor opens (Play in a new tab, which runs the author's own code) get neither, and the main process only answers the editor's own window.
- **Files** go through project-fs's Electron bridge (`@textadventures/project-fs/electron-main`): the editor only ever holds an opaque root id for a folder the author picked in a native dialog, never a path (see `project-fs/README.md`).
- **Recent folders** (`src/recent.ts`) are kept by the main process in `recent-folders.json` in the app's userData folder, since they're paths. A folder gets into the list only through a root the window already holds (project-fs's `rootPath()`) or a file the OS opened, never a path from the editor. They're listed on the home page and in File → Open Recent, and open without asking again.
- **The editor** (`app/`) checks for the bridge (`isElectron()`, `desktopApi()`). In the desktop app there are no drafts: New story asks for a folder and puts a story file and `squiffy.json` in it, Open file opens a `.squiffy` file's folder or unpacks a project zip into a folder, and there's no service worker. The native menu's commands are carried out by `app/src/lib/desktop-shell.ts`.
- **Links** to other sites open in the browser, and nothing navigates the window away from the editor.

## Still to do (#276)

- Packaging: installers for macOS, Windows and Linux with electron-builder, a separate "Squiffy Beta" app for prereleases, icons, `.squiffy` file associations, signing, and a workflow that attaches them to each GitHub Release.
- Telling the author when there's a new version, and a downloads page on the docs site.
