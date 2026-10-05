// The worker and the sun, asserted without a renderer.
//
// Two of TASK-104's criteria are about nothing but numbers — that the sun's
// direction differs across the day, and that the rhythm differs between actions
// that share a pose — and they are asserted here rather than in a browser because
// a screenshot cannot show either one.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  FRAME_MS,
  POSE_FOR,
  POSES,
  WORKER_STATES,
  cycleMs,
  cyclePhase,
  gestureFor,
  pointAlong,
  stableOffset,
  standPoint,
  walkMs,
} from "../src/solid/machine";
import { fillFor, sunFor } from "../src/solid/sun";
import { CAMERA_BASIS } from "../src/solid/model";
import { DAY_PHASES } from "../src/daylight";
// The flat renderer's own copies, pinned rather than imported into the solid path.
import { FRAME_MS as FLAT_FRAME_MS } from "../src/art/worker";
import { POSE_FOR as FLAT_POSE_FOR } from "../src/art/machine";
import type { Site } from "../src/store";

const site: Site = {
  id: "building:x", kind: "building", label: "x", path: "x", files: 1, bytes: 4096, depth: 1,
  x: 100, y: 200, w: 80, h: 60, floors: 3,
};

// ---------------------------------------------------------------------------
// The vocabulary, pinned against the flat renderer's.
// ---------------------------------------------------------------------------

test("the pose table is the flat renderer's, state for state", () => {
  // Imported into the test and never into the renderer: the flat art modules are
  // frozen (ADR-0024) and must not become load-bearing for the solid path. A copy
  // that drifted would show one action two ways in the two renderers.
  for (const [state, pose] of Object.entries(FLAT_POSE_FOR)) {
    assert.equal(
      POSE_FOR[state as keyof typeof POSE_FOR],
      pose,
      `${state} folds to a different pose in the solid town`,
    );
  }
  for (const state of WORKER_STATES) assert.ok(POSE_FOR[state], `${state} has no pose`);
});

test("the cadence is the flat renderer's, state for state", () => {
  for (const [state, frames] of Object.entries(FLAT_FRAME_MS)) {
    assert.deepEqual(
      FRAME_MS[state as keyof typeof FRAME_MS],
      frames,
      `${state} has a different cadence in the solid town`,
    );
  }
});

test("every state has a pose and a cadence, and no cadence is empty", () => {
  // A state with no frames would divide by zero in `cyclePhase`; a state with no
  // pose would draw nothing. Both are compile errors through the `Record` types,
  // and this catches the runtime half a `Record` cannot.
  for (const state of WORKER_STATES) {
    assert.ok(POSE_FOR[state], `${state} has no pose`);
    assert.ok(FRAME_MS[state] && FRAME_MS[state].length > 0, `${state} has no cadence`);
    assert.ok(cycleMs(state) > 0, `${state} has a zero-length cycle`);
  }
  assert.equal(new Set(WORKER_STATES).size, WORKER_STATES.length, "a state appears twice");
  assert.equal(new Set(POSES).size, POSES.length, "a pose appears twice");
});

// ---------------------------------------------------------------------------
// The rhythm — the criterion a screenshot cannot show.
// ---------------------------------------------------------------------------

test("actions sharing a pose still have their own rhythm", () => {
  // **The criterion, asserted directly.** Five states share the `work` pose, and
  // if they also shared a cadence the town would show a test run and a demolition
  // identically — which is the failure README.md's "each action has its own
  // rhythm" sentence exists to rule out.
  const work = WORKER_STATES.filter((s) => POSE_FOR[s] === "work");
  assert.ok(work.length >= 5, `only ${work.length} states share the work pose`);

  const periods = work.map(cycleMs);
  for (let i = 0; i < work.length; i++) {
    for (let j = i + 1; j < work.length; j++) {
      assert.notEqual(
        periods[i],
        periods[j],
        `${work[i]} and ${work[j]} both take ${periods[i]}ms — the same rhythm`,
      );
    }
  }
});

