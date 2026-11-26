# squiffy.json, several files, images and sound

Docs: https://squiffystory.com/project-file/, https://squiffystory.com/multiple-files/, https://squiffystory.com/buttons-panels-settings/ and https://squiffystory.com/images-and-files/

## squiffy.json

```json
{
  "$schema": "https://squiffystory.com/schema/squiffy.json",
  "version": 1,
  "id": "0b7c6d9e-3f1a-4e2b-9c5d-8a7f6e5d4c3b",
  "main": "story.squiffy"
}
```

| Property | Meaning |
|---|---|
| `version` | Format version, `1`. Required. A property or value (page string, panel icon, setting type) this Squiffy doesn't know is a warning and left out, not an error |
| `main` | The main file, where the story starts. Required |
| `id` | Identifies the story for saved games, and the player's progress, saves and choices are kept in the browser under it. It's the published page's IFID (uppercased), which sites that list stories match it by. Keep it when publishing a new version; never copy it to another story. Any unique text |
| `description` | What the story is about, in a sentence or two, for the published page's `<meta name="description">` and link previews |
| `author` | Who wrote it, for the published page's `<meta name="author">` |
| `cover` | An image's path from the main file's folder, for link previews (`og:image`). Published with the story even if the story doesn't show it; left out of a single HTML file |
| `language` | The language the story is written in, as a BCP 47 tag (`"en"`, `"fr"`, `"pt-BR"`), for the published page's `<html lang>`. Not a name such as `"English"`, which is refused |
| `exclude` | Files that aren't part of the story: `["notes.squiffy", "drafts/**", "lib/demo.js"]` (`*`, `?`, `**`) |
| `saveButton` | `false` leaves out the Save button. A `{{saves}}` link still opens the Saved games dialog |
| `headerTitle` | `true` shows the `@title` at the left of the header bar of buttons. Off by default; `{{headertitle}}` (helpers.md) can set one either way |
| `backButton` | `false` leaves out the Back button, so choices are final |
| `startAnywhere` | `true` lets anyone start the published story at any section, for a test build (below). Take it out before publishing for players |
| `panels` | Passages always to hand (below) |
| `settings` | Options the player can change, read as `settings.name` (below) |
| `persistent` | Attributes that last between playthroughs (below) |
| `ignore` | Warnings turned off for the whole story, each as a `squiffy-ignore` comment has it: `["dead-end", "unknown-name board score"]`. Only add one when the author agrees |
| `strings` | The page's button text, for a story in another language (below) |
| `map` | Positions and box sizes on the editor's story map. Written by the editor; leave it alone |

Having a `squiffy.json` also switches on Squiffy 7's rules for setting attributes (attributes.md).

## Several files

With `squiffy.json`:

- Every `.squiffy`, `.css` and `.js` file in the folder and subfolders is part of the story; no `@import` needed. `node_modules`, dot-folders, `build/` and any subfolder with a `squiffy.json` of its own (another story) are left out.
- The main file comes first, then the others in path order. That decides `+++` numbering and, for duplicate section names, which wins (with a warning).
- The story starts in the main file (first section, or `@start`). `@title` and `@start` in other files are ignored.
- Links work between files. Paths to images and in `@import` are relative to the main file's folder.
- Stylesheets and scripts go in path order; `@import` one in the main file to put it first.
- `@ui file.js` reads a script as start-up code instead of adding it to the page.
- An old `index.html`, `story.js`, `style.css`, `squiffy.runtime.global.js` next to the main file is treated as an old build and ignored.

Without `squiffy.json`, the story is its main file plus what it imports: `@import other.squiffy`, `@import *.squiffy`, `@import style.css`, `@import script.js`.

The CLI builds a `squiffy.json` story into `build/` (run in the folder with no file name). Given another `.squiffy` file in the folder, it builds just that file.

## Panels

