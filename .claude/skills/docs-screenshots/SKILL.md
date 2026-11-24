---
name: docs-screenshots
description: Take or retake the docs site's screenshots of the editor and the VS Code extension with the Playwright harness in e2e/screenshots/, or add a new one to a docs page
---

# The docs' screenshots

The docs (`site/src/content/docs/`) show screenshots of the editor and the VS Code extension, so
someone can see what Squiffy looks like before they download it. They're taken by Playwright
scripts, not by hand, so when the UI changes they can be taken again with one command.

```bash
npm run build                     # the editor and the extension use the packages' builds
npm run build --workspace vscode  # the extension, for the VS Code shots
npm run screenshots               # all of them, in about a minute
npm run screenshots -- editor     # the files matching "editor"
```

The desktop app's shots need the editor's static build and the desktop app's own, as
`desktop/` isn't a workspace: `npm run build` in `app/`, then `npm install && npm run build` in
`desktop/`. Its window opens on the screen while they run.

**In a git worktree**, `npm run build` (and `./dev.sh`, which uses lerna too) builds the main
checkout's packages, not the worktree's, so the screenshots show whatever the worktree last built
by hand. Build each package in the worktree instead: `for p in compiler runtime packager player
codemirror-lang editor-search graph-map project-fs vscode; do (cd $p && npm run build); done`.
Check with `ls -la runtime/dist` that the dates are today's.

`playwright.screenshots.config.ts` starts the editor's dev server on port 5188, and VS Code for
the web (`@vscode/test-web`, stable quality) on port 3123 with the extension from `vscode/` and
`examples/gameshow` open. VS Code is downloaded into `node_modules/.cache/vscode-test-web` the
first time. Both servers are reused if they're already running.

## How it fits together

