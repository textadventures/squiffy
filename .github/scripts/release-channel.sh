#!/usr/bin/env bash
# Prints the release channel ("stable" or "prerelease") for a version tag,
# e.g. `release-channel.sh v6.1.0-beta.1` prints "prerelease". Every
# tag-triggered workflow uses this to decide where a release goes — see the
# "Releasing" section of CLAUDE.md.
set -euo pipefail

version="${1#v}"

case "$version" in
  *-*) echo prerelease ;;
  *) echo stable ;;
esac
