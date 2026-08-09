export type GenerationBeat = { screen: "praise" | "roast"; text: string };

export interface GenerationEnvelope {
  source: "generated" | "offline" | "error";
  people: Array<{ descriptor: string; palette: string; formality: string; coherence: string }>;
  group_size: number;
  beats: [GenerationBeat, GenerationBeat, GenerationBeat, GenerationBeat];
}

export interface GenerationClientOptions {
  endpoint?: string;
  offlinePoolUrl?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  random?: () => number;
  jpegQuality?: number;
}

export class OfflineConversationPool {
  readonly #conversations: GenerationEnvelope[];
  readonly #random: () => number;
  #queue: number[] = [];
  #lastIndex: number | undefined;

  constructor(values: readonly unknown[], random: () => number = Math.random) {
    if (values.length === 0) throw new Error("offline conversation pool is empty");
    this.#conversations = values.map(normalizeOffline);
    this.#random = random;
  }

  next(source: "offline" | "error" = "offline"): GenerationEnvelope {
    if (this.#queue.length === 0) this.#refill();
    const index = this.#queue.shift()!;
    this.#lastIndex = index;
    return { ...this.#conversations[index], source };
  }

  #refill(): void {
    this.#queue = this.#conversations.map((_, index) => index);
    for (let i = this.#queue.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.#random() * (i + 1));
      [this.#queue[i], this.#queue[j]] = [this.#queue[j], this.#queue[i]];
    }
    if (this.#queue.length > 1 && this.#queue[0] === this.#lastIndex) {
      [this.#queue[0], this.#queue[1]] = [this.#queue[1], this.#queue[0]];
    }
  }
}

export async function loadOfflinePool(
  url = "/content/offline-pool.json",
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  random: () => number = Math.random,
): Promise<OfflineConversationPool> {
  const response = await fetchImpl(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(`offline pool load failed (${response.status})`);
  const data = await response.json();
  const conversations = Array.isArray(data) ? data : data?.conversations;
  if (!Array.isArray(conversations)) throw new Error("offline pool has invalid shape");
  return new OfflineConversationPool(conversations, random);
}

/** Capture is encoded to a Blob only; no data URL, persistence, or logging. */
export async function captureJpeg(video: HTMLVideoElement, quality = 0.82): Promise<Blob> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (width <= 0 || height <= 0) throw new Error("video has no decodable frame");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("2d canvas unavailable");
  context.drawImage(video, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  // Drop backing pixels promptly; the returned compressed Blob remains memory-only.
  canvas.width = 0;
  canvas.height = 0;
  if (!blob || blob.type !== "image/jpeg") throw new Error("JPEG encoding failed");
  return blob;
}

export class GenerationClient {
  readonly #endpoint: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof globalThis.fetch;
  readonly #offline: OfflineConversationPool;
  readonly #jpegQuality: number;

  constructor(offline: OfflineConversationPool, options: GenerationClientOptions = {}) {
    this.#offline = offline;
    this.#endpoint = options.endpoint ?? "/generate";
    this.#timeoutMs = options.timeoutMs ?? 6_000;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#jpegQuality = options.jpegQuality ?? 0.82;
  }

  /** Called by the conductor on ARMED entry. Always resolves to four safe beats. */
  async generate(video: HTMLVideoElement, hintGroupSize?: boolean): Promise<GenerationEnvelope> {
    try {
      const frame = await captureJpeg(video, this.#jpegQuality);
      return await this.generateFromFrame(frame, hintGroupSize);
    } catch {
      return this.#offline.next("error");
    }
  }

  async generateFromFrame(frame: Blob, hintGroupSize?: boolean): Promise<GenerationEnvelope> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const form = new FormData();
      form.append("frame", frame, "frame.jpg");
      if (hintGroupSize !== undefined) form.append("hint_group_size", String(hintGroupSize));
      const response = await this.#fetch(this.#endpoint, {
        method: "POST",
        body: form,
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`generation failed (${response.status})`);
      return validateEnvelope(await response.json());
    } catch {
      return this.#offline.next("error");
    } finally {
      clearTimeout(timer);
    }
  }
}

export function validateEnvelope(value: unknown): GenerationEnvelope {
  if (!value || typeof value !== "object") throw new Error("invalid generation envelope");
  const candidate = value as Record<string, unknown>;
  if (candidate.source !== "generated" && candidate.source !== "offline" && candidate.source !== "error") {
    throw new Error("invalid envelope source");
  }
  if (!Array.isArray(candidate.people) || !Number.isInteger(candidate.group_size) || (candidate.group_size as number) < 0) {
    throw new Error("invalid envelope metadata");
  }
  for (const person of candidate.people) {
    if (!person || typeof person !== "object") throw new Error("invalid person metadata");
    const item = person as Record<string, unknown>;
    if (["descriptor", "palette", "formality", "coherence"].some((key) => typeof item[key] !== "string")) {
      throw new Error("invalid person metadata");
    }
  }
  const beats = validateBeatArray(candidate.beats);
  return { ...candidate, beats } as unknown as GenerationEnvelope;
}

function validateBeatArray(value: unknown): [GenerationBeat, GenerationBeat, GenerationBeat, GenerationBeat] {
  if (!Array.isArray(value) || value.length !== 4) throw new Error("envelope must have exactly four beats");
  const beats = value.map((beat) => {
    if (!beat || typeof beat !== "object") throw new Error("invalid beat");
    const item = beat as Record<string, unknown>;
    if ((item.screen !== "praise" && item.screen !== "roast") || typeof item.text !== "string" || item.text.trim() === "") {
      throw new Error("invalid beat");
    }
    return { screen: item.screen, text: item.text } as GenerationBeat;
  });
  return beats as [GenerationBeat, GenerationBeat, GenerationBeat, GenerationBeat];
}

function normalizeOffline(value: unknown): GenerationEnvelope {
  const candidate = value as Record<string, unknown>;
  const beats = validateBeatArray(Array.isArray(value) ? value : candidate?.beats);
  return { source: "offline", people: [], group_size: 0, beats };
}
