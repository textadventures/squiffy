#!/usr/bin/env bash
# Build and launch the Squiffy desktop app (desktop/, #276): the editor (app/) and the packages it
# uses, then the Electron main process, then the app itself.
#
# Usage:
#   ./electron.sh [--skip-build] [file.squiffy]
#
# Options:
#   --skip-build   Launch without rebuilding first.
#   file.squiffy   Open this story file's folder, as if the OS had asked the app to open it.
#
# It runs the editor's static build, so re-run this after changing app/ or the packages it uses.
# For hot reloading instead, run `npm run dev` in app/, then `npm run dev` in desktop/.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

BUILD=true
FILE=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-build) BUILD=false; shift;;
        -*) echo "Unknown option: $1" >&2; exit 1;;
        *) FILE="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"; shift;;
    esac
done

if [[ "$BUILD" == true ]]; then
    echo "Building the editor and the packages it uses..."
    [[ -d node_modules ]] || npm install
    npx lerna run build --scope @textadventures/squiffy-app --include-dependencies

    echo ""
    echo "Building the desktop app..."
    # Not an npm workspace, so it has its own install
    [[ -d desktop/node_modules ]] || npm --prefix desktop install
    npm --prefix desktop run build
fi

echo ""
echo "Launching Squiffy desktop app..."
echo ""
# Electron needs "." to be desktop/, so cd there. Electron downloads its binary the first time.
#
# --no-sandbox on Linux: Chromium's SUID sandbox helper needs root ownership and mode 4755, which
# npm install never sets up. It has to be a real argument, since the check runs before any of the
# app's code. (Branches rather than an args array, which macOS's bash 3.2 treats as unbound under
# `set -u` when it's empty.)
cd desktop
if [[ "$(uname -s)" == "Linux" ]]; then
    if [[ -n "$FILE" ]]; then npx electron . --no-sandbox "$FILE"; else npx electron . --no-sandbox; fi
else
    if [[ -n "$FILE" ]]; then npx electron . "$FILE"; else npx electron .; fi
fi
