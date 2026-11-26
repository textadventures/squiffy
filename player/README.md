# Squiffy player

A prototype. The page that plays a story from a link with the whole story in it:

    https://squiffystories.com/v7/#story=1XZG7bsMwDEV_hdXS...

The editor's Publish dialog makes the link ("A link"). Nothing is uploaded: the story's text
files, and its images of up to 4 KB each, are compressed into the part of the address after the
`#`, which a browser never sends to a server. An image costs four characters for every three
bytes, so there's room for a few small ones, and none for sounds. The page compiles the story and runs it in a sandboxed frame, as the editor's preview
does. Its "Open in editor" button sends the same payload to the editor, which makes a new story
from it, so a reader can change a story and share their own version.

Anyone can make a link with any JavaScript in it, so a story mustn't be able to pass itself off
as another site, such as a sign-in page, under squiffystories.com's address. The frame's sandbox
stops it navigating the reader's tab, and the page's Content-Security-Policy (`vite.config.ts`,
sent by `_headers` and the dev server) has `frame-src 'none'` and `object-src 'none'`, so nothing
else can be loaded into the frame, however the story tries, and `connect-src 'none'`, so it can't
`fetch()`. Its links to other sites open in a new tab, showing their own address
(`openOtherSitesInNewTab` in squiffy-runtime's `preview.ts`), and it can still show images, sounds
and fonts from other sites, but no frames, so a video embedded from another site won't play.
`e2e/player/security.spec.ts` tries all this.

A playing story has one bar, inside its frame, which the story's own CSS styles: its title, then
the published page's buttons (its panels' buttons, Back, Restart, Settings, mute, light/dark) in
the same order and with the same icons, then an edit button for "Open in editor", which asks this
page to go there. The player asks for these with the preview host's `setControls()`; the editor's
preview doesn't, as it has buttons of its own. This page's own bar, with "Open in editor", only
shows when there's no story to play, such as for a broken link. The frame is named for the story's
title, which is what a screen reader calls it. The reader's light
or dark and mute choices are kept in this page's storage, for every story.

The Publish dialog can make a link that asks for no "Open in editor" button. That's an option
in the compressed payload (see the top of `src/link.ts`), so the address doesn't show it. The
button inside the frame isn't drawn, and this page's own one only shows if the story has an
error, so its author can open it to see why. It only hides the button: the story can still be
decoded from the link.

- `src/link.ts`: the encoding, which the editor imports too (`@textadventures/squiffy-player/link`)
- `src/main.ts`: the page
- `app/src/lib/share-link.ts`: the editor's side, which chooses the files that go in a link

## The play page

`/v7/play` (`play.html`, `src/play.ts`) is for the editor's Play in a new tab (#644), which plays
the published story as players will see it. The story is someone's JavaScript, so it plays here,
rather than in a tab of the editor's own, which would have the editor's origin and storage. The
editor opens this page, which tells it it's ready; the editor sends the story's published page,
and this page becomes it, so the story keeps its saves in this domain's storage, as a published
story does. Its messages are in `src/play-protocol.ts`, which the editor imports too
(`@textadventures/squiffy-player/play-protocol`), with its side in `app/src/lib/play-in-tab.ts`.

- The runtime is in the page the editor sends, so this page doesn't change with the editor: only
  if the messages do, which carry a version for that.
- It only takes a story from the window that opened it, from the editors in `play-protocol.ts`
  (and from `localhost` in development), and then cuts itself off from that window
  (`window.opener = null`), so the story can't reach the editor's tab.
- It keeps the story in `sessionStorage`, so it plays again when the page reloads, which is what
  the story's Restart does. A story too big to keep (with its sounds in it) doesn't.
- `_headers` keeps it out of other sites' frames, and gives it the player's Content-Security-Policy too.
- In development, Play in a new tab needs this dev server running, as share links do.

## Running it

    ./dev.sh                          # the editor on 5180, and this on http://localhost:5181/v7/
    npm run dev --workspace player    # just this

`./dev.sh --port <n>` puts the editor on that port and this on the next, each pointing at the other.

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
