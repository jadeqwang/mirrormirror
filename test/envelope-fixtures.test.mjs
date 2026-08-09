import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const fixtures = new URL("../fixtures/envelopes/", import.meta.url);
const read = async (name) => JSON.parse(await readFile(new URL(`${name}.json`, fixtures), "utf8"));

test("normal envelope satisfies the frozen kiosk contract", async () => {
  assertValidEnvelope(await read("normal"));
});

test("slow case contains a valid delayed response beyond the six-second deadline", async () => {
  const fixture = await read("slow");
  assert.ok(fixture.delay_ms > 6000);
  assertValidEnvelope(fixture.response);
});

test("malformed case is rejected by the contract validator", async () => {
  const fixture = await read("malformed");
  assert.throws(() => assertValidEnvelope(fixture));
});

test("skip sentinel makes accidental beat forwarding observable", async () => {
  const fixture = await read("skip");
  assert.equal(fixture.skip, true);
  assert.match(fixture.beats[0].text, /SENTINEL/);
});

function assertValidEnvelope(value) {
  assert.ok(value && typeof value === "object");
  assert.ok(["generated", "offline", "error"].includes(value.source));
  assert.ok(Number.isInteger(value.group_size) && value.group_size >= 0);
  assert.ok(Array.isArray(value.people));
  assert.equal(value.beats?.length, 4);
  for (const beat of value.beats) {
    assert.ok(beat.screen === "praise" || beat.screen === "roast");
    assert.equal(typeof beat.text, "string");
    assert.ok(beat.text.length > 0);
  }
}
