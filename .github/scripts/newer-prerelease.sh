#!/usr/bin/env bash
# Prints the newest prerelease tag that's newer than a stable release tag, or
# nothing if there isn't one: `newer-prerelease.sh v7.0.0` prints nothing
# until v7.1.0-beta.1 is tagged. deploy-app.yml deploys a stable release to
# app-beta.squiffystory.com too when there's none, so the beta site never runs
# an older version than app.squiffystory.com.
#
# A prerelease comes before its release (v7.1.0-beta.3 is older than v7.1.0),
# so only one for a later version counts.
set -euo pipefail

stable="${1:?Usage: newer-prerelease.sh <stable tag>}"
stable="${stable#v}"

newest=""
for tag in $(git tag --list 'v[0-9]*-*'); do
  core="${tag#v}"
  core="${core%%-*}"
  [ "$core" != "$stable" ] || continue
  # Later than the stable release, by its version without the prerelease part
  [ "$(printf '%s\n%s\n' "$stable" "$core" | sort -V | tail -1)" == "$core" ] || continue
  if [ -z "$newest" ] || [ "$(printf '%s\n%s\n' "${newest#v}" "${tag#v}" | sort -V | tail -1)" == "${tag#v}" ]; then
    newest="$tag"
  fi
done

echo "$newest"
