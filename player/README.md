# Squiffy player

A prototype. The page that plays a story from a link with the whole story in it:

    https://squiffystories.com/v7/#story=1XZG7bsMwDEV_hdXS...

The editor's Publish dialog makes the link ("A link"). Nothing is uploaded: the story's text
files, and its images of up to 4 KB each, are compressed into the part of the address after the
`#`, which a browser never sends to a server. An image costs four characters for every three
bytes, so there's room for a few small ones, and none for sounds. The page compiles the story and runs it in a sandboxed frame, as the editor's preview
does. Its "Open in editor" button sends the same payload to the editor, which makes a new story
from it, so a reader can change a story and share their own version.

A playing story has one bar, inside its frame, which the story's own CSS styles: its title, then
the published page's buttons (its panels' buttons, Back, Restart, Settings, mute, light/dark) in
the same order and with the same icons, then an edit button for "Open in editor", which asks this
page to go there. The player asks for these with the preview host's `setControls()`; the editor's
preview doesn't, as it has buttons of its own. This page's own bar, with the title and "Open in
editor", only shows when there's no story to play, such as for a broken link. The reader's light
or dark and mute choices are kept in this page's storage, for every story.

- `src/link.ts`: the encoding, which the editor imports too (`@textadventures/squiffy-player/link`)
- `src/main.ts`: the page
- `app/src/lib/share-link.ts`: the editor's side, which chooses the files that go in a link

## Running it

    npm run dev --workspace player    # http://localhost:5181/v7/
    ./dev.sh                          # the editor, whose links point there in development

`VITE_PLAYER_URL` (for the editor's build) and `VITE_EDITOR_URL` (for this one) set where each
finds the other. They default to `https://squiffystories.com` and `https://app.squiffystory.com`.

## Versions

The build goes into `build/v7/`, named for the major version in the root `package.json`, with a
home page at `build/index.html`. The path is in every link, so a story goes on being played by
the version of Squiffy it was written for: `/v7/` gets every 7.x release, and stays when `/v8/`
arrives. The first character of the payload (`1`) is the encoding's own version. The encoding
is one compressed stream of every file, rather than a zip, which makes a longer link (see the
top of `src/link.ts`).

`deploy-player.yml` deploys it to the `squiffy-player` Cloudflare Pages project on every release
tag. An upload replaces the whole site, so `.github/scripts/build-player-site.sh` builds every
major version's player each time: from its latest stable release, or its latest prerelease until
it has one. To try that: `.github/scripts/build-player-site.sh /tmp/site HEAD`.

## Not done yet

- The story's progress isn't saved: the sandboxed frame has no storage, so it would need to go
  through this page, keyed by a hash of the story.
- There's no Save button (squiffy.json's `saveButton`), as nothing is saved.
- A beta build's links go to `/v7/`, the same as a stable one's, so once 7.0.0 is out, a story
  that uses something new in a 7.1 beta won't play from its link until 7.1.0.