test("a strike is uneven and a wait is even", () => {
  // The cadence's *shape*, not just its total. A hammer blow is fast on the way
  // down and slow on the way back, so no two of its frames are the same length;
  // testing is an even four-beat, so all of its are. Asserting only the period
  // would let a metronome pass as a hammer.
  const hammer = FRAME_MS.hammering;
  assert.ok(new Set(hammer).size > 1, "hammering has one frame length, so it swings evenly");
  assert.ok(Math.min(...hammer) < Math.max(...hammer), "hammering has no fast/slow contrast");

  const testing = FRAME_MS.testing;
  assert.equal(new Set(testing).size, 1, "testing is not an even beat");
});

test("a phase advances through a cycle and wraps at the end", () => {
  for (const state of WORKER_STATES) {
    const period = cycleMs(state);
    assert.ok(Math.abs(cyclePhase(state, 0)) < 1e-9, `${state} does not start at 0`);
    // Sample *strictly inside* the cycle: `cyclePhase(state, period)` is the wrap
    // back to 0, and sampling it here would read as the phase going backwards —
    // which is what the first version of this test asserted and it was wrong.
    let previous = -1;
    for (let k = 0; k < 20; k++) {
      const p = cyclePhase(state, (period * k) / 20);
      assert.ok(p >= 0 && p < 1, `${state} phase ${p} escaped [0,1)`);
      assert.ok(p > previous, `${state} phase did not advance at ${k}/20`);
      previous = p;
    }
    assert.ok(Math.abs(cyclePhase(state, period)) < 1e-9, `${state} does not wrap to 0`);
    assert.ok(
      Math.abs(cyclePhase(state, period * 3.5) - cyclePhase(state, period * 0.5)) < 1e-9,
      `${state} is not periodic`,
    );
  }
});

test("the strike occupies less of the cycle than the recovery", () => {
  // The gesture's asymmetry, which is the thing that makes a blow read as a blow.
  // Asserted on the gesture rather than on the cadence because it is the gesture
  // that has to carry it: `work` is one pose for five states.
  let slowest = -1;
  let slowestAt = 0;
  for (let k = 0; k < 40; k++) {
    const t = k / 40;
    const a = gestureFor("work", t).swing;
    const b = gestureFor("work", (k + 1) / 40).swing;
    const speed = Math.abs(b - a);
    if (speed < slowest || slowest < 0) { slowest = speed; slowestAt = t; }
  }
  assert.ok(slowestAt > 0.35, `the slow part of the stroke is at ${slowestAt}, not after the strike`);
});

// ---------------------------------------------------------------------------
// The gesture.
// ---------------------------------------------------------------------------

test("every pose moves, and they do not move alike", () => {
  // **Motion, not swing.** `travel` deliberately holds its arm still and moves
  // its body instead — asserted on its own below — so a check that only watched
  // the boom would call the one pose that is *driving* the one pose that is dead.
  const samples: Record<string, number[]> = {};
  // **Sixteen samples, not four.** Four points at even quarters landed exactly on
  // the zeros of the travelling bob — whose period is half a cycle — and the test
  // reported a live gesture as static. A sample set that can miss a whole motion
  // is a sample set that proves nothing about the ones it does catch.
  const AT = Array.from({ length: 16 }, (_, k) => k / 16);
  for (const pose of POSES) {
    const frames = AT.map((t) => gestureFor(pose, t));
    for (const g of frames) {
      assert.ok(
        Number.isFinite(g.swing) && Number.isFinite(g.reach) && Number.isFinite(g.travel),
        `${pose} produced a non-finite gesture`,
      );
    }
    const spread = Math.max(
      Math.max(...frames.map((g) => g.swing)) - Math.min(...frames.map((g) => g.swing)),
      Math.max(...frames.map((g) => g.travel)) - Math.min(...frames.map((g) => g.travel)),
    );
    assert.ok(spread > 1e-3, `${pose} does not move at all, so its gesture is static`);
    samples[pose] = frames.map((g) => g.swing * 100 + g.travel);
  }
  // The poses must be distinguishable from each other, or the table is decoration.
  for (const a of POSES) {
    for (const b of POSES) {
      if (a >= b) continue;
      assert.notDeepEqual(samples[a], samples[b], `${a} and ${b} gesture identically`);
    }
  }
  // And exactly one of them moves its body rather than its arm.
  const travelling = POSES.filter((p) => gestureFor(p, 0.3).travel !== 0);
  assert.deepEqual(travelling, ["travel"], `these poses move the tracks: ${travelling.join(", ")}`);
});

