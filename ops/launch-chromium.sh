#!/bin/bash
set -eu

KIOSK_URL=${KIOSK_URL:-http://127.0.0.1:4173}
CHROMIUM_BIN=${CHROMIUM_BIN:-chromium}
DISPLAY_WIDTH=${DISPLAY_WIDTH:-1920}
DISPLAY_HEIGHT=${DISPLAY_HEIGHT:-1080}
PROFILE_ROOT=${PROFILE_ROOT:-/var/lib/mirrormirror/chromium}

mkdir -p "$PROFILE_ROOT/praise" "$PROFILE_ROOT/roast"

cleanup() {
  kill "$praise_pid" "$roast_pid" 2>/dev/null || true
  wait "$praise_pid" "$roast_pid" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

common_flags="--kiosk --no-first-run --disable-session-crashed-bubble --disable-infobars --disable-translate --disable-features=Translate,MediaRouter --autoplay-policy=no-user-gesture-required --password-store=basic --use-fake-ui-for-media-stream"

# shellcheck disable=SC2086
"$CHROMIUM_BIN" $common_flags --user-data-dir="$PROFILE_ROOT/praise" --window-position=0,0 --window-size="${DISPLAY_WIDTH},${DISPLAY_HEIGHT}" "${KIOSK_URL}/?screen=praise" &
praise_pid=$!
# shellcheck disable=SC2086
"$CHROMIUM_BIN" $common_flags --user-data-dir="$PROFILE_ROOT/roast" --window-position="${DISPLAY_WIDTH},0" --window-size="${DISPLAY_WIDTH},${DISPLAY_HEIGHT}" "${KIOSK_URL}/?screen=roast" &
roast_pid=$!

# If either browser dies, terminate its peer. systemd then relaunches both cleanly.
wait -n "$praise_pid" "$roast_pid"
exit 0
