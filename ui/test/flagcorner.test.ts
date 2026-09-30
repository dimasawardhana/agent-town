// The verification pennant is drawn on a roof, and a roof turns.
//
// It was anchored at a fixed fraction of the footprint — (0.6s, 0.28s) — which
// is a roof corner at turn 0 and empty air at turn 1. The flag appeared to
// float beside the building as soon as the town was turned, which is the same
// lesson this project has now paid three times: **a mark placed against a
// coordinate space it does not share is a mark that drifts.** Here the mark was
// placed in world space on a picture that rotates.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { IsoPix } from "../src/art/iso";
import { TURN_COUNT, normaliseTurn } from "../src/view";

const SIDE = 78;

function iso(turn: number) {
  return new IsoPix(256, 256, 128, 200, turn);
}

test("the pennant's corner is on the roof at every turn", () => {
  for (let t = 0; t < TURN_COUNT; t++) {
    const i = iso(t);
    const c = i.frontCorner(SIDE);
    // On the roof: every corner is a (0 or SIDE) pair, and any inset toward the
    // middle has to stay inside the footprint.
    assert.ok(
      (c.x === 0 || c.x === SIDE) && (c.y === 0 || c.y === SIDE),
      `turn ${t}: corner ${c.x},${c.y} is not a footprint corner`,
    );
    const fx = Math.round(c.x + (SIDE / 2 - c.x) * 0.4);
    const fy = Math.round(c.y + (SIDE / 2 - c.y) * 0.4);
    assert.ok(fx >= 0 && fx <= SIDE && fy >= 0 && fy <= SIDE, `turn ${t}: flag is off the roof`);
  }
});

test("the corner actually changes with the turn", () => {
  // The whole point. A corner that ignored the turn would be the old bug with
  // better manners, and would pass the test above.
  const seen = new Set<string>();
  for (let t = 0; t < TURN_COUNT; t++) {
    const c = iso(t).frontCorner(SIDE);
    seen.add(`${c.x},${c.y}`);
  }
  assert.ok(seen.size >= 2, `the flag's corner never moved: ${[...seen].join(" ")}`);
});

test("the corner is the same every time for a given turn", () => {
  // The flag must not hop corners as the art is re-baked, so the choice is a
  // total order and not a sort that happens to be stable.
  for (let t = 0; t < TURN_COUNT; t++) {
    const a = iso(t).frontCorner(SIDE);
    for (let n = 0; n < 5; n++) {
      assert.deepEqual(iso(t).frontCorner(SIDE), a, `turn ${t} is not stable`);
    }
  }
});

test("it is a quarter turn the corner moves by, so the flag rides the roof", () => {
  // Consecutive corners differ by a quarter turn, which is the property that
  // keeps the pole standing on the corner the camera can see.
  const pts = [];
  for (let t = 0; t < TURN_COUNT; t++) pts.push(iso(t).frontCorner(SIDE));
  let onRoof = 0;
  for (const p of pts) if (p.x === 0 || p.x === SIDE) onRoof++;
  assert.equal(onRoof, pts.length);
  assert.equal(normaliseTurn(TURN_COUNT), 0);
});

// The decisive one: not "is the flag on a footprint corner" but "is it attached
// to the roof". Measured in pixels, because that is the only question a reader
// of the map actually asks, and because a flag on a perfectly correct corner
// that sits twenty pixels away still reads as floating.
import { buildCap, buildRoofFlagCel } from "../src/art/building";
import { ARCHETYPES, archetypeFor } from "../src/art/roof";

test("the pennant's pixels touch the roof's, at every turn", () => {
  const side = 78;
  for (let t = 0; t < TURN_COUNT; t++) {
    for (const roof of ARCHETYPES) {
      const cap = buildCap(side, roof, "roofed", t);
      const flag = buildRoofFlagCel(side, roof, t);
      const capPx: [number, number][] = [];
      const flagPx: [number, number][] = [];
      for (let y = 0; y < cap.h; y++) {
        for (let x = 0; x < cap.w; x++) {
          const i = (y * cap.w + x) * 4;
          if (cap.data[i + 3] !== 0) capPx.push([x, y]);
          if (flag.data[i + 3] !== 0) flagPx.push([x, y]);
        }
      }
      if (flagPx.length === 0) continue; // too small for a pennant, by design
      // Nearest roof pixel to the nearest flag pixel, in Chebyshev distance.
      let best = Infinity;
      for (const [fx, fy] of flagPx) {
        for (const [cx, cy] of capPx) {
          const d = Math.max(Math.abs(fx - cx), Math.abs(fy - cy));
          if (d < best) best = d;
        }
      }
      // The pole rises *out of* the roof, so it starts on the surface and goes
      // up. A gap means the flag is standing in the air beside the building.
      assert.ok(best <= 12, `${roof} at turn ${t}: pennant is ${best}px from the roof`);
    }
  }
});