- `e2e/screenshots/lib.ts` has the helpers. Use them rather than finding the editor's DOM again:
  - `test` is Playwright's, with `Math.random` seeded in every frame of every page in the
    context (the preview's, and a tab from **Play in a new tab**), so `{{random}}`, `shuffle`
    and so on come out the same each time. `choose()` seeds it again before each click, and
    `reseed(page)` does for anything else that moves the story on, such as pressing Enter in a
    text box, as how many numbers get used before a click can depend on timing. It also blocks requests to
    textadventures.co.uk, so the home page has no "Made with Squiffy" games, which change.
  - `openStory(page, folder)` opens a story folder in the editor, by zipping it and giving it to
    the home page's **Open file**, as a project `.zip`. Sounds and images come too.
  - `setView`, `run` (returns the preview's frame), `choose` (clicks a link in the preview, and
    clicks again if the preview wasn't ready for it), `goToLine` (scrolls the script to a line),
    `resizePane` (drags the preview's or map's splitter), `menu(page, "File", "Publish…")`.
  - `newStory(page, text)` starts a new story and types this in place of the starter story, as
    the tutorial has the reader do, with `repoFile()` to read a step from `site/src/tutorial/`.
    It dismisses the reminder to download a copy. `openStory(page, folder, extraFiles)` can add
    files from elsewhere in the repo, such as the tutorial's sounds.
  - `playInNewTab(page)` publishes the story open in the editor into a tab of its own, for a
    shot of what players see. A side panel needs the story to be at least 1024 pixels wide,
    which the preview isn't, beside the script.
  - `dialog(page)` is the open dialog's panel, and puts a plain background behind it in place of
    the dimmed editor. `around(locator, padding)` is a rectangle around an element, for `clip`.
  - `capture(page, name, options)` saves `site/src/assets/screenshots/<name>.png` and
    `<name>-dark.png`. It switches the theme by emulating the system's light or dark mode, which
    the editor follows; pass `setTheme` for a page that doesn't (VS Code). `clip` takes an element
    or a rectangle.
  - `settle(page)` waits until nothing on the map or in the preview has moved or faded for a
    moment. The runtime's `{{#animate}}` and transitions take no notice of reduced motion, so a
    story with a typewriter intro takes a few seconds.
- One `*.capture.ts` file per area: `editor.capture.ts` (the editor and the story map),
  `editor-tools.capture.ts` (the home page, problems, Start at menu and dialogs),
  `player.capture.ts` (the published game show, from **Play in a new tab**),
  `tutorial.capture.ts` (both parts of the tutorial), `twine.capture.ts` and `quest.capture.ts`
  (converting a Twine story and a Quest gamebook), `desktop.capture.ts` and `vscode.capture.ts`.
- `desktop.capture.ts` launches the desktop app with Playwright's `_electron`, with a userData
  folder of its own holding a made-up New story location (`/Users/you/Documents/Squiffy`), so it
  neither touches nor shows your own settings and paths. The desktop app's home page isn't
  captured, as it's the editor's (`editor-home`), but for a line or two. Only the window's
  contents can be captured: the title bar, the native menu and native file dialogs are the OS's. They aren't tests, aren't run by `npm run test:e2e`, and aren't run in CI.
- `e2e/screenshots/stories/` has stories made for a screenshot, such as `cave/`, which has a
  missing link, a dead end and an unreachable section for the map to show, and
  `twine/the-lighthouse.twee`, a small Harlowe story with Twine map positions and one thing the
  converter notes in `twine-import.txt`, and `quest/the-dragons-hoard.aslx`, a small Quest 5.8
  gamebook with a page script, a flag, and one thing noted in `quest-import.txt`. Its `squiffy.json` has
  the map's positions (`map`), so the map's layout is the same each time. Use `examples/` when a
  real story suits.
- `site/src/components/Screenshot.astro` shows one in a page: `<Screenshot name="editor"
  alt="..." caption="..." />`, with the dark version when the site is dark, and a link to it full
  size. A small one, such as a dialog, is shown at its own size rather than stretched to the
  column. Astro makes webp versions at the sizes the page needs.

The window is 1440×810 at twice the pixels (`deviceScaleFactor: 2`), so text stays sharp when the
page scales a screenshot down to the content column.

Things that would make a picture different each run, and what the captures do about them:

- Dates: `page.clock.setFixedTime(...)`, as the home page shot does for "Last opened". Only
  where it's needed, as it stops time for the story's animations too.
- Random text: the seeded `Math.random`, and `reseed` before clicks.
- Animations: `settle`, and reduced motion, which the config turns on and the runtime follows,
  so typewriter and toast fade in at once and looping animations stay still. Something that
  keeps changing anyway makes `settle` give up after about 18 seconds, so a slow capture is a
  sign of one.
- The mouse: something it was left over can show a hover state. VS Code's splitters show dots,
  so `vscode.capture.ts` hides them.
- VS Code's language server: wait for what it provides (the Outline's sections) before the
  shot, or the Outline says it has nothing to show.
- Something that looks the same in both themes, such as the game show, whose studio is always
  dark: pass `themes: false`, so there's no `-dark` copy.

## Adding a screenshot

1. Decide what it should show, and which story shows it best. A small story made for the purpose
   is often clearer than a big example (the game show's map is too big to read in a screenshot).
2. Walk through it in the editor first (`./dev.sh`, or the dev server the config starts), to find
   the controls. Prefer roles and labels (`getByRole("button", { name: "Run" })`) to classes.
3. Add a test to the right `*.capture.ts` file, or a new file, ending in `capture(page, "name")`.
4. Run it, and **look at both pictures** (light and dark) before using them: the right story, the
   right state, nothing half faded in, no empty preview, nothing personal such as a real name.
5. Add `<Screenshot>` to the page, with alt text that says what the picture shows.
6. Commit the PNGs with the change. Retaking them gives different bytes even when nothing has
   changed, so only commit the ones that matter to the change.

To check a capture is repeatable, run it twice and compare the PNGs with `cmp`: a picture that
comes out different each time would make every retake look like a change.

The first run after the editor's dev server starts can time out while Vite prepares its
dependencies. Run it again.

## When the UI changes

Run `npm run screenshots` again, look at what changed (`git diff --stat site/src/assets/screenshots`
and the pictures themselves), and fix any capture that no longer finds its way.
