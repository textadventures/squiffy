# Squiffy + Vite example

A minimal web app that imports a Squiffy story using [`@textadventures/vite-plugin-squiffy`](../../vite-plugin).

```bash
npm install
npm run dev
```

- `vite.config.ts` adds the plugin.
- `src/main.ts` imports the story with `import { story, title } from "./story/game.squiffy"` and runs it with `squiffy-runtime`. While `npm run dev` is running, edits to any `.squiffy` file update the story in place.
- `src/story/game.squiffy` pulls in the other files in `src/story/rooms` with `@import`.

`npm run build` writes a static site to `dist`.
