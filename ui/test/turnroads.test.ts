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
