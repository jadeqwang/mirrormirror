# Cold-spare SD checklist

- Flash the same Raspberry Pi OS image and apply the same OS updates on the same day.
- Run `ops/provision-pi.sh`; copy the deployed `config.json` and root-owned
  `/etc/mirrormirror/server.env` without exposing the key in shell history.
- Confirm hostname/IP plan, Ethernet, clock synchronization, both independent
  HDMI outputs, camera by-id/by-path mapping, and disabled webcam audio.
- Cold-boot with network disconnected; both windows must appear and offline
  generation must work. Reconnect and verify `/health` and real generation.
- Prove server and Chromium auto-restart, run the latency check, and burn in for
  at least 30 minutes under full load while checking temperature/throttling.
- Label the card with image date, repo revision, Pi/display mapping, and test
  date. Store it with a tested reader and written swap instructions on site.
- Re-test the spare after any production config, prompt, dependency, or OS change.
