# Squiffy examples

- **coffeeshop/**: *Coffee Shop Confessions*, three days of training at a coffee shop, getting to know the regulars. A quiet story that shows the basics: text boxes, objects, passages, conditional text, a side panel, a stylesheet for the evening, and three endings.
- **gameshow/**: *The Wheel of Dubious Fortune*, a chaotic game show, which shows off as much of Squiffy as it can: several files, panels, player settings, music and sound, repeating text, timers, animations, text effects, transitions, arrays and objects, and a little JavaScript.
- **vite-app/**: a web app that imports a story with [the Vite plugin](../vite-plugin). See its README.

You can play the two stories, and change them, on the [Examples page](https://squiffystory.com/featured-examples/). For short examples of particular things, see the [Cookbook](https://squiffystory.com/cookbook/), and the editable samples throughout the docs.

## Running them locally

From the project root, after `npm install` and `npm run build`:

```bash
cd examples/coffeeshop
npx @textadventures/squiffy-cli -s
```

This builds the story in the folder's `squiffy.json` and serves it at http://localhost:8282.

Each story has playthrough tests in `tests/`. After changing a story, check it, play it at random, and run its tests:

```bash
npx @textadventures/squiffy-cli --check
npx @textadventures/squiffy-cli --random 300
npx @textadventures/squiffy-cli --test
```

A test that fails because the story changed on purpose can be recorded again with `--test --update`. The tests use a fixed random seed, so changing what's random in a story (such as adding a `{{random}}` before one that a test depends on) can change what a test sees.

The game show's theme tune, `gameshow/sounds/theme.mp3`, is by Keehar, and credited in its ID3 tags. Its sound effects are made with [ffmpeg](https://ffmpeg.org), by `gameshow/sounds/make-sounds.py`: the applause from [Applause after a concert](https://commons.wikimedia.org/wiki/File:Sound_Effects_-_Applause_after_a_concert.ogg) by Amada44 (public domain, CC0), made to sound like an old tape of canned applause, and the others synthesised.

## Adding an example

A folder here with a `squiffy.json` is built by the docs site (`site/scripts/build-examples.ts`) into `/examples/<folder>/` as a standalone game. To show it on the Examples page, add it to `site/src/examples.ts` and `site/src/content/docs/featured-examples.mdx`, and add it to the list in `compiler/src/compiler.test.ts`.

Short examples of a single feature belong in the docs instead, as an editable sample.
