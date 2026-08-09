/**
 * Additive kiosk reliability hook. Lane A can call this after creating its
 * primary video. It reloads only when playback time has not advanced for 5s.
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
