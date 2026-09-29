
import { strict as assert } from "node:assert";
import { test } from "node:test";

test("probe", async () => {
  const g = globalThis as any;
  g.window = g;
  Object.defineProperty(g, "navigator", { value: { userAgent: "node" }, configurable: true });
  g.document = {
    createElement: () => ({ getContext: () => null, style: {} }),
    addEventListener() {}, removeEventListener() {},
    documentElement: { style: {} },
  };
  const mod = await import("../src/workers");
  assert.equal(typeof mod.WorkerLayer, "function");
});
