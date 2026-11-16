The Squiffy documentation site, [squiffystory.com](https://squiffystory.com) (Astro + Starlight).

- `npm install`
- `npm run dev`

The site has two channels: squiffystory.com is built from the latest stable release tag, and beta.squiffystory.com from `main`. So docs written on `main` describe the next release, as if it had already shipped. To build the beta site, with its banner, `noindex` and links to the beta editor:

```
PUBLIC_BETA_SITE=true npm run build
```

See "Docs site" in [CLAUDE.md](../CLAUDE.md), including how to get a docs fix onto squiffystory.com between releases.
