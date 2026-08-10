export type MockCameraScene = "empty-room" | "one-person" | "three-people";

const SCENES: Record<MockCameraScene, string> = {
  "empty-room": "/empty-room.webm",
  "one-person": "/one-person.webm",
  "three-people": "/three-people.webm",
};

export function mockCameraEnabled(search = globalThis.location?.search ?? ""): boolean {
  const buildEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return buildEnv?.VITE_MOCK_CAMERA === "1" ||
    new URLSearchParams(search).get("mock_camera") === "1";
}

export function requestedMockScene(search = globalThis.location?.search ?? ""): MockCameraScene {
  const requested = new URLSearchParams(search).get("mock_scene");
  return requested && requested in SCENES ? requested as MockCameraScene : "one-person";
}

/**
 * Loads a looping fixture into a video element and exposes it as a MediaStream.
 * Lane A can use this in the same branch where it would otherwise call
 * getUserMedia(); no camera permission is requested in mock mode.
 */
export async function createMockCameraStream(
  video: HTMLVideoElement,
  scene: MockCameraScene = requestedMockScene(),
): Promise<MediaStream> {
  video.src = SCENES[scene];
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  await video.play();

  const capturable = video as HTMLVideoElement & {
    captureStream?: () => MediaStream;
    mozCaptureStream?: () => MediaStream;
  };
  const capture = capturable.captureStream ?? capturable.mozCaptureStream;
  if (!capture) throw new Error("This browser does not support HTMLMediaElement.captureStream()");
  return capture.call(video);
}
