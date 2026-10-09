// The follow camera, asserted without a renderer.
//
// TASK-110's scale criteria are about numbers a screenshot cannot vouch for —
// that a follow never widens the reader's zoom, and that the followed point
// really is the centre of the frame — and they are asserted here, against the
// same pure policy the scene frame loop calls (`solid/model.ts`), rather than
// eyeballed in a browser. The scene-side wiring is verified rendered; this file
// pins the decisions the wiring must implement.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { CAMERA_BASIS, FOLLOW_SCALE, followFraming, followScale, framingFor, worldExtent } from "../src/solid/model";
import type { Layout } from "../src/store";

const layout: Layout = {
  width: 500,
  height: 500,
  sites: [
    {
      id: "building:one", kind: "building", label: "one", path: "one", files: 3, bytes: 8192,
      depth: 2, floors: 2, x: 40, y: 40, w: 80, h: 60,
    },
  ],
  districts: [{ name: "src", kind: "source", x: 0, y: 0, w: 480, h: 480 }],
};

// ---------------------------------------------------------------------------
// The scale the follow insists on
// ---------------------------------------------------------------------------

test("a follow never widens the reader's zoom", () => {
  // The flat follow's contract, restated for a continuous scale: `Math.max`
  // against the floor, so a reader already zoomed in keeps their zoom and a
  // reader at the fit gets the follow's.
  assert.ok(followScale(5) === 5, "a zoom past the floor was overridden");
  assert.equal(followScale(0.5), FOLLOW_SCALE, "the fit's scale was kept instead of the floor");
  assert.ok(followScale(FOLLOW_SCALE) === FOLLOW_SCALE, "the floor itself moved");
});

test("the follow floor is a zoom-in from the fitted view", () => {
  // At the fit the machine is a speck — that is the whole reason the floor
  // exists — so the floor must exceed what the fit leaves a real town with,
  // whatever viewport the reader resized to.
  const e = worldExtent(layout);
  for (const [vw, vh] of [[968, 900], [800, 600], [1600, 500]] as const) {
    const fit = framingFor(e, vw, vh, 1, 40);
    assert.ok(
      FOLLOW_SCALE > fit.scale,
      `at ${vw}x${vh} the fit is already at ${fit.scale}, so following would not zoom in`,
    );
  }
});

// ---------------------------------------------------------------------------
// The frame the follow builds
// ---------------------------------------------------------------------------

test("the followed point is the centre of the frame", () => {
  // The follow exists because the worker was invisible; a follow that aims
  // beside the machine would recreate the same invisibility. The point is at
  // the centre exactly when its camera-space coordinates are zero, which for an
  // orthographic camera means its displacement from `position` is orthogonal to
  // both screen axes — asserted across viewports, since the framing is built
  // from the viewport's own halves.
  const at: [number, number, number] = [120, 80, 5];
  for (const [vw, vh] of [[968, 900], [800, 600]] as const) {
    const f = followFraming(at, vw, vh, FOLLOW_SCALE);
    const dx = at[0] - f.position[0], dy = at[1] - f.position[1], dz = at[2] - f.position[2];
    const across = dx * CAMERA_BASIS.x[0] + dy * CAMERA_BASIS.x[1] + dz * CAMERA_BASIS.x[2];
    const down = dx * CAMERA_BASIS.y[0] + dy * CAMERA_BASIS.y[1] + dz * CAMERA_BASIS.y[2];
    assert.ok(Math.abs(across) < 1e-9, `at ${vw}x${vh} the followed point sits ${across} off-centre across`);
    assert.ok(Math.abs(down) < 1e-9, `at ${vw}x${vh} the followed point sits ${down} off-centre down`);
  }
});

test("the follow view keeps the projection's 2:1", () => {
  // `solid.test.ts` asserts the tie for the fit; the follow builds its own
  // frustum, so the same tie is asserted here or the follow could invent a
  // different picture. One world step along x must land `scale / 2` pixels
  // across and `scale / 4` down, exactly as `project` moves the picture.
  const at: [number, number, number] = [10, 10, 0];
  for (const [vw, vh] of [[968, 900], [1200, 400]] as const) {
    const f = followFraming(at, vw, vh, FOLLOW_SCALE);
    const px = (s: readonly number[]): number =>
      (s[0] * CAMERA_BASIS.x[0] + s[1] * CAMERA_BASIS.x[1] + s[2] * CAMERA_BASIS.x[2])
      * (vw / (2 * f.halfWidth));
    const py = (s: readonly number[]): number =>
      (s[0] * CAMERA_BASIS.y[0] + s[1] * CAMERA_BASIS.y[1] + s[2] * CAMERA_BASIS.y[2])
      * (vh / (2 * f.halfHeight));
    const step = [1, 0, 0] as const;
    assert.ok(Math.abs(px(step) - f.scale * 0.5) < 1e-6, `at ${vw}x${vh} a step moved ${px(step)} px across, not ${f.scale * 0.5}`);
    assert.ok(Math.abs(py(step) - f.scale * 0.25) < 1e-6, `at ${vw}x${vh} a step moved ${py(step)} px down, not ${f.scale * 0.25}`);
  }
});

test("the follow frame has the picture's handedness", () => {
  // `Framing.halfTop` records why the top must be negative; a follow that lost
  // it would draw the town mirrored around the followed machine. Also: the
  // frustum holds the point with room to spare on both axes, and the camera
  // stands a fixed distance back along the view axis.
  const at: [number, number, number] = [200, 100, 3];
  const f = followFraming(at, 800, 600, FOLLOW_SCALE);
  assert.ok(f.halfTop < 0, "the follow frame lost the negative halfTop");
  assert.ok(f.halfBottom > 0, "the follow frame has no bottom half");
  assert.ok(f.halfWidth > 0 && f.halfHeight > 0, "the follow frustum has no area");
  const back = Math.hypot(
    at[0] - f.position[0], at[1] - f.position[1], at[2] - f.position[2],
  );
  assert.ok(Math.abs(back - 1000) < 1e-9, "the camera is not a fixed distance behind the point");
});

// ---------------------------------------------------------------------------
// What the scene side must hand the policy
// ---------------------------------------------------------------------------

test("the framing the scene applies is the scale the policy returned", () => {
  // The scene's frame loop is expected to pass `followScale(...)`'s own output
  // back into `followFraming` — round-tripped here so a mismatch between the
  // two calls cannot hide in the scene.
  for (const current of [0.5, 0.98, 2, 5]) {
    const f = followFraming([50, 50, 0], 968, 900, followScale(current));
    assert.equal(f.scale, followScale(current), `scale ${current} did not survive the round trip`);
  }
  // And the frame narrows in lockstep with the scale, as the fit's does.
  const near = followFraming([50, 50, 0], 800, 600, FOLLOW_SCALE);
  const closer = followFraming([50, 50, 0], 800, 600, FOLLOW_SCALE * 2);
  assert.ok(closer.halfWidth < near.halfWidth, "a larger scale did not narrow the frustum");
});
