// Roads must survive a turn.
//
// The turn transform is applied to the layout once, and anything the transform
// does not know about is left behind in the *unrotated* frame. A road that is
// not part of the transform does not drift — it disappears, because the
// transformed layout simply has none. That is the failure this pins.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { roadsAsLines, turnLayout } from "../src/view";

// Square, because a wide town turns nearly onto itself and a fixture that
// barely moves proves nothing about whether the roads moved with it.
interface Fixture {
  sites: { x: number; y: number; w: number; h: number }[];
  districts: { x: number; y: number; w: number; h: number }[];
  roads: { x: number; y: number; w: number; h: number; kind: string }[];
  width: number;
  height: number;
}
const layout: Fixture = {
  width: 300,
  height: 300,
  sites: [{ x: 40, y: 40, w: 60, h: 60 }],
  districts: [{ x: 40, y: 40, w: 200, h: 200 }],
  roads: [
    { x: 40, y: 150, w: 260, h: 20, kind: "row" },
    { x: 120, y: 70, w: 30, h: 30, kind: "district" },
  ],
};

test("a turn carries the roads with it", () => {
  const turned = turnLayout(1, layout) as Fixture & { roads: Fixture["roads"] };
  assert.ok(turned.roads, "the turned layout has no roads at all; they vanish on any turn");
  assert.equal(turned.roads.length, 2, "a road was dropped by the turn");
});

test("roads are rotated with everything else, not left in the old frame", () => {
  const turned = turnLayout(1, layout) as Fixture;
  const before = layout.roads.map((r) => `${r.x},${r.y}`);
  const after = turned.roads.map((r) => `${r.x},${r.y}`);
  // Turn 0 is the identity, so anything that changed here was actually moved.
  // The two roads must not still be sitting exactly where the layout declared
  // them while the buildings beside them have moved.
  const siteMoved = turned.sites[0].x !== layout.sites[0].x || turned.sites[0].y !== layout.sites[0].y;
  const roadMoved = before.some((b, i) => b !== after[i]);
  assert.ok(siteMoved, "the fixture did not actually move anything, so it proves nothing");
  assert.ok(roadMoved, "the sites moved but the roads did not");
});

test("a road's extent turns with the town, swapping as the geometry does", () => {
  // A quarter turn swaps width and height, so a horizontal band becomes a
  // vertical one. Asserting the *swap* is the point: a road that kept its
  // dimensions would be a band pointing the wrong way down a street.
  const turned = turnLayout(1, layout) as Fixture & { roads: Fixture["roads"] };
  for (let i = 0; i < layout.roads.length; i++) {
    const before = layout.roads[i];
    const after = turned.roads[i];
    assert.ok(
      (after.w === before.w && after.h === before.h) ||
        (after.w === before.h && after.h === before.w),
      `road ${before.kind} came out ${after.w}x${after.h} from ${before.w}x${before.h}`,
    );
    assert.equal(after.kind, before.kind, "a road changed kind on a turn");
  }
});

test("a road line spans the road, rather than being as long as the road is thick", () => {
  const project = (x: number, y: number) => ({ x: (x - y) / 2, y: (x + y) / 4 });
  // 100 long and 8 thick: the shape a gap between two rows has.
  const [line] = roadsAsLines([{ x: 0, y: 0, w: 100, h: 8, kind: "district" }], project);
  const span = Math.hypot(line.bx - line.ax, line.by - line.ay);
  const near = project(0, 0);
  const far = project(100, 8);
  const roadLen = Math.hypot(far.x - near.x, far.y - near.y);
  // Roughly half the road, because `a` is the centre and `b` the far end. The
  // slack is generous on purpose: what is being pinned is that the line is
  // *proportional to the road's length at all*.
  //
  // Taking `b` as the midpoint of the road's top edge instead — which is what
  // this did — makes the line's length a function of the road's *thickness*, so
  // a hundred-unit street came out two pixels long. Nothing noticed while the
  // lines only fed proximity tests; a car travelling one crawls two pixels and
  // never crosses.
  assert.ok(
    span > roadLen * 0.4,
    `a ${roadLen.toFixed(1)}px road produced a ${span.toFixed(1)}px line`,
  );
});

test("a road's width is its thickness, not how far it runs", () => {
  const project = (x: number, y: number) => ({ x: (x - y) / 2, y: (x + y) / 4 });
  const [long] = roadsAsLines([{ x: 0, y: 0, w: 122, h: 8, kind: "district" }], project);
  // Half of 8, floored at the 3px minimum. Taking the long side instead gave
  // 61, at which point every point in the district counts as being on the road
  // and the width stops carrying any information at all.
  assert.equal(long.halfWidth, 4, "a thin long road was given its length as its width");
  const [short] = roadsAsLines([{ x: 0, y: 0, w: 8, h: 122, kind: "district" }], project);
  assert.equal(short.halfWidth, 4, "the vertical case took the wrong side");
});









