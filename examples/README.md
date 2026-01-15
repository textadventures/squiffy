# Squiffy Examples

This directory contains example Squiffy stories demonstrating various features and capabilities.

## Playing the Examples

### Online (Recommended)

The easiest way to play these examples is to visit the [Examples page on squiffystory.com](https://squiffystory.com/examples/).

Each example is available in two formats:
- **Interactive editor**: Edit the code and see live updates
- **Standalone version**: Play the full game in a clean interface ([Play links](https://squiffystory.com/examples/))

### Local Development

To run examples locally, use the Squiffy CLI:

```bash
# Install the CLI (from the project root)
npm run build

# Run an example
cd examples/coffeeshop
npx @textadventures/squiffy-cli coffeeshop.squiffy -s
```

This will compile the example and start a local web server at http://localhost:8282

## Featured Examples

- **coffeeshop/** - A narrative story about working at "The Daily Grind" coffee shop
  - Demonstrates: text input, variables, conditional text, relationship tracking, multiple endings

- **gameshow/** - "The Wheel of Dubious Fortune" interactive game show
  - Demonstrates: animations, live updates, randomization, complex state tracking, scoring

- **helloworld/** - A minimal Squiffy story to get started

## Building Examples

The examples are automatically packaged during the site build process. If you're working on the site:

```bash
cd site
npm run build:examples  # Package all examples
npm run build           # Full site build (includes examples)
```

Packaged examples are output to `site/public/examples/` as standalone HTML/JS/CSS files.

### Configuration

The `examples.json` file controls which examples are built and published:

```json
{
  "examples": [
    {
      "path": "coffeeshop/coffeeshop.squiffy",
      "description": "Full story: working at The Daily Grind coffee shop",
      "featured": true
    }
  ]
}
```

**Adding a new example:**
1. Create your `.squiffy` file in a subdirectory (e.g., `myexample/myexample.squiffy`)
2. Add an entry to `examples.json` with the path relative to the `examples/` directory
3. Run `npm run build:examples` from the `site/` directory to build it

**Why this approach?**
- Excludes test/internal examples (like `warnings/`)
- Handles multi-file examples correctly (like `import/test.squiffy`)
- Allows adding metadata like descriptions and featured flags
- Gives explicit control over what's published to the site
