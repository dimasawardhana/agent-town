// test/solid-follow.test.ts
import { strict as assert } from "node:assert";
import { test } from "node:test";

// src/solid/model.ts
function project(wx, wy, z = 0) {
  return { x: (wx - wy) / 2, y: (wx + wy) / 4 - z };
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
var CAMERA_UP = [0, 0, -1];
function worldExtent(l) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x, y, w, h) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + h > maxY) maxY = y + h;
  };
  for (const s of l.sites) add(s.x, s.y, s.w, s.h);
  for (const d of l.districts) add(d.x, d.y, d.w, d.h);
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}
var FIT_PAD = 40;
function framingFor(extent, viewportWidth, viewportHeight, zoom = 1, maxZ = 0) {
  const corners = [
    project(extent.minX, extent.minY),
    project(extent.maxX, extent.minY),
    project(extent.minX, extent.maxY),
    project(extent.maxX, extent.maxY)
  ];
  const raised = maxZ > 0 ? corners.map((c) => ({ x: c.x, y: c.y - maxZ })) : [];
  const all = [...corners, ...raised];
  const picW = Math.max(1e-6, Math.max(...all.map((c) => c.x)) - Math.min(...all.map((c) => c.x)));
  const picH = Math.max(1e-6, Math.max(...all.map((c) => c.y)) - Math.min(...all.map((c) => c.y)));
  const scale = Math.max(
    1e-6,
    Math.min(
      (viewportWidth - FIT_PAD * 2) / picW,
      (viewportHeight - FIT_PAD * 2) / picH
    ) * zoom
  );
  const pcx = (Math.min(...all.map((c) => c.x)) + Math.max(...all.map((c) => c.x))) / 2;
  const pcy = (Math.min(...all.map((c) => c.y)) + Math.max(...all.map((c) => c.y))) / 2;
  const target = [pcx + 2 * pcy, -pcx + 2 * pcy, 0];
  return {
    target,
    // Pushed out along the basis' own z axis. The distance is arbitrary under an
    // orthographic camera — nothing foreshortens — so it is a constant chosen to
    // clear the near plane rather than a fit.
    position: [
      target[0] + CAMERA_BASIS.z[0] * 1e3,
      target[1] + CAMERA_BASIS.z[1] * 1e3,
      target[2] + CAMERA_BASIS.z[2] * 1e3
    ],
    up: CAMERA_UP,
    halfWidth: viewportWidth * AXIS.x / scale,
    halfHeight: viewportHeight * AXIS.y / scale,
    // **Negated on purpose** — see `halfTop`. This is the handedness of the
    // picture, and every vertical direction in the town depends on it.
    halfTop: -(viewportHeight * AXIS.y / scale),
    halfBottom: viewportHeight * AXIS.y / scale,
    scale
  };
}
var FOLLOW_SCALE = 3;
function followScale(current) {
  return Math.max(current, FOLLOW_SCALE);
}
function followFraming(point, viewportWidth, viewportHeight, scale) {
  const target = [point[0], point[1], point[2]];
  return {
    target,
    position: [
      target[0] + CAMERA_BASIS.z[0] * 1e3,
      target[1] + CAMERA_BASIS.z[1] * 1e3,
      target[2] + CAMERA_BASIS.z[2] * 1e3
    ],
    up: CAMERA_UP,
    halfWidth: viewportWidth * AXIS.x / scale,
    halfHeight: viewportHeight * AXIS.y / scale,
    halfTop: -(viewportHeight * AXIS.y / scale),
    halfBottom: viewportHeight * AXIS.y / scale,
    scale
  };
}

