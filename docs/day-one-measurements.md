# Day-one video measurements

Run these before tuning detection or raising camera resolution. Use the production Chromium flags, both C920S cameras, both displays, and `?debug=1` on each kiosk URL. Record the camera selectors, negotiated resolution/frame rate, ambient temperature, Pi throttling state, and the commit/image identifier with every result.

## Confirm MJPEG and negotiated mode

Chromium's media APIs report resolution and frame rate but do not expose the UVC pixel format. The debug overlay therefore reports the browser-visible settings and explicitly marks format as requiring an OS check.

1. Start both kiosk windows and confirm the overlay settles near 1280×720 and 20–24fps.
2. On the Pi, run `v4l2-ctl --list-devices` to map the configured serial/by-path label to a `/dev/video*` node. Do not infer identity from enumeration order.
3. Run `v4l2-ctl -d /dev/videoN --get-fmt-video --get-parm` for each active capture node. Record `Pixel Format: 'MJPG'`, 1280×720, and the actual interval. If it says YUYV, stop: fix the Chromium/camera launch configuration before continuing.
4. Reboot once and repeat the identity check to prove the two cameras remain pinned correctly.

## Stopwatch end-to-end latency

1. Put a phone stopwatch with millisecond or centisecond display in the camera's standing zone.
2. Wait at least ten seconds after camera startup. Frame the phone and its on-screen mirror in one separate still photo; do not save webcam frames from the application.
3. Take at least ten photos distributed across one minute for each screen. For each, subtract the time visible on the monitor from the live phone time.
4. Record median, 90th percentile, minimum, and maximum. Under roughly 100ms reads as a mirror. A consistently larger result blocks visual tuning.
5. If latency is high, first confirm MJPEG, then try a lower resolution/frame-rate constraint and retest. The overlay's display-delay/decode fields are diagnostic timing only; they are not a substitute for the optical stopwatch test.

## Thirty-minute full-load/thermal test

1. Run both feeds, praise compositing, text animation, and the detection sampler together. Leave both `?debug=1` overlays visible.
2. Sample once per minute for 30 minutes: each overlay's measured fps/dropped frames/main-thread lag plus `vcgencmd measure_temp`, `vcgencmd get_throttled`, and process CPU/memory from `top` or `pidstat`.
3. Exercise at least three complete performances during the run and note their timestamps. Watch for frame-rate collapse, growing dropped-frame count, visible stutter, camera stalls, thermal throttling bits, or an application reload.
4. Pass only if both feeds remain visually smooth, no current or historical thermal/undervoltage bit appears in `get_throttled`, and performance activity causes no sustained degradation. Preserve the minute-by-minute results in the installation log; do not record visitor images.

The overlay clock helps correlate photos and external logs. Its “main-thread timer lag” is a CPU-pressure proxy, not system-wide CPU utilization; Pi-side thermal and process measurements remain required.
