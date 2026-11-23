#!/usr/bin/env bash
# Builds squiffystories.com: the player (player/) for every major version of
# Squiffy that has one, each in its own folder (/v7/, /v8/, ...), so a link to
# a story goes on being played by the version it was written for.
#
#   build-player-site.sh <output folder> [ref...]
#
# Each major version's player is built from its latest stable release tag,
# or, until it has one, from its latest prerelease (so /v7/ is there for the
# 7.0 betas). Once a major version has a stable release, its prereleases
# don't change its player. A player built from a prerelease sends "Open in
# editor" to the beta editor, as the stable one may be an earlier major
# version, which can't open the link. Every deploy builds them all, since a Cloudflare
# Pages upload replaces the whole site. The home page and _headers at the top
# come from the newest version.
#
# Refs given after the output folder are built instead of the release tags,
# to try this out (`build-player-site.sh /tmp/site HEAD`).
set -euo pipefail

out="${1:?Usage: build-player-site.sh <output folder> [ref...]}"
shift
rm -rf "$out"
mkdir -p "$out"
out="$(cd "$out" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

version_of() {
  git show "$1:package.json" | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).version'
}

if [ "$#" -gt 0 ]; then
  refs="$*"
else
  tags="$(git tag --list 'v[0-9]*' | sort -V)"
  refs=""
  for major in $(echo "$tags" | sed -E 's/^v([0-9]+)\..*/\1/' | sort -un); do
    # The latest stable release, or else the latest prerelease
    ref="$(echo "$tags" | grep -E "^v$major\.[0-9]+\.[0-9]+$" | tail -1 || true)"
    [ -n "$ref" ] || ref="$(echo "$tags" | grep -E "^v$major\." | tail -1)"
    refs="$refs $ref"
  done
fi

newest=0
for ref in $refs; do
  # Releases from before there was a player
  if ! git cat-file -e "$ref:player/package.json" 2>/dev/null; then
    continue
  fi
  version="$(version_of "$ref")"
  major="${version%%.*}"
  # Where the player's "Open in editor" goes: see release-channel.sh
  case "$version" in
    *-*) editor="https://app-beta.squiffystory.com" ;;
    *) editor="https://app.squiffystory.com" ;;
  esac
  echo "::group::Building /v$major/ from $ref ($version), for the editor at $editor"
  # A copy of the release's files, rather than a git worktree, which Lerna
  # builds the main checkout's packages from
  src="$work/$major"
  mkdir -p "$src"
  git archive "$ref" | tar -x -C "$src"
  (cd "$src" && npm ci --no-audit --no-fund && VITE_EDITOR_URL="$editor" npx lerna run build --scope @textadventures/squiffy-player --include-dependencies)
  rm -rf "$out/v$major"
  cp -R "$src/player/build/v$major" "$out/v$major"
  if [ "$major" -ge "$newest" ]; then
    newest="$major"
    find "$src/player/build" -maxdepth 1 -type f -exec cp {} "$out/" \;
  fi
  rm -rf "$src"
  echo "::endgroup::"
done

if [ "$newest" -eq 0 ]; then
  echo "::error::No release has a player to build."
  exit 1
fi

echo "Built: $(cd "$out" && ls -d v*/ | tr '\n' ' ')"