test("a travelling machine moves its body and holds its arm", () => {
  // The one pose whose motion is in the tracks rather than the boom: an arm
  // swinging while the machine drives would be a machine doing two things at once.
  const travel = [0, 0.25, 0.5].map((t) => gestureFor("travel", t));
  assert.ok(Math.max(...travel.map((g) => g.travel)) > 0, "a travelling machine does not move");
  assert.ok(new Set(travel.map((g) => g.swing)).size === 1, "a travelling machine swings its arm");
  for (const pose of ["work", "idle", "done"] as const) {
    assert.equal(gestureFor(pose, 0.3).travel, 0, `${pose} shows track motion`);
  }
});

test("the gesture is periodic and finite for a phase outside [0,1)", () => {
  for (const pose of POSES) {
    for (const t of [-2.5, -0.1, 1.7, 12.25]) {
      const g = gestureFor(pose, t);
      assert.ok(Number.isFinite(g.swing) && Number.isFinite(g.reach), `${pose} at ${t} is not finite`);
    }
    assert.ok(
      Math.abs(gestureFor(pose, 0.4).swing - gestureFor(pose, 3.4).swing) < 1e-9,
      `${pose} is not periodic`,
    );
  }
});

// ---------------------------------------------------------------------------
// Standing and walking.
// ---------------------------------------------------------------------------

test("a worker stands on its site, not beside it", () => {
  for (const id of ["a", "worker-1", "01a0fc26-3999-7223"]) {
    const at = standPoint(site, stableOffset(id));
    assert.ok(at.x >= site.x && at.x <= site.x + site.w, `${id} stands outside the plot in x`);
    assert.ok(at.y >= site.y && at.y <= site.y + site.h, `${id} stands outside the plot in y`);
  }
});

test("the spread scales to the site, so a Yard and a hut both work", () => {
  // The flat renderer measured a fixed spread against a real Yard and got six
  // figures on top of each other. This asserts the property that fixed it: the
  // same offset covers proportionally more ground on a big site.
  const hut: Site = { ...site, x: 0, y: 0, w: 44, h: 44 };
  const yard: Site = { ...site, x: 0, y: 0, w: 420, h: 150 };
  const offset = { x: 0.5, y: 0.5 };
  const onHut = standPoint(hut, offset);
  const onYard = standPoint(yard, offset);
  assert.ok(onYard.x > onHut.x * 5, "the spread did not scale with the site");
});

test("a worker keeps its place when its neighbours change", () => {
  // Hashed from the worker's own id, not its index in the crew: a figure that
  // moved whenever a colleague arrived would be the town saying something false.
  const a = stableOffset("worker-a");
  const b = stableOffset("worker-a");
  assert.deepEqual(a, b, "the same id gave two different offsets");
  assert.notDeepEqual(a, stableOffset("worker-b"), "two ids landed on the same offset");
  for (const id of ["", "x", "a-longer-session-id-0123456789"]) {
    const o = stableOffset(id);
    assert.ok(o.x >= -0.5 && o.x <= 0.5 && o.y >= -0.5 && o.y <= 0.5, `${id} is off the spread`);
  }
});

