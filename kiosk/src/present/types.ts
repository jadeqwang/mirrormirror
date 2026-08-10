import type { BusEvent, ScreenRole } from "../bus.ts";

export type { MessageBus, ScreenRole } from "../bus.ts";

export type Beat = { screen: ScreenRole; text: string };

export interface GenerationEnvelopeLike {
  beats: readonly Beat[];
}

/** Lane D's original name for the §2.3 event union, now defined once in bus.ts. */
export type PresentationEvent = BusEvent;

export interface BeatView {
  type(text: string, kind?: "beat" | "preroll"): Promise<boolean>;
  abort(): void;
  reset(): void;
}
