# Changelog

## [7.0.0-beta.2](https://github.com/textadventures/squiffy/compare/v7.0.0-beta.1...v7.0.0-beta.2) (2026-11-17)


### Features

* add a TextMate grammar for .squiffy files, and highlight the docs' Squiffy samples ([#356](https://github.com/textadventures/squiffy/issues/356)) ([60a60d1](https://github.com/textadventures/squiffy/commit/60a60d1428fbc22941b52beba5825b03457a976e))
* dark mode and a refreshed default style for published stories ([#370](https://github.com/textadventures/squiffy/issues/370)) ([58c5524](https://github.com/textadventures/squiffy/commit/58c55247fedcafec0729638fb70694e4c1324367))
* highlight CSS and JavaScript files in the editor ([#363](https://github.com/textadventures/squiffy/issues/363)) ([690421c](https://github.com/textadventures/squiffy/commit/690421cc74cea683f008cf17e084a386b1c8ddb4))
* squiffy.json project files in the editor ([#367](https://github.com/textadventures/squiffy/issues/367)) ([5f9bcf7](https://github.com/textadventures/squiffy/commit/5f9bcf778434e1ca0251c61787dea3ca277cebd8))
* story graph in the language service, with unreachable section and dead end checks ([#381](https://github.com/textadventures/squiffy/issues/381)) ([67b75ec](https://github.com/textadventures/squiffy/commit/67b75ec816f24e8ba322cb4f728404ba15b6e1c0))
* story map in the editor ([#382](https://github.com/textadventures/squiffy/issues/382)) ([5562e28](https://github.com/textadventures/squiffy/commit/5562e2898ce133e2f8fc02ff6bf5eeab2bb5d5b9))
* treat a folder with a squiffy.json as one story ([#366](https://github.com/textadventures/squiffy/issues/366)) ([a8e3c8d](https://github.com/textadventures/squiffy/commit/a8e3c8d8ac3974a083140cef58a370e813fe9c8d))
* warn when a section name is used more than once ([#365](https://github.com/textadventures/squiffy/issues/365)) ([e94bc82](https://github.com/textadventures/squiffy/commit/e94bc8206319c133e7e7060c591a162299bf7798))


### Bug Fixes

* explain when the browser blocks the editor's storage ([#362](https://github.com/textadventures/squiffy/issues/362)) ([09b95f1](https://github.com/textadventures/squiffy/commit/09b95f1949b997d01f43dfe2bb5b69781c04b167))
* import wildcard matches in a predictable order in the CLI and Vite plugin ([#364](https://github.com/textadventures/squiffy/issues/364)) ([c442a74](https://github.com/textadventures/squiffy/commit/c442a74e819bd3b156d7ef3d0de711e89b190dd5))
* show "(Start)" and +++/--- lines in the outline instead of internal section names ([#369](https://github.com/textadventures/squiffy/issues/369)) ([55c9dd1](https://github.com/textadventures/squiffy/commit/55c9dd1f03cfb5882b04647b8eaf20a48b718c2f))
* smooth resizing of the editor's preview and sidebar panes ([#368](https://github.com/textadventures/squiffy/issues/368)) ([ef44760](https://github.com/textadventures/squiffy/commit/ef4476066a2f1b5e04125ae17fde33afbe24858d))
* start the story at the main file's first section, even after an [@import](https://github.com/import) ([#360](https://github.com/textadventures/squiffy/issues/360)) ([910f0c8](https://github.com/textadventures/squiffy/commit/910f0c8d845a375b614328346452a852b58069ac))

## [7.0.0-beta.1](https://github.com/textadventures/squiffy/compare/v6.0.1...v7.0.0-beta.1) (2026-11-16)


### Features

* add a language service, exported as squiffy-compiler/language-service ([#344](https://github.com/textadventures/squiffy/issues/344)) ([2a69c56](https://github.com/textadventures/squiffy/commit/2a69c5695340b04d6f664acf679bbd66d370e67c))
* add a sandboxed preview page and host helper to squiffy-runtime ([#345](https://github.com/textadventures/squiffy/issues/345)) ([e21d4f9](https://github.com/textadventures/squiffy/commit/e21d4f9ed8e7f90798260745f66862f25e082ed7))
* add project file system layer for the editor ([#339](https://github.com/textadventures/squiffy/issues/339)) ([f07606f](https://github.com/textadventures/squiffy/commit/f07606f7e88789d8721742f31f1ea4e4becfa93f))
* asset URL resolution hook and asset bundling ([#277](https://github.com/textadventures/squiffy/issues/277)) ([#337](https://github.com/textadventures/squiffy/issues/337)) ([180da33](https://github.com/textadventures/squiffy/commit/180da33b3cc879ec02b777e18f4cc37505f1aa70))
* completion, hover, rename, references and quick fixes in the new editor ([#347](https://github.com/textadventures/squiffy/issues/347)) ([4a11d55](https://github.com/textadventures/squiffy/commit/4a11d55015b1c11b73a7375321a20e6fecc36ecc))
* multi-file projects and images in the new editor ([#349](https://github.com/textadventures/squiffy/issues/349)) ([163b874](https://github.com/textadventures/squiffy/commit/163b874acc7541f8cd70e4ea05dff4cc188d6b3d))
* publish the story and download the project from the new editor ([#350](https://github.com/textadventures/squiffy/issues/350)) ([ec5d77b](https://github.com/textadventures/squiffy/commit/ec5d77b0817a519061efe536294738c3dcd6c51f))
* replace the 6.x editor with the new one on app.squiffystory.com ([#353](https://github.com/textadventures/squiffy/issues/353)) ([0b377f1](https://github.com/textadventures/squiffy/commit/0b377f10c0da99c91e77e8fe7d6be03da98b640a))
* run the story in a preview beside the new editor ([#348](https://github.com/textadventures/squiffy/issues/348)) ([d7798d4](https://github.com/textadventures/squiffy/commit/d7798d4a7c142a8c8f259b554d38ac286f237b6c))
* split compiler into parse, analyse and emit, with structured diagnostics ([#338](https://github.com/textadventures/squiffy/issues/338)) ([305949d](https://github.com/textadventures/squiffy/commit/305949d356464bd2a12d5cf4620364f384a135f0))
* start the Squiffy 7 editor rebuild (milestone 1: shell, open/save, diagnostics, outline) ([#346](https://github.com/textadventures/squiffy/issues/346)) ([d7af2ba](https://github.com/textadventures/squiffy/commit/d7af2ba639f450d23a4e1559ee22c604facd9dfe))
* the 6.x editor's remaining features in the new editor ([#352](https://github.com/textadventures/squiffy/issues/352)) ([f237b17](https://github.com/textadventures/squiffy/commit/f237b1720b30a88bb2fed61417c47d76483f12bc))
* work offline, update banner and recent folders in the new editor ([#351](https://github.com/textadventures/squiffy/issues/351)) ([77e6568](https://github.com/textadventures/squiffy/commit/77e6568fb2815b0784dfb386ea5706aa4bdbc520))


### Bug Fixes

* don't report project-fs's own writes as external changes when the watcher flushes mid-write ([#354](https://github.com/textadventures/squiffy/issues/354)) ([b16d7b3](https://github.com/textadventures/squiffy/commit/b16d7b35c7ab5dcd850d12f96795b1977b1ba862))
* link the beta docs to the beta editor, and tidy the Run split button ([#355](https://github.com/textadventures/squiffy/issues/355)) ([15cd583](https://github.com/textadventures/squiffy/commit/15cd583834e8513fbb49d98394e53e856322ff22))
* resolve asset URLs inside animate blocks ([#343](https://github.com/textadventures/squiffy/issues/343)) ([b034dc5](https://github.com/textadventures/squiffy/commit/b034dc5172be50d90a711912a0a7ab0ed9ec748b))

## [6.0.1](https://github.com/textadventures/squiffy/compare/v6.0.0...v6.0.1) (2026-10-18)


### Bug Fixes

* keep the editor usable when a story fails to start or uses [@import](https://github.com/import) ([#316](https://github.com/textadventures/squiffy/issues/316)) ([350dca0](https://github.com/textadventures/squiffy/commit/350dca0226e8da2422b1538b1980b83f5d2ffd68))

## [6.0.0](https://github.com/textadventures/squiffy/compare/v6.0.0-beta.5...v6.0.0) (2026-10-13)


### Bug Fixes

* load the editor's icon fonts when offline ([#311](https://github.com/textadventures/squiffy/issues/311)) ([afc62c0](https://github.com/textadventures/squiffy/commit/afc62c0a037b6865c159fb2cd047e79901747f84))


### Miscellaneous Chores

* prepare release-please and the release workflows for 6.0.0 ([#314](https://github.com/textadventures/squiffy/issues/314)) ([c6ea48b](https://github.com/textadventures/squiffy/commit/c6ea48b5b05ddc5221de6f844330d11c10a82a8d))

## [6.0.0-beta.5](https://github.com/textadventures/squiffy/compare/v6.0.0-beta.4...v6.0.0-beta.5) (2026-10-11)


### Features

* point the editor's Help menu at Getting Started and the Squiffy games catalogue ([#300](https://github.com/textadventures/squiffy/issues/300)) ([b3d5140](https://github.com/textadventures/squiffy/commit/b3d5140042d3edde61aaba8d301d255fa34c799a))
* warn about Squiffy 5 text processor syntax and offer conversion ([#296](https://github.com/textadventures/squiffy/issues/296)) ([d3f6ac6](https://github.com/textadventures/squiffy/commit/d3f6ac6d05907d4f5f060c722c171e33f09dd2f8))


### Bug Fixes

* add squiffy.story.seen() to the JavaScript API ([#298](https://github.com/textadventures/squiffy/issues/298)) ([8b9ffa5](https://github.com/textadventures/squiffy/commit/8b9ffa5dd0831f6f8a7785b01a995d2f0b8f14cf))
* don't convert square brackets inside Handlebars expressions to links ([#294](https://github.com/textadventures/squiffy/issues/294)) ([35ffc38](https://github.com/textadventures/squiffy/commit/35ffc38cefb55f6c618828d5aa3b08e75176993c))

## [6.0.0-beta.4](https://github.com/textadventures/squiffy/compare/v6.0.0-beta.3...v6.0.0-beta.4) (2026-10-10)


### Features

* add a Vite plugin for importing .squiffy files into a web app ([#126](https://github.com/textadventures/squiffy/issues/126)) ([5902597](https://github.com/textadventures/squiffy/commit/59025973db4e0dc0613e919a1f0e16f4b645dca6))
* allow registering custom helpers from [@ui](https://github.com/ui) JavaScript ([#289](https://github.com/textadventures/squiffy/issues/289)) ([f5b1401](https://github.com/textadventures/squiffy/commit/f5b1401a0d0514816f9f9b483a8af800db6c7b2e))
* support infix expressions in {{#if}} conditions ([#287](https://github.com/textadventures/squiffy/issues/287)) ([d24fc40](https://github.com/textadventures/squiffy/commit/d24fc40e9752fea02b7ae55f9be20e5f2460d835))


### Bug Fixes

* allow section and passage helpers to take a SafeString, e.g. from random ([#290](https://github.com/textadventures/squiffy/issues/290)) ([111af08](https://github.com/textadventures/squiffy/commit/111af0801dd24fc796e537663f00103e296b0c22))
* embed sections and passages added during a live update ([#291](https://github.com/textadventures/squiffy/issues/291)) ([68acf37](https://github.com/textadventures/squiffy/commit/68acf378b05fd4de07eca0110d72d2e5d39104f2))
* keep link-triggered animation links disabled after the animation finishes ([#293](https://github.com/textadventures/squiffy/issues/293)) ([308866e](https://github.com/textadventures/squiffy/commit/308866eb2f85cc9e200453d953e584ed35d0effe))
* make the Back button restore inputs and ignore presses during transitions ([#292](https://github.com/textadventures/squiffy/issues/292)) ([37ea8e4](https://github.com/textadventures/squiffy/commit/37ea8e4db51eeb9d8ec1c84b13543e94b2afc6c8))

## [6.0.0-beta.3](https://github.com/textadventures/squiffy/compare/v6.0.0-beta.2...v6.0.0-beta.3) (2026-10-10)


### Bug Fixes

* don't mistake image links for passage links ([#185](https://github.com/textadventures/squiffy/issues/185)) ([d796a1c](https://github.com/textadventures/squiffy/commit/d796a1cd6245116c321b98d3afcf390c6e0ee338))
* warn when {{embed}} names a section or passage that doesn't exist ([#282](https://github.com/textadventures/squiffy/issues/282)) ([dbb9070](https://github.com/textadventures/squiffy/commit/dbb90707685d5e36410bbd9dae22a66a72bd2eb6))
