/**
 * The §2.3 cross-window contract, in one place.
 *
 * Two Chromium windows load the same app; the praise window is the conductor
 * and owns all timing, the roast window is a follower with no state beyond its
 * own text layers. They speak only through this channel, and only in the shapes
 * below. Changing anything here is a `[CONTRACT]` change.
 *
 * This module previously existed twice and partially — the event union lived in
 * state.ts and a bare channel factory lived in present/index.ts. Both now import
 * from here so there is a single definition to change.
 */

export type ScreenRole = "praise" | "roast";
export type PerformanceState = "EMPTY" | "ARMED" | "PERFORMING" | "SPENT";
export type BeatIndex = 0 | 1 | 2 | 3;

export type BusEvent =
  | { type: "state"; state: PerformanceState }
  | { type: "beat"; index: BeatIndex; screen: ScreenRole; text: string }
  | { type: "beat_done"; index: number }
  | { type: "abort" }
  | { type: "reset" };

export interface MessageBus {
  postMessage(event: BusEvent): void;
  addEventListener(type: "message", listener: (event: MessageEvent<BusEvent>) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<BusEvent>) => void): void;
}

export type Bus = MessageBus & { close(): void };

export const BUS_CHANNEL_NAME = "mirrormirror";

export function createBus(name: string = BUS_CHANNEL_NAME): Bus {
  return new BroadcastChannel(name) as unknown as Bus;
}

const STATES: readonly string[] = ["EMPTY", "ARMED", "PERFORMING", "SPENT"];

/**
 * A follower that reloads mid-performance rejoins a live channel, so anything
 * arriving here is untrusted until checked.
 */
export function isBusEvent(value: unknown): value is BusEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  switch (event.type) {
    case "state":
      return typeof event.state === "string" && STATES.includes(event.state);
    case "beat":
      return (
        isBeatIndex(event.index) &&
        (event.screen === "praise" || event.screen === "roast") &&
        typeof event.text === "string" &&
        event.text.trim() !== ""
      );
    case "beat_done":
      return typeof event.index === "number" && Number.isInteger(event.index);
    case "abort":
    case "reset":
      return true;
    default:
      return false;
  }
}

export function isBeatIndex(value: unknown): value is BeatIndex {
  return value === 0 || value === 1 || value === 2 || value === 3;
}
