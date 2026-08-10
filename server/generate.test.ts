import assert from "node:assert/strict";
import test from "node:test";
import {
  compileDenylist,
  createGenerationHandler,
  ORDERED_GENERATION_SCHEMA,
  parseGateBeforeBeats,
} from "./generate.ts";

const beats = [
  { screen: "praise", text: "One mirror sees a plan arriving right on schedule." },
  { screen: "roast", text: "I see confidence asking the room for directions." },
  { screen: "praise", text: "That plan still has better timing than your assessment." },
  { screen: "roast", text: "Then it can explain why both mirrors look concerned." },
];

const offline = [{ beats: beats.map((beat) => ({ ...beat, text: `Offline: ${beat.text}` })) }];

function raw(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    group_size: 1,
    people: [{ coherence: "high", descriptor: "the one in blue", formality: "casual", palette: "blue" }],
    skip: false,
    skip_reason: null,
    speech: beats,
    ...overrides,
  });
}

function request(): Request {
  const form = new FormData();
  form.append("frame", new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }), "frame.jpg");
  form.append("hint_group_size", "true");
  return new Request("http://localhost/generate", { method: "POST", body: form });
}

test("ordered schema keeps all gate fields before the lines", () => {
  assert.deepEqual(Object.keys(ORDERED_GENERATION_SCHEMA.properties), [
    "group_size", "people", "skip", "skip_reason", "speech",
  ]);
});

test("schema order survives a provider that sorts keys alphabetically", () => {
  // Workers AI does exactly this, which is why `speech` is not called `beats`.
  const keys = Object.keys(ORDERED_GENERATION_SCHEMA.properties);
  assert.deepEqual([...keys].sort(), keys, "gate fields must still sort before the lines");
  assert.equal(keys.at(-1), "speech");
  for (const person of [Object.keys(ORDERED_GENERATION_SCHEMA.properties.speech.items.properties)]) {
    assert.deepEqual([...person].sort(), person);
  }
});

test("skip branch never parses malformed beat text", () => {
  const output = raw({ skip: true, skip_reason: "uniform" });
  const withUnreadInvalidBeats = output.replace(JSON.stringify(beats), "this-is-deliberately-not-json");
  assert.deepEqual(parseGateBeforeBeats(withUnreadInvalidBeats), { skip: true, skipReason: "uniform" });
});

test("out-of-order gate fields are rejected", () => {
  const outOfOrder = JSON.stringify({ speech: beats, group_size: 1, people: [], skip: true, skip_reason: "unsafe" });
  assert.throws(() => parseGateBeforeBeats(outOfOrder), /safety order/);
});

test("server substitutes offline beats on model gate without leaking generated beats", async () => {
  const reasons: string[] = [];
  const handler = createGenerationHandler({
    generateStructured: async () => raw({ skip: true, skip_reason: "medical_device", speech: [{ screen: "roast", text: "NEVER LEAK" }] }),
    offlinePool: offline,
    denylist: [],
    logSkip: (reason) => reasons.push(reason),
  });
  const response = await handler(request());
  const body = await response.json();
  assert.equal(body.source, "offline");
  assert.equal(JSON.stringify(body).includes("NEVER LEAK"), false);
  assert.deepEqual(reasons, ["medical_device"]);
});

test("deny-list hit is converted to an offline response", async () => {
  const handler = createGenerationHandler({
    generateStructured: async () => raw({ speech: beats.map((beat, index) => index === 2 ? { ...beat, text: "A forbidden wheelchair allusion" } : beat) }),
    offlinePool: offline,
    denylist: compileDenylist(["\\bwheelchairs?\\b"]),
  });
  const response = await handler(request());
  assert.equal((await response.json()).source, "offline");
});

test("valid generation returns the frozen envelope and forwards no image to logs", async () => {
  let receivedBytes = 0;
  let receivedHint: boolean | undefined;
  const handler = createGenerationHandler({
    generateStructured: async (call) => {
      receivedBytes = call.frame.byteLength;
      receivedHint = call.hintGroupSize;
      return raw();
    },
    offlinePool: offline,
    denylist: [],
  });
  const response = await handler(request());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.source, "generated");
  assert.equal(body.beats.length, 4);
  assert.equal(receivedBytes, 4);
  assert.equal(receivedHint, true);
});
