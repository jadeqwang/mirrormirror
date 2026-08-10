import type { Roi } from "./detect/model";
import type { GradeConfig, ScreenRole, VideoConfig } from "./video";

export interface KioskConfig {
  cameras: Record<ScreenRole, string>;
  video: VideoConfig;
  grade: GradeConfig;
  detection: { roi: Roi; sample_fps: number; enter_frames: number; exit_frames: number; threshold: number };
  timing: { settle_ms: number; spent_empty_ms: number; char_ms: number; beat_gap_ms: number; generation_timeout_ms: number };
  rearm_key: string;
}

export const DEFAULT_KIOSK_CONFIG: KioskConfig = {
  cameras: { praise: "", roast: "" },
  video: { width: 1280, height: 720, fps: 24 },
  grade: { saturate: 1.15, contrast: 1.05, brightness: 1.05, sepia: 0.12, vignette: 0.35, bloom: 0.25, softfocus: 0.3 },
  detection: {
    roi: [[0.2, 0.15], [0.8, 0.15], [0.95, 0.95], [0.05, 0.95]],
    sample_fps: 4,
    enter_frames: 4,
    exit_frames: 8,
    threshold: 0.08,
  },
  timing: { settle_ms: 1500, spent_empty_ms: 4500, char_ms: 35, beat_gap_ms: 900, generation_timeout_ms: 6000 },
  rearm_key: "F9",
};

/** Tries /config.json, then /config.example.json, then built-in defaults. Never throws. */
export async function loadKioskConfig(fetchImpl: typeof globalThis.fetch = globalThis.fetch): Promise<KioskConfig> {
  for (const path of ["/config.json", "/config.example.json"]) {
    try {
      const response = await fetchImpl(path, { cache: "no-store" });
      if (!response.ok) continue;
      return parseKioskConfig(await response.json());
    } catch {
      // A missing, malformed, or temporarily unavailable device config is not fatal.
    }
  }
  return cloneDefaults();
}

function parseKioskConfig(value: unknown): KioskConfig {
  const root = record(value);
  const cameras = record(root.cameras);
  const video = record(root.video);
  const grade = record(root.grade);
  const detection = record(root.detection);
  const timing = record(root.timing);
  return {
    cameras: {
      praise: stringValue(cameras.praise, DEFAULT_KIOSK_CONFIG.cameras.praise),
      roast: stringValue(cameras.roast, DEFAULT_KIOSK_CONFIG.cameras.roast),
    },
    video: {
      width: positiveNumber(video.width, DEFAULT_KIOSK_CONFIG.video.width),
      height: positiveNumber(video.height, DEFAULT_KIOSK_CONFIG.video.height),
      fps: positiveNumber(video.fps, DEFAULT_KIOSK_CONFIG.video.fps),
    },
    grade: {
      saturate: nonNegativeNumber(grade.saturate, DEFAULT_KIOSK_CONFIG.grade.saturate),
      contrast: nonNegativeNumber(grade.contrast, DEFAULT_KIOSK_CONFIG.grade.contrast),
      brightness: nonNegativeNumber(grade.brightness, DEFAULT_KIOSK_CONFIG.grade.brightness),
      sepia: nonNegativeNumber(grade.sepia, DEFAULT_KIOSK_CONFIG.grade.sepia),
      vignette: nonNegativeNumber(grade.vignette, DEFAULT_KIOSK_CONFIG.grade.vignette),
      bloom: nonNegativeNumber(grade.bloom, DEFAULT_KIOSK_CONFIG.grade.bloom),
      softfocus: nonNegativeNumber(grade.softfocus, DEFAULT_KIOSK_CONFIG.grade.softfocus),
    },
    detection: {
      roi: roiValue(detection.roi, DEFAULT_KIOSK_CONFIG.detection.roi),
      sample_fps: positiveNumber(detection.sample_fps, DEFAULT_KIOSK_CONFIG.detection.sample_fps),
      enter_frames: positiveInteger(detection.enter_frames, DEFAULT_KIOSK_CONFIG.detection.enter_frames),
      exit_frames: positiveInteger(detection.exit_frames, DEFAULT_KIOSK_CONFIG.detection.exit_frames),
      threshold: unitNumber(detection.threshold, DEFAULT_KIOSK_CONFIG.detection.threshold),
    },
    timing: {
      settle_ms: nonNegativeNumber(timing.settle_ms, DEFAULT_KIOSK_CONFIG.timing.settle_ms),
      spent_empty_ms: nonNegativeNumber(timing.spent_empty_ms, DEFAULT_KIOSK_CONFIG.timing.spent_empty_ms),
      char_ms: nonNegativeNumber(timing.char_ms, DEFAULT_KIOSK_CONFIG.timing.char_ms),
      beat_gap_ms: nonNegativeNumber(timing.beat_gap_ms, DEFAULT_KIOSK_CONFIG.timing.beat_gap_ms),
      generation_timeout_ms: positiveNumber(timing.generation_timeout_ms, DEFAULT_KIOSK_CONFIG.timing.generation_timeout_ms),
    },
    rearm_key: stringValue(root.rearm_key, DEFAULT_KIOSK_CONFIG.rearm_key),
  };
}

function cloneDefaults(): KioskConfig {
  return parseKioskConfig(DEFAULT_KIOSK_CONFIG);
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function stringValue(value: unknown, fallback: string): string { return typeof value === "string" ? value : fallback; }
function finiteNumber(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function positiveNumber(value: unknown, fallback: number): number { return finiteNumber(value) && value > 0 ? value : fallback; }
function nonNegativeNumber(value: unknown, fallback: number): number { return finiteNumber(value) && value >= 0 ? value : fallback; }
function positiveInteger(value: unknown, fallback: number): number { return finiteNumber(value) && Number.isInteger(value) && value > 0 ? value : fallback; }
function unitNumber(value: unknown, fallback: number): number { return finiteNumber(value) && value >= 0 && value <= 1 ? value : fallback; }
function roiValue(value: unknown, fallback: Roi): Roi {
  if (!Array.isArray(value) || value.length !== 4) return fallback.map((point) => [...point]) as unknown as Roi;
  const points = value.map((point) => Array.isArray(point) && point.length === 2 && point.every((coordinate) => finiteNumber(coordinate) && coordinate >= 0 && coordinate <= 1) ? [point[0], point[1]] as const : undefined);
  return points.every((point) => point !== undefined) ? points as unknown as Roi : fallback.map((point) => [...point]) as unknown as Roi;
}