```json
"panels": [
  { "passage": "status", "label": "Status", "position": "side" },
  { "passage": "inventory", "label": "Inventory", "icon": "bag" },
  { "passage": "help", "label": "Help" }
]
```

The passages go in the master section:

```squiffy
[[]]:

[status]:
**Gold:** {{gold}}

[inventory]:
{{#each inventory}}
- {{this}}
{{else}}
You're carrying nothing.
{{/each}}
```

- `"position": "side"` puts it beside the story (a header button on narrow screens). Others are header buttons that open a dialog.
- `icon`: `bag`, `person`, `map`, `help`, `info`, `list`, `book`, `star` or `heart` (the label becomes a tooltip).
- Panels only show text: `{{set}}`, `{{goto}}`, `@set` and JavaScript don't run, and links don't work. An empty side panel is hidden.

## Player settings

```json
"settings": [
  { "name": "warnings", "label": "Content warnings", "default": true, "description": "Before upsetting scenes" },
  { "name": "textSize", "type": "list", "label": "Text size", "options": ["Small", "Medium", "Large"], "default": "Medium" },
  { "name": "speed", "type": "range", "label": "Text speed", "min": 1, "max": 5, "step": 1, "default": 3 }
]
```

- Types: `toggle` (the default; `true`/`false`, off unless `default`), `list` (`options`: text, or `{ "value": "large", "label": "Large text" }`; first option unless `default`), `range` (`min` to `max`, optional `step`; `min` unless `default`). `name` is letters, digits and `_`.
- The page gets a Settings button; `{{settings}}` links to the same dialog.
- The story reads them: `{{#if settings.warnings}}`, `{{settings.textSize}}`, `@set fast = settings.speed > 3`. It can't change them.
- They're the player's: kept in the browser for the story, not undone by Back, kept on Restart, not in saved games. A change affects text shown afterwards, panels and `{{live "settings.speed"}}`, not text already shown.
- Each puts a class on `div#squiffy`: `setting-warnings` while a toggle is on, `setting-textSize-Large` and `setting-speed-3` for lists and ranges (characters other than letters, digits, `-`, `_` become `-`). Style with them: `div#squiffy.setting-textSize-Large { --squiffy-font-size: 1.375rem; }`.

## Persistent attributes

```json
"persistent": ["endings", "finished"]
```

- Attributes that belong to the player, not the playthrough: endings found, achievements, "finished once". Set and read as usual: `@set endings.pebbles = true`, `{{#if finished}}`, `{{length endings}}`.
- Kept in the browser for the story. Restart keeps them, Back doesn't undo them, they aren't in saved games and loading one doesn't change them.
- `{{forget}}` clears them all, `{{forget "finished"}}` just those named: put it in a passage the player chooses, e.g. `[Forget everything]`.
- Names are letters, digits and `_`, starting with a letter; not `settings`.
- CLI `--play`/`--random`/`--test` start with them empty each run; `--save` carries them in the save file, and `--start` with `--save` starts a new game that keeps them (a second playthrough).

## Page text in another language

```json
"strings": { "back": "Retour", "restart": "Recommencer", "restartConfirm": "Voulez-vous vraiment recommencer ?" }
```

Keys: `back`, `restart`, `restartConfirm`, `switchToDark`, `switchToLight`, `mute`, `unmute`, `saves`, `saveName`, `save`, `noSaves`, `savedGame`, `savedToday`, `savedYesterday`, `load`, `loadConfirm`, `saveOptions`, `overwrite`, `overwriteConfirm`, `rename`, `newName`, `saveToFile`, `loadFromFile`, `delete`, `deleteConfirm`, `cancel`, `close`, `wrongStory`, `notASave`, `newerSave`, `cantSave`, `settings`, `resetSettings`, `watchVideo` (`Watch on [site]`, a video's link where it can't play in the page), and for the Start at list, `startAt`, `findSection`, `fromStart`, `testSections`, `allSections`, `noSection`. `[name]`, `[time]` and `[site]` are filled in. Missing keys stay English.

