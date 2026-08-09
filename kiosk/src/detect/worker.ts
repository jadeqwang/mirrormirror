/// <reference lib="webworker" />
import { OccupancyModel, type OccupancyModelOptions } from "./model";

type Init = { type: "init"; options: OccupancyModelOptions };
type Frame = { type: "frame"; bitmap: ImageBitmap };
type Freeze = { type: "freeze"; frozen: boolean };
type Message = Init | Frame | Freeze;

let canvas: OffscreenCanvas;
let context: OffscreenCanvasRenderingContext2D;
let model: OccupancyModel;

self.onmessage = (event: MessageEvent<Message>) => {
  const message = event.data;
  if (message.type === "init") {
    model = new OccupancyModel(message.options);
    canvas = new OffscreenCanvas(model.width, model.height);
    const value = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    if (!value) throw new Error("worker 2d canvas unavailable");
    context = value;
  } else if (message.type === "freeze") {
    model.setFrozen(message.frozen);
  } else {
    context.drawImage(message.bitmap, 0, 0, model.width, model.height);
    message.bitmap.close();
    const pixels = context.getImageData(0, 0, model.width, model.height).data;
    self.postMessage({ type: "sample", sample: model.sample(pixels) });
  }
};
