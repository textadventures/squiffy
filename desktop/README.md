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
- **The editor** (`app/`) checks for the bridge (`isElectron()`, `desktopApi()`). In the desktop app there are no stories kept in the browser: New story asks for a name and makes a folder of that name with a story file and `squiffy.json` in it (in Documents/Squiffy, or the last location used: `src/new-story.ts`, which makes the folder so the editor never sends a path), Open file opens a `.squiffy` file's folder or unpacks a project zip into a folder, and there's no service worker. The native menu's commands are carried out by `app/src/lib/desktop-shell.ts`.
- **Links** to other sites open in the browser, and nothing navigates the window away from the editor.

## Packaging

```bash
npm run dist                               # installers for this OS, in release/
RELEASE_CHANNEL=prerelease npm run dist    # the same, as Squiffy Beta
```

`npm run dist` builds the main process, copies the editor's build (`app/build`, so build that first) into `resources/app-static`, and runs electron-builder (`scripts/dist.mjs`, on top of the `build` config in `package.json`):

| | Stable | Beta (`RELEASE_CHANNEL=prerelease`) |
|---|---|---|
| App | Squiffy | Squiffy Beta |
| `appId` | `com.squiffystory.desktop` | `com.squiffystory.desktop.beta` |
| `name` (Windows install folder, `.deb`, Linux executable) | `squiffy-desktop` | `squiffy-desktop-beta` |
| `desktopName` (Linux `.desktop` file and WM_CLASS) | `squiffy.desktop` | `squiffy-beta.desktop` |
| Icons | `build/` | `build/beta/` |

The beta is a separate app, so it installs beside the stable one and keeps its own settings and recent folders, as Quest Viva Beta does. Its home page says it's the beta, and its help links go to the beta docs.

- **macOS:** a DMG, Apple Silicon only, as Quest Viva's. electron-builder signs with any Developer ID it finds in the keychain; without one, `scripts/adhoc-sign.cjs` signs it ad hoc, since Apple Silicon won't open an unsigned app at all.
- **Windows:** an NSIS installer, x64, unsigned (SmartScreen warns).
- **Linux:** AppImage and `.deb`, x64 and arm64, run with `--no-sandbox` (Chromium's SUID sandbox helper can't be set up by an AppImage). The `.deb` is there because an AppImage doesn't add itself to the desktop's app list.
- `.squiffy` files are associated with the app, which opens a file's folder.

The icons are made from the editor's logo by `build/make-icons.sh` (ImageMagick and macOS's `iconutil`). The results are committed.

### Releases

`.github/workflows/desktop-publish.yml` runs on each release tag, on macOS, Windows and Linux. It builds the editor (with `VITE_DOCS_URL` and `VITE_BETA_APP` for a prerelease, as `deploy-app.yml` does), packages the app for the tag's channel (`.github/scripts/release-channel.sh`), and attaches the installers to the GitHub Release release-please made. It also runs, unsigned, on pull requests that change `desktop/` or the workflow, and can be run by hand (`gh workflow run desktop-publish.yml -f channel=stable`), when the installers are just the run's artifacts.

The macOS build is signed with a Developer ID and notarized when these repo secrets are set, as in Quest Viva's workflow, and signed ad hoc otherwise:

| Secret | |
|---|---|
| `MAC_CSC_LINK` | The Developer ID Application certificate, as a base64 `.p12` |
| `MAC_CSC_KEY_PASSWORD` | Its password |
| `APPLE_API_KEY_P8` | An App Store Connect API key, base64 |
| `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | Its key ID and issuer ID |

### Updates and downloads

The app doesn't update itself. When a new version is out, the editor says so, with a link to the release (`app/src/lib/desktop-updates.svelte.ts`, shown by `UpdateBanner.svelte`). It checks GitHub's releases when it starts and once a day: Squiffy for stable releases, and Squiffy Beta for prereleases as well. A release only counts once it has an installer for that platform. "Not now" skips that version.

The docs site's [desktop app page](https://squiffystory.com/desktop-app/) (`site/src/content/docs/desktop-app.mdx`, `site/src/components/DownloadButton.astro`) offers the latest release's installers, with the visitor's own system first. On beta.squiffystory.com it offers the newest prerelease, Squiffy Beta.
