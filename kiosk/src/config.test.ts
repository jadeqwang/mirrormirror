import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_KIOSK_CONFIG, loadKioskConfig } from "./config.ts";

test("full config round-trips without changing contract fields", async () => {
  const expected = JSON.parse(JSON.stringify(DEFAULT_KIOSK_CONFIG));
  expected.cameras = { praise: "praise-serial", roast: "roast-serial" };
  const config = await loadKioskConfig(async () => new Response(JSON.stringify(expected), { status: 200 }));
  assert.deepEqual(config, expected);
});

test("partial config falls back field by field", async () => {
  const config = await loadKioskConfig(async () => Response.json({ video: { fps: 20 }, timing: { char_ms: 0 }, detection: { threshold: 9 } }));
  assert.equal(config.video.fps, 20);
  assert.equal(config.video.width, DEFAULT_KIOSK_CONFIG.video.width);
  assert.equal(config.timing.char_ms, 0);
  assert.equal(config.detection.threshold, DEFAULT_KIOSK_CONFIG.detection.threshold);
});

test("failed device config tries example and never throws", async () => {
  const paths: string[] = [];
  const config = await loadKioskConfig(async (input) => {
    paths.push(String(input));
    if (String(input) === "/config.json") throw new Error("offline");
    return Response.json({ rearm_key: "F10" });
  });
  assert.deepEqual(paths, ["/config.json", "/config.example.json"]);
  assert.equal(config.rearm_key, "F10");
});
