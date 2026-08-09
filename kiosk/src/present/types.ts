export type ScreenRole = "praise" | "roast";

export type Beat = { screen: ScreenRole; text: string };

export interface GenerationEnvelopeLike {
  beats: readonly Beat[];
}

/** Frozen §2.3 wire shape, repeated locally until the shared bus module lands. */
export type PresentationEvent =
  | { type: "state"; state: "EMPTY" | "ARMED" | "PERFORMING" | "SPENT" }
  | { type: "beat"; index: 0 | 1 | 2 | 3; screen: ScreenRole; text: string }
  | { type: "beat_done"; index: number }
  | { type: "abort" }
  | { type: "reset" };

export interface MessageBus {
  postMessage(event: PresentationEvent): void;
  addEventListener(type: "message", listener: (event: MessageEvent<PresentationEvent>) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<PresentationEvent>) => void): void;
}

export interface BeatView {
  type(text: string, kind?: "beat" | "preroll"): Promise<boolean>;
  abort(): void;
  reset(): void;
}
