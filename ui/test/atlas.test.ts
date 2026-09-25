// The atlas's own limits.
//
// Tested here rather than through a bake because the failure this guards against
// is *silent*: an oversized canvas does not throw, it produces a blank texture,
// so a town that hit the limit would render as an empty field with every sprite
// invisible. The only way to know the guard works is to drive it past the limit
// and assert the refusal.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { assertAtlasFits, bakedCels, layoutAtlas } from "../src/art/bake";
import { Pix } from "../src/art/surface";

/** A cel of a given size. Empty is fine: only its dimensions matter here. */
const cel = (w: number, h: number) => ({ pix: new Pix(w, h) });

test("the layout rounds each dimension up to a power of two", () => {
  // 16 per row, sized to the widest and tallest cel, plus a 2px gutter.
  const l = layoutAtlas([cel(100, 50), cel(20, 30)]);
  assert.equal(l.perRow, 16);
  assert.equal(l.cellW, 102, "cell width must be the widest cel plus the gutter");
  assert.equal(l.cellH, 52, "cell height must be the tallest cel plus the gutter");
  assert.equal(l.rows, 1, "one row holds sixteen cels");
  assert.equal(l.width, 2048, "16 x 102 is 1632, rounded up to 2048");
  assert.equal(l.height, 64, "1 x 52 is 52, rounded up to 64");
});

test("the layout grows in rows rather than in width", () => {
  // The sheet is a fixed width of sixteen columns, so adding cels adds height.
  // This is the shape that makes the ceiling reachable: past 8192 a side the
  // height doubles to 16384 and the texture is gone.
  const one = layoutAtlas(Array.from({ length: 16 }, () => cel(100, 100)));
  const two = layoutAtlas(Array.from({ length: 17 }, () => cel(100, 100)));
  assert.equal(one.rows, 1);
  assert.equal(two.rows, 2, "the seventeenth cel must open a second row");
  assert.equal(one.width, two.width, "adding a row must not widen the sheet");
  assert.ok(two.height > one.height, "adding a row must deepen the sheet");
});

test("the real atlas fits, with room to spare", () => {
  // Built from the actual cels rather than a remembered count and size, so this
  // cannot go stale: adding art moves these numbers and the test moves with them.
  // Asserted directly rather than only via `doesNotThrow`, so the current margin
  // is visible in the failure message when it eventually runs out.
  const cels = bakedCels();
  const l = layoutAtlas(cels);
  assert.doesNotThrow(() => assertAtlasFits(cels.length, l), "the town must bake");
  assert.ok(
    l.height <= 8192,
    `the real atlas is ${l.width}x${l.height} for ${cels.length} cels and no longer fits`,
  );
  assert.ok(l.width * l.height <= 16_777_216, "the real atlas is already over the area limit");
});

test("a sheet past the side limit is refused, and says why", () => {
  // Sized to overshoot on purpose and built directly rather than by baking, so the
  // test is fast and does not depend on how many cels any particular change adds.
  // It computes its own cels, so it stays a test of the guard and not of today's
  // art budget.
  const n = 1200;
  const tooTall = layoutAtlas(Array.from({ length: n }, () => cel(113, 111)));
  assert.ok(tooTall.height > 8192, "this test needs a sheet that is genuinely over");
  assert.throws(
    () => assertAtlasFits(n, tooTall),
    (e: Error) => {
      // The message must be actionable: the dimensions, which limit was broken,
      // and the two numbers a caller can change (cel count and cel size).
      assert.match(e.message, /atlas would be/, "must state the size it wanted");
      assert.match(e.message, /height \d+ > 8192/, "must name the limit that broke");
      assert.match(e.message, /1200 cels/, "must state the cel count");
      // The laid-out cell includes the 2px gutter, so it is 115x113 rather than
      // the 113x111 the cel was drawn at. Reporting the sheet's own cell is the
      // more useful number — it is what every row is pitched by.
      assert.match(e.message, /115x113/, "must state the cell pitch it used");
      return true;
    },
    "an oversized atlas must refuse rather than bake a blank texture",
  );
});

test("an empty bake is refused rather than laid out as a NaN sheet", () => {
  // `Math.max` of nothing is -Infinity, so an empty bake would sail through the
  // size comparisons as a NaN-sized canvas instead of failing where the mistake is.
  assert.throws(() => layoutAtlas([]), /no cels/, "an empty bake is a caller mistake, not a sheet");
});
