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

async function listCameras(): Promise<MediaDeviceInfo[]> {
  let devices = (await navigator.mediaDevices.enumerateDevices()).filter(
    (device) => device.kind === "videoinput",
  );

  // Labels are blank on a fresh Chromium profile until permission has been
  // granted, and a by-path/serial selector can only match against a label.
  // Open and immediately release a throwaway stream to unlock them.
  //
  // Only when they are actually missing: both kiosk windows boot at once, and
  // an unconditional `video: true` has them racing for the same default device,
  // which V4L2 can refuse. Once the profile has been granted, labels persist and
  // this is skipped entirely.
  if (devices.some((device) => !device.label)) {
    const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    permissionStream.getTracks().forEach((track) => track.stop());
    devices = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === "videoinput",
    );
  }
  return devices;
}

/**
 * Every camera failure is a setup failure, and the person reading it is standing
 * at the machine with no way to see what the browser can see. So each message
 * ends with the list to copy a selector out of — anything less means guessing at
 * `config.json` from `v4l2-ctl` output that does not use the browser's names.
 */
function cameraChoices(devices: readonly MediaDeviceInfo[]): string {
  if (devices.length === 0) return " No cameras are connected.";
  // deviceId always, not only when the label is missing: two cameras of the same
  // model carry byte-identical labels, and then the id is the only thing that
  // tells them apart.
  const named = devices.map((device) => `  ${device.label || "(unlabelled)"}\n    ${device.deviceId}`);
  const hidden = devices.some((device) => !device.label)
    ? "\nCamera labels are hidden; grant persistent camera permission to this profile."
    : "";
  return `\nCameras this window can see:\n${named.join("\n")}${hidden}`;
}

/**
 * Browser deviceIds are opaque. With the kiosk profile's persistent camera
 * permission, labels are populated and a config value may be either the exact
 * deviceId or a distinctive substring of the label.
 *
 * Chromium's label is the product name and USB vid:pid — "HD Pro Webcam C920
 * (046d:08e5)" — and notably *not* the serial number the kernel exposes. So two
 * cameras of the same model are indistinguishable by label and must be selected
 * by deviceId. Those are salted per browser profile, and the two windows run
 * separate profiles, so each `cameras.<role>` value has to be read out of that
 * role's own window. Each window only ever resolves its own.
 *
 * We deliberately never fall back to enumeration order: picking a camera by
 * position would silently swap the two mirrors on the next reboot, and the
 * piece has no way to notice it is flattering the wrong feed.
 */
async function resolveCameraDeviceId(selector: string, role: ScreenRole): Promise<string> {
  if (!selector.trim()) {
    const devices = await listCameras().catch((): MediaDeviceInfo[] => []);
    throw new Error(
      `No camera configured for the ${role} screen. Put a deviceId or a distinctive ` +
      `part of the label in config.json under cameras.${role}.${cameraChoices(devices)}`,
    );
  }

  const devices = await listCameras();
  const wanted = normalize(selector);
  const exact = devices.find((device) => device.deviceId === selector);
  if (exact) return exact.deviceId;

  const labelMatches = devices.filter((device) => normalize(device.label).includes(wanted));
  if (labelMatches.length === 1) return labelMatches[0].deviceId;
  if (labelMatches.length > 1) {
    throw new Error(
      `Camera selector ${JSON.stringify(selector)} matches ${labelMatches.length} devices. ` +
      `If they are the same model their labels are identical and no substring can separate ` +
      `them — use one of these deviceIds for cameras.${role} instead.${cameraChoices(labelMatches)}`,
    );
  }

  throw new Error(`Configured ${role} camera ${JSON.stringify(selector)} was not found.${cameraChoices(devices)}`);
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
    const deviceId = await resolveCameraDeviceId(config.cameras[role], role);
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
