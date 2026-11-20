# Dynamic text

Text that changes as it's shown, or after. Docs: https://squiffystory.com/dynamic-text/

## Conditions

```squiffy
{{#if score > 100 and has_key}}
You have a high score and the key!
{{else if score > 100}}
High score, no key.
{{else}}
Keep playing.
{{/if}}

{{#unless (seen "intro")}}Welcome!{{/unless}}
You have {{= gold}} {{= gold = 1 ? "coin" : "coins"}}.
```

Operators and precedence are in attributes.md.

## Random

```squiffy
It's {{random (array "Monday" "Tuesday" "Wednesday")}}.
The weather is {{random (array "sunny" "rainy") set="weather"}}.
{{goto (random (array "cave" "forest" "river"))}}
```

`set=` stores the choice. With `--play` and `--random`, use `--seed` for the same results every time.

## Animation

```squiffy
{{#animate "typewriter"}}This text appears letter by letter.{{/animate}}
{{#animate "toast"}}Word by word.{{/animate}}
{{#animate "fadeIn" duration=1000}}Fades in.{{/animate}}
{{#animate "continue"}}Step inside{{/animate}}
```

Animations queue and play in order. `continue` shows its text as a link that pauses the queue until clicked; `style=` is `pulse` (default), `glow`, `bounce` or `wave`. In `--play`, a `continue` is shown as a link to click.

| Option | For | Meaning |
|---|---|---|
| `interval=n` | typewriter, toast | ms between characters (default 100) or words (default 200) |
| `fadeDuration=n` | typewriter, toast | ms for each to fade in (default 100) |
| `duration=n` | fadeIn | ms for the fade (default 500) |
| `start=n` | typewriter, toast, fadeIn | ms to wait first |
| `loop=true` | all but continue | Repeat forever |
| `trigger="link"` | all but continue | Wait for a link inside the text to be clicked |

To link to the next section from inside `{{#animate}}`, use `[[Begin>]]` and a `---` divider rather than `+++`, which would split the block. Don't overuse animations. Authors can add their own with `squiffy.registerAnimation` (javascript.md).

## Moving on after a delay

```squiffy
The floor starts to crumble. [[Jump!]](safe)
{{goto "fall" after=4000}}
```

If the player clicks a link first, the story doesn't move on. The delay starts once the section is written, not after animations finish. In `--play`, it happens at once.

## Replace

```squiffy
I bought {{#label "item"}}a pint of milk{{/label}}. Or maybe [something different]?

[something different]:
{{#replace "item"}}a loaf of bread{{/replace}}
```

The replacement can contain links.

## Rotate and sequence

```squiffy
Size: {{rotate (array "small" "medium" "large") set="size"}}
{{sequence (array "Ready" "Steady" "Go")}}
{{sequence (array "Click me" "Again" (section "next" text="And once more"))}}
```

`rotate` cycles forever; `sequence` stops at the last option, which isn't a link (or is a section link, as above). `show="next"` shows the next option instead of the current one.

## Live text

```squiffy
Score: {{live "score"}}
{{live "colour" section="colourDescription"}}
```

`{{live}}` updates text already on screen when the attribute changes, unlike `{{score}}`. With `section=` or `passage=`, it shows that section's or passage's text, run again when the attribute changes. It takes object paths: `{{live "hero.hp"}}`.
