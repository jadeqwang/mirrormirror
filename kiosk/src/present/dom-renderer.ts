import type { BeatView } from "./types.ts";

export interface TypewriterOptions {
  charMs?: number;
  abortFadeMs?: number;
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

/** One-screen accumulating text view. Previous lines remain visible at 40%. */
export class DomBeatView implements BeatView {
  readonly #root: HTMLElement;
  readonly #charMs: number;
  readonly #abortFadeMs: number;
  readonly #setTimer: NonNullable<TypewriterOptions["setTimer"]>;
  readonly #clearTimer: NonNullable<TypewriterOptions["clearTimer"]>;
  #timer?: ReturnType<typeof setTimeout>;
  #finish?: (completed: boolean) => void;
  #generation = 0;

  constructor(root: HTMLElement, options: TypewriterOptions = {}) {
    this.#root = root;
    this.#charMs = Math.max(0, options.charMs ?? 35);
    this.#abortFadeMs = Math.max(0, options.abortFadeMs ?? 420);
    this.#setTimer = options.setTimer ?? setTimeout;
    this.#clearTimer = options.clearTimer ?? clearTimeout;
    root.classList.add("presentation");
  }

  type(text: string, kind: "beat" | "preroll" = "beat"): Promise<boolean> {
    this.#cancelTyping();
    this.#root.classList.remove("presentation--aborting");
    for (const old of this.#root.querySelectorAll<HTMLElement>(".presentation__line--current")) {
      old.classList.remove("presentation__line--current");
      old.classList.add("presentation__line--prior");
    }
    const line = document.createElement("p");
    line.className = `presentation__line presentation__line--current presentation__line--${kind}`;
    line.dataset.fullText = text;
    line.textContent = "";
    this.#root.append(line);

    const chars = Array.from(text);
    const generation = ++this.#generation;
    return new Promise<boolean>((resolve) => {
      this.#finish = resolve;
      let cursor = 0;
      const step = () => {
        if (generation !== this.#generation) return;
        if (cursor >= chars.length) {
          this.#finish = undefined;
          resolve(true);
          return;
        }
        line.textContent += chars[cursor++];
        this.#timer = this.#setTimer(step, this.#charMs);
      };
      // First character is painted synchronously: ARMED never shows a dead pause.
      step();
    });
  }

  abort(): void {
    this.#cancelTyping();
    this.#root.classList.add("presentation--aborting");
    const generation = ++this.#generation;
    this.#timer = this.#setTimer(() => {
      if (generation !== this.#generation) return;
      this.#root.replaceChildren();
      this.#root.classList.remove("presentation--aborting");
      this.#timer = undefined;
    }, this.#abortFadeMs);
  }

  reset(): void {
    this.#cancelTyping();
    this.#generation += 1;
    this.#root.classList.remove("presentation--aborting");
    this.#root.replaceChildren();
  }

  #cancelTyping(): void {
    if (this.#timer !== undefined) this.#clearTimer(this.#timer);
    this.#timer = undefined;
    this.#finish?.(false);
    this.#finish = undefined;
  }
}
