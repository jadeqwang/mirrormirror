import "./styles.css";
import { loadKioskConfig, type KioskConfig } from "./config";
import { createBus, type Bus } from "./bus";
import { installVideoDebugOverlay, startVideoPipeline, type ScreenRole, type VideoPipeline } from "./video";
import { VideoOccupancyDetector } from "./detect";
import { installRoiEditor, loadStoredRoi, shouldEditRoi } from "./detect/roi-editor";
import { installRearmKey, PerformanceStateMachine } from "./state";
import { GenerationClient, loadOfflinePool, OfflineConversationPool, type GenerationEnvelope } from "./gen-client";
import { DomBeatView, installPresentationStyles, Presentation } from "./present";
import { installVideoStallWatchdog } from "./watchdog";

/**
 * Both windows load this file; `?screen=` picks the role.
 *
 * The praise window is the conductor: it owns the camera the detector samples,
 * the state machine, and the one generation call. The roast window is a
 * follower with no state beyond its own text layers — it renders the beats
 * addressed to it and reports when it has finished typing. All of that crosses
 * the §2.3 bus and nothing else does.
 */

/** Used only if `/content/preroll-pool.json` cannot be reached. */
const EMERGENCY_PREROLL = ["oh, hello"] as const;

/**
 * Used only if `/content/offline-pool.json` cannot be reached. One conversation,
 * deliberately: this exists so a content-serving fault degrades the piece
 * instead of preventing boot, not as a second copy of lane G's pool.
 */
const EMERGENCY_CONVERSATION = [
  { screen: "praise", text: "You arrived at exactly the right moment, which is a real talent." },
  { screen: "roast", text: "There is no right moment. We run continuously. That is the design." },
  { screen: "praise", text: "Continuous things still have better and worse moments. Yours are worse." },
  { screen: "roast", text: "Mine are honest. Yours are timed to whoever is standing in front." },
] as const;

function roleFromLocation(location: Location): ScreenRole {
  const role = new URLSearchParams(location.search).get("screen");
  if (role === "praise" || role === "roast") return role;
  throw new Error('Missing or invalid "screen" query parameter (expected praise or roast)');
}

function shell(): { mirror: HTMLElement; text: HTMLElement; status: HTMLElement } {
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
  return { mirror, text, status };
}

async function loadPreroll(): Promise<readonly string[]> {
  try {
    const response = await fetch("/content/preroll-pool.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(String(response.status));
    const data = await response.json();
    const lines: unknown = Array.isArray(data) ? data : data?.lines;
    const usable = Array.isArray(lines) ? lines.filter((line): line is string => typeof line === "string" && line.trim() !== "") : [];
    return usable.length ? usable : EMERGENCY_PREROLL;
  } catch {
    return EMERGENCY_PREROLL;
  }
}

async function loadFallbackPool(): Promise<OfflineConversationPool> {
  try {
    return await loadOfflinePool();
  } catch {
    // Never let a missing content file stop the piece from opening.
    console.error("offline pool unavailable; running on the emergency conversation");
    return new OfflineConversationPool([{ beats: EMERGENCY_CONVERSATION }]);
  }
}

/** The roast window: text layers and the bus, nothing else. */
function startFollower(config: KioskConfig, bus: Bus, text: HTMLElement, preroll: readonly string[]): () => void {
  const view = new DomBeatView(text, { charMs: config.timing.char_ms });
  const presentation = new Presentation({ role: "roast", view, bus, preroll, beatGapMs: config.timing.beat_gap_ms });
  return () => presentation.dispose();
}

/** The praise window: detection, the state machine, the one generation call. */
async function startConductor(
  config: KioskConfig,
  bus: Bus,
  text: HTMLElement,
  preroll: readonly string[],
  video: HTMLVideoElement,
): Promise<() => void> {
  const view = new DomBeatView(text, { charMs: config.timing.char_ms });
  const offline = await loadFallbackPool();
  const client = new GenerationClient(offline, { timeoutMs: config.timing.generation_timeout_ms });

  let detector: VideoOccupancyDetector | undefined;
  let machine!: PerformanceStateMachine<GenerationEnvelope>;

  const presentation = new Presentation({
    role: "praise",
    view,
    bus,
    preroll,
    beatGapMs: config.timing.beat_gap_ms,
  });

  machine = new PerformanceStateMachine<GenerationEnvelope>({
    settleMs: config.timing.settle_ms,
    spentEmptyMs: config.timing.spent_empty_ms,
    rearmKey: config.rearm_key,
    generate: () => client.generate(video),
    fallback: () => offline.next("error"),
    onReady: (envelope) => {
      void presentation.play(envelope).then((completed) => {
        // A cancelled run (abort/reset) already moved the machine on.
        if (completed) machine.complete();
      });
    },
    emit: (event) => {
      // BroadcastChannel does not echo to the sender, so the conductor's own
      // presentation has to be told directly as well as over the bus.
      bus.postMessage(event);
      presentation.handle(event);
    },
    // Spec §6: our own screens change brightness dramatically as text reveals,
    // and that light lands on the visitor and the back wall.
    freezeDetection: (frozen) => detector?.setFrozen(frozen),
  });

  const roi = loadStoredRoi(config.detection.roi);
  detector = new VideoOccupancyDetector(video, {
    roi,
    threshold: config.detection.threshold,
    enterFrames: config.detection.enter_frames,
    exitFrames: config.detection.exit_frames,
    sampleFps: config.detection.sample_fps,
    onSample: (sample) => { if (sample.changed) machine.setOccupied(sample.occupied); },
  });
  detector.start();

  const removeRearmKey = installRearmKey(machine);
  const closeRoiEditor = shouldEditRoi() ? installRoiEditor(video, roi) : undefined;

  return () => {
    closeRoiEditor?.();
    removeRearmKey();
    detector?.stop();
    machine.dispose();
    presentation.dispose();
  };
}

async function boot(): Promise<void> {
  const role = roleFromLocation(window.location);
  document.documentElement.dataset.screen = role;
  document.title = `Mirror Mirror — ${role}`;

  const { mirror, text, status } = shell();
  const removePresentationStyles = installPresentationStyles();
  const config = await loadKioskConfig();

  let pipeline: VideoPipeline;
  try {
    pipeline = await startVideoPipeline(mirror, role, config);
  } catch (error) {
    removePresentationStyles();
    throw error;
  }
  const video = mirror.querySelector<HTMLVideoElement>(".mirror__video--primary");
  if (!video) throw new Error("Primary video layer was not created");
  status.remove();

  const bus = createBus();
  const preroll = await loadPreroll();
  const teardown = role === "praise"
    ? await startConductor(config, bus, text, preroll, video)
    : startFollower(config, bus, text, preroll);

  const stopWatchdog = installVideoStallWatchdog(video);
  const stopOverlay = new URLSearchParams(window.location.search).get("debug") === "1"
    ? installVideoDebugOverlay(mirror, video, pipeline.track)
    : undefined;

  window.addEventListener("pagehide", () => {
    stopOverlay?.();
    stopWatchdog();
    teardown();
    bus.close();
    removePresentationStyles();
    pipeline.stop();
  }, { once: true });
}

void boot().catch((error: unknown) => {
  console.error(error);
  const status = document.querySelector<HTMLElement>(".boot-status") ?? shell().status;
  status.classList.add("boot-status--error");
  status.textContent = error instanceof Error ? error.message : "Unable to start kiosk";
});
