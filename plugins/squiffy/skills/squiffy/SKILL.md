---
name: squiffy
description: Write, edit, check and play Squiffy interactive stories. Use when working with .squiffy files, a squiffy.json project file, or a Squiffy story or gamebook, including writing sections, passages, links, attributes and {{...}} text, and checking or playtesting a story with the Squiffy command-line tool.
---

# Writing Squiffy stories

Squiffy is a language for choice-based interactive stories. A story is one or more `.squiffy` text files, usually with a `squiffy.json` project file, which build into a web page. Full docs: https://squiffystory.com (an index for AI agents is at https://squiffystory.com/llms.txt).

## First, read squiffy.json

Before writing anything, look for `squiffy.json` in the story's folder. **It changes the rules for setting attributes:**

- **With `squiffy.json` (Squiffy 7 rules):** text goes in quotes, and another attribute is written by its plain name.
  `@set weapon = "sword"`, `@set best = score`, `[[Go]](next, name = "Bob", gold += price)`
- **Without it (Squiffy 6 rules):** text has no quotes, and another attribute has an `@`.
  `@set weapon = sword`, `@set best = @score`, `[[Go]](next, name = Bob, gold += @price)`

Numbers, `true`/`false`, `@set has_key`, `@set not has_key`, `:=`, `@inc` and `@dec` are the same in both. Match the story's existing style. Don't add a `squiffy.json` to a story without asking: it changes how the story's existing assignments are read (`--convert-v6` converts them and adds one).

`squiffy.json` also names the main file (`"main"`), where the story starts. With it, every `.squiffy`, `.css` and `.js` file in the folder is part of the story, without `@import`.

## Core syntax

```squiffy
@title The Cellar
@start top

[[top]]:
@set gold = 0
You're at the top of the cellar steps. You could [listen], or [[go down]](cellar, lamp = true).

[listen]:
Something drips below.

[[cellar]]:
It's dark.{{#if lamp}} Your lamp shows a [chest].{{/if}} [[Go back up]](top), or [[leave by the back door]](outside).

[chest]:
@inc gold 5
You find {{gold}} gold.

[[outside]]:
@end
You step out into the night with {{gold}} gold. THE END.
```

- `[[name]]:` starts a **section**. `[[name]]` or `[[link text]](name)` links to one. Going to a new section turns off every earlier link.
- `[name]:` starts a **passage** inside the section above it. `[name]` or `[link text](name)` links to one. Passage links can be clicked in any order, once each, until the player leaves the section. Coming back to a section shows it again with fresh passage links, so guard one-off rewards with an attribute: `{{#unless chest_open}}[chest]{{/unless}}`. Any text in single square brackets is a passage link.
- Links can set attributes: `[[Buy]](shop, gold -= 3, has_sword = true)`.
- `+++Link text` ends the section with a link to a new, unnamed section that follows.
- `@set`, `@inc`, `@dec`, `@unset`, `@clear`, `@end`, `@repeat`, `@class`, `@tag`, `@transition`, `@leave` are directives: one per line, at the start of a section or passage. They always run when it's shown, even inside `{{#if}}`; use the `{{set}}`, `{{inc}}` helpers to change attributes conditionally, and `{{clear}}` to clear the screen conditionally.
- `{{...}}` is the Handlebars text processor: `{{gold}}`, `{{= price * 2}}`, `{{#if gold > 5 and not has_key}}...{{else}}...{{/if}}`, `(seen "chest")`, `{{goto "end"}}`, `{{embed "map"}}`. Helpers take subexpressions in `( )`, never nested `{{ }}`.
- `@end` marks a section as an ending. A section with no links out and no `@end` is a "dead end", which `--check` warns about, as it does about `@end` in a section that links to another (other than the start).
- Text is Markdown, and HTML works. Blank lines separate paragraphs.
- Lines indented four spaces (or a tab) at the start of a section or passage are JavaScript.
- Text before the first `[[section]]:` is the start of the story (a section called `_default` in CLI output), unless `@start` names another.
- `@import file.squiffy` adds another file, in a story without `squiffy.json`.

