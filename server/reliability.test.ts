import assert from "node:assert/strict";
import test from "node:test";
import { createGenerationHandler } from "./generate.ts";
import { createMockGenerator } from "./mock-model.ts";

const offline = [{ beats: [
  { screen: "praise", text: "The fallback notices that we are all still here." },
  { screen: "roast", text: "It is making a very ambitious assumption about attention." },
  { screen: "praise", text: "Attention stayed, so the fallback gets partial credit." },
  { screen: "roast", text: "Partial credit is still its strongest review today." },
] }];

function request(caseName: string): Request {
  const form = new FormData();
  form.set("frame", new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }), "frame.jpg");
  return new Request("http://localhost/generate", { method: "POST", headers: { "x-mock-generation": caseName }, body: form });
}

test("mock skip enters the model gate and never exposes sentinel text", async () => {
  const incoming = request("skip");
  const handler = createGenerationHandler({
    generateStructured: createMockGenerator({ url: incoming.url, headers: { "x-mock-generation": "skip" } }),
    offlinePool: offline, denylist: [], random: () => 0,
  });
  const response = await handler(incoming);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.doesNotMatch(text, /SENTINEL/);
  assert.equal(JSON.parse(text).source, "offline");
});

test("normal mock is adapted from kiosk fixture to ordered model output", async () => {
  const incoming = request("normal");
  const handler = createGenerationHandler({
    generateStructured: createMockGenerator({ url: incoming.url, headers: { "x-mock-generation": "normal" } }),
    offlinePool: offline, denylist: [],
  });
  const response = await handler(incoming);
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { source: string }).source, "generated");
});
