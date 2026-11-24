# End-to-End Tests with Playwright

This directory contains end-to-end tests that run Squiffy stories in real browsers using Playwright.

## Why E2E Tests?

The unit tests in jsdom can't test:
- Animation effects (anime.js requires real browser APIs)
- CSS transitions and fades
- Real DOM timing and layout
- Cross-browser compatibility

These E2E tests fill that gap by running actual compiled stories in Chromium, Firefox, and WebKit.

## Setup

First time only:
```bash
npm install
npx playwright install
```

## Running Tests

```bash
# Run all E2E tests
npm run test:e2e

# Run with UI mode (recommended for development)
npm run test:e2e:ui

# Run both unit and E2E tests
npm run test:all
```

## The editor

`e2e/editor/` tests the editor (`app/`) itself, from its dev server, which Playwright starts on port 5188. Each test starts a new story in the browser and replaces its text. `story-map.spec.ts` covers the story map: writing a section beside the full-screen map, and editing from the map.

```bash
# Just the editor's tests
npx playwright test --project=editor
```

The dev server uses the built packages, so run `npm run build` first if you've changed the compiler, runtime or another workspace.

## The player and the docs site

`e2e/player/` and `e2e/site/` check the player (`player/`, on port 5181) and the docs site (`site/`, on port 4329, as the beta site) from their dev servers, for accessibility (#640): axe's automated WCAG checks of each page in light and dark, with the docs' samples running, and what the keyboard and a screen reader get from them, such as where the focus goes and what things are called. Like the editor's `accessibility.spec.ts`, they're instead of trying each change with a screen reader by hand, though they can't catch everything one would.

```bash
npx playwright test --project=player
npx playwright test --project=site
```

Astro won't start a second dev server for the site, so if one's already running, it has to be on port 4329 for these to use it.

## The docs' screenshots

`screenshots/` isn't tests: it takes the screenshots of the editor and the VS Code extension that the docs show, with `npm run screenshots`. See `.claude/skills/docs-screenshots/SKILL.md`.

## Test Stories

Test stories are in `e2e/test-stories/`:
- `animations.squiffy` - Tests animation plugin
- `link-animation.squiffy` - Tests link-triggered animations (disabled state, going back)
- `replace.squiffy` - Tests replace label plugin with fade transitions
- `live.squiffy` - Tests live update plugin
- `back.squiffy` - Tests going back (`goBack()`) with animations and cleared screens
- `continue.squiffy` - Tests `{{#animate "continue"}}` from the keyboard

## How It Works

1. `test-server.js` compiles `.squiffy` files on-demand and serves them
2. Playwright starts the server automatically before tests
3. Tests navigate to `/story-name/` URLs
4. Server compiles and packages the story, returns HTML/JS/CSS (exposing the API as `window.squiffyApi`, so tests can call e.g. `goBack()`)
5. Tests interact with the story in real browsers

## Writing New Tests

1. Add a `.squiffy` file to `test-stories/`
2. Create a `.spec.ts` test file in `e2e/`
3. Use Playwright API to interact with the story
4. Tests run in 3 browsers automatically

## Debugging

```bash
# Run tests in headed mode
npx playwright test --headed

# Run specific test file
npx playwright test plugins.spec.ts

# Generate test code with Playwright codegen
npx playwright codegen http://localhost:8282/animations/
```
