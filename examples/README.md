# Squiffy examples

- **coffeeshop/**: *Coffee Shop Confessions*, a story about your first days working at a coffee shop. Text input, attributes, conditional text and several endings.
- **gameshow/**: *The Wheel of Dubious Fortune*, a chaotic game show. Animations, live text, random events and scoring.
- **vite-app/**: a web app that imports a story with [the Vite plugin](../vite-plugin). See its README.

You can play the two stories, and change them, on the [Examples page](https://squiffystory.com/featured-examples/). For short examples of particular things, see the [Cookbook](https://squiffystory.com/cookbook/), and the editable samples throughout the docs.

## Running them locally

From the project root, after `npm install` and `npm run build`:

```bash
cd examples/coffeeshop
npx @textadventures/squiffy-cli -s
```

This builds the story in the folder's `squiffy.json` and serves it at http://localhost:8282.

## Adding an example

A folder here with a `squiffy.json` is built by the docs site (`site/scripts/build-examples.ts`) into `/examples/<folder>/` as a standalone game. To show it on the Examples page, add it to `site/src/examples.ts` and `site/src/content/docs/featured-examples.mdx`, and add it to the list in `compiler/src/compiler.test.ts`.

Short examples of a single feature belong in the docs instead, as an editable sample.
