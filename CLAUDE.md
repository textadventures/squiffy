# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Squiffy is a tool for creating multiple-choice interactive stories. This is a Lerna-managed monorepo currently under reconstruction (v6, alpha). The production version is on the `v5` branch.

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
cd editor && npm run build
cd site && npm run build

# Run the editor locally
cd editor && npm run dev

# Run the site locally
cd site && npm run dev
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

The runtime tests use jsdom environment (configured in `runtime/vitest.config.ts`).

## Linting

```bash
npm run lint
```

## Releasing

Releases are managed by [release-please](https://github.com/googleapis/release-please) (`.github/workflows/release-please.yml`, config in `release-please-config.json` / `.release-please-manifest.json`). All packages share one version, and there's no manual version-bump step:

1. PRs must have a [Conventional Commits](https://www.conventionalcommits.org/)-prefixed title (`fix:`, `feat:`, `chore:`, etc.), enforced by `pr-title-lint.yml`. PRs are squash-merged, so the PR title becomes the commit message on `main` that release-please parses. `fix:` and `feat:` appear in the changelog; `chore:`, `test:`, `docs:` etc. don't, and don't trigger a release on their own. Dependabot PRs use the `chore` prefix.
2. Every push to `main` updates a standing "release PR" that bumps the version and `CHANGELOG.md` from the commits merged since the last release. The version lives in the root `package.json` and is copied into `lerna.json`, every workspace's `package.json`, the internal `squiffy-*` dependency ranges, and the matching `package-lock.json` entries (the `extra-files` list in `release-please-config.json`; a new workspace or internal dependency must be added there).
3. Merging that release PR *is* the release: release-please tags it (e.g. `v6.0.0-beta.3`) and creates the GitHub Release, and the tag triggers `npm-publish.yml`, which runs `lerna publish from-package` to publish the non-private packages.

The `prerelease` versioning strategy means every release just increments the trailing `beta.N`, whatever the commit types. To cut a specific version (e.g. `6.0.0`), merge a commit with a `Release-As: 6.0.0` footer (exact wording). The squash merge message has to be edited by hand to include it. Changing `prerelease-type` in the config alone doesn't affect the next release while a numbered prerelease sequence is under way; it needs the same one-off `Release-As` commit.

`.github/scripts/release-channel.sh` says whether a tag is `stable` or a `prerelease`. A stable release is un-flagged as a prerelease on GitHub and marked Latest. On npm, prereleases still go to the `latest` dist-tag until 6.0.0 ships (see the comment in `npm-publish.yml`).

release-please pushes using the `RELEASE_PAT` repo secret (a PAT with Contents and Pull requests read/write), since tags pushed with `GITHUB_TOKEN` don't trigger other workflows. `npm-publish.yml` needs no secret: it uses npm trusted publishing, which each package must have configured on npmjs.com (trusting `textadventures/squiffy` and `npm-publish.yml`). Lerna then adds provenance, which needs every published package.json to have a `repository.url` pointing at this repo.

`npm run publish:manual` still works as a manual fallback (it publishes whatever versions are in the package.json files and aren't on npm yet). Don't name a root script `publish`: npm treats that as a lifecycle hook, so `lerna publish` would run it again after publishing and fail.

## CLI Usage

Test the CLI during development:
```bash
cd examples/test
npx @textadventures/squiffy-cli example.squiffy -s
```

CLI options:
- `-s, --serve`: Start HTTP server after compiling
- `-p, --port`: Port for HTTP server (default: 8282)
- `--scriptonly [filename]`: Only generate JavaScript file
- `--zip`: Create zip file

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
- **editor**: Web-based IDE at app.squiffystory.com (Vite + TypeScript + Bootstrap)
  - Uses Ace editor for code editing
  - Two entry points: `index.html` (editor) and `preview.html` (story preview)
  - PWA-enabled with offline support
- **site**: Marketing/documentation site at squiffystory.com (Astro + Starlight)
- **types**: Type definitions for Vite plugin

### Key Concepts

- **Sections**: Major story divisions. When you navigate to a new section, all previous links become unclickable, ensuring forward-only progression from that point.
- **Passages**: Sub-divisions within a section. Unlike sections, passage links remain clickable after being used - you can click passage links in any order within the same section, creating a more exploratory experience.
- **Story Data**: The compiler outputs a JSON structure with sections/passages and JavaScript arrays
- **Plugins**: Runtime extends functionality via plugin system (animate, live updates, random, etc.)
- **State**: Runtime manages story state (variables, history) via `State` class
- **Link Handler**: Runtime component that processes different link types (section, passage, custom)

## TypeScript Configuration

Each package has its own `tsconfig.json`. Packages using Vite (runtime, packager, editor) have `vite.config.ts` files.

## File Locations

- Compiler source: `compiler/src/compiler.ts`
- Runtime source: `runtime/src/squiffy.runtime.ts`
- Runtime plugins: `runtime/src/plugins/`
- Packager source: `packager/src/packager.ts`
- CLI source: `cli/src/squiffy.ts`
- Editor source: `editor/src/main.ts`

## Development Workflow

When working on the compiler or runtime:
1. Make changes to source files
2. Run `npm run build` in that package
3. Test with `npm test` in that package
4. To test integration, rebuild dependent packages (e.g., after changing compiler, rebuild packager)

When working on the editor:
1. Run `npm run dev` in the editor directory
2. Changes hot-reload automatically
3. The editor uses local versions of compiler, runtime, and packager

## Module System

All packages use ES modules (`"type": "module"` in package.json). Import statements use `.js` extensions even for TypeScript files (TypeScript will resolve them correctly).
