import { OccupancyModel, type OccupancyModelOptions, type OccupancySample } from "./model";

export interface DetectorOptions extends OccupancyModelOptions {
  sampleFps?: number;
  onSample: (sample: OccupancySample) => void;
  workerFactory?: () => Worker;
}

/** Samples an already-open video. It never requests camera access itself. */
export class VideoOccupancyDetector {
  readonly #video: HTMLVideoElement;
  readonly #options: DetectorOptions;
  #worker?: Worker;
  #model?: OccupancyModel;
  #canvas?: HTMLCanvasElement;
  #context?: CanvasRenderingContext2D;
  #timer?: number;
  #busy = false;
  #frozen = false;

  constructor(video: HTMLVideoElement, options: DetectorOptions) {
    this.#video = video;
    this.#options = options;
  }

  start(): void {
    if (this.#timer !== undefined) return;
    const canUseWorker = typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined" && typeof createImageBitmap !== "undefined";
    if (canUseWorker) {
      this.#worker = this.#options.workerFactory?.() ?? new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      this.#worker.onmessage = (event: MessageEvent<{ type: "sample"; sample: OccupancySample }>) => {
        this.#busy = false;
        this.#options.onSample(event.data.sample);
      };
      this.#worker.onerror = () => this.#switchToFallback();
      this.#worker.postMessage({ type: "init", options: serializableOptions(this.#options) });
      if (this.#frozen) this.#worker.postMessage({ type: "freeze", frozen: true });
    } else {
      this.#initFallback();
    }
    const fps = Math.min(4, Math.max(3, this.#options.sampleFps ?? 4));
    this.#timer = window.setInterval(() => void this.#sample(), 1000 / fps);
  }

  stop(): void {
    if (this.#timer !== undefined) window.clearInterval(this.#timer);
    this.#timer = undefined;
    this.#worker?.terminate();
    this.#worker = undefined;
    this.#busy = false;
  }

  setFrozen(frozen: boolean): void {
    this.#frozen = frozen;
    this.#worker?.postMessage({ type: "freeze", frozen });
    this.#model?.setFrozen(frozen);
  }

  async #sample(): Promise<void> {
    if (this.#busy || this.#video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    this.#busy = true;
    if (this.#worker) {
      try {
        const bitmap = await createImageBitmap(this.#video);
        this.#worker.postMessage({ type: "frame", bitmap }, [bitmap]);
      } catch {
        this.#busy = false;
        this.#switchToFallback();
      }
      return;
    }
    // Yield until after the current render frame before doing the short fallback sample.
    requestAnimationFrame(() => {
      try {
        this.#context!.drawImage(this.#video, 0, 0, this.#model!.width, this.#model!.height);
        const rgba = this.#context!.getImageData(0, 0, this.#model!.width, this.#model!.height).data;
        this.#options.onSample(this.#model!.sample(rgba));
      } finally {
        this.#busy = false;
      }
    });
  }

  #switchToFallback(): void {
    this.#worker?.terminate();
    this.#worker = undefined;
    this.#busy = false;
    if (!this.#model) this.#initFallback();
  }

  #initFallback(): void {
    this.#model = new OccupancyModel(this.#options);
    this.#model.setFrozen(this.#frozen);
    this.#canvas = document.createElement("canvas");
    this.#canvas.width = this.#model.width;
    this.#canvas.height = this.#model.height;
    const context = this.#canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    if (!context) throw new Error("detection canvas unavailable");
    this.#context = context;
  }
}

function serializableOptions(options: DetectorOptions): OccupancyModelOptions {
  return { width: options.width, height: options.height, roi: options.roi, threshold: options.threshold, enterFrames: options.enterFrames, exitFrames: options.exitFrames, pixelThreshold: options.pixelThreshold, backgroundAlpha: options.backgroundAlpha };
}
