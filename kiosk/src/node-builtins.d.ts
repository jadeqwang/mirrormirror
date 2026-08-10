// Kiosk production code is checked with browser globals only. These narrow
// declarations let its colocated Node test files participate without pulling
// Node's global timer overloads into DOM modules.
declare module "node:test" {
  const test: (name: string, callback: () => void | Promise<void>) => void;
  export { test };
  export default test;
}

declare module "node:assert/strict" {
  interface Assert {
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    doesNotThrow(callback: () => unknown, message?: string): void;
    equal(actual: unknown, expected: unknown, message?: string): void;
    match(actual: string, regexp: RegExp, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): asserts value;
    rejects(callback: (() => Promise<unknown>) | Promise<unknown>, error?: unknown): Promise<void>;
    throws(callback: () => unknown, error?: unknown): void;
  }
  const assert: Assert;
  export default assert;
}
