# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Squiffy is a tool for creating multiple-choice interactive stories. This is a Lerna-managed monorepo for Squiffy 6, a complete rewrite of Squiffy 5 (which lives on the `v5` branch).

## Initial Setup

After cloning:
```bash
npm install
npm run build
npm install  # Run again to register local packages
```

## Build Commands

```bash
# Build all packages
npm run build

# Build a single workspace
cd compiler && npm run build
cd runtime && npm run build
cd packager && npm run build
cd cli && npm run build
cd app && npm run build
cd site && npm run build

# Run the editor locally (builds the packages it uses first; --skip-build, --port <n>)
./dev.sh
# or, if they're already built
cd app && npm run dev

# Run the site locally
cd site && npm run dev

# Build and run the desktop app (desktop/ isn't a workspace; this installs it too)
./electron.sh
```

## Testing

Tests use Vitest:
```bash
# Run all tests
npm test

# Run tests for specific packages
cd compiler && npm test
cd runtime && npm test

# Run tests in watch mode (for development)
cd compiler && npm run dev
cd runtime && npm run dev
```

End-to-end tests use Playwright (`npm run test:e2e`, not run in CI): `e2e/` runs compiled stories in a browser, and `e2e/editor/` runs the editor from its dev server (`npx playwright test --project=editor`), for what needs a real browser, such as the story map and writing on it.

The runtime tests run in the `node` environment, and each test creates a fresh DOM with `global-jsdom` (so use `window.Event` etc. rather than the Node globals).

## Linting

```bash
npm run lint
```

## Releasing

