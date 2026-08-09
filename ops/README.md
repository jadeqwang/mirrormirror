# Raspberry Pi operations

Provision Raspberry Pi OS Lite (64-bit), enable its minimal graphical session,
clone/copy the repository, and run `sudo ops/provision-pi.sh`. Put only the API
key in `/etc/mirrormirror/server.env` (`OPENAI_API_KEY=...`, mode 0600). The
browser never receives it. The server binds to loopback by default.

## Hardware verification

1. Connect Ethernet and confirm it survives a reboot (`ip link`, then ping the
   configured gateway). Do not configure venue Wi-Fi as the primary route.
2. Run `xrandr --query`; both HDMI connectors must be `connected`, independently
   addressable, and arranged left-to-right. Set `DISPLAY_WIDTH` in the kiosk
   unit override if each output is not 1920 pixels wide.
3. Run `v4l2-ctl --list-devices` and inspect
   `/dev/v4l/by-id/` plus `/dev/v4l/by-path/`. Put stable by-id/by-path values in
   the deployed `config.json`; never use `/dev/video0` enumeration order.
4. Confirm each C920 negotiates MJPEG at 1280x720 and 24 fps. Disable webcam
   microphones in the OS/session; the piece never requests audio.
5. Hide the pointer with `unclutter`, disable screen blanking/power management,
   notifications, automatic graphical updates, browser restore prompts, and any
   desktop panel. Verify a cold boot reaches both kiosk windows unattended.

## Restart and burn-in acceptance

Run `systemctl status mirrormirror-{server,kiosk}` and `curl
http://127.0.0.1:4173/health`. Kill the server and each Chromium PID in turn;
each visitor-facing window must return automatically. Pull Ethernet during a
performance and verify an offline conversation still completes. Then run the
full two-camera pipeline for a ten-hour gallery day while monitoring throttling
(`vcgencmd get_throttled`), temperature, memory, dropped frames, and journal
restarts. Repeat after a power-cycle.

For X11, use an autologin graphical session and start the kiosk unit from
`graphical.target`. If the installed Pi image uses Wayland, validate its output
placement and Chromium positioning on the actual monitors before installation;
do not assume X11 coordinates carry across compositors.
