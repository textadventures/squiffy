# squiffy-compiler

Compiles Squiffy story files into JavaScript. See [the main README](../README.md) and the [docs](https://squiffystory.com).

## Tests

```bash
npm test
```

`test/fixtures/` has a small story for each feature. `compiler.test.ts` compiles each of them, and the complete stories in `../examples`, and compares the output with its snapshots. The fixtures have no `squiffy.json`, so they use Squiffy 6's rules for setters. `warnings/` has stories that should produce warnings.
