# Video-stall watchdog integration

Lane E provides `server/video-watchdog.ts` without modifying Lane A's
`kiosk/src/main.ts`. During integration, move/import that module into kiosk-owned
code and, immediately after locating the primary video element, call:

```ts
const stopWatchdog = installVideoStallWatchdog(video);
window.addEventListener("pagehide", stopWatchdog, { once: true });
```

The watchdog ignores paused/not-yet-ready media and hard-reloads after playback
time remains unchanged for more than five seconds. Test it with a deliberately
frozen real camera and with the looping mock stream before deployment.
