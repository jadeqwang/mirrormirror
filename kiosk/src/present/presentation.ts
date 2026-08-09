import type { BeatView, GenerationEnvelopeLike, MessageBus, PresentationEvent, ScreenRole } from "./types.ts";

export interface PresentationOptions {
  role: ScreenRole;
  view: BeatView;
  bus: MessageBus;
  preroll: readonly string[];
  beatGapMs?: number;
  random?: () => number;
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  onComplete?: () => void;
}

/** Coordinates strict cross-window alternation. Only praise calls play(). */
export class Presentation {
  readonly #role: ScreenRole;
  readonly #view: BeatView;
  readonly #bus: MessageBus;
  readonly #preroll: readonly string[];
  readonly #beatGapMs: number;
  readonly #random: () => number;
  readonly #setTimer: NonNullable<PresentationOptions["setTimer"]>;
  readonly #clearTimer: NonNullable<PresentationOptions["clearTimer"]>;
  readonly #onComplete?: () => void;
  #run = 0;
  #prerollDone: Promise<boolean> = Promise.resolve(true);
  #pending?: { index: number; resolve: (done: boolean) => void };
  #gapTimer?: ReturnType<typeof setTimeout>;
  #gapResolve?: (done: boolean) => void;

  constructor(options: PresentationOptions) {
    if (options.preroll.length === 0) throw new Error("pre-roll pool must not be empty");
    this.#role = options.role;
    this.#view = options.view;
    this.#bus = options.bus;
    this.#preroll = options.preroll;
    this.#beatGapMs = Math.max(0, options.beatGapMs ?? 900);
    this.#random = options.random ?? Math.random;
    this.#setTimer = options.setTimer ?? setTimeout;
    this.#clearTimer = options.clearTimer ?? clearTimeout;
    this.#onComplete = options.onComplete;
    this.#bus.addEventListener("message", this.#onMessage);
  }

  /** Feed locally emitted state events here as well as posting them to the bus. */
  handle(event: PresentationEvent): void {
    if (event.type === "state" && event.state === "ARMED" && this.#role === "praise") {
      const line = this.#preroll[Math.floor(this.#random() * this.#preroll.length)] ?? this.#preroll[0];
      this.#prerollDone = this.#view.type(line, "preroll");
    } else if (event.type === "beat_done" && this.#role === "praise") {
      this.#acceptDone(event.index);
    } else if (event.type === "abort") {
      this.#cancel(false);
      this.#view.abort();
    } else if (event.type === "reset") {
      this.#cancel(false);
      this.#view.reset();
    }
  }

  async play(envelope: GenerationEnvelopeLike): Promise<boolean> {
    if (this.#role !== "praise") throw new Error("only the praise conductor can sequence an envelope");
    assertFourBeats(envelope);
    const run = ++this.#run;
    if (!(await this.#prerollDone) || run !== this.#run) return false;

    for (let index = 0; index < 4; index += 1) {
      const beat = envelope.beats[index];
      const event = { type: "beat", index: index as 0 | 1 | 2 | 3, screen: beat.screen, text: beat.text } as const;
      const done = new Promise<boolean>((resolve) => this.#pending = { index, resolve });
      this.#bus.postMessage(event);
      if (beat.screen === "praise") {
        void this.#view.type(beat.text).then((completed) => {
          if (!completed || run !== this.#run) return;
          this.#bus.postMessage({ type: "beat_done", index });
          this.#acceptDone(index);
        });
      }
      if (!(await done) || run !== this.#run) return false;
      if (index < 3 && !(await this.#gap(run))) return false;
    }
    if (run === this.#run) this.#onComplete?.();
    return run === this.#run;
  }

  dispose(): void {
    this.#bus.removeEventListener("message", this.#onMessage);
    this.#cancel(false);
  }

  #onMessage = (message: MessageEvent<PresentationEvent>): void => {
    const event = message.data;
    if (!event || typeof event !== "object") return;
    if (event.type === "beat" && this.#role === "roast" && event.screen === "roast") {
      const run = this.#run;
      void this.#view.type(event.text).then((completed) => {
        if (completed && run === this.#run) this.#bus.postMessage({ type: "beat_done", index: event.index });
      });
      return;
    }
    this.handle(event);
  };

  #acceptDone(index: number): void {
    if (!this.#pending || this.#pending.index !== index) return;
    const pending = this.#pending;
    this.#pending = undefined;
    pending.resolve(true);
  }

  #gap(run: number): Promise<boolean> {
    return new Promise((resolve) => {
      this.#gapResolve = resolve;
      this.#gapTimer = this.#setTimer(() => {
        this.#gapTimer = undefined;
        this.#gapResolve = undefined;
        resolve(run === this.#run);
      }, this.#beatGapMs);
    });
  }

  #cancel(done: boolean): void {
    this.#run += 1;
    if (this.#gapTimer !== undefined) this.#clearTimer(this.#gapTimer);
    this.#gapTimer = undefined;
    const gapResolve = this.#gapResolve;
    this.#gapResolve = undefined;
    gapResolve?.(done);
    const pending = this.#pending;
    this.#pending = undefined;
    pending?.resolve(done);
  }
}

function assertFourBeats(envelope: GenerationEnvelopeLike): void {
  if (!Array.isArray(envelope.beats) || envelope.beats.length !== 4) throw new Error("presentation requires exactly four generated beats");
  for (const beat of envelope.beats) {
    if ((beat.screen !== "praise" && beat.screen !== "roast") || typeof beat.text !== "string" || !beat.text.trim()) {
      throw new Error("presentation received an invalid beat");
    }
  }
}
