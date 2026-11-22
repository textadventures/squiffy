# Helpers reference

Every `{{helper}}` in Squiffy's Handlebars text processor. Docs: https://squiffystory.com/helpers-reference/

- `{{helper args}}` calls a helper; `{{#helper}}...{{/helper}}` is a block helper.
- Pass one helper's result to another with parentheses, never nested braces: `{{random (array "a" "b")}}`, `{{#if (seen "intro")}}`.
- Named options are `key=value`: `{{goto "end" after=2000}}`.
- In `{{#if}}`, `{{#unless}}`, `{{else if}}` and `{{= }}`, use the operators (`=`, `>`, `and`, `+`...) rather than the comparison, logic and maths helpers. The helpers are what the operators turn into, and are needed only outside those places.
- Helpers that change attributes run where they are in the text, so they respect `{{#if}}`. Directives (`@set`, `@music`) always run.

## Built-in Handlebars blocks

| Helper | Example |
|---|---|
| `{{#if}}`, `{{else if}}`, `{{else}}` | `{{#if score > 100}}High{{else if score > 50}}Medium{{else}}Low{{/if}}` |
| `{{#unless}}` | `{{#unless game_over}}Keep playing{{/unless}}` |
| `{{#each}}` | `{{#each inventory}}- {{this}}{{else}}Nothing{{/each}}`, with `{{@index}}`, `@first`, `@last` |
| `{{!-- comment --}}` | Not shown to the player |

## Attributes

| Helper | Parameters | Description |
|---|---|---|
| `{{name}}` | | Show an attribute with a one-word name |
| `get` | `"name"` or an expression | Show an attribute: `{{get "player name"}}`, `{{get room}}` |
| `set` | `"attr" value` | Set, value can be a calculation: `{{set "gold" gold + 5}}` |
| `unset` | `"attr"` | Set to false |
| `inc` | `"attr" [amount]` | Add 1 or amount: `{{inc "score" bonus * 10}}` |
| `dec` | `"attr" [amount]` | Take away 1 or amount |
| `=` | expression | Show a calculation: `{{= price * 2}}` |

## Comparison and logic

`eq` (`=`), `ne` (`!=`), `gt` (`>`), `gte` (`>=`), `lt` (`<`), `lte` (`<=`), `and`, `or`, `not`, and `cond` (`? :`). E.g. `{{#if (and (gt score 100) has_key)}}` is `{{#if score > 100 and has_key}}`; `{{cond (gt hp 0) "alive" "dead"}}` is `{{= hp > 0 ? "alive" : "dead"}}`.

## Maths

Each takes numbers, or text holding a number.

| Helper | Description |
|---|---|
| `add`, `sub`, `mul`, `div`, `mod` | `+ - * / %`, two values each. `add` joins text if either value is other text |
| `round` | `{{round a}}` to a whole number (halves round up), `{{round a 2}}` to 2 places |
| `floor`, `ceil` | Round down, round up |
| `abs` | Without the minus sign |
| `min`, `max` | Smallest or largest of the numbers, or of an array: `{{set "hp" (min (hp + 5) max_hp)}}` |

A calculation inside a helper goes in its own parentheses: `{{= (round (gold / 3))}}`, not `(round gold / 3)`.

## Text

| Helper | Description |
|---|---|
| `upper`, `lower` | Capitals, small letters: `{{#if (lower answer) = "yes"}}` |
| `capitalise` (or `capitalize`) | Capital first letter |

`name contains "Mac"` checks for text in text (case-sensitive). `name.length` is the number of letters.

## Navigation

| Helper | Parameters | Description |
|---|---|---|
| `seen` | `"name"` | Has the player seen this section or passage: `{{#if (seen "intro")}}` |
| `visits` | `"name"` | How many times, or 0 |
| `at` | `"name"` or `(array ...)` | Is the player in this section now |
| `goto` | `"section" [after=ms]` | Go to a section once this one is shown, or after a delay (ms, `"3s"`, or an expression) |
| `deactivate` | `"passage" ...`, or nothing | Turn off links to passages in this section, or to this passage |
| `clear` | | Clear the screen like `@clear`, but only if the text reaches it: `{{#if previous_section != "change"}}{{clear}}{{/if}}`. Text before it in this section or passage (and the master section's) goes too; `@leave` and `@transition` apply as with `@clear` |

## Listing sections and passages

Lists, for `{{#each}}`, `join`, `random` and the other array helpers. Saves listing passage names a second time.

| Helper | Parameters | Description |
|---|---|---|
| `passages` | `["section"] [tagged="..."] [untagged="..."]` | A section's passage names in written order: with no section, this section's then the master section's (`""` for the master's alone). Leaves out the master passage, `@1`, `@last`, `@after`. `tagged`: has all these `@tag` tags (space-separated); `untagged`: has none of them. `{{#each (passages tagged="passenger")}}{{passage this}} {{/each}}` |
| `sections` | `[tagged="..."] [untagged="..."]` | Section names, apart from the master section |
| `tags` | `["name"]` | A passage's (this section's, then the master's) or section's `@tag` tags, or this section's: `{{#if (tags "a busker") contains "settled"}}` |

With no arguments, `{{passages}}`, `{{sections}}` and `{{tags}}` still show an attribute of that name if there is one. An unknown section or name is an error.

