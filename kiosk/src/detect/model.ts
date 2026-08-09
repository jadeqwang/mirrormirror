export type Point = readonly [number, number];
export type Roi = readonly [Point, Point, Point, Point];

export interface OccupancyModelOptions {
  width?: number;
  height?: number;
  roi: Roi;
  threshold?: number;
  enterFrames?: number;
  exitFrames?: number;
  pixelThreshold?: number;
  backgroundAlpha?: number;
}

export interface OccupancySample {
  occupied: boolean;
  changed: boolean;
  foregroundFraction: number;
  foregroundPixels: number;
  roiPixels: number;
}

/** Stateful grayscale running-background occupancy gate. */
export class OccupancyModel {
  readonly width: number;
  readonly height: number;
  readonly #threshold: number;
  readonly #enterFrames: number;
  readonly #exitFrames: number;
  readonly #pixelThreshold: number;
  readonly #alpha: number;
  #mask: Uint8Array;
  #background?: Float32Array;
  #occupied = false;
  #enterCount = 0;
  #exitCount = 0;
  #frozen = false;

  constructor(options: OccupancyModelOptions) {
    this.width = options.width ?? 160;
    this.height = options.height ?? 120;
    this.#threshold = options.threshold ?? 0.08;
    this.#enterFrames = options.enterFrames ?? 4;
    this.#exitFrames = options.exitFrames ?? 8;
    this.#pixelThreshold = options.pixelThreshold ?? 24;
    this.#alpha = options.backgroundAlpha ?? 0.025;
    this.#mask = rasterizeRoi(options.roi, this.width, this.height);
  }

  get occupied(): boolean { return this.#occupied; }
  setFrozen(frozen: boolean): void { this.#frozen = frozen; }
  setRoi(roi: Roi): void { this.#mask = rasterizeRoi(roi, this.width, this.height); }

  sample(rgba: Uint8ClampedArray): OccupancySample {
    if (rgba.length !== this.width * this.height * 4) throw new Error("unexpected sample dimensions");
    const gray = new Uint8Array(this.width * this.height);
    for (let p = 0, i = 0; p < gray.length; p += 1, i += 4) {
      gray[p] = Math.round(rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114);
    }
    if (!this.#background) {
      this.#background = Float32Array.from(gray);
      return this.#result(0, 0);
    }

    let foreground = 0;
    let roiPixels = 0;
    for (let p = 0; p < gray.length; p += 1) {
      if (!this.#mask[p]) continue;
      roiPixels += 1;
      if (Math.abs(gray[p] - this.#background[p]) >= this.#pixelThreshold) foreground += 1;
    }
    if (!this.#frozen) {
      for (let p = 0; p < gray.length; p += 1) {
        this.#background[p] += this.#alpha * (gray[p] - this.#background[p]);
      }
    }
    return this.#result(foreground, roiPixels);
  }

  #result(foreground: number, roiPixels: number): OccupancySample {
    const fraction = roiPixels === 0 ? 0 : foreground / roiPixels;
    const before = this.#occupied;
    if (!this.#occupied) {
      this.#exitCount = 0;
      this.#enterCount = fraction >= this.#threshold ? this.#enterCount + 1 : 0;
      if (this.#enterCount >= this.#enterFrames) {
        this.#occupied = true;
        this.#enterCount = 0;
      }
    } else {
      this.#enterCount = 0;
      this.#exitCount = fraction < this.#threshold ? this.#exitCount + 1 : 0;
      if (this.#exitCount >= this.#exitFrames) {
        this.#occupied = false;
        this.#exitCount = 0;
      }
    }
    return { occupied: this.#occupied, changed: before !== this.#occupied, foregroundFraction: fraction, foregroundPixels: foreground, roiPixels };
  }
}

export function rasterizeRoi(roi: Roi, width: number, height: number): Uint8Array {
  const points = roi.map(([x, y]) => [x * (width - 1), y * (height - 1)] as const);
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pointInPolygon(x + 0.5, y + 0.5, points)) mask[y * width + x] = 1;
    }
  }
  return mask;
}

function pointInPolygon(x: number, y: number, points: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
