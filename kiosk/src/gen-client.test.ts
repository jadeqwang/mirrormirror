import assert from "node:assert/strict";
import test from "node:test";
import { GenerationClient, OfflineConversationPool, validateEnvelope } from "./gen-client.ts";

function conversation(label: string) {
  return {
    beats: [
      { screen: "praise", text: `${label} praise one` },
      { screen: "roast", text: `${label} roast one` },
      { screen: "praise", text: `${label} praise two` },
      { screen: "roast", text: `${label} roast two` },
    ],
  };
}

test("offline pool is a no-repeat shuffle, including cycle boundaries", () => {
  const pool = new OfflineConversationPool([conversation("A"), conversation("B"), conversation("C")], () => 0);
  const seen = Array.from({ length: 7 }, () => pool.next().beats[0].text);
  for (let i = 1; i < seen.length; i += 1) assert.notEqual(seen[i], seen[i - 1]);
  assert.equal(new Set(seen.slice(0, 3)).size, 3);
  assert.equal(new Set(seen.slice(3, 6)).size, 3);
});

test("malformed server envelope becomes local error fallback", async () => {
  const offline = new OfflineConversationPool([conversation("safe")]);
  const fakeFetch = async () => Response.json({ source: "generated", people: [], group_size: 1, beats: [] });
  const client = new GenerationClient(offline, { fetch: fakeFetch as typeof fetch });
  const result = await client.generateFromFrame(new Blob(["jpeg"], { type: "image/jpeg" }));
  assert.equal(result.source, "error");
  assert.match(result.beats[0].text, /^safe/);
});

test("timeout aborts request and becomes local error fallback", async () => {
  const offline = new OfflineConversationPool([conversation("timeout-safe")]);
  const fakeFetch = (_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
  const client = new GenerationClient(offline, { fetch: fakeFetch as typeof fetch, timeoutMs: 5 });
  const result = await client.generateFromFrame(new Blob(["jpeg"], { type: "image/jpeg" }));
  assert.equal(result.source, "error");
});

test("valid frozen envelope passes kiosk verification", () => {
  const value = {
    source: "generated",
    people: [{ descriptor: "the one in blue", palette: "blue", formality: "casual", coherence: "high" }],
    group_size: 1,
    beats: conversation("generated").beats,
  };
  assert.deepEqual(validateEnvelope(value), value);
});