Releases are managed by [release-please](https://github.com/googleapis/release-please) (`.github/workflows/release-please.yml`, config in `release-please-config.json` / `.release-please-manifest.json`). All packages share one version, and there's no manual version-bump step:

1. PRs must have a [Conventional Commits](https://www.conventionalcommits.org/)-prefixed title (`fix:`, `feat:`, `chore:`, etc.), enforced by `pr-title-lint.yml`. PRs are squash-merged, so the PR title becomes the commit message on `main` that release-please parses. `fix:` and `feat:` appear in the changelog; `chore:`, `test:`, `docs:` etc. don't, and don't trigger a release on their own. Dependabot PRs use the `chore` prefix. A PR that only changes `site/` should use `docs:` or `chore:`, not `feat:` or `fix:`: a `feat:` would bump the packages' minor version with nothing new in them. Its docs go live on beta.squiffystory.com straight away, and on squiffystory.com with the next stable release (or sooner, as a docs fix: see "Docs site" below).
2. Every push to `main` updates a standing "release PR" that bumps the version and `CHANGELOG.md` from the commits merged since the last release. The version lives in the root `package.json` and is copied into `lerna.json`, every workspace's `package.json`, the internal `squiffy-*` dependency ranges, and the matching `package-lock.json` entries (the `extra-files` list in `release-please-config.json`; a new workspace or internal dependency must be added there).
3. Merging that release PR *is* the release: release-please tags it (e.g. `v6.0.1`) and creates the GitHub Release, and the tag triggers `npm-publish.yml`, which runs `lerna publish from-package` to publish the non-private packages, `deploy-app.yml`, which deploys the editor (`app/`) to app.squiffystory.com, `desktop-publish.yml`, which attaches the desktop app's installers to the GitHub Release (see `desktop/README.md`), and (for a stable release) `deploy-site.yml`, which deploys that release's docs to squiffystory.com.

Versions follow semver from the commit types: `fix:` bumps the patch version and `feat:` the minor. To cut a specific version (e.g. `7.0.0`, or a prerelease such as `6.1.0-beta.1`), merge a commit with a `Release-As: 7.0.0` footer (exact wording). The squash merge message has to be edited by hand to include it.

Prereleases only need a `Release-As` to start a series (e.g. `Release-As: 7.1.0-beta.1`). After that, while the current version is a prerelease, every release bumps just its number (`7.1.0-beta.2`, `-beta.3`, …) whatever the commit types, until a `Release-As: 7.1.0` makes the stable release. That's the `"versioning": "prerelease"` and `"prerelease": true` in `release-please-config.json`. They make no difference once the version is stable, so they stay set. Don't add a `prerelease-type` there: that would make the release after a stable one a prerelease too (e.g. `7.0.0` → `7.0.1-beta`).

`.github/scripts/release-channel.sh` says whether a tag is `stable` or a `prerelease` (anything with a `-`, e.g. `-beta.1`). A stable release is marked Latest on GitHub, goes to the `latest` dist-tag on npm, deploys to app.squiffystory.com and puts its docs on squiffystory.com. A prerelease is flagged as a prerelease on GitHub, goes to the `beta` dist-tag on npm and deploys to the `beta` preview branch of `squiffy-app` (beta.squiffy.pages.dev, served as app-beta.squiffystory.com), so stable users never get it. Its desktop app is packaged as a separate app, Squiffy Beta, which installs beside the stable one. The beta editor's Help menu links to beta.squiffystory.com, and its home page says it's the beta (`deploy-app.yml` builds it with `VITE_DOCS_URL` and `VITE_BETA_APP`).

release-please pushes using the `RELEASE_PAT` repo secret (a PAT with Contents and Pull requests read/write), since tags pushed with `GITHUB_TOKEN` don't trigger other workflows. `npm-publish.yml` needs no secret: it uses npm trusted publishing, which each package must have configured on npmjs.com (trusting `textadventures/squiffy` and `npm-publish.yml`). Lerna then adds provenance, which needs every published package.json to have a `repository.url` pointing at this repo.

`dependabot-automerge.yml` also merges with `RELEASE_PAT`, so the merge's push to `main` triggers release-please. Runs triggered by Dependabot can only read Dependabot secrets, so `RELEASE_PAT` must be set under both Settings → Secrets → Actions and Settings → Secrets → Dependabot. If the release PR ever goes stale or conflicts because a push didn't trigger release-please, run `gh workflow run release-please.yml` to regenerate it.

**Deployments:** both sites are Cloudflare Pages projects connected to this repo, which build a preview deployment for every PR and push (their checks are required on `main`). They build with the Node version in `.node-version`, which should match the `node-version` in the GitHub workflows. Both have automatic production deployments turned off in the Cloudflare dashboard, and are deployed to production only by a workflow uploading a release tag's build with Wrangler (using the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets). app.squiffystory.com (`squiffy-app`) is deployed by `deploy-app.yml`, which uploads stable releases to `--branch=main`, its production branch. `squiffy-app` builds with `npx lerna run build --scope @textadventures/squiffy-app --include-dependencies`, into `app/build`. To redeploy or roll back, run `gh workflow run deploy-app.yml --ref vX.Y.Z`.

**Docs site:** the docs have two channels, like the editor:

| Site | Built from | Documents |
|---|---|---|
| squiffystory.com | the latest stable release tag, by `deploy-site.yml` | the current stable release |
| beta.squiffystory.com | `main`, by Cloudflare | the next release, as it's being built |

So docs for a new feature are written on `main` as if it already shipped, with no version markers, and reach squiffystory.com when it's released. `squiffy-site`'s production branch is `production`, a branch in this repo that only exists because Cloudflare's branch control won't accept a branch that doesn't. It points at `v6.0.1` and nothing should be pushed to it: with automatic production deployments off, Cloudflare never builds it, and only `deploy-site.yml`'s uploads go live. Cloudflare builds `main` and every PR as preview deployments, with `PUBLIC_BETA_SITE=true` set in the Preview environment. beta.squiffystory.com is a custom domain on the `main` branch alias (main.squiffy-site.pages.dev). `deploy-site.yml` uploads stable builds to `--branch=production`.

A beta build (`site/src/channel.mjs`) shows a banner above every page (`site/src/components/Banner.astro`) linking to squiffystory.com, has a `noindex` robots meta tag so search results go to the stable docs, uses beta.squiffystory.com for its canonical links and sitemap, and points its links to app.squiffystory.com at app-beta.squiffystory.com (`site/src/app-links.mjs` rewrites them in the built HTML). To build one locally: `PUBLIC_BETA_SITE=true npm run build` in `site/`.

There's no release branch, so a docs fix for the current release that can't wait for the next one goes like this: land it on `main` as usual, then make a branch from the latest stable tag, cherry-pick the fix onto it (and any earlier fixes deployed this way since that release), push it, and run `gh workflow run deploy-site.yml -f ref=<branch>`. The workflow refuses a branch that doesn't contain the latest stable tag or that changes anything outside `site/`, so squiffystory.com never documents unreleased changes. The branch can be deleted once the next stable release is out. `gh workflow run deploy-site.yml -f ref=vX.Y.Z` redeploys or rolls back to a release's docs.

**Old docs redirects:** the Squiffy 5 docs at docs.textadventures.co.uk/squiffy/ are to be redirected, from the 6.0.0 launch, by a Cloudflare Redirect Rule on the textadventures.co.uk zone, which strips `/squiffy` and `.html` and sends the request to squiffystory.com. `site/public/_redirects` then maps each old page to its new home. The rules are relative, so they work on beta.squiffystory.com too. `site/scripts/check-redirects.ts` runs as part of the site build (both channels) and fails if an old page (listed in `site/scripts/legacy-docs-paths.txt`) doesn't resolve, a target `#anchor` is missing (e.g. after a heading rename), or the file goes over Cloudflare Pages' 100-rule limit.

`npm run publish:manual` still works as a manual fallback (it publishes whatever versions are in the package.json files and aren't on npm yet). Don't name a root script `publish`: npm treats that as a lifecycle hook, so `lerna publish` would run it again after publishing and fail.

## CLI Usage

Test the CLI during development:
```bash
cd examples/coffeeshop
npx @textadventures/squiffy-cli -s
```

CLI options:
- `-s, --serve`: Start HTTP server after compiling
- `-p, --port`: Port for HTTP server (default: 8282)
- `--scriptonly [filename]`: Only generate JavaScript file
- `--zip`: Create zip file
- `--check`: Report problems without building, from the language service (`cli/src/check.ts`): what the build reports, plus unreachable sections, dead ends, and sound on the first screen (which browsers won't play before a click)
- `--play`: Play the story as text in jsdom (`cli/src/play.ts`), printing the new text and the links after each step. `--choose` (link text or number, repeatable), `--choices file` (one link per line), `--input attribute=value`, `--save file.json` (carry on between runs, which is how an agent plays a step at a time), `--start`, `--attributes`, `--seed`. Time is virtual: animations, transitions and `{{goto ... after=}}` happen at once
- `--random [runs]`: Play many times clicking at random (`--steps`, `--seed`), reporting errors, dead ends, endings and sections never visited, each problem with the `--play` options that reproduce it. A way longer than five links goes in a `--choices` file in `random/` in the build folder
- `--record file.squiffy-test`: With `--play`, record the playthrough as a test: the seed, inputs, links clicked, and the sections reached and attributes changed at each step (`cli/src/playtest.ts`, #499)
- `--test [file or folder]`: Replay every `.squiffy-test` file in the story's folder (not `build/`), reporting the first step where each one goes differently. `--update` records failing tests again. Recording them from the editor is #310
- `--json`: With `--check`, `--play`, `--random` or `--test`, print the result as JSON, for AI agents and other tools
- `--convert-v5`: Convert Squiffy 5 text processor syntax to Squiffy 6 (keeps a `.bak` of the original)
- `--convert-twine`: Convert a Twine story (Twee, or Twine's published or archive HTML; Harlowe or SugarCube) into a new Squiffy story folder, with `twine-import.txt` listing what couldn't be converted exactly (#378). `--out` chooses the folder
- `--convert-quest`: Convert a Quest 5 or Quest Viva gamebook (a `.quest` file, or `.aslx`) into a new Squiffy story folder, with the images and sounds it uses, and `quest-import.txt` listing what couldn't be converted exactly (`compiler/src/quest/`). Page scripts are converted to helpers at the start of each section (`compiler/src/quest/script.ts` parses them, `scripts.ts` converts them). Commands beyond the gamebook editor's own are kept as comments. `--out` chooses the folder
- `--convert-v6`: Convert a Squiffy 6 story's `@set` and link setters to Squiffy 7's rules (#373) and add a `squiffy.json`, which is what turns those rules on (keeps a `.bak` of each file changed)

## Architecture

### Data Flow

1. **Compiler** (`compiler/`) - Converts Squiffy script text into JavaScript
   - Input: `.squiffy` text files containing story markup
   - Output: JSON story structure + JavaScript functions
   - Main file: `compiler/src/compiler.ts`
   - Exports: `compile()` function returning `CompileSuccess | CompileError`

2. **Runtime** (`runtime/`) - Browser library that executes compiled stories
   - Input: Compiled story data from compiler
   - Handles: Link clicks, state management, transitions, plugins
   - Main file: `runtime/src/squiffy.runtime.ts`
   - Entry point: `init()` function returning `SquiffyApi`
   - Plugin architecture in `runtime/src/plugins/`
   - The rewriting of infix expressions (`{{= a + 1}}`, `{{#if a > 1}}`) is in the compiler (`compiler/src/infix-expressions.ts`, exported as `squiffy-compiler/infix-expressions`), which the runtime's build bundles. The compiler uses it too, to report Handlebars syntax errors in a section's text (`compiler/src/templates.ts`)

3. **Packager** (`packager/`) - Bundles compiler output + runtime into deployable files
   - Input: `CompileSuccess` output from compiler
   - Output: HTML, CSS, JS files (and optional zip)
   - Main file: `packager/src/packager.ts`
   - Exports: `createPackage()` function

### Packages

- **compiler**: Pure compilation logic, no I/O (async file loading via callbacks)
- **runtime**: Browser-side execution, handles DOM manipulation, state, events
- **packager**: Combines compiler + runtime, generates output files
- **cli**: Node.js CLI wrapper around packager, includes file I/O and dev server
- **app**: Private workspace (`@textadventures/squiffy-app`) with the editor at app.squiffystory.com (#278): SvelteKit + Skeleton on Quest Viva's app shell, CodeMirror 6, the language service in a Web Worker, the sandboxed preview from `squiffy-runtime/preview-host`, and `@textadventures/project-fs` for files. A PWA, with offline support. It replaced the 6.x editor (`editor/`, Vite + Bootstrap + Ace) in 7.0. See `app/README.md`.
- **codemirror-lang**: Private workspace (`@textadventures/squiffy-codemirror`) with the CodeMirror 6 highlighting mode for `.squiffy` files, shared by the editor and the docs site's editable samples (`site/src/components/Sample.astro`). Each colours it with its own `HighlightStyle`. The docs' static code blocks use the TextMate grammar in `compiler/syntaxes/` instead, so a highlighting change may need making in both.
- **desktop**: The Electron desktop app (#276), `squiffy-desktop`: the editor from `app/` served from an `app://` scheme, with project-fs's Electron bridge for folders on disk, recent folders kept by the main process, and a native menu. Not one of the npm workspaces (so the root install doesn't download Electron): it has its own lockfile and depends on `file:../project-fs`. See `desktop/README.md`.
- **site**: Marketing/documentation site at squiffystory.com, with a beta channel at beta.squiffystory.com (Astro + Starlight; see "Docs site" above)
- **project-fs**: Private workspace (`@textadventures/project-fs`) with the editor's file system layer: list/read/write/delete over a rooted project tree, with in-memory, File System Access, OPFS, Node and Electron adapters and a shared conformance suite. No Squiffy imports, so it can become a standalone package later (#215). See `project-fs/README.md`.
- **graph-map**: Private workspace (`@textadventures/graph-map`) with the editor's story map component (#380): a Svelte map of a directed graph with a live force-directed layout (Barnes–Hut repulsion, springs, rows by rank), pan, zoom, drag-to-link and keyboard access. No Squiffy imports, like `project-fs`, so Quest Viva can use it too. The TypeScript core builds to `dist/`; `GraphMap.svelte` is shipped as source. See `graph-map/README.md`.
- **editor-search**: Private workspace (`@textadventures/editor-search`) with the editor's Find and Replace panel and Go to line bar, in place of CodeMirror's own: plain DOM on `@codemirror/search` (which still does the searching), coloured by `--ed-search-*` custom properties that `app/src/lib/codemirror-theme.ts` sets. No Squiffy imports, like `project-fs`, as it's meant for Quest Viva's editor too, from a shared repo in time. See `editor-search/README.md`.
- **types**: Type definitions for `.squiffy` imports, used by the Vite plugin
- **vite-plugin**: Vite plugin that compiles `.squiffy` imports, so a story can be built into a web app. `examples/vite-app` is a private workspace that uses it.
- **plugins/squiffy**: Not a package. A Claude Code plugin with a Squiffy skill (`skills/squiffy/SKILL.md`, and `references/` beside it), for authors whose own Claude Code works on a story folder with none of this repo's context. `.claude-plugin/marketplace.json` at the root makes this repo its marketplace (`/plugin marketplace add textadventures/squiffy`, `/plugin install squiffy@squiffy`; `/plugin marketplace add ./` to try a local copy, and `claude plugin validate ./` to check it). It has no `version`, so installs follow the latest commit on `main`, and release-please doesn't need to bump it. The skill summarises the docs for an agent, so **a change to the language (syntax, directives, helpers, setter rules, `squiffy.json` properties, CLI options) needs the same change in the skill's references**, as well as in `site/`. `runtime/src/skill.test.ts` fails if a helper the runtime registers is missing from either the docs' `helpers-reference.mdx` or the skill's `references/helpers.md`. Documented in `site/src/content/docs/writing-with-ai.mdx`.
- **examples**: Not a package. The complete stories on the docs site's Examples page (`coffeeshop`, `gameshow`), which `site/scripts/build-examples.ts` builds as standalone games, as the CLI builds them, and zips as downloads that open in the editor (every folder in `examples/` with a `squiffy.json`), plus `vite-app`. The page shows the game show's files with `site/src/components/ExampleFiles.astro`, listed in `site/src/examples.ts`. `coffeeshop` is a quiet story that shows the basics; `gameshow` shows off as much of Squiffy 7 as it can (several files, panels, settings, sound, timers...), so a new feature that suits it can go in. `cli/src/examples.test.ts` checks each one, plays it at random, and runs its playthrough tests in `tests/` (record them again with `--test --update` after changing a story on purpose). Short examples of single features belong in the docs as editable samples, or in the Cookbook (`site/src/cookbook/`). The compiler's snapshot tests compile both these stories and the feature stories in `compiler/test/fixtures/`, which have no `squiffy.json`, so they cover Squiffy 6's setter rules. The runtime tests use `compiler/test/fixtures/test/example.squiffy`.

### Key Concepts

- **Sections**: Major story divisions. When you navigate to a new section, all previous links become unclickable, ensuring forward-only progression from that point.
- **Passages**: Sub-divisions within a section. The player can click a section's passage links in any order, until they leave the section. Each passage link can be clicked once, unless the passage has `@repeat` (#104).
- **Story Data**: The compiler outputs a JSON structure with sections/passages and JavaScript arrays
- **Plugins**: Runtime extends functionality via plugin system (animate, live updates, random, etc.)
- **State**: Runtime manages story state (variables, history) via `State` class
- **Link Handler**: Runtime component that processes different link types (section, passage, custom)

## TypeScript Configuration

Each package has its own `tsconfig.json`. Packages using Vite (runtime, packager, app) have `vite.config.ts` files.

## File Locations

- Compiler source: `compiler/src/compiler.ts`
- Runtime source: `runtime/src/squiffy.runtime.ts`
- Runtime plugins: `runtime/src/plugins/`
- Packager source: `packager/src/packager.ts`
- CLI source: `cli/src/squiffy.ts`
- Editor source: `app/src/routes/edit/+page.svelte` (see `app/README.md`)

## Development Workflow

When working on the compiler or runtime:
1. Make changes to source files
2. Run `npm run build` in that package
3. Test with `npm test` in that package
4. To test integration, rebuild dependent packages (e.g., after changing compiler, rebuild packager)

When working on the editor:
1. Run `npm run dev` in the app directory
2. Changes hot-reload automatically
3. The editor uses local versions of compiler, runtime, packager, project-fs, graph-map, editor-search and codemirror-lang (rebuild them after changing them; `GraphMap.svelte` itself hot-reloads)

## Module System

All packages use ES modules (`"type": "module"` in package.json). Import statements use `.js` extensions even for TypeScript files (TypeScript will resolve them correctly).
