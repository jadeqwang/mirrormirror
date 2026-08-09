import assert from "node:assert/strict";

/**
 * Registers frozen transition checks against a small adapter supplied by lane B.
 * factory() returns { state, occupied(value, now), tick(now), performanceDone(now), rearm(now) }.
 */
export function stateMachineSuite(test, factory) {
  test("settles before performing and then enters spent", () => {
    const machine = factory();
    assert.equal(machine.state, "EMPTY");
    machine.occupied(true, 0);
    assert.equal(machine.state, "ARMED");
    machine.tick(1499);
    assert.equal(machine.state, "ARMED");
    machine.tick(1500);
    assert.equal(machine.state, "PERFORMING");
    machine.performanceDone(2000);
    assert.equal(machine.state, "SPENT");
  });

  test("ignores arrivals while performing and aborts when empty", () => {
    const machine = factory();
    machine.occupied(true, 0);
    machine.tick(1500);
    machine.occupied(true, 1600);
    assert.equal(machine.state, "PERFORMING");
    machine.occupied(false, 1700);
    assert.notEqual(machine.state, "PERFORMING");
  });

  test("spent requires 4.5 seconds continuously empty", () => {
    const machine = factory();
    machine.occupied(true, 0);
    machine.tick(1500);
    machine.performanceDone(2000);
    machine.occupied(false, 2100);
    machine.tick(6599);
    assert.equal(machine.state, "SPENT");
    machine.tick(6600);
    assert.equal(machine.state, "EMPTY");
  });

  test("attendant rearm returns to empty", () => {
    const machine = factory();
    machine.occupied(true, 0);
    machine.tick(1500);
    machine.performanceDone(2000);
    machine.rearm(2100);
    assert.equal(machine.state, "EMPTY");
  });
}
