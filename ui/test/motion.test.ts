// A machine that drives, rather than one that is carried across the map.
//
// Two claims, and they are the difference between a figure that is somewhere and
// a figure that is going somewhere:
//
//   1. **Facing.** A machine's world direction decides which way it is drawn, the
//      way the road it is standing on already does. The road is turned by the
//      view, so a machine that read its facing off picture coordinates would be
//      agreeing with the road only at turn 0 — and a town that can be turned is a
//      town where that agreement is not an accident worth relying on. The rule is
//      `WorldView.screenDir`'s: the sign of the screen-x component is the flip.
//   2. **Cadence.** A walk that holds one pose is a slide. The steps are read off
//      the art's own `FRAME_MS.walk` table at a rate set by how much ground the
//      machine is actually covering, so a short hop does not take as many steps
//      as a long haul and a fast crossing does not moonwalk.
//
// The journeys below are the ones `WorkerLayer.move` derives: a route of `walked`
// picture pixels takes `round(walked / 14)` walk cycles, capped at seven, and a
// cycle is the art's own 4 x 120ms. They are written out rather than imported
// because that derivation is not exported, and a second copy of it here would be
// a second thing to keep right.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { FRAME_MS } from "../src/art/worker";
import { TURNS, WorldView } from "../src/view";
import { mirrored, walkLift, walkPhase, worldDirection } from "../src/workers";

/** One walk cycle's duration, as the layer reads it from the art's table. */
const CYCLE_MS = FRAME_MS.walk.reduce((a, b) => a + b, 0);

/** A journey in picture pixels and milliseconds. */
interface Journey {
  walked: number;
  ms: number;
}

/** A short hop: 10px, one cycle (round(10/14) is 1), so 480ms. */
const HOP: Journey = { walked: 10, ms: CYCLE_MS };
/** A long haul: 300px, seven cycles (round(300/14) is 21, capped at 7), so
 *  3360ms — and therefore a crossing far faster than the hop, which is the
 *  whole of what a longer journey buys. */
const HAUL: Journey = { walked: 300, ms: 7 * CYCLE_MS };
/** Travel at exactly the art's reference rate: one 14px stride per cycle. */
const REFERENCE: Journey = { walked: 14 * 3, ms: 3 * CYCLE_MS };

/** How many times the pose changes in the first `ms` of a journey, sampled each
 *  millisecond — the same count a reader watching the map would make. */
function advances(journey: Journey, ms: number): number {
  let changes = 0;
  let last = walkPhase(journey.walked, journey.ms, 0);
  for (let t = 1; t <= ms; t++) {
    const pose = walkPhase(journey.walked, journey.ms, t);
    if (pose !== last) changes++;
    last = pose;
  }
  return changes;
}

test("a machine faces the way the road under it points", () => {
  // The two axis-aligned roads the map draws: world +x runs east, world +y runs
  // north. The expected flips are worked through the projection by hand rather
  // than read back out of it, so a turn table that moved would fail here instead
  // of being restated.
  const expected = [
    { turn: 0, east: false, north: true }, // screen right, and screen left
    { turn: 1, east: false, north: false }, // both read as screen right
    { turn: 2, east: true, north: false }, // east reads as screen left
    { turn: 3, east: true, north: true }, // both read as screen left
  ];
  for (const want of expected) {
    const view = new WorldView(want.turn);
    assert.equal(mirrored(view, 1, 0), want.east, `world +x at turn ${want.turn}`);
    assert.equal(mirrored(view, 0, 1), want.north, `world +y at turn ${want.turn}`);
  }
});

test("the flip is the view's own rule, not a second copy of it", () => {
  // The test above is what says the rule is the right one; this says the layer
  // asks rather than re-derives, at every turn and for directions on both sides
  // of both axes. A copy of the rule that fell behind `screenDir` would agree
  // with it here and disagree with the map everywhere.
  for (const turn of TURNS) {
    const view = new WorldView(turn);
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
      [3, 1],
      [-2, 5],
    ]) {
      const dir = view.screenDir(dx, dy);
      assert.equal(
        mirrored(view, dx, dy),
        dir.x < 0,
        `world (${dx}, ${dy}) at turn ${turn}: screen x is ${dir.x}`,
      );
    }
  }
});

