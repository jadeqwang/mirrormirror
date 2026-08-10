import test from "node:test";
import assert from "node:assert/strict";
import type { BusEvent, MessageBus } from "./bus.ts";
import { PerformanceStateMachine } from "./state.ts";
import { Presentation } from "./present/presentation.ts";
import type { BeatView, GenerationEnvelopeLike } from "./present/types.ts";

/**
 * Exercises the graph `main.ts` wires: occupancy → state machine → generation →
 * conductor presentation → follower presentation → completion. Every lane tested
 * its own component; nothing tested the joins, which is where the project stalled.
 */

class Clock {
  now = 0;
  next = 1;
  jobs = new Map<number, { at: number; callback: () => void }>();
  set = (callback: () => void, delay: number) => { const id = this.next++; this.jobs.set(id, { at: this.now + delay, callback }); return id as unknown as ReturnType<typeof setTimeout>; };
  clear = (id: ReturnType<typeof setTimeout>) => { this.jobs.delete(id as unknown as number); };
  tick(ms: number) { this.now += ms; for (;;) { const due = [...this.jobs].filter(([, job]) => job.at <= this.now).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; this.jobs.delete(due[0]); due[1].callback(); } }
}

/** Two of these linked together behave like BroadcastChannel: senders never hear themselves. */
class FakeBus implements MessageBus {
  peer?: FakeBus;
  #listeners = new Set<(event: MessageEvent<BusEvent>) => void>();
  postMessage(event: BusEvent): void { if (this.peer) this.peer.#deliver(event); }
  addEventListener(_type: "message", listener: (event: MessageEvent<BusEvent>) => void): void { this.#listeners.add(listener); }
  removeEventListener(_type: "message", listener: (event: MessageEvent<BusEvent>) => void): void { this.#listeners.delete(listener); }
  #deliver(event: BusEvent): void { for (const listener of [...this.#listeners]) listener({ data: event } as MessageEvent<BusEvent>); }
}

class FakeView implements BeatView {
  lines: string[] = [];
  async type(text: string, kind: "beat" | "preroll" = "beat"): Promise<boolean> { this.lines.push(`${kind}:${text}`); return true; }
  abort(): void { this.lines.push("abort"); }
  reset(): void { this.lines.push("reset"); }
}

const ENVELOPE: GenerationEnvelopeLike = {
  beats: [
    { screen: "praise", text: "That jacket is a decision and I respect it." },
    { screen: "roast", text: "It is a decision the way a sneeze is a decision." },
    { screen: "praise", text: "You call it a sneeze; I call it instinct." },
    { screen: "roast", text: "Instinct would have stopped at the collar." },
  ],
};

const turn = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

function wire(options: { generate: () => Promise<GenerationEnvelopeLike>; fallback?: () => GenerationEnvelopeLike }) {
  const clock = new Clock();
  const praiseBus = new FakeBus();
  const roastBus = new FakeBus();
  praiseBus.peer = roastBus;
  roastBus.peer = praiseBus;
  const praiseView = new FakeView();
  const roastView = new FakeView();
  const preroll = ["oh, hello"];

  // Follower first, so it is listening before the conductor emits anything.
  new Presentation({ role: "roast", view: roastView, bus: roastBus, preroll, beatGapMs: 10, setTimer: clock.set, clearTimer: clock.clear });
  const praise = new Presentation({ role: "praise", view: praiseView, bus: praiseBus, preroll, beatGapMs: 10, setTimer: clock.set, clearTimer: clock.clear });

  let machine!: PerformanceStateMachine<GenerationEnvelopeLike>;
  machine = new PerformanceStateMachine<GenerationEnvelopeLike>({
    settleMs: 1500,
    spentEmptyMs: 4500,
    generate: options.generate,
    fallback: options.fallback,
    onReady: (envelope) => { void praise.play(envelope).then((completed) => { if (completed) machine.complete(); }); },
    emit: (event) => { praiseBus.postMessage(event); praise.handle(event); },
    setTimer: clock.set,
    clearTimer: clock.clear,
  });

  return { clock, machine, praiseView, roastView };
}

async function runToSpent(clock: Clock, machine: PerformanceStateMachine<GenerationEnvelopeLike>): Promise<void> {
  for (let step = 0; step < 40 && machine.state !== "SPENT"; step += 1) {
    await turn();
    clock.tick(100);
  }
  await turn();
}

test("occupancy drives a whole performance across both windows", async () => {
  const { clock, machine, praiseView, roastView } = wire({ generate: async () => ENVELOPE });

  machine.setOccupied(true);
  // The pre-roll must be on screen before anything is awaited (spec §7).
  assert.equal(machine.state, "ARMED");
  await turn();
  assert.deepEqual(praiseView.lines, ["preroll:oh, hello"]);
  assert.deepEqual(roastView.lines, [], "the roast screen holds during the pre-roll");

  await runToSpent(clock, machine);

  assert.equal(machine.state, "SPENT", "the performance completed and released the zone");
  assert.deepEqual(praiseView.lines, [
    "preroll:oh, hello",
    `beat:${ENVELOPE.beats[0].text}`,
    `beat:${ENVELOPE.beats[2].text}`,
  ]);
  assert.deepEqual(roastView.lines, [
    `beat:${ENVELOPE.beats[1].text}`,
    `beat:${ENVELOPE.beats[3].text}`,
  ]);
});

test("a failed generation still performs, from the offline pool", async () => {
  const { clock, machine, praiseView, roastView } = wire({
    generate: async () => { throw new Error("server down"); },
    fallback: () => ENVELOPE,
  });

  machine.setOccupied(true);
  await runToSpent(clock, machine);

  assert.equal(machine.state, "SPENT");
  assert.equal(praiseView.lines.length, 3, "pre-roll plus two praise beats");
  assert.equal(roastView.lines.length, 2, "two roast beats");
});

test("a visitor leaving mid-performance aborts both screens", async () => {
  const { clock, machine, praiseView, roastView } = wire({ generate: async () => ENVELOPE });

  machine.setOccupied(true);
  await turn();
  clock.tick(1500);
  await turn();
  assert.equal(machine.state, "PERFORMING");

  machine.setOccupied(false);
  await turn();

  assert.equal(machine.state, "EMPTY", "never perform to an empty room");
  assert.ok(praiseView.lines.includes("abort"), "praise screen faded");
  assert.ok(roastView.lines.includes("abort"), "roast screen faded");
});