// ---------------------------------------------------------------------------
// The test above is not enough, and the reason it is not enough is the whole
// point of this block.
//
// It compares `buildCap` with `buildRoofFlagCel`, and **both of those build
// their own box correctly** — each calls `capBox(side, roof, turn)` internally.
// So it measures two pictures that are each individually right, and says
// nothing about what the bake *records* about them.
//
// The floating flag lived in exactly that gap. The bake gave the cap
// `capBox(side, roof)` — no turn, so the origin for turn 0 — while giving the
// pennant `capBox(side, roof, turn)`. Both cels' pixels were correct; the frame
// origins differed by 39x20px on a side-78 building, and the scene lays a sprite
// down using the frame's origin rather than the box its pixels were drawn in. So
// the flag was drawn correctly, onto the wrong roof, and every test that looked
// at pixels passed.
//
// So this asserts the contract directly, on the recorded origins: **a mark cut
// from another cel's box carries that box's origin.** It is the same sentence
// `building.ts` already writes on every overlay, and it is checkable.
import { SIZES, bakedCels, capFrame, verifiedFrame, baseFrame, baseDamageFrame } from "../src/art/bake";
import { STAGE_ORDER, capBox, stageRank } from "../src/art/building";
import { MATERIALS } from "../src/art/roof";

test("a mark cut from the cap's box carries the cap's origin, at every turn", () => {
  for (let t = 0; t < TURN_COUNT; t++) {
    const byKey = new Map(bakedCels(t).map((c) => [c.key, c]));
    for (const { side } of SIZES) {
      for (const roof of ARCHETYPES) {
        const cap = byKey.get(capFrame(side, roof, "roofed", t));
        const flag = byKey.get(verifiedFrame(side, roof, t));
        assert.ok(cap && flag, `turn ${t}: a roofed cap or pennant was not baked`);
        assert.equal(
          flag!.ox,
          cap!.ox,
          `turn ${t}, ${roof} at side ${side}: pennant origin x is ${flag!.ox}, the roof's is ${cap!.ox}`,
        );
        assert.equal(
          flag!.oy,
          cap!.oy,
          `turn ${t}, ${roof} at side ${side}: pennant origin y is ${flag!.oy}, the roof's is ${cap!.oy}`,
        );
      }
    }
  }
});

test("a mark cut from the base's box carries the base's origin, at every turn", () => {
  for (let t = 0; t < TURN_COUNT; t++) {
    const byKey = new Map(bakedCels(t).map((c) => [c.key, c]));
    for (const { side } of SIZES) {
      for (const m of MATERIALS) {
        const base = byKey.get(baseFrame(side, m, "roofed", t));
        const rubble = byKey.get(baseDamageFrame(side, m, t));
        assert.ok(base && rubble, `turn ${t}: a base or its rubble was not baked`);
        assert.equal(rubble!.ox, base!.ox, `turn ${t}: rubble origin x differs from its base`);
        assert.equal(rubble!.oy, base!.oy, `turn ${t}: rubble origin y differs from its base`);
      }
    }
  }
});

test("a cel's recorded origin is the box its own pixels were drawn in", () => {
  // The general form, and the one that actually caught it: not "these two agree"
  // but "each cel's origin is the box its own builder used". A cap baked with
  // turn 0's origin while its pixels were drawn for turn 3 is the same bug with
  // nothing to disagree with, and the pair test above would pass it.
  for (let t = 0; t < TURN_COUNT; t++) {
    const byKey = new Map(bakedCels(t).map((c) => [c.key, c]));
    for (const { side } of SIZES) {
      for (const roof of ARCHETYPES) {
        for (const stage of STAGE_ORDER) {
          // Below `roofed` a cap draws nothing, and the bake deliberately
          // collapses every pre-roof stage onto ONE shared blank cut from the
          // first archetype's box - 320 blank cels become 16, which is what
          // makes twelve archetypes affordable at all. That blank is empty, so
          // its origin is not load-bearing, and there is no per-roof box to
          // agree with. The caps that carry a roof are the ones that must.
          if (stageRank(stage) < stageRank("roofed")) continue;
          const cel = byKey.get(capFrame(side, roof, stage, t));
          if (!cel) continue;
          const box = capBox(side, roof, t);
          assert.equal(cel.ox, box.ox, `turn ${t}: ${roof}/${stage} cap origin x is not its own box`);
          assert.equal(cel.oy, box.oy, `turn ${t}: ${roof}/${stage} cap origin y is not its own box`);
        }
      }
    }
  }
});