test("a road running straight away from the camera keeps the authored facing", () => {
  // World (1, 1) is the diagonal, and the projection sends it straight up the
  // screen at turn 0 and straight down at turn 2 — no screen x at all, so no
  // opinion. A mirror that flickered on and off as a machine crossed that line
  // would be the map saying two things at once. At the turns where the same road
  // runs across the screen it does flip, because there it has a left and a right.
  for (const [turn, x] of [
    [0, 0],
    [1, 1],
    [2, 0],
    [3, -1],
  ]) {
    const view = new WorldView(turn);
    assert.equal(view.screenDir(1, 1).x, x, `the diagonal's screen x at turn ${turn}`);
    assert.equal(mirrored(view, 1, 1), x < 0, `the diagonal at turn ${turn}`);
  }
});

/** Asserts a direction component by component. `===` rather than `deepEqual`
 *  because the turn's negation of zero is a negative zero, and a negative zero
 *  is the same direction as a positive one — a test that failed on the sign of
 *  nothing would be the test lying rather than the code. */
function sameDirection(actual: { x: number; y: number }, wx: number, wy: number, what: string): void {
  assert.ok(actual.x === wx, `${what}: x is ${actual.x}, not ${wx}`);
  assert.ok(actual.y === wy, `${what}: y is ${actual.y}, not ${wy}`);
}

test("the world direction of a screen vector is the map's own, at each turn", () => {
  // Anchored by hand rather than by round trip. Screen (0.5, 0.25) is what world
  // +x reads as upright, and at turn 1 the road that draws it is world +y — the
  // same picture, a different road, which is the whole of what a turn is.
  sameDirection(worldDirection(new WorldView(0), 0.5, 0.25), 1, 0, "turn 0, screen (0.5, 0.25)");
  sameDirection(worldDirection(new WorldView(1), 0.5, 0.25), 0, 1, "turn 1, screen (0.5, 0.25)");
  sameDirection(worldDirection(new WorldView(0), 0, 0.5), 1, 1, "turn 0, the diagonal");
  sameDirection(worldDirection(new WorldView(2), 0, 0.5), -1, -1, "turn 2, the diagonal");
});

test("a journey's direction survives being carried back through the turn", () => {
  // The layer walks a picture-space polyline, so its leg directions arrive in
  // screen units and have to be taken back to world units before the view is
  // asked. That the round trip lands where it started is the whole of the claim:
  // a turn applied here instead of undone would send every machine the wrong way
  // at every turn but 0, which is invisible until it is not.
  for (const turn of TURNS) {
    const view = new WorldView(turn);
    for (const [sx, sy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
      [1, 1],
      [0.5, 0.25],
    ]) {
      const world = worldDirection(view, sx, sy);
      const back = view.screenDir(world.x, world.y);
      assert.equal(back.x, sx, `world (${world.x}, ${world.y}) at turn ${turn} read back as x ${back.x}`);
      assert.equal(back.y, sy, `world (${world.x}, ${world.y}) at turn ${turn} read back as y ${back.y}`);
    }
  }
});

test("a long haul takes more steps than a short hop over the same time", () => {
  const window = 400;
  assert.ok(window < HOP.ms, "the window must fall inside the hop, or the hop has arrived");
  const hop = advances(HOP, window);
  const haul = advances(HAUL, window);
  assert.ok(hop > 0, "a machine in flight never took a step; the walk is a held pose");
  assert.ok(
    haul > hop,
    `a ${HAUL.walked}px haul took ${haul} steps and a ${HOP.walked}px hop took ${hop} over ${window}ms — the cadence is not tied to the ground covered`,
  );
});