## Links

| Helper | Parameters | Description |
|---|---|---|
| `section` | `"name" [text="..."] [set="..."]` | Link to a section: `{{section "hall" text="Enter" set="visited=true, count+=1, room='hall'"}}` |
| `passage` | `"name" [text="..."] [set="..."]` | Link to a passage |
| `restart` | `[text="..."] [confirm=false]` | Link that restarts the story, like the Restart button, asking first unless `confirm=false`: `{{restart text="Play again"}}` at an ending |
| `saves` | `[text="..."]` | Link that opens the Saved games dialog, like the Save button. Works even with `"saveButton": false` |
| `settings` | `[text="..."]` | Link that opens the Settings dialog, for a story with `"settings"` in `squiffy.json` (project.md). `{{settings.name}}` is a setting's value, not the link |

`set` takes link-style assignments; single quotes for text avoid escaping.

## Content

| Helper | Parameters | Description |
|---|---|---|
| `embed` | `"name"`, then parameters | Show another section's text, or a passage in this section: `{{embed "say" who="Ann"}}`. Block form `{{#embed "box"}}...{{/embed}}` wraps text |
| `content` | | In embedded text, the text the `{{#embed}}` wraps |
| `array` | `item1 item2 ...` | Make an array: `(array "red" "green")` |

## Sound

| Helper | Parameters | Description |
|---|---|---|
| `music` | `"file" [fade=seconds]` | Play music, continuing across sections, crossfading over 1 second by default |
| `stopmusic` | `[fade=seconds]` | Fade the music out |
| `sound` | `"file" [volume=0 to 1]` | Play a sound once |
| `stopsounds` | | Stop sounds playing once; music carries on |

## Classes

On the story's element, for CSS. They stay until removed (unlike `@class`, which changes with the section).

| Helper | Description |
|---|---|
| `addclass` | `{{addclass "dark" "rain"}}` or `{{addclass "dark rain"}}` |
| `removeclass` | Take classes off |
| `toggleclass` | Add, or take off if present |
| `hasclass` | `{{#if (hasclass "dark")}}`: whether all these classes are on, from `@class` or `addclass` |

## Arrays

These take the attribute's **name in quotes** and change or read the array in it:

| Helper | Description |
|---|---|
| `append` | `{{append "inventory" "sword"}}` adds to the end |
| `prepend` | Adds to the start |
| `pop` | Removes and returns the first item: `{{set "next" (pop "queue")}}` |
| `remove` | Removes the first matching item |
| `contains` | `(contains "inventory" "key")`, or `(contains (array ...) value)`. In conditions, `inventory contains "key"` |
| `length` | `(length "inventory")`. In conditions, `inventory.length`. On an object, `(length "hero")` counts its values |

These take the **array itself** (no quotes) and return a new value, without changing the attribute; to keep the result, set it: `@set bag = (sort bag)`:

| Helper | Description |
|---|---|
| `join` | `{{join bag ", " " and "}}` gives "lamp, key and rope". As a block, it shows its text for each item, with the separators between: `{{#join ways ", " " or "}}[[{{this}}]](go, to = "{{this}}"){{/join}}`. `this`, `@index`, `@first`, `@last` and `{{else}}` (empty array) work as in `{{#each}}` |
| `sort` | Numbers first, smallest first, then text alphabetically |
| `shuffle` | Random order |
| `slice` | `(slice bag 0 3)` first three, `(slice bag -2)` last two. Works on text |
| `first`, `last` | First or last item |
| `indexof` | Position from 0, or -1. Works on text |
| `count` | How many times a value is in an array, or text in text |
| `range` | `(range 1 5)` is 1 to 5, counting up or down |

## Dynamic text

See dynamic-text.md for details.

| Helper | Parameters | Description |
|---|---|---|
| `random` | `(array ...) [set="attr"]` | Pick one at random, optionally storing it. Also `(random bag)` |
| `#animate` | `"typewriter"`/`"toast"`/`"fadeIn"`/`"continue"`, options | Animate the text inside |
| `#style` | `"class" ...` | Give the text inside classes (span, or div if it has blank lines), for CSS or a built-in effect: `shake`, `shudder`, `rumble`, `sway`, `buoy`, `pulse`, `fade-in-out`, `blink`, `flicker`, `blur`, `blurrier`, `smear`, `mirror`, `upside-down` |
| `#label` | `"name"` | Mark some text to replace later |
| `#replace` | `"name"` | Replace a label's text |
| `rotate` | `(array ...) [set="attr"] [show="next"]` | A link that cycles through options |
| `sequence` | `(array ...) [set="attr"] [show="next"]` | A link that goes through options once |
| `live` | `"attr" [section="name"] [passage="name"]` | Show an attribute (or a section's text) and update it when the attribute changes |
| `#once` (or `#firsttime`) | `["name"]` | Show the text inside the first time it's shown, and the `{{else}}` text (or nothing) after that |
| `#every` | `ms [times=n] [append=true]` | Show the text inside again and again while the player is in the section |
| `stop` | | Inside `{{#every}}`, stop after this time |

## Custom helpers

Authors can add helpers with `squiffy.registerHelper` in a `@ui` block: see javascript.md.
