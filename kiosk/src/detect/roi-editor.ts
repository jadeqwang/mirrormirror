import type { Point, Roi } from "./model";

export const ROI_STORAGE_KEY = "mirrormirror.detection.roi";

export function loadStoredRoi(fallback: Roi): Roi {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(ROI_STORAGE_KEY) ?? "null");
    return isRoi(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/** Full-screen four-click calibration UI enabled only by `?roi=1`. */
export function installRoiEditor(video: HTMLVideoElement, initial: Roi, onSave?: (roi: Roi) => void): () => void {
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
      context.beginPath();
      points.forEach(([x, y], index) => index ? context.lineTo(x * canvas.width, y * canvas.height) : context.moveTo(x * canvas.width, y * canvas.height));
      if (points.length === 4) context.closePath();
      context.fillStyle = "rgba(0,180,255,.22)";
      context.fill();
      context.strokeStyle = "#00d8ff";
      context.lineWidth = 4;
      context.stroke();
      for (const [x, y] of points) {
        context.beginPath(); context.arc(x * canvas.width, y * canvas.height, 8, 0, Math.PI * 2); context.fillStyle = "white"; context.fill();
      }
    }
    instruction.textContent = points.length < 4 ? `Click corner ${points.length + 1} of 4, walking around the standing zone.` : "Region ready. Redraw if the blue shape crosses itself, then save and copy.";
    const roi = points.length === 4 ? points as unknown as Roi : undefined;
    output.value = roi ? JSON.stringify({ detection: { roi } }, null, 2) : "Place four corners to produce a config snippet.";
    save.disabled = copy.disabled = !roi;
  };
  const click = (event: MouseEvent) => {
    if (points.length === 4) points = [];
    points.push([clamp(event.clientX / canvas.width), clamp(event.clientY / canvas.height)]);
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
