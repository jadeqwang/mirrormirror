import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fixtures = new URL("../../fixtures/envelopes/", import.meta.url);
const read = async (name) => JSON.parse(await readFile(new URL(`${name}.json`, fixtures), "utf8"));

/**
 * Registers the required parser checks. Lane C should call this from its test
 * with parseEnvelope(raw), where invalid input returns null or throws.
 */
export function envelopeParserSuite(test, parseEnvelope) {
  test("accepts a valid four-beat envelope", async () => {
    assert.deepEqual(parseEnvelope(await read("normal")), await read("normal"));
  });
  test("rejects malformed group size, routing, and beat count", async () => {
    let parsed;
    try { parsed = parseEnvelope(await read("malformed")); } catch { parsed = null; }
    assert.equal(parsed, null);
  });
}
