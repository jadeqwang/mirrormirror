import { createMockCameraStream, mockCameraEnabled } from "./dev/mock-camera";

export type ScreenRole = "praise" | "roast";

export interface VideoConfig {
  width: number;
  height: number;
  fps: number;
}

export interface GradeConfig {
  saturate: number;
  contrast: number;
  brightness: number;
  sepia: number;
  vignette: number;
  bloom: number;
  softfocus: number;
}

export interface VideoPipelineConfig {
  cameras: Record<ScreenRole, string>;
  video: VideoConfig;
  grade: GradeConfig;
}

export interface VideoPipeline {
  stream: MediaStream;
  track: MediaStreamTrack;
  stop(): void;
}

interface VideoFrameMetadata {
  expectedDisplayTime?: number;
  processingDuration?: number;
  presentedFrames?: number;
  width?: number;
  height?: number;
}

type VideoFrameCallback = (now: number, metadata: VideoFrameMetadata) => void;
type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: VideoFrameCallback) => number;
};

const REQUIRED_FORMAT = "MJPEG";

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

/**
 * Browser deviceIds are opaque. With the kiosk profile's persistent camera
 * permission, labels are populated and a config value may be either the exact
 * deviceId or a stable serial/by-path substring exposed in the device label.
 * We deliberately never fall back to enumeration order.
 */
async function resolveCameraDeviceId(selector: string): Promise<string> {
  if (!selector.trim()) {
    throw new Error("Camera selector is empty; configure a deviceId or label serial/path");
  }

  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
    (device) => device.kind === "videoinput",
  );
  const wanted = normalize(selector);
  const exact = devices.find((device) => device.deviceId === selector);
  if (exact) return exact.deviceId;

  const labelMatches = devices.filter((device) => normalize(device.label).includes(wanted));
  if (labelMatches.length === 1) return labelMatches[0].deviceId;
  if (labelMatches.length > 1) {
    throw new Error(`Camera selector ${JSON.stringify(selector)} matches multiple devices`);
  }

  const permissionHint = devices.some((device) => !device.label)
    ? " Camera labels are hidden; grant persistent camera permission to the kiosk profile."
    : "";
  throw new Error(`Configured camera ${JSON.stringify(selector)} was not found.${permissionHint}`);
}

function setGradeVariables(root: HTMLElement, grade: GradeConfig): void {
  root.style.setProperty("--grade-saturate", String(grade.saturate));
  root.style.setProperty("--grade-contrast", String(grade.contrast));
  root.style.setProperty("--grade-brightness", String(grade.brightness));
  root.style.setProperty("--grade-sepia", String(grade.sepia));
  root.style.setProperty("--grade-vignette", String(grade.vignette));
  root.style.setProperty("--grade-bloom", String(grade.bloom));
  root.style.setProperty("--grade-softfocus", String(grade.softfocus));
}

function buildVideoLayers(host: HTMLElement, role: ScreenRole): HTMLVideoElement {
  host.replaceChildren();
  host.className = `mirror mirror--${role}`;

  const soft = document.createElement("video");
  soft.className = "mirror__video mirror__video--soft";
  soft.muted = true;
  soft.playsInline = true;
  soft.setAttribute("aria-hidden", "true");

  const bloom = document.createElement("video");
  bloom.className = "mirror__video mirror__video--bloom";
  bloom.muted = true;
  bloom.playsInline = true;
  bloom.setAttribute("aria-hidden", "true");

  const primary = document.createElement("video");
  primary.className = "mirror__video mirror__video--primary";
  primary.autoplay = true;
  primary.muted = true;
  primary.playsInline = true;
  primary.setAttribute("aria-label", `${role} mirror camera`);

  const vignette = document.createElement("div");
  vignette.className = "mirror__vignette";
  vignette.setAttribute("aria-hidden", "true");

  // Primary first; the edge-softening and bloom copies composite above it.
  // These layers alter light only and never perform landmark/geometry warping.
  host.append(primary, soft, bloom, vignette);
  return primary;
}

function attachStream(host: HTMLElement, primary: HTMLVideoElement, stream: MediaStream): void {
  const layers = host.querySelectorAll<HTMLVideoElement>("video");
  for (const layer of layers) layer.srcObject = stream;
  void Promise.all(Array.from(layers, (layer) => layer.play())).catch((error: unknown) => {
    console.error("Camera autoplay failed", error);
  });
  primary.addEventListener("loadedmetadata", () => host.classList.add("mirror--ready"), {
    once: true,
  });
}

