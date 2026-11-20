# squiffy.json, several files, images and sound

Docs: https://squiffystory.com/multiple-files/ and https://squiffystory.com/images-and-files/

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
| `version` | Format version, `1`. Required |
| `main` | The main file, where the story starts. Required |
| `id` | Identifies the story for saved games. Keep it when publishing a new version; never copy it to another story. Any unique text |
| `exclude` | Files that aren't part of the story: `["notes.squiffy", "drafts/**", "lib/demo.js"]` (`*`, `?`, `**`) |
| `saveButton` | `false` leaves out the Save button. A `{{saves}}` link still opens the Saved games dialog |
| `backButton` | `false` leaves out the Back button, so choices are final |
| `panels` | Passages always to hand (below) |
| `strings` | The page's button text, for a story in another language (below) |
| `map` | Positions on the editor's story map. Written by the editor; leave it alone |

Having a `squiffy.json` also switches on Squiffy 7's rules for setting attributes (attributes.md).

## Several files

With `squiffy.json`:

- Every `.squiffy`, `.css` and `.js` file in the folder and subfolders is part of the story; no `@import` needed. `node_modules`, dot-folders and `build/` are left out.
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

## Page text in another language

```json
"strings": { "back": "Retour", "restart": "Recommencer", "restartConfirm": "Voulez-vous vraiment recommencer ?" }
```

Keys: `back`, `restart`, `restartConfirm`, `switchToDark`, `switchToLight`, `saves`, `saveName`, `save`, `noSaves`, `savedGame`, `savedToday`, `savedYesterday`, `load`, `loadConfirm`, `saveOptions`, `overwrite`, `overwriteConfirm`, `rename`, `newName`, `saveToFile`, `loadFromFile`, `delete`, `deleteConfirm`, `cancel`, `close`, `wrongStory`, `notASave`, `cantSave`. `[name]` and `[time]` are filled in. Missing keys stay English.

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
- The Back button and saved games restore the music. `_music` holds its file name. Use MP3 for widest support.
