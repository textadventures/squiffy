#!/usr/bin/env bash
# Start the editor (app/) from its Vite dev server, after building the packages it uses, with the
# player (player/) beside it on the next port, which plays the editor's share links and its Play in
# a new tab.
#
# Usage:
#   ./dev.sh [--skip-build] [--port <n>]
#
# Options:
#   --skip-build   Start without rebuilding the packages first.
#   --port <n>     Editor port (default 5180), with the player on the next one (5181). Set this to a
#                  different value per checkout (e.g. when reviewing a PR in a git worktree alongside
#                  your main checkout) so the two dev.sh instances don't collide.
#
# app/ hot-reloads, as does graph-map's GraphMap.svelte. The other packages it uses (compiler,
# runtime, packager, project-fs, graph-map, editor-search, codemirror-lang) are used from their
# builds, so re-run this (or `npm run build` in that package) after changing one.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

BUILD=true
PORT=5180
while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-build) BUILD=false; shift;;
        --port) PORT="$2"; shift 2;;
        *) echo "Unknown argument: $1" >&2; exit 1;;
    esac
done

# Check the port before building, so a clash fails in seconds rather than after the build.
port_holder() {
    # Prints "<command> (PID <pid>)" for the process listening on $1, if any.
    lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | awk 'NR == 2 { print $1 " (PID " $2 ")" }'
}
port_in_use() {
    if command -v lsof >/dev/null 2>&1; then
        [[ -n "$(port_holder "$1")" ]]
    else
        (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
    fi
}
PLAYER_PORT=$((PORT + 1))
for p in "$PORT" "$PLAYER_PORT"; do
    if port_in_use "$p"; then
        holder="$(port_holder "$p" || true)"
        echo "Port $p is already in use${holder:+ by $holder}." >&2
        echo "" >&2
        echo "Another dev server may be running, perhaps from another checkout or worktree." >&2
        echo "Stop it, or pick another port with --port <n>, e.g. ./dev.sh --port $((PORT + 10))" >&2
        exit 1
    fi
done

if [[ ! -d node_modules ]]; then
    echo "node_modules missing, installing (fresh checkout/worktree)..."
    npm install
fi

if [[ "$BUILD" == true ]]; then
    echo "Building the packages the editor uses..."
    # The editor's dependencies, but not the editor itself: the dev server doesn't need its static
    # build. (lerna's --ignore is applied before --include-dependencies, so it can't do this.)
    SCOPES=()
    for pkg in $(npx lerna list --all --scope @textadventures/squiffy-app --include-dependencies --json 2>/dev/null \
            | node -e 'for (const p of JSON.parse(require("fs").readFileSync(0))) if (p.name !== "@textadventures/squiffy-app") console.log(p.name)'); do
        SCOPES+=(--scope "$pkg")
    done
    npx lerna run build "${SCOPES[@]}"
fi

# The player, in the background, stopped when the editor is. Each is told where the other is: the
# editor sends share links and Play in a new tab to the player, whose "Open in editor" comes back.
# (The player's dev server uses a strict port of its own.)
EDITOR_URL="http://localhost:$PORT"
VITE_EDITOR_URL="$EDITOR_URL" PORT="$PLAYER_PORT" npm --prefix player run dev &
PLAYER_PID=$!
trap 'kill "$PLAYER_PID" 2>/dev/null || true' EXIT

echo ""
echo "Starting the editor on http://localhost:$PORT, and the player on http://localhost:$PLAYER_PORT/v7/"
echo ""
# --strictPort, so Vite fails rather than quietly moving to another port.
VITE_PLAYER_URL="http://localhost:$PLAYER_PORT" npm --prefix app run dev -- --port "$PORT" --strictPort
