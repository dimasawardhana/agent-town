// The land is bigger than the frame it is seen in.
//
// The town was a diorama: an isometric rectangle sized to the content, which
// projected to a diamond that fit inside the viewport with sky all the way
// round it. Measured at 935x817 against an 884x860 frame — 83.6% green and a
// picture floating in a void.
//
// This asserts the one property that fixes it and that is checkable without a
// browser: **the land's projected diamond is larger than the frame in both
// axes**, so no zoom that shows the frame can also show all of the land, and the
// field therefore runs off the edges instead of ending inside them.
//
// It is deliberately about the *land*, not about where the camera was pointed.
// Two reframings were tried against a bigger land and both were worse than
// centring; the thing that made the picture better was the field being large, and
// this is the test for that.

import { strict as assert } from "node:assert";
import { test } from "node:test";

// **Imported, never re-declared.** The first version of this test kept its own
// `LAND_APRON = 900`, and the mutation that shrinks the scene's apron to three
// tiles passed it: the test was asserting its own copy of the number. That is the
// same mistake as the light-pattern one and the pennant's, and it is the reason
// these two constants live in `visibility.ts`, which is pure, rather than in
// `scene.ts`, which a node test cannot import without Phaser.
import { LAND_APRON, LAND_BACK, landBox } from "../src/visibility";

/** The smallest viewport this town has to look right in. The panel takes the
 *  right-hand side, so the canvas is narrower than the window by a good margin,
 *  and the height is the window's. Taken as a pair because the land has to beat
 *  *both* — beating one and losing the other is the diorama again. */
const VIEWPORT = { w: 884, h: 860 };

/** The same projection the scene uses, restated rather than imported: it is two
 *  lines of arithmetic, and a test that imported the scene's would be testing the
 *  scene's copy of itself. */
const project = (x: number, y: number) => ({ x: (x - y) / 2, y: (x + y) / 4 });

/** The town this map was measured on, so the number below is a real one. */
const TOWN = { width: 1044, height: 634 };

test("the land is wider than the frame it is seen in", () => {
  const b = landBox(TOWN.width, TOWN.height, LAND_APRON, project, LAND_BACK);
  const w = b.maxX - b.minX;
  assert.ok(
    w > VIEWPORT.w,
    `the land is ${Math.round(w)}px wide on an ${VIEWPORT.w}px frame, so its left and right corners are both inside the picture`,
  );
});

test("the land is taller than the frame it is seen in", () => {
  const b = landBox(TOWN.width, TOWN.height, LAND_APRON, project, LAND_BACK);
  const h = b.maxY - b.minY;
  assert.ok(
    h > VIEWPORT.h,
    `the land is ${Math.round(h)}px tall on an ${VIEWPORT.h}px frame, so its far corner is inside the picture`,
  );
});

test("the near corner is where the field starts, and only just behind it", () => {
  // The land's near corner is the only point above which there is sky, so the
  // composition turns on where it is. The apron pushes it *up* by `apron / 2`,
  // which is why the apron is so large and the back margin is three tiles and no
  // more: `LAND_BACK` is the only thing holding the near corner near the town.
  //
  // (A comment in `scene.ts` claimed the opposite — that the back margin does not
  // move the near corner — and this test is what found it.)
  const padded = landBox(TOWN.width, TOWN.height, LAND_APRON, project, LAND_BACK);
  const bare = landBox(TOWN.width, TOWN.height, LAND_APRON, project);
  assert.equal(padded.minY, -LAND_BACK / 2, "the near corner is not the back margin behind the town");
  // Half the margin, because the projection halves it — and a couple of dozen
  // pixels, which is the whole point of keeping this margin small against a
  // forward apron of 900.
  assert.ok(
    Math.abs(-padded.minY - LAND_BACK / 2) < 1,
    `the near corner is ${(-padded.minY).toFixed(0)}px above the town, not half the back margin`,
  );
  assert.ok(
    -padded.minY < LAND_APRON / 4,
    `the near corner is ${(-padded.minY).toFixed(0)}px above the town — the apron is reaching behind it`,
  );
  // And the measurement this whole change rests on: with three tiles of pad the
  // land is **468px tall on an 860px frame**, so its far corner sits inside the
  // picture and there is sky below it — that is the diorama. With the apron it is
  // taller than the frame, so it is not.
  //
  // (An earlier version of this test asserted the old land *fitted* inside the
  // frame. It never did — it was 935px wide on an 884px one. The axis that was
  // wrong is the height, and height is what put a corner inside the picture.)
  const before = landBox(TOWN.width, TOWN.height, LAND_BACK, project, LAND_BACK);
  const beforeH = before.maxY - before.minY;
  assert.ok(
    beforeH < VIEWPORT.h,
    `a three-tile pad is now ${Math.round(beforeH)}px tall on an ${VIEWPORT.h}px frame; the far corner is no longer inside the picture and this test no longer describes the defect`,
  );
  const afterH = padded.maxY - padded.minY;
  assert.ok(afterH > VIEWPORT.h, `the apron leaves the land at ${Math.round(afterH)}px, inside the frame`);
});

test("the land is still measured and painted from the same two numbers", () => {
  // `drawGround` and `extents` both size the land, and a land *measured* smaller
  // than the land *painted* is how a camera finds an edge the reader can already
  // see. They cannot share a constant object without a cycle, so this pins the
  // arithmetic both sides do.
  const box = landBox(TOWN.width, TOWN.height, LAND_APRON, project, LAND_BACK);
  const painted = { x: -LAND_BACK, y: -LAND_BACK, w: TOWN.width + LAND_APRON + LAND_BACK, h: TOWN.height + LAND_APRON + LAND_BACK };
  const corners = [
    project(painted.x, painted.y),
    project(painted.x + painted.w, painted.y),
    project(painted.x, painted.y + painted.h),
    project(painted.x + painted.w, painted.y + painted.h),
  ];
  assert.equal(Math.round(Math.min(...corners.map((c) => c.x))), Math.round(box.minX));
  assert.equal(Math.round(Math.max(...corners.map((c) => c.x))), Math.round(box.maxX));
  assert.equal(Math.round(Math.min(...corners.map((c) => c.y))), Math.round(box.minY));
  assert.equal(Math.round(Math.max(...corners.map((c) => c.y))), Math.round(box.maxY));
});