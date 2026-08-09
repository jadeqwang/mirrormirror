import assert from "node:assert/strict";
import test from "node:test";
import { Presentation } from "./presentation.ts";
import type { BeatView, MessageBus, PresentationEvent } from "./types.ts";

class Bus implements MessageBus {
  peer?: Bus;
  sent: PresentationEvent[] = [];
  listeners = new Set<(event: MessageEvent<PresentationEvent>) => void>();
  postMessage(event: PresentationEvent): void {
    this.sent.push(event);
    for (const listener of this.peer?.listeners ?? []) listener({ data: event } as MessageEvent<PresentationEvent>);
  }
  addEventListener(_type: "message", listener: (event: MessageEvent<PresentationEvent>) => void): void { this.listeners.add(listener); }
  removeEventListener(_type: "message", listener: (event: MessageEvent<PresentationEvent>) => void): void { this.listeners.delete(listener); }
}

class View implements BeatView {
  calls: Array<{ text: string; kind: "beat" | "preroll" }> = [];
  waiting: Array<(done: boolean) => void> = [];
  aborted = 0;
  resets = 0;
  type(text: string, kind: "beat" | "preroll" = "beat"): Promise<boolean> {
    this.calls.push({ text, kind });
    return new Promise((resolve) => this.waiting.push(resolve));
  }
  finish(done = true): void { this.waiting.shift()?.(done); }
  abort(): void { this.aborted += 1; while (this.waiting.length) this.finish(false); }
  reset(): void { this.resets += 1; while (this.waiting.length) this.finish(false); }
}

const envelope = {
  beats: [
    { screen: "praise", text: "P one" },
    { screen: "roast", text: "R two" },
    { screen: "praise", text: "P three" },
    { screen: "roast", text: "R four" },
  ] as const,
};

async function turn(): Promise<void> { await Promise.resolve(); await Promise.resolve(); }

test("ARMED starts local praise pre-roll immediately and generated indices remain 0-3", async () => {
  const bus = new Bus(); const view = new View();
  const presentation = new Presentation({ role: "praise", view, bus, preroll: ["oh, hello"], beatGapMs: 0, setTimer: (fn) => { fn(); return 1 as unknown as ReturnType<typeof setTimeout>; } });
  presentation.handle({ type: "state", state: "ARMED" });
  assert.deepEqual(view.calls, [{ text: "oh, hello", kind: "preroll" }]);
  const playing = presentation.play(envelope);
  await turn();
  assert.equal(bus.sent.length, 0, "generated beat waits for the pre-roll to finish");
  view.finish(); await turn();
  assert.deepEqual(bus.sent[0], { type: "beat", index: 0, screen: "praise", text: "P one" });
  presentation.handle({ type: "abort" });
  assert.equal(await playing, false);
});

test("conductor waits for beat_done and alternates across paired windows", async () => {
  const praiseBus = new Bus(); const roastBus = new Bus(); praiseBus.peer = roastBus; roastBus.peer = praiseBus;
  const praiseView = new View(); const roastView = new View(); let complete = 0;
  const timer = (fn: () => void) => { fn(); return 1 as unknown as ReturnType<typeof setTimeout>; };
  const praise = new Presentation({ role: "praise", view: praiseView, bus: praiseBus, preroll: ["oh, hello"], beatGapMs: 0, setTimer: timer, onComplete: () => complete++ });
  const roast = new Presentation({ role: "roast", view: roastView, bus: roastBus, preroll: ["oh, hello"] });
  const playing = praise.play(envelope); await turn();
  assert.deepEqual(praiseView.calls.map((x) => x.text), ["P one"]);
  assert.equal(roastView.calls.length, 0);
  praiseView.finish(); await turn();
  assert.deepEqual(roastView.calls.map((x) => x.text), ["R two"]);
  assert.deepEqual(praiseView.calls.map((x) => x.text), ["P one"], "next local beat cannot overlap remote typing");
  roastView.finish(); await turn();
  assert.deepEqual(praiseView.calls.map((x) => x.text), ["P one", "P three"]);
  praiseView.finish(); await turn();
  assert.deepEqual(roastView.calls.map((x) => x.text), ["R two", "R four"]);
  roastView.finish(); await turn();
  assert.equal(await playing, true);
  assert.equal(complete, 1);
  assert.deepEqual(praiseBus.sent.filter((x) => x.type === "beat").map((x) => x.index), [0, 1, 2, 3]);
  praise.dispose(); roast.dispose();
});

test("abort fades both roles, cancels sequencing, and reset clears both", async () => {
  const praiseBus = new Bus(); const roastBus = new Bus(); praiseBus.peer = roastBus; roastBus.peer = praiseBus;
  const praiseView = new View(); const roastView = new View();
  const praise = new Presentation({ role: "praise", view: praiseView, bus: praiseBus, preroll: ["oh, hello"] });
  const roast = new Presentation({ role: "roast", view: roastView, bus: roastBus, preroll: ["oh, hello"] });
  const playing = praise.play(envelope); await turn();
  const abort = { type: "abort" } as const; praise.handle(abort); praiseBus.postMessage(abort);
  assert.equal(await playing, false);
  assert.equal(praiseView.aborted, 1); assert.equal(roastView.aborted, 1);
  const reset = { type: "reset" } as const; praise.handle(reset); praiseBus.postMessage(reset);
  assert.equal(praiseView.resets, 1); assert.equal(roastView.resets, 1);
});

test("malformed or non-four-beat envelopes never enter presentation", async () => {
  const presentation = new Presentation({ role: "praise", view: new View(), bus: new Bus(), preroll: ["oh, hello"] });
  await assert.rejects(() => presentation.play({ beats: [{ screen: "praise", text: "only one" }] }), /exactly four/);
});
