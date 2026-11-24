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
npm run screenshots               # all of them
npm run screenshots -- editor     # the files matching "editor"
```

`playwright.screenshots.config.ts` starts the editor's dev server on port 5188, and VS Code for
the web (`@vscode/test-web`, stable quality) on port 3123 with the extension from `vscode/` and
`examples/gameshow` open. VS Code is downloaded into `node_modules/.cache/vscode-test-web` the
first time. Both servers are reused if they're already running.

## How it fits together

- `e2e/screenshots/lib.ts` has the helpers. Use them rather than finding the editor's DOM again:
  - `test` is Playwright's, with `Math.random` seeded in every frame (the preview's too), so
    `{{random}}`, `shuffle` and so on come out the same each time.
  - `openStory(page, folder)` opens a story folder in the editor, by zipping it and giving it to
    the home page's **Open file**, as a project `.zip`. Sounds and images come too.
  - `setView`, `run` (returns the preview's frame), `choose` (clicks a link in the preview, and
    clicks again if the preview wasn't ready for it), `goToLine` (scrolls the script to a line),
    `resizePane` (drags the preview's or map's splitter).
  - `capture(page, name, options)` saves `site/src/assets/screenshots/<name>.png` and
    `<name>-dark.png`. It switches the theme by emulating the system's light or dark mode, which
    the editor follows; pass `setTheme` for a page that doesn't (VS Code). `clip` takes an element
    or a rectangle.
  - `settle(page)` waits until nothing on the map or in the preview has moved or faded for a
    moment. The runtime's `{{#animate}}` and transitions take no notice of reduced motion, so a
    story with a typewriter intro takes a few seconds.
- One `*.capture.ts` file per area: `editor.capture.ts` (the editor and the story map) and
  `vscode.capture.ts`. They aren't tests, aren't run by `npm run test:e2e`, and aren't run in CI.
- `e2e/screenshots/stories/` has stories made for a screenshot, such as `cave/`, which has a
  missing link, a dead end and an unreachable section for the map to show. Its `squiffy.json` has
  the map's positions (`map`), so the map's layout is the same each time. Use `examples/` when a
  real story suits.
- `site/src/components/Screenshot.astro` shows one in a page: `<Screenshot name="editor"
  alt="..." caption="..." />`, with the dark version when the site is dark, and a link to it full
  size. Astro makes webp versions at the sizes the page needs.

The window is 1440×810 at twice the pixels (`deviceScaleFactor: 2`), so text stays sharp when the
page scales a screenshot down to the content column.

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

## When the UI changes

Run `npm run screenshots` again, look at what changed (`git diff --stat site/src/assets/screenshots`
and the pictures themselves), and fix any capture that no longer finds its way.
