#!/bin/sh
# Runs the live web tests (tests/live) against the currently running
# `pnpm dev` session: discovers the sidecar's loopback port and bearer token
# from its process environment and hands them to Playwright via env vars.
# The token never touches disk or stdout.
set -eu

cd "$(dirname "$0")/.."

SIDECAR_PID=$(pgrep -f "target/debug/aster-core" | head -1 || true)
if [ -z "$SIDECAR_PID" ]; then
  echo "no running aster-core sidecar found; start \`pnpm dev\` first" >&2
  exit 1
fi

# lsof ORs its selection criteria unless -a is given; without it the first
# listening socket of ANY process would be picked.
PORT=$(lsof -a -nP -iTCP -sTCP:LISTEN -p "$SIDECAR_PID" | awk '/127\.0\.0\.1/ { sub(/.*:/, "", $9); print $9; exit }')
TOKEN=$(ps -Eww -p "$SIDECAR_PID" -o command | tr ' ' '\n' | sed -n 's/^ASTER_BOOTSTRAP_TOKEN=//p' | head -1)

if [ -z "$PORT" ] || [ -z "$TOKEN" ]; then
  echo "could not read sidecar port/token from pid $SIDECAR_PID" >&2
  exit 1
fi

ASTER_LIVE_CORE_URL="http://127.0.0.1:$PORT" \
ASTER_LIVE_TOKEN="$TOKEN" \
exec pnpm exec playwright test --config playwright.live.config.ts "$@"