test("a journey is distance-proportional with a floor, and never overshoots", () => {
  const here = { x: 0, y: 0 };
  const far = { x: 900, y: 0 };
  const near = { x: 10, y: 0 };
  assert.ok(walkMs(here, far) > walkMs(here, near), "a longer walk did not take longer");
  assert.ok(walkMs(here, here) >= 320, "a zero-distance walk had no floor");

  const mid = pointAlong(here, far, 0.5);
  assert.equal(mid.x, 450);
  // Clamped at both ends: an overshooting worker walks through a building.
  assert.deepEqual(pointAlong(here, far, -1), here, "an early t undershot the start");
  assert.deepEqual(pointAlong(here, far, 2), far, "a late t overshot the destination");
});

// ---------------------------------------------------------------------------
// The sun.
// ---------------------------------------------------------------------------

test("the sun's direction differs across the three phases", () => {
  // The criterion. A light that only changed brightness would be a filter over one
  // sun rather than a different hour, and a shadow that never moves is a shadow
  // the flat town already bakes.
  const suns = DAY_PHASES.map((p) => sunFor(p));
  for (let i = 0; i < suns.length; i++) {
    for (let j = i + 1; j < suns.length; j++) {
      const [a, b] = [suns[i], suns[j]];
      const dot = a.toSun.reduce((acc, v, k) => acc + v * b.toSun[k], 0);
      assert.ok(
        dot < 0.999,
        `${DAY_PHASES[i]} and ${DAY_PHASES[j]} have the same sun direction`,
      );
    }
  }
});

test("every sun direction is a unit vector", () => {
  for (const phase of DAY_PHASES) {
    const { toSun } = sunFor(phase);
    assert.equal(toSun.length, 3);
    assert.ok(
      Math.abs(Math.hypot(toSun[0], toSun[1], toSun[2]) - 1) < 1e-9,
      `${phase}'s sun is not unit length, so its intensity would scale with nothing`,
    );
    for (const v of toSun) assert.ok(Number.isFinite(v), `${phase}'s sun has a non-finite component`);
  }
});

test("the sun does not depend on the turn", () => {
  // ADR-0026 §3, asserted as the property it is. The sun is built from
  // `CAMERA_BASIS`, which is derived from the *projection* rather than from the
  // camera's current orientation — so it is a constant, and orbiting the camera
  // moves the reader without moving the light. A sun computed from the camera
  // would make every quarter turn re-light the town from a new angle, which is
  // the headlight the decision rejected.
  for (const phase of DAY_PHASES) {
    const first = sunFor(phase).toSun;
    const again = sunFor(phase).toSun;
    assert.deepEqual(again, first, `${phase}'s sun moved between two calls`);
  }
  // And it is a real world direction, not the camera's own axis: a sun exactly
  // along the view direction lights every face the reader can see equally, which
  // is the flattening the on-axis offset exists to avoid.
  for (const phase of DAY_PHASES) {
    const { toSun } = sunFor(phase);
    const alongView = toSun.reduce((acc, v, k) => acc + v * CAMERA_BASIS.z[k], 0);
    assert.ok(Math.abs(alongView) < 0.6, `${phase}'s sun is within a whisker of the view axis`);
  }
});

test("dusk is the warm hour and night is the dim one", () => {
  const day = sunFor("day");
  const dusk = sunFor("dusk");
  const night = sunFor("night");
  assert.ok(night.intensity < dusk.intensity, "night is not dimmer than dusk");
  assert.ok(night.intensity < day.intensity, "night is not dimmer than day");
  assert.ok(fillFor("night").intensity < fillFor("day").intensity, "night's fill is not dimmer than day's");
  // Dusk's key is the palette's horizon gold — the warm light the town's colours
  // were chosen against, which is why dusk is the default.
  assert.notEqual(dusk.colour, day.colour, "dusk and day share a key colour");
  assert.notEqual(night.colour, dusk.colour, "night and dusk share a key colour");
});
