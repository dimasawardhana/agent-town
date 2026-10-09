// test/solid-label.test.ts
import { strict as assert } from "node:assert";
import { test } from "node:test";

// src/solid/model.ts
function screenPosition(point, width, height) {
  return { x: (point.x + 1) * width / 2, y: (1 - point.y) * height / 2 };
}
var CAMERA_BASIS = (() => {
  const norm = (v) => {
    const m = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / m, v[1] / m, v[2] / m];
  };
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
  const run = norm([1 / 2, -1 / 2, 0]);
  const rise = norm([1 / 4, 1 / 4, -1]);
  const out = norm(cross(run, rise));
  return { x: run, y: rise, z: out };
})();
var AXIS = {
  x: CAMERA_BASIS.x[0],
  y: 2 * CAMERA_BASIS.y[0]
};

// test/solid-label.test.ts
test("screenPosition maps centered NDC to centered CSS pixels", () => {
  assert.deepEqual(screenPosition({ x: 0, y: 0 }, 800, 600), { x: 400, y: 300 });
});
test("screenPosition flips NDC vertical direction", () => {
  assert.deepEqual(screenPosition({ x: -1, y: 1 }, 800, 600), { x: 0, y: 0 });
});
