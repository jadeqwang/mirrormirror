import type { Point, Roi } from "./model";

export const ROI_STORAGE_KEY = "mirrormirror.detection.roi";

/**
 * The editor draws over what the visitor sees; the detector samples the raw
 * `<video>`. Two transforms sit between them and both must be undone, or the
 * region drawn on site gates on the wrong part of the frame:
 *
 *  1. the display is mirrored (`transform: scaleX(-1)`), so screen-left is
 *     source-right;
 *  2. `object-fit: cover` scales the frame to fill the element and crops the
 *     overflow, so screen space is not a uniform scaling of source space
 *     whenever the element and the frame disagree about aspect ratio.
 *
 * ROI points are stored in normalised *source* coordinates, which is what
 * `rasterizeRoi` expects.
 */
export interface ViewportMapping {
  rect: { left: number; top: number; width: number; height: number };
  sourceWidth: number;
  sourceHeight: number;
  mirrored: boolean;
}

function coverGeometry(mapping: ViewportMapping) {
  const scale = Math.max(mapping.rect.width / mapping.sourceWidth, mapping.rect.height / mapping.sourceHeight);
  return {
    scale,
    left: mapping.rect.left + (mapping.rect.width - mapping.sourceWidth * scale) / 2,
    top: mapping.rect.top + (mapping.rect.height - mapping.sourceHeight * scale) / 2,
  };
}

/** Screen (client) pixels → normalised source coordinates. */
export function clientToSource(x: number, y: number, mapping: ViewportMapping): Point {
  const { scale, left, top } = coverGeometry(mapping);
  let sourceX = (x - left) / scale;
  const sourceY = (y - top) / scale;
  if (mapping.mirrored) sourceX = mapping.sourceWidth - sourceX;
  return [clamp(sourceX / mapping.sourceWidth), clamp(sourceY / mapping.sourceHeight)];
}

/** Normalised source coordinates → screen (client) pixels. */
export function sourceToClient(point: Point, mapping: ViewportMapping): readonly [number, number] {
  const { scale, left, top } = coverGeometry(mapping);
  const sourceX = mapping.mirrored ? mapping.sourceWidth - point[0] * mapping.sourceWidth : point[0] * mapping.sourceWidth;
  return [left + sourceX * scale, top + point[1] * mapping.sourceHeight * scale];
}

export function loadStoredRoi(fallback: Roi): Roi {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(ROI_STORAGE_KEY) ?? "null");
    return isRoi(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/** Full-screen four-click calibration UI enabled only by `?roi=1`. */
export function installRoiEditor(
  video: HTMLVideoElement,
  initial: Roi,
  onSave?: (roi: Roi) => void,
  mirrored = true,
): () => void {
  const mapping = (): ViewportMapping => {
    const rect = video.getBoundingClientRect();
    return {
      rect,
      // Before loadedmetadata the frame size is unknown; fall back to the
      // element box so the overlay stays usable instead of dividing by zero.
      sourceWidth: video.videoWidth || rect.width || 1,
      sourceHeight: video.videoHeight || rect.height || 1,
      mirrored,
    };
  };
  const root = document.createElement("div");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Detection region editor");
  Object.assign(root.style, { position: "fixed", inset: "0", zIndex: "2147483647", background: "rgba(0,0,0,.25)", font: "16px system-ui", color: "white" });
  const canvas = document.createElement("canvas");
  Object.assign(canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", cursor: "crosshair" });
  const panel = document.createElement("div");
  Object.assign(panel.style, { position: "absolute", top: "16px", left: "16px", maxWidth: "520px", padding: "12px", background: "rgba(0,0,0,.85)", borderRadius: "6px" });
  const instruction = document.createElement("div");
  const output = document.createElement("textarea");
  output.readOnly = true;
  output.rows = 4;
  Object.assign(output.style, { display: "block", width: "480px", maxWidth: "80vw", margin: "8px 0", font: "13px monospace" });
  const reset = button("Redraw");
  const save = button("Save locally");
  const copy = button("Copy config snippet");
  const close = button("Close editor");
  panel.append(instruction, output, reset, save, copy, close);
  root.append(canvas, panel);
  document.body.append(root);

  let points: Point[] = initial.map((point) => [...point] as Point);
  const resize = () => { canvas.width = innerWidth; canvas.height = innerHeight; draw(); };
  const draw = () => {
    const context = canvas.getContext("2d")!;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (points.length) {
      const view = mapping();
      const screen = points.map((point) => sourceToClient(point, view));
      context.beginPath();
      screen.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
      if (points.length === 4) context.closePath();
      context.fillStyle = "rgba(0,180,255,.22)";
      context.fill();
      context.strokeStyle = "#00d8ff";
      context.lineWidth = 4;
      context.stroke();
      for (const [x, y] of screen) {
        context.beginPath(); context.arc(x, y, 8, 0, Math.PI * 2); context.fillStyle = "white"; context.fill();
      }
    }
    instruction.textContent = points.length < 4 ? `Click corner ${points.length + 1} of 4, walking around the standing zone.` : "Region ready. Redraw if the blue shape crosses itself, then save and copy.";
    const roi = points.length === 4 ? points as unknown as Roi : undefined;
    output.value = roi ? JSON.stringify({ detection: { roi } }, null, 2) : "Place four corners to produce a config snippet.";
    save.disabled = copy.disabled = !roi;
  };
  const click = (event: MouseEvent) => {
    if (points.length === 4) points = [];
    points.push(clientToSource(event.clientX, event.clientY, mapping()));
    draw();
  };
  const persist = () => {
    const roi = points as unknown as Roi;
    localStorage.setItem(ROI_STORAGE_KEY, JSON.stringify(roi));
    onSave?.(roi);
    instruction.textContent = "Saved in this browser. Copy the snippet into config.json for deployment.";
  };
  const copySnippet = async () => { await navigator.clipboard.writeText(output.value); instruction.textContent = "Config snippet copied."; };
  const dispose = () => { window.removeEventListener("resize", resize); root.remove(); video.focus(); };
  canvas.addEventListener("click", click);
  reset.addEventListener("click", () => { points = []; draw(); });
  save.addEventListener("click", persist);
  copy.addEventListener("click", () => void copySnippet());
  close.addEventListener("click", dispose);
  window.addEventListener("resize", resize);
  resize();
  return dispose;
}

export function shouldEditRoi(location: Location = window.location): boolean {
  return new URLSearchParams(location.search).get("roi") === "1";
}

function isRoi(value: unknown): value is Roi {
  return Array.isArray(value) && value.length === 4 && value.every((point) => Array.isArray(point) && point.length === 2 && point.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1));
}
function clamp(value: number): number { return Math.max(0, Math.min(1, Math.round(value * 10_000) / 10_000)); }
function button(label: string): HTMLButtonElement { const value = document.createElement("button"); value.textContent = label; value.style.marginRight = "8px"; return value; }
