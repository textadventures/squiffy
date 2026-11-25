# Accessibility

Writing a story everyone can play: with the keyboard, a screen reader, without colour or sound, at their own pace. Docs: https://squiffystory.com/accessibility/

## What Squiffy already does

Links are reachable with Tab and clicked with Enter; a `continue` animation is a button (Enter or Space). After a click, focus moves to the new text, so a screen reader reads it. Links that can't be clicked any more are `aria-disabled` and out of the Tab order. Links are underlined, and the default colours have enough contrast. Reduced motion is respected (dynamic-text.md). The story's `language` (project.md) tells screen readers how to pronounce it. Don't work around any of this.

## When writing

- **Images:** alt text that says what matters to the story: `![A rusty key on a velvet cushion](key.png)`, `<img src="map.png" alt="...">`. Decorative images get empty alt text: `![](flourish.png)`, `alt=""`.
- **Link text** makes sense on its own, as screen reader users list a page's links: `[[Open the door]]`, not "click [[here]](door)".
- **Colour:** don't let colour, or a look set with `@class`, carry meaning alone; say it in the text too. When changing the colour variables (styling.md), keep enough contrast in both light and dark mode, and keep links underlined.
- **Timed text:** `{{goto ... after=}}` and `{{#every}}` change the story with no action from the reader, who may not have finished reading. Give enough time, or a link to go on instead. When timing is part of the game, offer a toggle setting (project.md) to turn it off: `{{#if settings.timers}}{{goto "too late" after=10000}}{{/if}}`.
- **Sound:** never put information only in `@music`/`@sound`; say it in the text. Sound on the first screen doesn't play until a click.
- **Text boxes:** give each a label: `<label>Your name: <input type="text" data-attribute="name"></label>`, or `aria-label="Your name"`. With validation, say in the text what's needed ("at least two letters"), as nothing tells a screen reader why the links are disabled.
- **Custom HTML and JavaScript:** anything clickable is a `<button>` or a link, never a `<div>`/`<span>` with `onclick`.

## Checking

`--check` and `--play` can't judge this. Suggest the author tries the story with the keyboard alone, and with a screen reader (VoiceOver on Mac, Command+F5; Narrator or NVDA on Windows).
