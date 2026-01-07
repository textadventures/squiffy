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

## Publishing

Packages are versioned and published together using Lerna:
```bash
npm run version    # Version all packages
npm run publish    # Publish to npm (skips private packages)
```

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
