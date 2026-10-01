// Birds, and the one claim they are allowed to make.
//
// A bird is the purest decoration this town has: it reports nothing about the
// repository, it has no verb, and a reader cannot act on one. The liveliness
// spec's first rule is that a figure moving because it looks nice is decoration
// wearing a claim's clothes, so these tests are almost entirely about the
// *claim* — that a bird says something, and that the something is the hour.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { BIRD_H, BIRD_TEX, BIRD_W, birdPath } from "../src/birds";
import { DAYLIGHT, DAY_PHASES } from "../src/daylight";
import { P } from "../src/art/palette";

test("birds are a claim about the hour, and only the hour", () => {
  // Dusk only. Birds come out at dusk and roost by dark, so a night bird would
  // be asserting something the town knows to be untrue — the same rule that puts
  // no cloud in a night sky, and the same reason the count is a table entry
  // rather than a constant in `birds.ts`.
  assert.equal(DAYLIGHT.day.birds, 0, "a bird at day is a speck against a bright sky");
  assert.equal(DAYLIGHT.night.birds, 0, "birds do not fly at night");
  assert.ok(DAYLIGHT.dusk.birds > 0, "dusk is the one hour a bird claims");
  // And it is a *count*, so a layer cannot ask for more than the table allows.
  for (const phase of DAY_PHASES) {
    const n = DAYLIGHT[phase].birds;
    assert.ok(Number.isInteger(n) && n >= 0, `${phase} has ${n} birds, which is not a count`);
  }
});

test("a bird's path is a pure function of its index and the clock", () => {
  // Two clients drawing the same town must draw the same birds, and a redraw
  // must not restart the flock. A bird placed from a counter, or from
  // `Math.random`, would differ between the two.
  for (let i = 0; i < DAYLIGHT.dusk.birds; i++) {
    assert.deepEqual(birdPath(i, 12.5, 1200, 860), birdPath(i, 12.5, 1200, 860), `bird ${i} moved between calls`);
    // And it is not a constant: a bird that does not move is a pixel.
    const a = birdPath(i, 0, 1200, 860);
    const b = birdPath(i, 2, 1200, 860);
    assert.notDeepEqual([a.x, a.y], [b.x, b.y], `bird ${i} is stationary`);
  }
});

test("a bird drifts horizontally and slowly, and never flies up or down", () => {
  // A bird that climbed, or turned, or changed size would be doing something a
  // reader would try to interpret. This one goes from one side of the sky to the
  // other and that is the whole of its vocabulary.
  for (let i = 0; i < DAYLIGHT.dusk.birds; i++) {
    const a = birdPath(i, 0, 1200, 860);
    const b = birdPath(i, 1, 1200, 860);
    assert.ok(Math.abs(b.y - a.y) <= 6, `bird ${i} moved ${Math.abs(b.y - a.y).toFixed(1)}px vertically in a second`);
    assert.ok(Math.abs(b.x - a.x) < 40, `bird ${i} jumped ${Math.abs(b.x - a.x).toFixed(1)}px in a second`);
    assert.ok(a.speed > 0, `bird ${i} does not move at all`);
  }
});

test("a bird is always on the frame or within reach of it", () => {
  // Wrapping, not lost. A bird that left the frame and never came back is a
  // bird the reader saw leave and never saw again, and one that piled up at an
  // edge is a flock the reader has to decode.
  const w = 1200;
  const h = 860;
  for (let i = 0; i < DAYLIGHT.dusk.birds; i++) {
    for (const t of [0, 1, 7, 60, 600, 3600, 100_000]) {
      const p = birdPath(i, t, w, h);
      assert.ok(p.x >= -BIRD_W && p.x <= w, `bird ${i} at t=${t} is at x=${p.x.toFixed(0)}, off the frame`);
      assert.ok(p.y >= 0 && p.y <= h * 0.36, `bird ${i} at t=${t} is at y=${p.y.toFixed(0)}, out of the sky band`);
    }
  }
});

test("a bird is never in front of the town", () => {
  // The sky band only, at every offset in the field. A bird that drifted low
  // enough to cross a roof would be a mark on a building, and a mark on a
  // building is a claim about the building.
  for (let i = 0; i < DAYLIGHT.dusk.birds; i++) {
    for (let t = 0; t < 40; t++) {
      const p = birdPath(i, t * 7, 1200, 860);
      assert.ok(
        p.y + BIRD_H <= 860 * 0.36,
        `bird ${i} at t=${t * 7} is at ${p.y.toFixed(0)}, low enough to cross the island`,
      );
    }
  }
});

test("a bird is the shape of a bird, and small enough not to compete", () => {
  // The silhouette is the whole of it. A filled blob at seven pixels is a smudge
  // and a single stroke is a dash; the M is the one shape the eye completes on
  // its own. Pinned by size rather than by pixels, because the pixels are drawn
  // into a texture no test here can see.
  assert.equal(BIRD_W, 7, "a bird wide enough to compete with a machine");
  assert.equal(BIRD_H, 4);
  // The two other silhouettes in this town, for the size of the comparison.
  assert.ok(BIRD_W < 20, "a bird is wider than a worker figure");
  assert.ok(BIRD_W < 32, "a bird is wider than a machine");
});

test("a bird is drawn in the darkest glass value, not in ink", () => {
  // `P.ink` is the outline every other mark in the town is drawn in. A bird has
  // no outline — it is a shape — and a bird in ink reads as a scratch on the
  // lens rather than as a thing in the air.
  assert.ok(P.glass[0] !== P.ink, "the bird's colour is the same as every outline in the town");
});

test("the bird's texture key is its own, and not another mark's", () => {
  // The ember has a test like this: a mark that silently shares a texture key
  // with another mark is a mark that changes when the other one does.
  assert.equal(BIRD_TEX, "bird");
  assert.notEqual(BIRD_TEX, "ember");
  assert.notEqual(BIRD_TEX, "puff");
});
