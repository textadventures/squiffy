# JavaScript

Most stories need none. Docs: https://squiffystory.com/javascript/

## In a section or passage

Lines indented four spaces or a tab, at the start of a section or passage, run before its text is shown:

```squiffy
[[hit]]:
    squiffy.set("health", squiffy.get("health") - 15);
You're hit.
```

To run code after the text is on the page: `squiffy.ui.afterWrite(() => { ... })`. Calling `squiffy.story.go` from there works like `{{goto}}`.

## When the story starts

```squiffy
@ui
    squiffy.registerHelper("shout", (text) => text.toUpperCase() + "!");
---
Welcome. {{shout "hello"}}
```

A `@ui` block goes at the top and ends with `---`. `@ui helpers.js` reads a file instead. Other `.js` files in a `squiffy.json` story's folder are added to the page as `<script>` tags (without `squiffy.json`, `@import script.js`). The CLI's `--play` and `--random` don't run those page scripts, but do run `@ui` and section JavaScript.

## The squiffy API

| Function | Description |
|---|---|
| `squiffy.get("name")`, `squiffy.set("name", value)` | Read and set attributes, including paths like `"hero.hp"` or `"party.0.name"`. Also plain `get`/`set` |
| `squiffy.story.go("section")` | Go to a section |
| `squiffy.story.seen("name")`, `squiffy.story.visits("name")` | Seen, and visit count |
| `squiffy.story.passages(section?, { tagged, untagged }?)`, `squiffy.story.sections({ tagged, untagged }?)`, `squiffy.story.tags(name?)` | As the `passages`, `sections` and `tags` helpers (helpers.md). Tags are space-separated text or an array |
| `squiffy.ui.write("text")` | Write text, with Markdown and `{{...}}` |
| `squiffy.ui.afterWrite(fn)` | Run once the text is on the page |
| `squiffy.ui.transition(fn)` | Run an effect; `fn` returns a Promise, and links are blocked until it resolves |
| `squiffy.ui.scrollToEnd()` | Scroll to the end |
| `squiffy.element` | The story's HTML element |
| `squiffy.registerHelper(name, fn)` | Add a helper |
| `squiffy.registerAnimation(name, fn)` | Add an `{{#animate}}` effect |

## Custom helpers

`registerHelper(name, fn)`: positional arguments are passed in order, and the last argument is `options`, with named `key=value` arguments in `options.hash`. Returned text is escaped; return `new squiffy.SafeString(html)` for HTML, escaping any player input in it first. Helpers can use `squiffy.get`/`squiffy.set`.

```squiffy
@ui
    squiffy.registerHelper("visit", (attribute, ...args) => {
        const items = args.slice(0, -1); // the last argument is options
        const count = squiffy.get(attribute) || 0;
        squiffy.set(attribute, count + 1);
        return items[Math.min(count, items.length - 1)];
    });
---
```

## Custom animations

`squiffy.registerAnimation(name, (el, params, onComplete, loop) => { ... })` in a `@ui` block. `params` has the `{{#animate}}` options; call `onComplete()` when done. Anime.js is available as `squiffy.import.animejs`.

## Errors

JavaScript errors in a story are reported by `--play` and `--random`, with the section they happened in.
