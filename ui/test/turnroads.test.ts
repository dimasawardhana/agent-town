// Roads must survive a turn.
//
// The turn transform is applied to the layout once, and anything the transform
// does not know about is left behind in the *unrotated* frame. A road that is
// not part of the transform does not drift — it disappears, because the
// transformed layout simply has none. That is the failure this pins.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { bandTiles, roadsAsLines, turnLayout } from "../src/view";

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

test("a road line follows the band, not the rectangle around it", () => {
  const project = (x: number, y: number) => ({ x: (x - y) / 2, y: (x + y) / 4 });
  const [line] = roadsAsLines(
    [
      {
        x: 0, y: 0, w: 122, h: 122, kind: "import",
        from: "a", to: "b",
        // The band from A's plot edge to B's — far shorter than the box.
        ax: 20, ay: 20, bx: 100, by: 100,
      },
    ],
    project,
  );
  const bandLen = Math.hypot(line.bx - line.ax, line.by - line.ay);
  const far = project(122, 122);
  const rectLen = Math.hypot(far.x - project(0, 0).x, far.y - project(0, 0).y);
  assert.ok(
    bandLen < rectLen * 0.75,
    `the line is ${bandLen.toFixed(1)}px — the ${rectLen.toFixed(1)}px rectangle is still driving it`,
  );
  assert.equal(line.halfWidth, 4, "a band's width is its thickness, not its length");
  // And the line must be the band, in the right place: both ends projected.
  const wantA = project(20, 20);
  const wantB = project(100, 100);
  assert.equal(line.ax, wantA.x, "the line's near end is not the band's near end");
  assert.equal(line.bx, wantB.x, "the line's far end is not the band's far end");
});

test("a road with no band still comes from its rectangle", () => {
  // Row and district roads are areas, not joins between two places. They carry
  // no band and must keep working, because a renderer that branched on "is
  // there an ax" instead of "does this road have a band" would leave the whole
  // town's streets unpainted and every test still green.
  const project = (x: number, y: number) => ({ x: (x - y) / 2, y: (x + y) / 4 });
  const [row] = roadsAsLines([{ x: 0, y: 200, w: 1000, h: 24, kind: "row" }], project);
  assert.equal(row.ax, project(0, 212).x, "a row road lost its rectangle");
  assert.equal(row.bx, project(1000, 212).x, "a row road lost its far end");
  assert.equal(row.halfWidth, 12, "a row road's width is its thickness");
});

test("a band paints the tiles it passes through, not the box around it", () => {
  // A band from (20,20) to (100,100) with a half-width of 4 runs down the
  // diagonal; the box it came from is 122x122 and covers the whole corner.
  const tiles = bandTiles(20, 20, 100, 100, 4, 24, 24);
  const xs = tiles.map((t) => t.wx);
  const ys = tiles.map((t) => t.wy);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  assert.ok(spanX < 100 && spanY < 100, `the band reached ${spanX}x${spanY} of tiles`);
  // And it must be continuous: a road with gaps in it is not a road.
  tiles.sort((a, b) => a.wy - b.wy || a.wx - b.wx);
  for (let i = 1; i < tiles.length; i++) {
    const dx = Math.abs(tiles[i].wx - tiles[i - 1].wx);
    const dy = Math.abs(tiles[i].wy - tiles[i - 1].wy);
    assert.ok(dx <= 24 && dy <= 24, `tiles ${tiles[i - 1].wx},${tiles[i - 1].wy} and ${tiles[i].wx},${tiles[i].wy} are not adjacent`);
  }
});

test("a band of zero length still terminates", () => {
  // The degenerate case is the one an unbounded walk hangs on, and it is
  // reachable: two plots at the same centre cannot happen, but a band whose
  // endpoints round to the same tile can.
  //
  // `tiles.length >= 0` used to stand here. It could not fail, and a test that
  // cannot fail is a comment with asserts in it — the failure `mutate.mjs`'s
  // header says must be fixed or written down, not left in the suite.
  const tiles = bandTiles(50, 50, 50, 50, 4, 16, 16);
  // Four, not one: (50, 50) sits on the corner where four tiles meet, and a
  // half-width of 4 genuinely reaches all of them. Asserting one would be
  // asserting a number I had not checked.
  //
  // What is being held is that the walk *terminates* and that it covers the
  // point it was given. `>= 0` could not fail; both of these can.
  assert.ok(tiles.length <= 4, `a zero-length band walked ${tiles.length} tiles; the bound is the 2x2 block around the point`);
  assert.ok(
    tiles.some((t) => 50 >= t.wx && 50 < t.wx + 16 && 50 >= t.wy && 50 < t.wy + 16),
    "the band painted no tile containing its own point",
  );
});

test("a band shorter than one tile is still a road", () => {
  // The gap between two plots on this repository is 14 world units and a tile
  // is 16. Testing whether a tile's *centre* lies within the band paints
  // nothing here whenever the band straddles a tile boundary — which is most of
  // the time, and always for the four axis-aligned roads.
  const tiles = bandTiles(220, 330, 234, 330, 4, 16, 16);
  assert.ok(tiles.length > 0, "a 14-unit band painted no tiles at all; it is not a road");
});

test("a band is continuous across tile boundaries", () => {
  // Every tile the walk returns must touch its neighbour in the chain. A dotted
  // road is worse than a wide one: a reader sees a dashed line and concludes
  // there is no connection.
  // Every tile the walk returns must touch one already reached.
  //
  // Eight neighbours, not four. The ground tiles are an isometric diamond
  // lattice: under the projection a tile at (wx, wy) and one at (wx+16, wy+16)
  // land directly above one another, so a diagonal band advances by a
  // diagonal step and a four-neighbour flood fill reports a perfectly
  // continuous road as forty pieces.
  const tiles = bandTiles(100, 100, 500, 180, 4, 16, 16);
  const keys = new Set(tiles.map((t) => `${t.wx},${t.wy}`));
  const seen = new Set<string>();
  const queue = [`${tiles[0].wx},${tiles[0].wy}`];
  const STEPS: [number, number][] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx !== 0 || dy !== 0) STEPS.push([dx * 16, dy * 16]);
    }
  }
  while (queue.length > 0) {
    const key = queue.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    const [wx, wy] = key.split(",").map(Number);
    for (const [dx, dy] of STEPS) {
      const n = `${wx + dx},${wy + dy}`;
      if (keys.has(n) && !seen.has(n)) queue.push(n);
    }
  }
  assert.equal(seen.size, keys.size, `the band is in ${keys.size - seen.size} pieces, not one`);
});