// test/solid-follow.test.ts
var layout = {
  width: 500,
  height: 500,
  sites: [
    {
      id: "building:one",
      kind: "building",
      label: "one",
      path: "one",
      files: 3,
      bytes: 8192,
      depth: 2,
      floors: 2,
      x: 40,
      y: 40,
      w: 80,
      h: 60
    }
  ],
  districts: [{ name: "src", kind: "source", x: 0, y: 0, w: 480, h: 480 }]
};
test("a follow never widens the reader's zoom", () => {
  assert.ok(followScale(5) === 5, "a zoom past the floor was overridden");
  assert.equal(followScale(0.5), FOLLOW_SCALE, "the fit's scale was kept instead of the floor");
  assert.ok(followScale(FOLLOW_SCALE) === FOLLOW_SCALE, "the floor itself moved");
});
test("the follow floor is a zoom-in from the fitted view", () => {
  const e = worldExtent(layout);
  for (const [vw, vh] of [[968, 900], [800, 600], [1600, 500]]) {
    const fit = framingFor(e, vw, vh, 1, 40);
    assert.ok(
      FOLLOW_SCALE > fit.scale,
      `at ${vw}x${vh} the fit is already at ${fit.scale}, so following would not zoom in`
    );
  }
});
test("the followed point is the centre of the frame", () => {
  const at = [120, 80, 5];
  for (const [vw, vh] of [[968, 900], [800, 600]]) {
    const f = followFraming(at, vw, vh, FOLLOW_SCALE);
    const dx = at[0] - f.position[0], dy = at[1] - f.position[1], dz = at[2] - f.position[2];
    const across = dx * CAMERA_BASIS.x[0] + dy * CAMERA_BASIS.x[1] + dz * CAMERA_BASIS.x[2];
    const down = dx * CAMERA_BASIS.y[0] + dy * CAMERA_BASIS.y[1] + dz * CAMERA_BASIS.y[2];
    assert.ok(Math.abs(across) < 1e-9, `at ${vw}x${vh} the followed point sits ${across} off-centre across`);
    assert.ok(Math.abs(down) < 1e-9, `at ${vw}x${vh} the followed point sits ${down} off-centre down`);
  }
});
test("the follow view keeps the projection's 2:1", () => {
  const at = [10, 10, 0];
  for (const [vw, vh] of [[968, 900], [1200, 400]]) {
    const f = followFraming(at, vw, vh, FOLLOW_SCALE);
    const px = (s) => (s[0] * CAMERA_BASIS.x[0] + s[1] * CAMERA_BASIS.x[1] + s[2] * CAMERA_BASIS.x[2]) * (vw / (2 * f.halfWidth));
    const py = (s) => (s[0] * CAMERA_BASIS.y[0] + s[1] * CAMERA_BASIS.y[1] + s[2] * CAMERA_BASIS.y[2]) * (vh / (2 * f.halfHeight));
    const step = [1, 0, 0];
    assert.ok(Math.abs(px(step) - f.scale * 0.5) < 1e-6, `at ${vw}x${vh} a step moved ${px(step)} px across, not ${f.scale * 0.5}`);
    assert.ok(Math.abs(py(step) - f.scale * 0.25) < 1e-6, `at ${vw}x${vh} a step moved ${py(step)} px down, not ${f.scale * 0.25}`);
  }
});
test("the follow frame has the picture's handedness", () => {
  const at = [200, 100, 3];
  const f = followFraming(at, 800, 600, FOLLOW_SCALE);
  assert.ok(f.halfTop < 0, "the follow frame lost the negative halfTop");
  assert.ok(f.halfBottom > 0, "the follow frame has no bottom half");
  assert.ok(f.halfWidth > 0 && f.halfHeight > 0, "the follow frustum has no area");
  const back = Math.hypot(
    at[0] - f.position[0],
    at[1] - f.position[1],
    at[2] - f.position[2]
  );
  assert.ok(Math.abs(back - 1e3) < 1e-9, "the camera is not a fixed distance behind the point");
});
test("the framing the scene applies is the scale the policy returned", () => {
  for (const current of [0.5, 0.98, 2, 5]) {
    const f = followFraming([50, 50, 0], 968, 900, followScale(current));
    assert.equal(f.scale, followScale(current), `scale ${current} did not survive the round trip`);
  }
  const near = followFraming([50, 50, 0], 800, 600, FOLLOW_SCALE);
  const closer = followFraming([50, 50, 0], 800, 600, FOLLOW_SCALE * 2);
  assert.ok(closer.halfWidth < near.halfWidth, "a larger scale did not narrow the frustum");
});
