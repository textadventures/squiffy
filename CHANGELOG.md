# Changelog

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
