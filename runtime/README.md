# squiffy-runtime

Plays a compiled Squiffy story in the browser. See [Embedding](https://squiffystory.com/embedding/) in the docs, and [the main README](../README.md).

## Public API

From 7.0, these are covered by semver, so changing them in a way that breaks a page or story using them waits for a new major version:

- `init()`, its options (`SquiffyInitOptions`), and the `SquiffyApi` it returns, with its events
- The page's pieces documented on the Embedding page: `createSavesDialog()`, `createSettingsDialog()`, `confirmDialog()`, `createPanels()`, `createStartMenu()`, `indexedDbSaveSlots()`, `memorySaveSlots()`, and their strings
- What a story's own JavaScript gets: `squiffy` in a section's or passage's JavaScript and in `@ui`, and `SquiffyScriptApi` with the `squiffy:ready` event ([JavaScript](https://squiffystory.com/javascript/))
- The CSS class names and custom properties on the [Styling](https://squiffystory.com/styling/) page, and the classes the stylesheet gives `{{#style}}` effects and `@transition`s
- The saved game format (`SavedGame`, `"format": "squiffy-save"`): a 7.x runtime loads a game saved by any earlier 7.x

The rest is for Squiffy's own packages, which are always released together with the same version, and can change in any release: `squiffy-runtime/preview-host`, `squiffy-runtime/preview-html` and `squiffy.preview.html` (the preview in the editor, the VS Code extension and the player), the plugin interfaces (stories can't add plugins), and the shape of a compiled story (`Story`), which should come from `squiffy-compiler` of the same version.