## The edit, check, play loop

The Squiffy command-line tool runs with `npx` (Node.js required). Run it in the story's folder (the one with `squiffy.json`), or give it the `.squiffy` file for a story without one. After every change:

1. **Check:** `npx @textadventures/squiffy-cli --check --json`
   Lists problems with file, line, column, severity and code: compile errors (including `{{...}}` text that isn't valid, `squiffy/template-syntax`, e.g. `{{round + 1}}` for `{{= round + 1}}`), JavaScript that doesn't parse, often story text indented by mistake (`squiffy/javascript-syntax`), broken links, unreachable sections (`squiffy/unreachable-section`), story links to a `@test` section (`squiffy/link-to-test-section`), dead ends (`squiffy/dead-end`), a section with `@end` that links on to another section (other than the start), so isn't an ending (`squiffy/end-with-way-out`), sound on the first screen, which browsers won't play before a click (`squiffy/sound-on-first-screen`), and a bare `{{name}}` that's neither a helper nor an attribute the story sets, so shows nothing: a typo or a missing helper (`squiffy/unknown-name`). Exit code 1 if there are errors. Fix errors. Fix warnings, or ask the author: an unreachable section may be unfinished work they want to keep. A warning that's deliberate, or wrong (an attribute set from JavaScript with a computed name), can be turned off with `{{!-- squiffy-ignore code --}}` in the section, or in the master section `[[]]:` for the whole story; the code is what follows `squiffy/`, and `unknown-name` can be followed by attribute names: `{{!-- squiffy-ignore unknown-name board score --}}`. Put it after any indented JavaScript in the section. `squiffy.json`'s `"ignore": ["dead-end"]` does the same for the whole story, without a comment. Only add one when the author agrees.
2. **Play** a step at a time, like a player:
   `npx @textadventures/squiffy-cli --play --save game.json --json`
   shows the start and the numbered choices. Then click one link per run, reading the result before choosing the next. The JSON has every step so far in `steps`; read the last one, and `choices`:
   `npx @textadventures/squiffy-cli --play --save game.json --choose "go down" --json`
   `--choose` takes a link's text or number. Use `--start section` to begin somewhere else, `--input name=Ann` to fill a text box, `--attributes` to see attributes, `--seed 1` for repeatable randomness. Delete `game.json` to start again. Errors in the story (such as bad JavaScript) are reported, with exit code 1. In the JSON, a section without a name of its own (one starting with `+++` or `---`) has an internal name such as `_continue3`: `sectionLabels` says which it is, such as `the "+++Continue..." after "cellar"`, and that's what to call it when talking to the author.
   For a long story (dozens of clicks or more), each run taking a second adds up: write a script that starts `npx @textadventures/squiffy-cli --play --interactive --json` once and plays it all. It reads a line from standard input (a link's text or number, `:input name=value` to fill a text box, `:attributes`) and writes one line of JSON back for each, the same as `--play --json` with `steps` holding just that line's steps; the first line is the start. A link that isn't there gives `stopped` and play carries on. It ends when the input ends; `--save`, `--choose`, `--seed` and `--record` work with it too.
3. **Play at random** to find problems you wouldn't reach yourself:
   `npx @textadventures/squiffy-cli --random 50 --json`
   Reports errors, dead ends, endings reached and sections never visited. Each problem has the options to reproduce it, such as `--play --seed 7 --choose 'go down' --choose 'Go back up'`, or for a long route, `--choices build/random/problem-1.txt` (a file with one link per line). Run those with `--play` to see it happen.
   **Run the author's tests**, if the story has `.squiffy-test` files: `npx @textadventures/squiffy-cli --test --json`
   Each is a recorded playthrough; a failure gives the step, and how it differs (a link that's gone, a different section, an attribute with a different value, an error). If the author changed the story on purpose, `--test --update` records failing tests again, but ask before doing that, as it changes what the tests expect. Record a new test with `--play --choose ... --record tests/name.squiffy-test` (add `--seed` and `--input` as needed). To stop a test checking attributes that are only bookkeeping, record it with `--ignore name` (repeatable, `*` matches any characters), or add an `ignore told seen_*` line to the test file before its first `went`; `ignore *` checks only links, sections and passages. Suggest this to the author, rather than `--update`, when a change to bookkeeping fails a test and the story plays the same.
4. **Build** the playable page when asked: `npx @textadventures/squiffy-cli` (no flags). With `squiffy.json`, it writes to `build/`; otherwise next to the file. `--serve` serves it on http://localhost:8282 (to this computer only; `--host 0.0.0.0` for a phone on the same network), where the author can start at any section with `?start=section name` on the address, or the flag button's list (references/project.md, "Starting at a later section"), and `--inline` makes one HTML file.

Time is virtual in `--play` and `--random`: animations, `{{goto ... after=}}` and `{{#every}}` happen at once (a `{{#every}}` that never stops is left after 20 times). Scripts a story adds to its page aren't run.

If the CLI says it doesn't know `--check`, `--play`, `--random` or `--test`, it's an older version: try `npx @textadventures/squiffy-cli@latest` (or `@beta`, if the story uses something from a beta), or tell the author to update.

**Converting** a story from elsewhere, when the author asks: `npx @textadventures/squiffy-cli mygame.html --convert-twine` (Twine's published or archive HTML, or Twee; Harlowe or SugarCube) and `mygame.quest --convert-quest` (a Quest gamebook, or its `.aslx`) each make a new story folder next to the file (`--out folder` for another), with `twine-import.txt` / `quest-import.txt` listing what couldn't be converted exactly: read it, and `--check` the result. `story.squiffy --convert-v5` converts a Squiffy 5 story in place, and `--convert-v6` a Squiffy 6 one, keeping `.bak` copies.

Don't write `game.json`, `build/` or `random/` output into the author's story files, and delete scratch save files you made when you're done.

## Writing well for Squiffy

- Give each section a short, unique name. Passage names must be unique within their section.
- Every section should lead somewhere or end with `@end`. Aim for `--check` with no warnings, and `--random` with no problems.
- Use passages for looking around within a scene, and sections for decisions that move the story on.
- Write for every player: alt text on images, link text that makes sense on its own, and nothing that's only shown by colour or sound (references/accessibility.md).
- Keep the author's voice, formatting and naming conventions. Ask before restructuring their story.

## Reference files

Read these when you need more than the above:

- [references/syntax.md](references/syntax.md): every kind of section, passage, link and directive, master sections, `@start`, `@title`, `@repeat`, `@clear`, `@end`, embedding and `{{goto}}`. Read when writing structure beyond basic sections and links.
- [references/attributes.md](references/attributes.md): setting attributes in Squiffy 7 and Squiffy 6, link setters, calculations, conditions, arrays, objects, `seen`/`visits`/`turns`/`previous`. Read before writing any `@set` or link setter you aren't sure of.
- [references/helpers.md](references/helpers.md): every `{{helper}}`, with its parameters. Read before using a helper not shown above.
- [references/dynamic-text.md](references/dynamic-text.md): random text, animation, transitions, replace, rotate, sequence, live text and delays.
- [references/project.md](references/project.md): `squiffy.json` (main, exclude, panels, player settings, saves, Back button, strings), starting at a later section to test it (`?start=`, `@test`), stories in several files, `@import`, images, music and sound.
- [references/player-input.md](references/player-input.md): asking the player for text, with validation.
- [references/styling.md](references/styling.md): CSS variables, `@class` and the class helpers, custom transitions.
- [references/accessibility.md](references/accessibility.md): writing a story that works with the keyboard and screen readers: alt text, link text, colour, timers, sound, text box labels. Read before adding images, timers, text boxes or custom HTML.
- [references/javascript.md](references/javascript.md): JavaScript in sections, `@ui`, the `squiffy` API, custom helpers and animations.
