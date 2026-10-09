import { strict as assert } from "node:assert";
import { test } from "node:test";

import { screenPosition } from "../src/solid/model";

test("screenPosition maps centered NDC to centered CSS pixels", () => {
  assert.deepEqual(screenPosition({ x: 0, y: 0 }, 800, 600), { x: 400, y: 300 });
});

test("screenPosition flips NDC vertical direction", () => {
  assert.deepEqual(screenPosition({ x: -1, y: 1 }, 800, 600), { x: 0, y: 0 });
});
