# Changelog

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
