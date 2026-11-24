# squiffy-compiler

Compiles Squiffy story files into JavaScript. See [the main README](../README.md) and the [docs](https://squiffystory.com).

## Public API

From 7.0, these are covered by semver, so changing them in a way that breaks code using them waits for a new major version:

- `compile()`, and what it returns: `CompileSuccess`'s `getJs()`, `getUiInfo()` and `diagnostics`, or a `CompileError`
- The project file (`squiffy.json`): `parseProjectFile()`, `formatProjectFile()`, `updateProjectFile()`, `getStoryFiles()`, `storyFileList()`, `isExcluded()`, `isAlwaysSkipped()`, `languageTag()`, the `PROJECT_*`, `PAGE_STRINGS`, `PANEL_ICONS`, `PLAYER_SETTING_TYPES`, `STORY_DETAILS` and `BUILD_FOLDER` constants, and their types
- The converters: `findV5Syntax()` and `convertV5Syntax()`, `convertSetters()`, `convertTwine()`, `convertQuestGamebook()`, and their result types
- `squiffy-compiler/node`: `findStory()` and `StoryOnDisk`
- `squiffy-compiler/squiffy.tmLanguage.json`, the TextMate grammar

The rest is for Squiffy's own packages (the runtime, packager, CLI, editor and VS Code extension), which are always released together with the same version, and can change in any release: `parse()`, `analyse()`, `emit()`, `ParseCache`, the syntax tree's types, `squiffy-compiler/language-service`, `squiffy-compiler/infix-expressions`, and everything else exported. So is the compiled story itself (`output.story`, and the `story.js` that `getJs()` writes): use it with `squiffy-runtime` of the same version.

## Tests

```bash
npm test
```

`test/fixtures/` has a small story for each feature. `compiler.test.ts` compiles each of them, and the complete stories in `../examples`, and compares the output with its snapshots. The fixtures have no `squiffy.json`, so they use Squiffy 6's rules for setters. `warnings/` has stories that should produce warnings.
