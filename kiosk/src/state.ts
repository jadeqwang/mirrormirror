import type { BusEvent, PerformanceState } from "./bus";

export type { BusEvent, PerformanceState } from "./bus";

/** Lane B's original name for the §2.3 event union, now defined once in bus.ts. */
export type ConductorEvent = BusEvent;

export interface StateMachineOptions<T> {
  settleMs?: number;
  spentEmptyMs?: number;
  rearmKey?: string;
  generate: () => Promise<T>;
  /**
   * Last resort when `generate` rejects. Lane C's client resolves with an
   * offline conversation rather than rejecting, but the conductor must not
   * depend on that — see the rejection path in `#arm`.
   */
  fallback?: () => T | undefined;
  onReady: (result: T) => void;
  emit: (event: ConductorEvent) => void;
  freezeDetection?: (frozen: boolean) => void;
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

/** Praise-window conductor. Rendering and networking remain injected lane concerns. */
export class PerformanceStateMachine<T> {
  readonly #options: Required<Pick<StateMachineOptions<T>, "settleMs" | "spentEmptyMs" | "rearmKey">> & StateMachineOptions<T>;
  #state: PerformanceState = "EMPTY";
  #occupied = false;
  #settled = false;
  #result?: T;
  #generation = 0;
  #settleTimer?: ReturnType<typeof setTimeout>;
  #spentTimer?: ReturnType<typeof setTimeout>;

  constructor(options: StateMachineOptions<T>) {
    this.#options = { settleMs: 1500, spentEmptyMs: 4500, rearmKey: "F9", ...options };
  }

  get state(): PerformanceState { return this.#state; }

  setOccupied(occupied: boolean): void {
    this.#occupied = occupied;
    if (this.#state === "EMPTY" && occupied) this.#arm();
    else if (this.#state === "ARMED" && !occupied) this.#toEmpty();
    else if (this.#state === "PERFORMING" && !occupied) {
      this.#options.emit({ type: "abort" });
      this.#toEmpty();
    } else if (this.#state === "SPENT") {
      if (occupied) this.#cancelSpentTimer();
      else this.#startSpentTimer();
    }
  }

  /** Presentation calls this after the final beat completes. */
  complete(): void {
    if (this.#state !== "PERFORMING") return;
    this.#transition("SPENT");
    this.#options.freezeDetection?.(false);
    if (!this.#occupied) this.#startSpentTimer();
  }

  handleKey(event: Pick<KeyboardEvent, "key" | "repeat">): boolean {
    if (event.repeat || event.key !== this.#options.rearmKey) return false;
    this.forceRearm();
    return true;
  }

  forceRearm(): void {
    const occupied = this.#occupied;
    this.#toEmpty();
    if (occupied) this.#arm();
  }

  dispose(): void {
    this.#generation += 1;
    this.#cancelTimers();
    this.#options.freezeDetection?.(false);
  }

  #arm(): void {
    this.#cancelTimers();
    this.#settled = false;
    this.#result = undefined;
    this.#transition("ARMED");
    const generation = ++this.#generation;
    // Generation begins synchronously on ARMED entry, in parallel with settling.
    void this.#options.generate().then((result) => {
      if (generation !== this.#generation || this.#state !== "ARMED") return;
      this.#result = result;
      this.#tryPerform();
    }).catch(() => {
      if (generation !== this.#generation || this.#state !== "ARMED") return;
      const fallback = this.#options.fallback?.();
      if (fallback !== undefined) {
        this.#result = fallback;
        this.#tryPerform();
        return;
      }
      // Nothing at all to show. Do not sit in ARMED with only the pre-roll on
      // screen until the visitor gives up — spec §8 makes a blank screen the one
      // failure they can perceive. Go SPENT rather than EMPTY so a still-occupied
      // zone cannot immediately re-arm and retry in a tight loop.
      this.#options.emit({ type: "abort" });
      this.#transition("SPENT");
      if (!this.#occupied) this.#startSpentTimer();
    });
    this.#settleTimer = this.#setTimer(() => {
      this.#settleTimer = undefined;
      if (this.#state !== "ARMED" || !this.#occupied) return;
      this.#settled = true;
      this.#tryPerform();
    }, this.#options.settleMs);
  }

  #tryPerform(): void {
    if (!this.#settled || this.#result === undefined || !this.#occupied || this.#state !== "ARMED") return;
    const result = this.#result;
    this.#transition("PERFORMING");
    this.#options.freezeDetection?.(true);
    this.#options.onReady(result);
  }

  #toEmpty(): void {
    this.#generation += 1;
    this.#cancelTimers();
    this.#options.freezeDetection?.(false);
    this.#settled = false;
    this.#result = undefined;
    this.#transition("EMPTY");
    this.#options.emit({ type: "reset" });
  }

  #startSpentTimer(): void {
    if (this.#spentTimer !== undefined) return;
    this.#spentTimer = this.#setTimer(() => {
      this.#spentTimer = undefined;
      if (this.#state === "SPENT" && !this.#occupied) this.#toEmpty();
    }, this.#options.spentEmptyMs);
  }

  #transition(state: PerformanceState): void {
    if (state === this.#state && state !== "EMPTY") return;
    this.#state = state;
    this.#options.emit({ type: "state", state });
  }

  #cancelSpentTimer(): void { if (this.#spentTimer !== undefined) this.#clearTimer(this.#spentTimer); this.#spentTimer = undefined; }
  #cancelTimers(): void { if (this.#settleTimer !== undefined) this.#clearTimer(this.#settleTimer); this.#settleTimer = undefined; this.#cancelSpentTimer(); }
  #setTimer(callback: () => void, delay: number): ReturnType<typeof setTimeout> { return (this.#options.setTimer ?? setTimeout)(callback, delay); }
  #clearTimer(timer: ReturnType<typeof setTimeout>): void { (this.#options.clearTimer ?? clearTimeout)(timer); }
}

export function installRearmKey<T>(machine: PerformanceStateMachine<T>, target: Window = window): () => void {
  const listener = (event: KeyboardEvent) => { if (machine.handleKey(event)) event.preventDefault(); };
  target.addEventListener("keydown", listener);
  return () => target.removeEventListener("keydown", listener);
}
