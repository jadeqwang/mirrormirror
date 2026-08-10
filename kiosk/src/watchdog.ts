/**
 * Moved out of `server/` — this is browser code and the server never imported it.
 *
 * Spec §8: a blank screen is the only failure a visitor can perceive, so a
 * silently stalled camera is the worst outcome the kiosk has. Reload only when
 * playback time has genuinely stopped advancing, never on a paused or
 * not-yet-ready element.
 */
export function installVideoStallWatchdog(video: HTMLVideoElement, stallMs = 5_000): () => void {
  let lastTime = video.currentTime;
  let lastAdvance = performance.now();
  const timer = window.setInterval(() => {
    if (video.paused || video.ended || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    if (video.currentTime !== lastTime) { lastTime = video.currentTime; lastAdvance = performance.now(); return; }
    if (performance.now() - lastAdvance > stallMs) window.location.reload();
  }, 1_000);
  return () => window.clearInterval(timer);
}
