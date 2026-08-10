import { test } from "node:test";
import assert from "node:assert/strict";
import { clientToSource, sourceToClient, type ViewportMapping } from "./roi-editor.ts";

/** Matched aspect ratios: the frame fills the element with no cropping. */
const matched: ViewportMapping = {
  rect: { left: 0, top: 0, width: 1920, height: 1080 },
  sourceWidth: 1280,
  sourceHeight: 720,
  mirrored: true,
};

/** 16:9 frame in a square element: cover crops the sides. */
const cropped: ViewportMapping = {
  rect: { left: 0, top: 0, width: 1000, height: 1000 },
  sourceWidth: 1600,
  sourceHeight: 900,
  mirrored: false,
};

// Stored ROI points are quantised to 4dp so the config snippet stays readable.
// That is ~0.13px at 1280 source width, well under the 160px sample grid.
const close = (actual: number, expected: number, message: string) =>
  assert.ok(Math.abs(actual - expected) <= 1e-4, `${message}: got ${actual}, want ${expected}`);

test("a click on screen-left lands on source-right when the display is mirrored", () => {
  // The whole point of the fix: the visitor and the detector disagree about
  // which side is which, and the ROI is stored in the detector's terms.
  const [x, y] = clientToSource(480, 540, matched);
  close(x, 0.75, "mirrored x");
  close(y, 0.5, "y");
});

test("centre maps to centre even when cover crops the frame", () => {
  const [x, y] = clientToSource(500, 500, cropped);
  close(x, 0.5, "x");
  close(y, 0.5, "y");
});

test("cover cropping is accounted for at the edges", () => {
  // The element's left edge is not the frame's left edge — 1600x900 scaled to
  // cover a 1000x1000 box overflows horizontally by 389px each side.
  const [x] = clientToSource(0, 500, cropped);
  close(x, 350 / 1600, "left edge of the element");
});

test("client and source coordinates round-trip in both mappings", () => {
  for (const mapping of [matched, cropped]) {
    for (const point of [[0.1, 0.2], [0.5, 0.5], [0.9, 0.85]] as const) {
      const [clientX, clientY] = sourceToClient(point, mapping);
      const [x, y] = clientToSource(clientX, clientY, mapping);
      close(x, point[0], "round-trip x");
      close(y, point[1], "round-trip y");
    }
  }
});

test("points outside the frame are clamped into range", () => {
  const [x, y] = clientToSource(-5000, -5000, matched);
  assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1, "clamped into 0..1");
});
