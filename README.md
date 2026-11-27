# Squiffy

Squiffy is a free, open source tool for creating multiple-choice interactive stories. Write your story in a simple text format and publish it as HTML.

- **Web editor**: [app.squiffystory.com](https://app.squiffystory.com) - works offline as a PWA, no account required
- **Desktop app**: for Mac, Windows and Linux, from the [releases on GitHub](https://github.com/textadventures/squiffy/releases)
- **VS Code extension**: [Squiffy on the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=textadventures.squiffy)
- **Documentation**: [squiffystory.com](https://squiffystory.com)

> **Squiffy 7** brings a new editor, a desktop app, a VS Code extension, a story map, importing from Twine and Quest, and many additions to the language: see [What's new](https://squiffystory.com/whats-new/). Squiffy 6 stories still work in Squiffy 7. Squiffy 6 was a complete rewrite of [Squiffy 5](https://github.com/textadventures/squiffy/tree/v5).

## Quick Example

```
You wake up in a dark room. There is a [[door]] to the north and a [[window]] to the east.

[[door]]:
You open the door and step into a hallway. A [torch] flickers on the wall.

[torch]:
You grab the torch. It illuminates the hallway, revealing a staircase leading down.

[[window]]:
You look through the window. Moonlight streams in, but the glass is too thick to break.
```

**Sections** (`[[door]]`) are major story divisions - navigating to a new section disables all previous links. **Passages** (`[torch]`) are sub-divisions within a section where links remain clickable, allowing exploration within that section.

## Getting Started

The easiest way to get started is with the [web editor](https://app.squiffystory.com). For full documentation, see [squiffystory.com](https://squiffystory.com/getting-started/).

### Command-line usage

You can also compile and preview Squiffy stories from the command line:

```bash
npx @textadventures/squiffy-cli story.squiffy -s
```

The command-line tool can also check a story for problems (`--check`), play it as text (`--play`) or at random to find dead ends (`--random`), with `--json` output for AI agents, and convert stories from Squiffy 5 and 6, Twine and Quest. See [Using Squiffy from the command line](https://squiffystory.com/cli/) for all the options.

### Writing with AI

This repo is also a Claude Code plugin marketplace, with a Squiffy skill for an agent helping you write a story:

```
/plugin marketplace add textadventures/squiffy
/plugin install squiffy@squiffy
```

See [Writing with AI](https://squiffystory.com/writing-with-ai/).

## Features

- Sections and passages for structuring stories, which can be split across several files
- Variables, calculations, arrays and objects
- Conditional text and logic, with [Handlebars](https://handlebarsjs.com/)-style helpers
- Dynamic text: animations, transitions, text effects, random text, live updates and timed text
- Player text input
- Images, music, sound and fonts
- Markdown formatting
- JavaScript integration
- Published stories with a Back button, saved games, panels, player settings and dark mode
- An editor that finds problems as you type, with a story map and an outline
- Import from Twine (Harlowe or SugarCube) and Quest gamebooks
- Multiple export formats (HTML files, single HTML file, zip)
- Embeddable in custom web pages via the [runtime API](https://squiffystory.com/embedding/), or in a web app with the Vite plugin

## Development

This is a Lerna-managed monorepo. After cloning:

```bash
npm install
npm run build
npm install  # run again to register local packages
```

Run the editor locally with `npm run dev` in `app/`, and the docs site with `npm run dev` in `site/`. `./electron.sh` builds and runs the desktop app.

### Packages

| Folder            | Package name                          | Description                                                                         |
|-------------------|---------------------------------------|-------------------------------------------------------------------------------------|
| `compiler`        | `squiffy-compiler`                    | Converts Squiffy scripts into JavaScript, plus the language service and importers   |
| `runtime`         | `squiffy-runtime`                     | Browser library for running compiled stories                                        |
| `packager`        | `@textadventures/squiffy-packager`    | Bundles compiler output + runtime into deployable files                             |
| `cli`             | `@textadventures/squiffy-cli`         | Node.js CLI wrapper around the packager                                             |
| `types`           | `@textadventures/squiffy-types`       | Type definitions for the Vite plugin                                                |
| `vite-plugin`     | `@textadventures/vite-plugin-squiffy` | Vite plugin for importing `.squiffy` files into a web app                           |
| `app`             | *(private)*                           | Web editor at [app.squiffystory.com](https://app.squiffystory.com)                  |
| `desktop`         | *(private)*                           | Electron desktop app (not an npm workspace; see [its README](desktop/README.md))    |
| `site`            | *(private)*                           | Documentation site at [squiffystory.com](https://squiffystory.com)                  |
| `codemirror-lang` | *(private)*                           | CodeMirror 6 highlighting for `.squiffy` files, used by the editor and the docs     |
| `project-fs`      | *(private)*                           | The editor's file system layer, for the browser, Node and Electron                  |
| `graph-map`       | *(private)*                           | The editor's story map component                                                    |

The `examples` folder has the complete stories on the docs site's [Examples](https://squiffystory.com/featured-examples/) page, and `examples/vite-app`, an example web app that uses the Vite plugin. `plugins/squiffy` is the Claude Code plugin.

### Testing

```bash
npm test          # run all unit tests
npm run test:e2e  # run the end-to-end tests in real browsers (see e2e/README.md)
npm run lint      # lint all packages
```

### Releasing

Releases are made by [release-please](https://github.com/googleapis/release-please), from [Conventional Commits](https://www.conventionalcommits.org/) PR titles (`fix:`, `feat:`, `docs:`, `chore:` etc.). See `CLAUDE.md` for the details.

## License

MIT
