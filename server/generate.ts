import { readFile } from "node:fs/promises";

export type Screen = "praise" | "roast";

export interface Beat {
  screen: Screen;
  text: string;
}

export interface Person {
  descriptor: string;
  palette: string;
  formality: string;
  coherence: string;
}

export interface GenerationEnvelope {
  source: "generated" | "offline" | "error";
  people: Person[];
  group_size: number;
  beats: [Beat, Beat, Beat, Beat];
}

export interface ModelCall {
  frame: Uint8Array;
  mimeType: "image/jpeg";
  hintGroupSize?: boolean;
  /** The provider must return the model's raw structured-output JSON text. */
  schema: typeof ORDERED_GENERATION_SCHEMA;
}

export type GenerateStructured = (call: ModelCall) => Promise<string>;

export interface GenerationDependencies {
  generateStructured: GenerateStructured;
  offlinePool: readonly unknown[];
  denylist: readonly RegExp[];
  timeoutMs?: number;
  logSkip?: (reason: string) => void;
  random?: () => number;
}

/**
 * Property insertion order is intentional. Providers that support strict JSON
 * schemas must receive this object unchanged: gate fields precede `beats`.
 */
export const ORDERED_GENERATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["people", "group_size", "skip", "skip_reason", "beats"],
  properties: {
    people: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["descriptor", "palette", "formality", "coherence"],
        properties: {
          descriptor: { type: "string" },
          palette: { type: "string" },
          formality: { type: "string" },
          coherence: { type: "string" },
        },
      },
    },
    group_size: { type: "integer", minimum: 0 },
    skip: { type: "boolean" },
    skip_reason: { type: ["string", "null"] },
    beats: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["screen", "text"],
        properties: {
          screen: { type: "string", enum: ["praise", "roast"] },
          text: { type: "string" },
        },
      },
    },
  },
} as const;

type GateResult =
  | { skip: true; skipReason: string }
  | { skip: false; people: Person[]; groupSize: number; beats: [Beat, Beat, Beat, Beat] };

/**
 * Reads top-level values in schema order. Crucially, when `skip` is true the
 * beats value is never JSON-parsed, validated, logged, or returned.
 */
export function parseGateBeforeBeats(raw: string): GateResult {
  const fields = scanTopLevelFields(raw);
  const expected = ["people", "group_size", "skip", "skip_reason", "beats"];
  if (fields.length !== expected.length || fields.some((field, i) => field.key !== expected[i])) {
    throw new Error("model output fields are missing or out of safety order");
  }

  const peopleValue = parseJsonValue(fields[0].raw, "people");
  const groupSizeValue = parseJsonValue(fields[1].raw, "group_size");
  const skipValue = parseJsonValue(fields[2].raw, "skip");
  if (typeof skipValue !== "boolean") throw new Error("skip must be boolean");

  // Do not touch fields[4] on this branch. This is the safety boundary.
  if (skipValue) {
    const reason = parseJsonValue(fields[3].raw, "skip_reason");
    return { skip: true, skipReason: typeof reason === "string" ? reason : "model_gate" };
  }

  const skipReason = parseJsonValue(fields[3].raw, "skip_reason");
  if (skipReason !== null) throw new Error("skip_reason must be null when skip is false");
  const beatsValue = parseJsonValue(fields[4].raw, "beats");
  return {
    skip: false,
    people: validatePeople(peopleValue),
    groupSize: validateGroupSize(groupSizeValue),
    beats: validateBeats(beatsValue),
  };
}

export function compileDenylist(entries: readonly unknown[]): RegExp[] {
  return entries.map((entry, index) => {
    if (typeof entry === "string") return new RegExp(entry, "iu");
    if (entry && typeof entry === "object" && typeof (entry as { pattern?: unknown }).pattern === "string") {
      const item = entry as { pattern: string; flags?: unknown };
      const flags = typeof item.flags === "string" ? item.flags : "iu";
      return new RegExp(item.pattern, flags.includes("u") ? flags : `${flags}u`);
    }
    throw new Error(`invalid deny-list entry at index ${index}`);
  });
}

export async function loadDenylist(path = "content/denylist.json"): Promise<RegExp[]> {
  const data = JSON.parse(await readFile(path, "utf8"));
  const entries = Array.isArray(data) ? data : data?.patterns;
  if (!Array.isArray(entries)) throw new Error("deny-list must be an array or { patterns: [] }");
  return compileDenylist(entries);
}

export async function loadOfflinePool(path = "content/offline-pool.json"): Promise<GenerationEnvelope[]> {
  const data = JSON.parse(await readFile(path, "utf8"));
  const entries = Array.isArray(data) ? data : data?.conversations;
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("offline pool is empty or invalid");
  return entries.map((entry) => toOfflineEnvelope(entry));
}