test("a crossing at the art's own reference speed is read at the art's own rhythm", () => {
  // One stride per cycle is the speed `FRAME_MS.walk` and the 14px stride were
  // drawn against, and at that speed the table is used exactly as written: a
  // pose every 120ms.
  for (let t = 0; t < CYCLE_MS; t += 10) {
    assert.equal(
      walkPhase(REFERENCE.walked, REFERENCE.ms, t),
      Math.floor(t / FRAME_MS.walk[0]),
      `at ${t}ms the reference speed is not on the art's own ${FRAME_MS.walk[0]}ms pose`,
    );
  }
  // Three cycles of travel and three cycles of steps, so a machine sets off and
  // arrives in the same pose rather than standing there mid-stride.
  assert.equal(walkPhase(REFERENCE.walked, REFERENCE.ms, REFERENCE.ms), 0);
});

test("a fast crossing steps faster than the reference, and a slow one slower", () => {
  const fast: Journey = { walked: 14 * 20, ms: 5 * CYCLE_MS };
  const slow: Journey = { walked: 14, ms: 40 * CYCLE_MS };
  const atReference = advances(REFERENCE, 960);
  assert.ok(
    advances(fast, 960) > atReference,
    "a machine covering ground faster than the reference reads as moonwalking",
  );
  assert.ok(advances(slow, 960) < atReference, "a machine crawling along reads as hurrying");
});

test("the cadence is bounded at both ends, so it never blurs or stalls", () => {
  // The haul is already past the fast bound (its raw rate is 3.06), so it is the
  // yardstick: one pose every 60ms. A journey far faster reads the same, because
  // past that point a one-pixel ride is a shimmer and the machine is expected to
  // cover more ground per step instead — the same trade `MAX_CYCLES` takes.
  const farFaster: Journey = { walked: 14 * 40, ms: 2 * CYCLE_MS };
  assert.equal(walkPhase(HAUL.walked, HAUL.ms, 59), 0);
  assert.equal(walkPhase(HAUL.walked, HAUL.ms, 60), 1);
  assert.equal(walkPhase(farFaster.walked, farFaster.ms, 60), 1, "a far faster crossing blurs");
  assert.equal(walkPhase(farFaster.walked, farFaster.ms, 120), 2);

  // And a crawl is not slower than a pose every 240ms: held longer than that, a
  // machine on the map reads as stopped, and a map that says the agent stopped is
  // lying about it.
  const crawl: Journey = { walked: 14, ms: 400 * CYCLE_MS };
  assert.equal(walkPhase(crawl.walked, crawl.ms, 239), 0);
  assert.equal(walkPhase(crawl.walked, crawl.ms, 240), 1);
});

test("the ride is a bounce on the tracks, not a lift off the ground", () => {
  // Every walk pose is visited over a full cycle, and the body never leaves its
  // tracks: one pixel, down for half the cycle and up for the other half. A ride
  // with a single low pose is a stutter, and one of two pixels puts the machine's
  // own undercarriage in the air.
  const seen = new Set<number>();
  for (let t = 0; t < CYCLE_MS; t++) {
    const pose = walkPhase(HAUL.walked, HAUL.ms, t);
    seen.add(pose);
    assert.ok(walkLift(pose) === 0 || walkLift(pose) === 1, `the body rode ${walkLift(pose)}px`);
  }
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3], "a walk cycle must visit every pose the art paces");
  assert.equal(walkLift(0), 0);
  assert.equal(walkLift(1), 1);
  assert.equal(walkLift(2), 1);
  assert.equal(walkLift(3), 0);
});

test("a journey that measured nothing still gets the art's rhythm", () => {
  // The first frame of a journey, and any degenerate route: the reference rate,
  // so a machine is never frozen or blurred by a number that was never measured.
  for (const journey of [
    { walked: 0, ms: CYCLE_MS },
    { walked: 10, ms: 0 },
  ]) {
    assert.equal(walkPhase(journey.walked, journey.ms, 0), 0);
    assert.equal(walkPhase(journey.walked, journey.ms, FRAME_MS.walk[0]), 1);
  }
  assert.equal(walkPhase(HAUL.walked, HAUL.ms, -5), 0, "a clock before the journey has no pose");
  // And the pose is a cycle rather than a counter: an hour into a walk is the
  // same walk, which is what keeps a long crossing from costing a long loop.
  assert.equal(walkPhase(HAUL.walked, HAUL.ms, 3_600_000), walkPhase(HAUL.walked, HAUL.ms, 0));
});
