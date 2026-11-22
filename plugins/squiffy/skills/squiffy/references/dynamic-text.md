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

## The first time

```squiffy
You're in the cave. {{#once}}A bat flies out!{{else}}It's quiet now.{{/once}}
{{#once "smell"}}Something is burning.{{/once}}
```

`{{#once}}` shows its text the first time it's shown, and the `{{else}}` text (or nothing) from then on. Each one remembers for itself, including in embedded text, and helpers inside it only run that first time. Ones given the same name share their memory, for something that happens once across several sections. `{{#firsttime}}` is the same. Prefer it to `{{#if (visits "cave") = 1}}`; use `seen`/`visits` to ask about another section or passage.

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

Times can be text in seconds (`start="1.5s"`) or expressions (`start=delay * 1000`).

To link to the next section from inside `{{#animate}}`, use `[[Begin>]]` and a `---` divider rather than `+++`, which would split the block. Don't overuse animations. Authors can add their own with `squiffy.registerAnimation` (javascript.md).

## Transitions

`@transition fade` makes a section or passage fade in as it appears, with an optional time: `@transition slide-up 1s` (default 0.5s). Built in: `fade` (or `dissolve`), `slide-up`, `slide-down`, `slide-left`, `slide-right`, `zoom`, `blur`, `pulse`, `rumble`, `shudder`, `flicker`. A passage uses its section's unless it has its own. In the master section it's for every section and passage; `@transition none` turns it off for one. They don't replay on Back or loading a save, and are plain fades under reduced motion. Custom ones: styling.md.

`@leave fade` (with `@clear` or `{{clear}}`) plays a transition backwards on the old text before the screen clears, e.g. `@clear` + `@leave zoom 1s` + `@transition fade`. Slides move the way they're named both ways: `@leave slide-left` + `@transition slide-left` (e.g. in the master section with `@clear`) makes each screen slide off left and the next slide in from the right; `--squiffy-slide-distance: 100%` in CSS makes slides go all the way across (styling.md). Same names, times, inheritance, master section and `none` as `@transition`. Clicks wait until it's done, so keep it short. A `@leave` where nothing it's for clears the screen is a warning.

## Moving on after a delay

```squiffy
The floor starts to crumble. [[Jump!]](safe)
{{goto "fall" after=4000}}
```

If the player clicks a link first, the story doesn't move on. `after=` can be an expression (`after=patience * 1000`) or a time as text (`after="3s"`, `"500ms"`). The delay starts once the section is written, not after animations finish. In `--play`, it happens at once.

## Repeating text

```squiffy
@set fuse = 5
The fuse burns down: {{#every 1000}}{{dec "fuse"}}{{fuse}}...{{#if fuse <= 0}}{{stop}}{{goto "boom"}}{{/if}}{{/every}}
```

Every so often (ms, `"1.5s"` or an expression), the text inside is worked out again and replaces what it showed, first after one wait. `append=true` adds it after instead. It stops after a `{{stop}}` in it, after `times=n`, or when the player leaves the section (passages don't stop it). Back undoes what it changed. In `--play`, it runs at once, and play stops waiting after 20 times in a row with nothing else to do.

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

`{{live}}` updates text already on screen when the attribute changes, unlike `{{score}}`. With `section=` or `passage=`, it shows that section's or passage's text, run again when the attribute changes, but only while the player is in the section it's in. It takes object paths: `{{live "hero.hp"}}`.