export function createGenerationHandler(deps: GenerationDependencies) {
  if (deps.offlinePool.length === 0) throw new Error("offline pool must not be empty");
  const offline = deps.offlinePool.map(toOfflineEnvelope);
  const random = deps.random ?? Math.random;
  const timeoutMs = deps.timeoutMs ?? 5_500;

  return async function handleGenerate(request: Request): Promise<Response> {
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ error: "invalid_multipart" }, 400);
    }
    const frame = form.get("frame");
    if (!(frame instanceof Blob) || frame.type !== "image/jpeg") {
      return json({ error: "frame_must_be_jpeg" }, 400);
    }

    // The only frame copy lives in request memory and this local byte buffer.
    // It is never written or included in diagnostics.
    const bytes = new Uint8Array(await frame.arrayBuffer());
    if (bytes.byteLength === 0) return json({ error: "empty_frame" }, 400);
    const hint = parseOptionalBoolean(form.get("hint_group_size"));

    try {
      const raw = await withTimeout(
        deps.generateStructured({
          frame: bytes,
          mimeType: "image/jpeg",
          ...(hint === undefined ? {} : { hintGroupSize: hint }),
          schema: ORDERED_GENERATION_SCHEMA,
        }),
        timeoutMs,
      );
      const gated = parseGateBeforeBeats(raw);
      if (gated.skip === true) {
        deps.logSkip?.(gated.skipReason);
        return json(pickOffline(offline, random));
      }
      if (gated.beats.some((beat) => deps.denylist.some((pattern) => matches(pattern, beat.text)))) {
        deps.logSkip?.("denylist");
        return json(pickOffline(offline, random));
      }
      return json({
        source: "generated",
        people: gated.people,
        group_size: gated.groupSize,
        beats: gated.beats,
      } satisfies GenerationEnvelope);
    } catch (error) {
      // Errors contain no frame bytes. Leave fallback selection to the kiosk so
      // a server fault remains distinguishable from a deliberate safety skip.
      return json({ error: "generation_failed" }, error instanceof TimeoutError ? 504 : 502);
    }
  };
}

function scanTopLevelFields(raw: string): Array<{ key: string; raw: string }> {
  let i = skipSpace(raw, 0);
  if (raw[i++] !== "{") throw new Error("model output must be an object");
  const fields: Array<{ key: string; raw: string }> = [];
  while (true) {
    i = skipSpace(raw, i);
    if (raw[i] === "}") {
      i = skipSpace(raw, i + 1);
      if (i !== raw.length) throw new Error("trailing model output");
      return fields;
    }
    const keyEnd = scanString(raw, i);
    const key = JSON.parse(raw.slice(i, keyEnd));
    i = skipSpace(raw, keyEnd);
    if (raw[i++] !== ":") throw new Error("invalid model object");
    i = skipSpace(raw, i);
    const valueStart = i;
    i = scanValue(raw, i);
    fields.push({ key, raw: raw.slice(valueStart, i) });
    i = skipSpace(raw, i);
    if (raw[i] === ",") {
      i += 1;
      continue;
    }
    if (raw[i] !== "}") throw new Error("invalid model object separator");
  }
}

function scanValue(text: string, start: number): number {
  const first = text[start];
  if (first === '"') return scanString(text, start);
  if (first === "{" || first === "[") {
    const stack = [first];
    let inString = false;
    let escaped = false;
    for (let i = start + 1; i < text.length; i += 1) {
      const char = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "{" || char === "[") stack.push(char);
      else if (char === "}" || char === "]") {
        const open = stack.pop();
        if ((open === "{" && char !== "}") || (open === "[" && char !== "]")) throw new Error("mismatched JSON");
        if (stack.length === 0) return i + 1;
      }
    }
    throw new Error("unterminated JSON value");
  }
  let i = start;
  while (i < text.length && !/[\s,}]/u.test(text[i])) i += 1;
  if (i === start) throw new Error("missing JSON value");
  return i;
}

function scanString(text: string, start: number): number {
  if (text[start] !== '"') throw new Error("expected JSON string");
  let escaped = false;
  for (let i = start + 1; i < text.length; i += 1) {
    if (escaped) escaped = false;
    else if (text[i] === "\\") escaped = true;
    else if (text[i] === '"') return i + 1;
  }
  throw new Error("unterminated JSON string");
}

function skipSpace(text: string, start: number): number {
  let i = start;
  while (/\s/u.test(text[i] ?? "")) i += 1;
  return i;
}

function parseJsonValue(raw: string, name: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`invalid ${name}`);
  }
}

function validatePeople(value: unknown): Person[] {
  if (!Array.isArray(value)) throw new Error("people must be an array");
  return value.map((person) => {
    if (!person || typeof person !== "object") throw new Error("invalid person");
    const candidate = person as Record<string, unknown>;
    for (const key of ["descriptor", "palette", "formality", "coherence"] as const) {
      if (typeof candidate[key] !== "string") throw new Error(`invalid person.${key}`);
    }
    return candidate as unknown as Person;
  });
}

function validateGroupSize(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error("invalid group_size");
  return value as number;
}

function validateBeats(value: unknown): [Beat, Beat, Beat, Beat] {
  if (!Array.isArray(value) || value.length !== 4) throw new Error("beats must contain exactly four entries");
  const beats = value.map((beat) => {
    if (!beat || typeof beat !== "object") throw new Error("invalid beat");
    const candidate = beat as Record<string, unknown>;
    if ((candidate.screen !== "praise" && candidate.screen !== "roast") || typeof candidate.text !== "string" || candidate.text.trim() === "") {
      throw new Error("invalid beat fields");
    }
    return { screen: candidate.screen, text: candidate.text } as Beat;
  });
  return beats as [Beat, Beat, Beat, Beat];
}

function toOfflineEnvelope(value: unknown): GenerationEnvelope {
  const candidate = value as Record<string, unknown>;
  const beatsValue = Array.isArray(value) ? value : candidate?.beats;
  return { source: "offline", people: [], group_size: 0, beats: validateBeats(beatsValue) };
}

function pickOffline(pool: readonly GenerationEnvelope[], random: () => number): GenerationEnvelope {
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)));
  return pool[index];
}

function matches(pattern: RegExp, text: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(text);
}

function parseOptionalBoolean(value: FormDataEntryValue | null): boolean | undefined {
  if (value === null || value === "") return undefined;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return undefined;
}

class TimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError("generation timed out")), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}
