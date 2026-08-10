#!/bin/bash
set -eu

# Two Chromium windows, one per screen role. On the Pi they are two displays and
# each window is fullscreen. On a desk they are two halves of one monitor, which
# is the same layout scaled down and is how the piece gets rehearsed before the
# hardware exists: KIOSK_MODE=0.
KIOSK_URL=${KIOSK_URL:-http://127.0.0.1:4173}
CHROMIUM_BIN=${CHROMIUM_BIN:-chromium}
KIOSK_MODE=${KIOSK_MODE:-1}
PROFILE_ROOT=${PROFILE_ROOT:-/var/lib/mirrormirror/chromium}

if [ "$KIOSK_MODE" = "1" ]; then
  DISPLAY_WIDTH=${DISPLAY_WIDTH:-1920}
  DISPLAY_HEIGHT=${DISPLAY_HEIGHT:-1080}
else
  # Side by side on one monitor. Measure it rather than guessing, because a
  # desk-mode window that runs off the right edge hides the roast screen and
  # looks exactly like the roast screen having failed to start.
  screen=$(xdpyinfo 2>/dev/null | awk '/dimensions:/ {print $2; exit}')
  DISPLAY_WIDTH=${DISPLAY_WIDTH:-$(( ${screen%%x*} / 2 ))}
  DISPLAY_HEIGHT=${DISPLAY_HEIGHT:-${screen##*x}}
  : "${DISPLAY_WIDTH:=960}" "${DISPLAY_HEIGHT:=1080}"
fi

mkdir -p "$PROFILE_ROOT/praise" "$PROFILE_ROOT/roast"

cleanup() {
  kill "$praise_pid" "$roast_pid" 2>/dev/null || true
  wait "$praise_pid" "$roast_pid" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

common_flags="--no-first-run --disable-session-crashed-bubble --disable-infobars --disable-translate --disable-features=Translate,MediaRouter --autoplay-policy=no-user-gesture-required --password-store=basic --use-fake-ui-for-media-stream"
[ "$KIOSK_MODE" = "1" ] && common_flags="--kiosk $common_flags"

# shellcheck disable=SC2086
"$CHROMIUM_BIN" $common_flags --user-data-dir="$PROFILE_ROOT/praise" --window-position=0,0 --window-size="${DISPLAY_WIDTH},${DISPLAY_HEIGHT}" "${KIOSK_URL}/?screen=praise" &
praise_pid=$!
# shellcheck disable=SC2086
"$CHROMIUM_BIN" $common_flags --user-data-dir="$PROFILE_ROOT/roast" --window-position="${DISPLAY_WIDTH},0" --window-size="${DISPLAY_WIDTH},${DISPLAY_HEIGHT}" "${KIOSK_URL}/?screen=roast" &
roast_pid=$!

# If either browser dies, terminate its peer. systemd then relaunches both cleanly.
wait -n "$praise_pid" "$roast_pid"
exit 0
