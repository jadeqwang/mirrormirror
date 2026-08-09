import assert from "node:assert/strict";
import test from "node:test";
import { OccupancyModel, rasterizeRoi, type Roi } from "./model.ts";

const full: Roi = [[0, 0], [1, 0], [1, 1], [0, 1]];
function frame(value: number, width = 4, height = 4): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([value, value, value, 255], i);
  return pixels;
}

test("ROI rasterizer excludes pixels outside a trapezoid", () => {
  const mask = rasterizeRoi([[0.25, 0], [0.75, 0], [1, 1], [0, 1]], 20, 20);
  const covered = mask.reduce((sum, value) => sum + value, 0);
  assert.ok(covered > 200 && covered < 400);
});

test("gate applies consecutive-frame hysteresis to both edges", () => {
  const model = new OccupancyModel({ width: 4, height: 4, roi: full, threshold: 0.5, enterFrames: 2, exitFrames: 3, backgroundAlpha: 0, pixelThreshold: 10 });
  model.sample(frame(0));
  assert.equal(model.sample(frame(255)).occupied, false);
  assert.equal(model.sample(frame(255)).occupied, true);
  assert.equal(model.sample(frame(0)).occupied, true);
  assert.equal(model.sample(frame(0)).occupied, true);
  const exited = model.sample(frame(0));
  assert.equal(exited.occupied, false);
  assert.equal(exited.changed, true);
});

test("freezing prevents a performing subject from entering the background", () => {
  const model = new OccupancyModel({ width: 4, height: 4, roi: full, threshold: 0.5, enterFrames: 1, exitFrames: 1, backgroundAlpha: 1, pixelThreshold: 10 });
  model.sample(frame(0));
  model.setFrozen(true);
  for (let i = 0; i < 5; i += 1) assert.equal(model.sample(frame(255)).occupied, true);
  assert.equal(model.sample(frame(0)).occupied, false);
});
