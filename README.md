# Squiffy

Squiffy is a free, open source tool for creating multiple-choice interactive stories. Write your story in a simple text format and publish it as HTML.

- **Web editor**: [app.squiffystory.com](https://app.squiffystory.com) - works offline as a PWA, no account required
- **Documentation**: [squiffystory.com](https://squiffystory.com)

> **Note:** This is Squiffy v6, currently in beta. It is a complete rewrite of [Squiffy v5](https://github.com/textadventures/squiffy/tree/v5). See [What's New in v6](https://squiffystory.com/whats-new/).

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

You can also compile Squiffy stories from the command line:

```bash
npx @textadventures/squiffy-cli story.squiffy
```

This generates HTML, CSS and JS files. Add `-s` to start a local web server to preview your story:

```bash
npx @textadventures/squiffy-cli story.squiffy -s
```

Other CLI options:

- `--port <number>` - port for the local server (default: 8282)
- `--inline` - create a single self-contained HTML file
- `--zip` - create a zip file
- `--scriptonly [filename]` - only generate the JavaScript file

## Features

- Sections and passages for structuring stories
- Variables and state tracking
- Conditional text and logic
- Dynamic text (animations, random text, live updates, text replacement)
- Player text input with validation
- Markdown formatting
- JavaScript integration
- Auto-save to browser localStorage
- Multiple export formats (HTML files, single HTML file, zip)
- Embeddable in custom web pages via the [runtime API](https://squiffystory.com/embedding/)

## Development

This is a Lerna-managed monorepo. After cloning:

```bash
npm install
npm run build
npm install  # run again to register local packages
```

### Packages

| Folder        | Package name                          | Description                                                                                             |
|---------------|---------------------------------------|---------------------------------------------------------------------------------------------------------|
| `compiler`    | `squiffy-compiler`                    | Converts Squiffy scripts into JavaScript                                                                |
| `runtime`     | `squiffy-runtime`                     | Browser library for running compiled stories                                                            |
| `packager`    | `squiffy-packager`                    | Bundles compiler output + runtime into deployable files                                                 |
| `cli`         | `@textadventures/squiffy-cli`         | Node.js CLI wrapper around the packager                                                                 |
| `editor`      | `@textadventures/squiffy-editor`      | Web editor at [app.squiffystory.com](https://app.squiffystory.com)                                      |
| `site`        | `site`                                | Documentation site at [squiffystory.com](https://squiffystory.com)                                      |
| `types`       | `@textadventures/squiffy-types`       | Type definitions for the Vite plugin                                                                    |

There is also an `examples` folder containing sample Squiffy scripts.

### Testing

```bash
npm test          # run all tests
npm run lint      # lint all packages
```

## License

MIT