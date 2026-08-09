export { DomBeatView, type TypewriterOptions } from "./dom-renderer.ts";
export { Presentation, type PresentationOptions } from "./presentation.ts";
export { installPresentationStyles, PRESENTATION_CSS } from "./styles.ts";
export type { Beat, BeatView, GenerationEnvelopeLike, MessageBus, PresentationEvent, ScreenRole } from "./types.ts";

export function createMirrorMirrorChannel(): BroadcastChannel {
  return new BroadcastChannel("mirrormirror");
}
