# Squiffy syntax

Everything that can go in a `.squiffy` file. Docs: https://squiffystory.com/syntax/

## Sections and passages

| Write | What it does |
|---|---|
| `[[name]]:` | Starts a section called "name". Section names are unique in the story |
| `[name]:` | Starts a passage in the section above it. Passage names are unique in their section |
| `+++Continue...` | Ends this section with a link saying "Continue...", and starts a new unnamed section that it goes to. Directives such as `@clear` can go on the next lines |
| `---` | Starts a new unnamed section, for `[[text>]]` links to go to (use inside `{{#animate}}`, where `+++` would split the block) |
| `[[]]:` | The master section: its text and directives run with every section |
| `[]:` | A master passage: runs with every passage in its section, or every passage in the story if it's in `[[]]` |
| `[@1]:`, `[@2]:`... | Runs after the player has clicked that many passage links in the section |
| `[@last]:` | Runs once every passage link in the section has been clicked |
| `[snippet: name]:` | A snippet for the editor's Add menu, not part of the story |

Text before the first section is the start of the story, unless `@start` names another section. With `squiffy.json`, the story starts in the main file.

Going to a new section turns off every link on screen. Passage links stay active until the player leaves the section, and each can be clicked once.

## Links

| Write | What it does |
|---|---|
| `[[cave]]` | Link to section "cave" |
| `[[Go in]](cave)` | Link to "cave" saying "Go in" |
| `[look]` | Link to passage "look" in this section |
| `[Look around](look)` | Link to passage "look" saying "Look around" |
| `[[Go in]](cave, torch = true)` | Link that also sets attributes, separated by commas (see attributes.md) |
| `[Take it](take, coins += 1)` | Passage link that sets attributes |
| `[[Next>]]` | Link to the next section in the file |
| `[[Next]](>, score = 10)` | Link to the next section that sets attributes |
| `[a website](https://example.com)` | Ordinary web link |
| `**[[cave]]**`, `[[**Go in**]](cave)`, `+++**Continue...**` | Formatted links |

Any text in single square brackets is a passage link, so avoid `[like this]` in prose. Web links and Markdown images `![alt](cat.png)` are left alone.

Don't put formatting inside a link that doesn't name its target: `[[**north**]]` links to a section called `**north**`. Write `**[[north]]**` or `[[**north**]](north)`.

Links can also be made with helpers: `{{section "name" text="..." set="..."}}` and `{{passage "name" ...}}` (see helpers.md).

## Directives

One per line, at the start of a section or passage, before its text. Those that change attributes always run when it's shown, regardless of any `{{#if}}`.

| Write | What it does |
|---|---|
| `@title The Island` | The story's title. Main file only |
| `@start cave` | Start in section "cave". Main file only |
| `@set gold = 10`, `@set name = "Alice"` | Set an attribute (see attributes.md for the Squiffy 6/7 rules) |
| `@set gold += 5` | Also `-=`, `*=`, `/=` |
| `@set greeting := Hello, {{name}}!` | Set to text after processing `{{...}}` |
| `@set has_key` / `@set not has_key` / `@unset has_key` | Set true / false |
| `@inc score`, `@dec health`, `@inc score 10` | Add or take away 1, or a whole number |
| `@clear` | Clear the screen before showing this |
| `@repeat` | In a passage: its links can be clicked again. Such clicks don't count towards `@1`/`@last` |
| `@end` | Marks the section as an ending (in a passage, marks its section). Doesn't change what the player sees |
| `@class dark cave` | CSS classes on the story while this section is current (see styling.md) |
| `@transition fade`, `@transition slide-up 1s` | How this section or passage appears (see dynamic-text.md) |
| `@leave fade`, `@leave slide-up 1s` | With `@clear`: how the old text goes first (see dynamic-text.md) |
| `@music theme.mp3`, `@music stop` | Play music (continues across sections), or stop it |
| `@sound door.mp3`, `@sound stop` | Play a sound once, or stop sounds |
| `@import chapter2.squiffy`, `@import *.squiffy` | Add another file (not needed with `squiffy.json`) |
| `@import style.css`, `@import script.js` | Add a stylesheet or script to the page |
| `@ui`, indented JavaScript, then `---` | JavaScript that runs once when the story starts. `@ui helpers.js` for a file |

## Endings and dead ends

A section with no links to another section is where the story stops. If it's meant to be an ending, put `@end` in it, and perhaps `{{restart text="Play again"}}`. Otherwise it's a dead end, which `--check` and `--random` report. A section that's only used by `{{embed}}` isn't reported as unreachable.

## JavaScript

Lines indented with four spaces or a tab, at the start of a section or passage, are JavaScript, run when it's shown. An indented line after text is text. See javascript.md.

## Going to another section without a click

`{{goto "death"}}` moves on once the section has been written (all of it, so put text the player shouldn't see in an `{{else}}`). `{{goto "darkness" after=3000}}` waits 3 seconds, unless the player clicks a link first. `{{goto}}` only goes to sections. It's not a turn. In the master section, guard it: `{{#if health <= 0 and not (at "death")}}{{goto "death"}}{{/if}}`.

In JavaScript: `squiffy.story.go("section")`.

## Turning off passage links

`{{deactivate "smash it"}}` turns off the links to that passage in this section. `{{deactivate}}` in a passage turns off links to itself (useful with `@repeat`).

## Embedding text

`{{embed "name"}}` shows another section's text, or a passage in this section.

- Parameters: `{{embed "say" who="Ann" line="Hello!"}}`, read in the embedded text as `{{who}}`. A parameter hides an attribute of the same name during the embed only; it isn't saved. Values can be expressions: `asks=gold - 7`, `items=["lamp", "key"]`.
- Wrapping: `{{#embed "speech" who="Guard"}}Halt!{{/embed}}`, shown in the embedded text with `{{content}}`.
- A passage link inside embedded text looks for the passage in the section the player is in, so embedded sections should link to sections.

## Formatting

Text is Markdown: `**bold**`, `_italic_`, lists, headings. Leave a blank line between paragraphs (a single line break is a space). HTML works: `<span style="color: red">`. Images: `![A cat](cat.png)` or `<img src="images/map.png">`; paths are relative to the main file. `{{!-- comment --}}` is a comment.
