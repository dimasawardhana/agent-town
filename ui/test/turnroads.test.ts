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
    { x: 120, y: 70, w: 30, h: 30, kind: "containment" },
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

test("a road line carries which end is the importer", () => {
  const project = (x: number, y: number) => ({ x: (x - y) / 2, y: (x + y) / 4 });
  const lines = roadsAsLines(
    [
      // Importer first: ui/src imports ui/shared.
      { x: 0, y: 0, w: 10, h: 4, kind: "import", from: "ui/src", to: "ui/shared" },
      // A containment road claims no direction, and must come back claiming none.
      { x: 20, y: 0, w: 10, h: 4, kind: "containment" },
    ],
    project,
  );
  assert.equal(lines[0].from, "ui/src");
  assert.equal(lines[0].to, "ui/shared");
  assert.equal(lines[1].from, undefined, "a containment road grew a direction");
  assert.equal(lines[1].to, undefined, "a containment road grew a direction");
});

test("a road line spans the road, rather than being as long as the road is thick", () => {
  const project = (x: number, y: number) => ({ x: (x - y) / 2, y: (x + y) / 4 });
  // 100 long and 8 thick: the shape an import road between two buildings has.
  const [line] = roadsAsLines([{ x: 0, y: 0, w: 100, h: 8, kind: "import" }], project);
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
  const [long] = roadsAsLines([{ x: 0, y: 0, w: 122, h: 8, kind: "import" }], project);
  // Half of 8, floored at the 3px minimum. Taking the long side instead gave
  // 61, at which point every point in the district counts as being on the road
  // and the width stops carrying any information at all.
  assert.equal(long.halfWidth, 4, "a thin long road was given its length as its width");
  const [short] = roadsAsLines([{ x: 0, y: 0, w: 8, h: 122, kind: "import" }], project);
  assert.equal(short.halfWidth, 4, "the vertical case took the wrong side");
});

test("a turn carries the road's band with it", () => {
  // Turn 1, not turn 0: at turn 0 `turnLayout` returns the layout untouched and
  // an unchanged band would prove nothing. The point is that the band is part
  // of what a turn moves, not that it happens to be where it started.
  const withBand = {
    ...layout,
    roads: [{ ...layout.roads[0], ax: 40, ay: 150, bx: 300, by: 150 }],
  };
  const turned = turnLayout(1, withBand) as {
    roads: { kind: string; x: number; ax: number; ay: number; bx: number; by: number }[];
  };
  const before = withBand.roads[0] as unknown as { ax: number; ay: number; bx: number; by: number };
  const after = turned.roads[0];
  assert.equal(typeof after.bx, "number", "the turn dropped the band's far end entirely");
  assert.equal(typeof after.ay, "number", "the turn dropped the band's near end");
  // A quarter turn maps (x, y) to (y, -x), so a horizontal band becomes a
  // vertical one. Anything that leaves both ends where they were is a band the
  // turn ignored.
  const moved = after.ax !== before.ax || after.ay !== before.ay ||
    after.bx !== before.bx || after.by !== before.by;
  assert.ok(moved, "the band was left in the old frame while the rectangle turned");
  // Both ends must move by the same amount as the rect, or the band belongs to
  // a different town than the road it is attached to.
  const rect = turned.roads[0];
  assert.equal(typeof rect.x, "number", "the road lost its extent too");
  const spanBefore = Math.hypot(before.bx - before.ax, before.by - before.ay);
  const spanAfter = Math.hypot(after.bx - after.ax, after.by - after.ay);
  assert.ok(
    Math.abs(spanAfter - spanBefore) < 0.001,
    `a quarter turn changed the band's length from ${spanBefore} to ${spanAfter}`,
  );
});
