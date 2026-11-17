# @textadventures/squiffy-codemirror

A [CodeMirror 6](https://codemirror.net/) highlighting mode for `.squiffy` files: section and passage headers, links, attributes, Handlebars, and indented JavaScript. It's used by the editor (`app/`) and by the editable samples on the docs site (`site/src/components/Sample.astro`), so the two highlight a story the same way.

```ts
import { squiffyLanguage } from "@textadventures/squiffy-codemirror";
```

It's highlighting only: it assigns `@lezer/highlight` tags (`heading`, `heading2`, `link`, `keyword`, `processingInstruction`, `monospace`, `tagName`, `comment`), and each host colours them with its own `HighlightStyle` to fit its theme. Everything that needs to understand the story comes from the language service.

The static code blocks on the docs site are highlighted by the TextMate grammar in `compiler/syntaxes/` instead, so if you change how something is highlighted here, check whether the grammar needs the same change.
