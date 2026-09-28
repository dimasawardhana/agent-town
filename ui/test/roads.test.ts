// Roads: a ground kind that returns, and a placement pass that has something to
// place it.
//
// The seam is the ground bake and the layout's own geometry. The road kind was
// deleted once before because a road tile "had nothing to place it and was baked
// as dead art", so these tests exist to make sure that cannot happen quietly
// again: the art and the geometry are asserted together, and neither is useful
// alone.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { GROUND_KINDS, groundTile, groundEdgeTile, EDGES, type Ground } from "../src/art/terrain";
import { bakedCels } from "../src/art/bake";

test("the road kind is back, and it is a made surface", () => {
  assert.ok(GROUND_KINDS.includes("road"), "there is no road ground kind");
  const road = groundTile("road", 0);
  const grass = groundTile("grass", 0);
  // A road must not read as bare earth: the Yard and the Workshop are both
  // earth-toned, and a third brown surface makes a reader unable to tell where
  // one ends and the next begins. That is ADR-0004's failure, not a taste call.
  const roadHex = hex(road);
  const grassHex = hex(grass);
  const earthHex = hex(groundTile("earth", 0));
  assert.notEqual(roadHex, earthHex, "a road is bare earth; it will vanish into the Yard");
  assert.notEqual(roadHex, grassHex, "a road is grass; it will vanish into the field");
  // And it is grey: asphalt reads as made at a glance, and every warm surface in
  // the town is already spoken for.
  const r = parseInt(roadHex.slice(1, 3), 16);
  const g = parseInt(roadHex.slice(3, 5), 16);
  const b = parseInt(roadHex.slice(5, 7), 16);
  assert.ok(b >= r, `a road should be cool, not warm: ${roadHex}`);
  assert.ok(Math.abs(r - g) < 24 && Math.abs(g - b) < 24, `a road should be near-grey: ${roadHex}`);
});

test("every ground kind draws, and a road has all four edges", () => {
  for (const kind of GROUND_KINDS) {
    assert.ok(!groundTile(kind, 0).empty(), `${kind} draws nothing`);
    for (const edge of EDGES) {
      assert.ok(!groundEdgeTile(kind, edge, 0).empty(), `${kind}/${edge} draws nothing`);
    }
  }
});

test("the road's edge is a kerb, not more road", () => {
  // An edge tile is what separates a road from the grass beside it. If it drew
  // the same pixels as the surface, the road would have no boundary and would
  // read as a stain rather than as a made thing.
  const edge = groundEdgeTile("road", "north", 0);
  const surface = groundTile("road", 0);
  assert.notDeepEqual(
    Array.from(edge.data),
    Array.from(surface.data),
    "a road edge is identical to its surface; the road has no kerb",
  );
});

test("the road is baked — the thing that was deleted for being dead art", () => {
  const keys = new Set(bakedCels().map((c) => c.key));
  for (const v of [0, 1, 2, 3]) {
    assert.ok(keys.has(`g:road:${v}`), `no baked road tile for variant ${v}`);
    for (const edge of EDGES) {
      assert.ok(keys.has(`ge:road:${edge}:${v}`), `no baked road edge ${edge}/${v}`);
    }
  }
});

/**
 * The colour at the tile's *centre* — the surface, not its rim.
 *
 * The first opaque pixel is an edge step, and asserting on it measured the
 * kerb rather than the road, which is the same mistake as judging a surface by
 * its shadow.
 */
function hex(p: { data: Uint8ClampedArray; w: number; h: number }): string {
  const i = (((p.h >> 1) * p.w) + (p.w >> 1)) * 4;
  return (
    "#" +
    [p.data[i], p.data[i + 1], p.data[i + 2]]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
  );
}
