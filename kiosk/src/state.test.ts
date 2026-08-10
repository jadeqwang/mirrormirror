import assert from "node:assert/strict";
import test from "node:test";
import { PerformanceStateMachine, type ConductorEvent } from "./state.ts";

class Clock {
  now = 0;
  next = 1;
  jobs = new Map<number, { at: number; callback: () => void }>();
  set = (callback: () => void, delay: number) => { const id = this.next++; this.jobs.set(id, { at: this.now + delay, callback }); return id as unknown as ReturnType<typeof setTimeout>; };
  clear = (id: ReturnType<typeof setTimeout>) => { this.jobs.delete(id as unknown as number); };
  tick(ms: number) { this.now += ms; for (;;) { const due = [...this.jobs].filter(([, job]) => job.at <= this.now).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; this.jobs.delete(due[0]); due[1].callback(); } }
}

async function turn(): Promise<void> { await Promise.resolve(); await Promise.resolve(); }

test("generation fires at ARMED entry and performance waits for settle and result", async () => {
  const clock = new Clock(); const events: ConductorEvent[] = []; const frozen: boolean[] = [];
  let resolve!: (value: string) => void; let generated = 0; let ready = "";
  const machine = new PerformanceStateMachine({ settleMs: 1500, spentEmptyMs: 4500, generate: () => { generated += 1; return new Promise<string>((r) => resolve = r); }, onReady: (value) => ready = value, emit: (event) => events.push(event), freezeDetection: (value) => frozen.push(value), setTimer: clock.set, clearTimer: clock.clear });
  machine.setOccupied(true);
  assert.equal(machine.state, "ARMED"); assert.equal(generated, 1);
  clock.tick(1500); assert.equal(machine.state, "ARMED");
  resolve("envelope"); await turn();
  assert.equal(machine.state, "PERFORMING"); assert.equal(ready, "envelope"); assert.equal(frozen.at(-1), true);
  assert.deepEqual(events.filter((e) => e.type === "state"), [{ type: "state", state: "ARMED" }, { type: "state", state: "PERFORMING" }]);
});

test("clear during performance aborts, resets, and ignores stale generation", async () => {
  const clock = new Clock(); const events: ConductorEvent[] = [];
  const machine = new PerformanceStateMachine({ settleMs: 1, generate: async () => "ok", onReady: () => {}, emit: (event) => events.push(event), setTimer: clock.set, clearTimer: clock.clear });
  machine.setOccupied(true); await turn(); clock.tick(1);
  assert.equal(machine.state, "PERFORMING");
  machine.setOccupied(true); assert.equal(machine.state, "PERFORMING");
  machine.setOccupied(false);
  assert.equal(machine.state, "EMPTY");
  assert.deepEqual(events.slice(-3), [{ type: "abort" }, { type: "state", state: "EMPTY" }, { type: "reset" }]);
});

test("SPENT requires one uninterrupted empty interval", async () => {
  const clock = new Clock();
  const machine = new PerformanceStateMachine({ settleMs: 1, spentEmptyMs: 4500, generate: async () => "ok", onReady: () => {}, emit: () => {}, setTimer: clock.set, clearTimer: clock.clear });
  machine.setOccupied(true); await turn(); clock.tick(1); machine.complete();
  machine.setOccupied(false); clock.tick(3000); machine.setOccupied(true); clock.tick(3000);
  assert.equal(machine.state, "SPENT");
  machine.setOccupied(false); clock.tick(4499); assert.equal(machine.state, "SPENT"); clock.tick(1); assert.equal(machine.state, "EMPTY");
});

test("a rejected generation performs the supplied fallback", async () => {
  const clock = new Clock(); let ready = "";
  const machine = new PerformanceStateMachine({ settleMs: 1, generate: async () => { throw new Error("network down"); }, fallback: () => "offline", onReady: (value) => ready = value, emit: () => {}, setTimer: clock.set, clearTimer: clock.clear });
  machine.setOccupied(true); await turn(); clock.tick(1); await turn();
  assert.equal(machine.state, "PERFORMING");
  assert.equal(ready, "offline");
});

test("a rejected generation with no fallback leaves SPENT, not stranded in ARMED", async () => {
  const clock = new Clock(); const events: ConductorEvent[] = [];
  const machine = new PerformanceStateMachine({ settleMs: 1, spentEmptyMs: 4500, generate: async () => { throw new Error("network down"); }, onReady: () => {}, emit: (event) => events.push(event), setTimer: clock.set, clearTimer: clock.clear });
  machine.setOccupied(true); await turn();
  assert.equal(machine.state, "SPENT");
  assert.deepEqual(events.at(-2), { type: "abort" });
  // And the zone still recovers on its own once the visitor leaves.
  machine.setOccupied(false); clock.tick(4500);
  assert.equal(machine.state, "EMPTY");
});

test("attendant key rearms an occupied zone and repeat is ignored", async () => {
  const clock = new Clock(); let calls = 0;
  const machine = new PerformanceStateMachine({ settleMs: 1, generate: async () => { calls += 1; return "ok"; }, onReady: () => {}, emit: () => {}, setTimer: clock.set, clearTimer: clock.clear });
  machine.setOccupied(true); await turn(); clock.tick(1);
  assert.equal(machine.handleKey({ key: "F9", repeat: true }), false);
  assert.equal(machine.handleKey({ key: "F9", repeat: false }), true);
  assert.equal(machine.state, "ARMED"); assert.equal(calls, 2);
});
