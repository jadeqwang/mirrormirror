import "./styles.css";
import {
  installVideoDebugOverlay,
  startVideoPipeline,
  type GradeConfig,
  type ScreenRole,
  type VideoPipelineConfig,
} from "./video";

const DEFAULT_CONFIG: VideoPipelineConfig = {
  cameras: { praise: "", roast: "" },
  video: { width: 1280, height: 720, fps: 24 },
  grade: {
    saturate: 1.15,
    contrast: 1.05,
    brightness: 1.05,
    sepia: 0.12,
    vignette: 0.35,
    bloom: 0.25,
    softfocus: 0.3,
  },
};

function roleFromLocation(location: Location): ScreenRole {
  const role = new URLSearchParams(location.search).get("screen");
  if (role === "praise" || role === "roast") return role;
  throw new Error('Missing or invalid "screen" query parameter (expected praise or roast)');
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function mergeGrade(value: unknown): GradeConfig {
  const source = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const fallback = DEFAULT_CONFIG.grade;
  return {
    saturate: finiteNumber(source.saturate, fallback.saturate),
    contrast: finiteNumber(source.contrast, fallback.contrast),
    brightness: finiteNumber(source.brightness, fallback.brightness),
    sepia: finiteNumber(source.sepia, fallback.sepia),
    vignette: finiteNumber(source.vignette, fallback.vignette),
    bloom: finiteNumber(source.bloom, fallback.bloom),
    softfocus: finiteNumber(source.softfocus, fallback.softfocus),
  };
}

function parseConfig(value: unknown): VideoPipelineConfig {
  const raw = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const cameras = typeof raw.cameras === "object" && raw.cameras !== null
    ? (raw.cameras as Record<string, unknown>)
    : {};
  const video = typeof raw.video === "object" && raw.video !== null
    ? (raw.video as Record<string, unknown>)
    : {};
  return {
    cameras: {
      praise: typeof cameras.praise === "string" ? cameras.praise : "",
      roast: typeof cameras.roast === "string" ? cameras.roast : "",
    },
    video: {
      width: finiteNumber(video.width, DEFAULT_CONFIG.video.width),
      height: finiteNumber(video.height, DEFAULT_CONFIG.video.height),
      fps: finiteNumber(video.fps, DEFAULT_CONFIG.video.fps),
    },
    grade: mergeGrade(raw.grade),
  };
}

async function loadConfig(): Promise<VideoPipelineConfig> {
  for (const path of ["/config.json", "/config.example.json"]) {
    try {
      const response = await fetch(path, { cache: "no-store" });
      if (response.ok) return parseConfig(await response.json());
    } catch {
      // Try the checked-in example, then fail with actionable camera guidance.
    }
  }
  return DEFAULT_CONFIG;
}

function shell(): { mirror: HTMLElement; status: HTMLElement } {
  document.body.replaceChildren();
  const app = document.createElement("main");
  app.id = "app";
  const mirror = document.createElement("section");
  mirror.id = "mirror";
  const text = document.createElement("section");
  text.id = "text-layers";
  text.className = "text-layers";
  text.setAttribute("aria-live", "polite");
  const status = document.createElement("div");
  status.className = "boot-status";
  status.textContent = "starting camera";
  app.append(mirror, text, status);
  document.body.append(app);
  return { mirror, status };
}

async function boot(): Promise<void> {
  const role = roleFromLocation(window.location);
  document.documentElement.dataset.screen = role;
  document.title = `Mirror Mirror — ${role}`;
  const { mirror, status } = shell();
  const config = await loadConfig();
  const pipeline = await startVideoPipeline(mirror, role, config);
  const video = mirror.querySelector<HTMLVideoElement>(".mirror__video--primary");
  if (!video) throw new Error("Primary video layer was not created");
  status.remove();

  if (new URLSearchParams(window.location.search).get("debug") === "1") {
    installVideoDebugOverlay(mirror, video, pipeline.track);
  }
  window.addEventListener("pagehide", () => pipeline.stop(), { once: true });
}

void boot().catch((error: unknown) => {
  console.error(error);
  const status = document.querySelector<HTMLElement>(".boot-status") ?? shell().status;
  status.classList.add("boot-status--error");
  status.textContent = error instanceof Error ? error.message : "Unable to start kiosk";
});
