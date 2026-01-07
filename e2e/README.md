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

## Test Stories

Test stories are in `e2e/test-stories/`:
- `animations.squiffy` - Tests animation plugin
- `replace.squiffy` - Tests replace label plugin with fade transitions
- `live.squiffy` - Tests live update plugin

## How It Works

1. `test-server.js` compiles `.squiffy` files on-demand and serves them
2. Playwright starts the server automatically before tests
3. Tests navigate to `/story-name/` URLs
4. Server compiles and packages the story, returns HTML/JS/CSS
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
