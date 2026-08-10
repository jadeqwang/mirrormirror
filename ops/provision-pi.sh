#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then echo "Run as root: sudo ops/provision-pi.sh" >&2; exit 1; fi
INSTALL_ROOT=${INSTALL_ROOT:-/opt/mirrormirror}
SOURCE_ROOT=${SOURCE_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y chromium unclutter nodejs npm v4l-utils
id mirrormirror >/dev/null 2>&1 || useradd --create-home --shell /bin/bash mirrormirror
install -d -o mirrormirror -g mirrormirror /var/lib/mirrormirror /etc/mirrormirror "$INSTALL_ROOT"
cp -a "$SOURCE_ROOT/." "$INSTALL_ROOT/"
cd "$INSTALL_ROOT"
npm ci
npm run build
npm run build:server
chown -R mirrormirror:mirrormirror "$INSTALL_ROOT" /var/lib/mirrormirror
install -m 0644 ops/systemd/mirrormirror-server.service ops/systemd/mirrormirror-kiosk.service /etc/systemd/system/
install -m 0755 ops/launch-chromium.sh "$INSTALL_ROOT/ops/launch-chromium.sh"
if [ ! -f /etc/mirrormirror/server.env ]; then
  install -m 0600 -o root -g root /dev/null /etc/mirrormirror/server.env
  echo '# OPENAI_API_KEY=replace-me' >> /etc/mirrormirror/server.env
fi
systemctl daemon-reload
systemctl enable mirrormirror-server.service mirrormirror-kiosk.service
echo "Provisioned. Set /etc/mirrormirror/server.env, verify displays/cameras, then reboot."