export async function startVideoPipeline(
  host: HTMLElement,
  role: ScreenRole,
  config: VideoPipelineConfig,
): Promise<VideoPipeline> {
  const useMock = mockCameraEnabled();
  if (!useMock && !navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera capture is unavailable in this browser context");
  }

  setGradeVariables(host, config.grade);
  const primary = buildVideoLayers(host, role);
  let mockSource: HTMLVideoElement | undefined;
  let stream: MediaStream;
  if (useMock) {
    mockSource = document.createElement("video");
    stream = await createMockCameraStream(mockSource);
  } else {
    const deviceId = await resolveCameraDeviceId(config.cameras[role]);
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        deviceId: { exact: deviceId },
        width: { ideal: config.video.width, max: config.video.width },
        height: { ideal: config.video.height, max: config.video.height },
        frameRate: { ideal: config.video.fps, max: config.video.fps },
      },
    });
  }
  const track = stream.getVideoTracks()[0];
  if (!track) throw new Error("Camera opened without a video track");
  track.contentHint = "motion";
  attachStream(host, primary, stream);

  return {
    stream,
    track,
    stop: () => {
      stream.getTracks().forEach((item) => item.stop());
      mockSource?.pause();
      mockSource?.removeAttribute("src");
      mockSource?.load();
    },
  };
}

function formatSetting(value: unknown, suffix = ""): string {
  return value === undefined ? "?" : `${String(value)}${suffix}`;
}

/** Chromium does not expose the negotiated UVC pixel format to Web APIs. */
function negotiatedFormat(settings: MediaTrackSettings): string {
  const extended = settings as MediaTrackSettings & { pixelFormat?: string; codec?: string };
  return extended.pixelFormat ?? extended.codec ?? `${REQUIRED_FORMAT} required; verify with v4l2-ctl`;
}

export function installVideoDebugOverlay(
  host: HTMLElement,
  video: HTMLVideoElement,
  track: MediaStreamTrack,
): () => void {
  const overlay = document.createElement("aside");
  overlay.className = "video-debug";
  overlay.setAttribute("aria-live", "polite");
  document.body.append(overlay);

  const frameVideo = video as VideoWithFrameCallback;
  let frames = 0;
  let dropped = 0;
  let lastPresented = 0;
  let frameDelayMs = 0;
  let decodeMs = 0;
  let measuredFps = 0;
  let mainThreadLagMs = 0;
  let lastFpsAt = performance.now();
  let stopped = false;

  const onFrame: VideoFrameCallback = (_now, metadata) => {
    frames += 1;
    if (metadata.presentedFrames !== undefined && lastPresented) {
      dropped += Math.max(0, metadata.presentedFrames - lastPresented - 1);
    }
    lastPresented = metadata.presentedFrames ?? lastPresented;
    frameDelayMs = Math.max(0, performance.now() - (metadata.expectedDisplayTime ?? performance.now()));
    decodeMs = (metadata.processingDuration ?? 0) * 1000;
    if (!stopped) frameVideo.requestVideoFrameCallback?.(onFrame);
  };
  frameVideo.requestVideoFrameCallback?.(onFrame);

  let expectedTick = performance.now() + 1000;
  const interval = window.setInterval(() => {
    const now = performance.now();
    mainThreadLagMs = Math.max(0, now - expectedTick);
    expectedTick = now + 1000;
    measuredFps = (frames * 1000) / Math.max(1, now - lastFpsAt);
    frames = 0;
    lastFpsAt = now;

    const settings = track.getSettings();
    const quality = video.getVideoPlaybackQuality?.();
    const totalDropped = quality?.droppedVideoFrames ?? dropped;
    overlay.textContent = [
      `role ${host.classList.contains("mirror--praise") ? "praise" : "roast"}`,
      `${formatSetting(settings.width)}x${formatSetting(settings.height)} @ ${measuredFps.toFixed(1)} fps (track ${formatSetting(settings.frameRate)})`,
      `format ${negotiatedFormat(settings)}`,
      `frames dropped ${totalDropped} · display delay ${frameDelayMs.toFixed(1)}ms · decode ${decodeMs.toFixed(1)}ms`,
      `main-thread timer lag ${mainThreadLagMs.toFixed(1)}ms`,
      `clock ${new Date().toISOString().slice(11, 23)} · measurement mode`,
    ].join("\n");
  }, 1000);

  return () => {
    stopped = true;
    window.clearInterval(interval);
    overlay.remove();
  };
}