## Starting at a later section

For the author testing a late scene in a browser without playing up to it. A story served with the CLI's `--serve` can start at any section:

- `http://localhost:8282/?start=the vault` starts at that section. Restart starts there again.
- `&set=` sets an attribute first, once for each, written as after `@set`: `?start=the vault&set=has_key&set=score=5`.
- The flag button above the story lists the sections, `@test` ones first, under **From the beginning**, which goes back to the story's start.

Starting anywhere other than the start still runs the start section's `@set` (and `@inc`, `@dec`...) lines first, so the story's "globals" such as `@set loot = 0` are set, but not its text or JavaScript: an attribute set from the start's JavaScript, or on the way to the scene, is empty unless something sets it. The section's own setters, and `&set=`, come after, so win.

In the author's testing views (the editor's and VS Code's previews, and `--serve`'s page), a bare `{{name}}` that's neither a helper nor a set attribute shows faintly as `{{name}}`, so a scene started without its attributes shows what's missing. Not in the published story, where it's nothing, nor in `--play`'s text, nor for `{{#if name}}`, expressions or paths such as `{{hero.name}}`.

When a scene needs more than an attribute or two, write a section that sets them and goes on to it, marked `@test`, and start there:

```squiffy
[[vault with the key]]:
@test
@set has_key
@set score = 5
{{goto "the vault"}}
```

`@test` means nothing needs to link to the section: it, and sections only it links to (so one `@test` section can list links to several setups), aren't reported by `--check` as unreachable, and `--random` doesn't count them as never visited. Don't use `squiffy-ignore unreachable-section` or JavaScript for this.

Sections marked `@test` are left out of the published story (the files in `build/`, the editor's exports), so:

- Mark every setup section `@test`, not only a list that links to them: an unmarked one is still published.
- Nothing in the story itself may link to, embed or `{{goto}}` a `@test` section: `--check` warns (`squiffy/link-to-test-section`), as that would be broken when published. Other `@test` sections can.

`--serve` shows a testing copy of the story, with the `@test` sections and the flag button, but the files it writes to `build/` are the published story, with neither. So a published story can't start anywhere (nor can the editor's Play in a new tab), unless `squiffy.json` has `"startAnywhere": true`, for a build other people test, which keeps the `@test` sections too.

With `--play`, use `--start section` instead (a `@test` section works there too). The editor's preview has the same flag button, and Run from this section.

## Images, video and fonts

```squiffy
![A sleeping cat](cat.png)
<img src="images/map.png" alt="Map of the island">
<video src="intro.mp4" controls></video>
```

Files go in the story's folder or below, and are included when built. Paths are relative to the main file. Avoid spaces in file names (or write `%20`). Fonts: put the files in the folder and add `@font-face` rules in a stylesheet (styling.md).

## Music and sound

```squiffy
[[forest]]:
@music sounds/forest.mp3
@sound sounds/owl.mp3
Tall trees surround you.

[[outside]]:
@music stop
```

- `@music file` loops until changed, continuing across sections; changing it crossfades over a second. `@music stop` fades it out.
- `@sound file` plays once; `@sound stop` stops sounds.
- Helpers for part-way or conditional sound: `{{music "battle.mp3" fade=3}}`, `{{stopmusic fade=0}}`, `{{sound "whisper.mp3" volume=0.5}}`, `{{stopsounds}}`.
- Browsers play no sound until the player clicks something, so don't put `@music`, `@sound`, `{{music}}` or `{{sound}}` in the start section, or `@music`/`@sound` in the master section: `--check` warns (`squiffy/sound-on-first-screen`). If the story is embedded in a page that always has a click first, `{{!-- squiffy-ignore sound-on-first-screen --}}` in the section turns the warning off. For music from the start, open with a title screen and a "Begin" link, and start the music in the section it goes to.
- The Back button and saved games restore the music. `_music` holds its file name. Use MP3 for widest support.
