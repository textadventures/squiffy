# @textadventures/vite-plugin-squiffy

A [Vite](https://vite.dev) plugin that lets you import [Squiffy](https://squiffystory.com) stories into a web app.

```bash
npm install --save-dev @textadventures/vite-plugin-squiffy
npm install squiffy-runtime
```

Add the plugin to `vite.config.ts`:

```ts
import { defineConfig } from "vite";
import squiffy from "@textadventures/vite-plugin-squiffy";

export default defineConfig({
    plugins: [squiffy()],
});
```

Then import a `.squiffy` file and run it with the Squiffy runtime:

```ts
import { init } from "squiffy-runtime";
import "squiffy-runtime/squiffy.runtime.css";
import { story, title } from "./game.squiffy";

const squiffy = await init({
    element: document.getElementById("squiffy")!,
    story,
});
await squiffy.begin();
```

A `.squiffy` import exports:

- `story` (also the default export): the compiled story, to pass to `init()`
- `title`: the story's `@title`

Files pulled in with `@import` are handled too. Other `.squiffy` files are compiled into the story, and Vite watches them for changes. `.js` and `.css` files are bundled by Vite, so `.js` files are loaded as ES modules. If the story fails to compile, the build fails, and in dev mode the errors appear in Vite's error overlay.

## Updating the story without reloading

By default, editing a `.squiffy` file reloads the page. To update the running story in place instead, keeping the player's progress, accept the update and pass the new story to the runtime's `update()`:

```ts
if (import.meta.hot) {
    import.meta.hot.accept("./game.squiffy", module => {
        if (module) squiffy.update(module.story);
    });
}
```

## TypeScript

To get types for `.squiffy` imports, add the plugin's client types to `tsconfig.json`:

```json
{
  "compilerOptions": {
    "types": ["vite/client", "@textadventures/vite-plugin-squiffy/client"]
  }
}
```

## Options

| Option    | Default | Description                              |
|-----------|---------|------------------------------------------|
| `verbose` | `false` | Log each `.squiffy` file as it compiles. |

See [`examples/vite-app`](https://github.com/textadventures/squiffy/tree/main/examples/vite-app) for a complete example.
