// The rules that decide what the map shows.
//
// Both are tested here rather than through the renderer because both have a
// failure mode that a screenshot of a small town will not show: an empty
// neighbourhood, and a map buried under its own labels. The defects these
// assertions describe were measured on a real repository, not imagined.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { boxContains, labelVisible, landBox, visibleAt } from "../src/visibility";
import { TURNS, turnLayout, turnPoint } from "../src/view";

/** A top-level building: depth 1, nothing under it. */
const building = (depth: number) => ({ depth });
/** A container standing in for its subtree. */
const container = (depth: number, minChildDepth: number) => ({ depth, minChildDepth });

test("a building is drawn at its own depth and below", () => {
  const b = building(3);
  assert.equal(visibleAt(b, 1), false, "a depth-3 building must be hidden at filter 1");
  assert.equal(visibleAt(b, 2), false, "a depth-3 building must be hidden at filter 2");
  assert.equal(visibleAt(b, 3), true, "a depth-3 building must be drawn at filter 3");
  assert.equal(visibleAt(b, 9), true, "a building stays drawn however deep the filter goes");
});

test("a container is drawn only while its children are hidden", () => {
  // The defect this defends against, measured rather than imagined: with a plain
  // `depth <= filter` rule, `internal` and its ten packages were both on screen
  // at filter 2 — a tower standing on the plate of the things it stands for, so
  // the map showed the same bytes twice.
  const svc = container(1, 2);
  assert.equal(visibleAt(svc, 1), true, "the container must stand in for its subtree at filter 1");
  assert.equal(visibleAt(svc, 2), false, "the container must step aside when its children appear");
  assert.equal(visibleAt(svc, 3), false, "and must not come back at a deeper filter");
  assert.equal(visibleAt(svc, 9), false, "at any depth, the children are the better answer");
});

test("a container and its children are never drawn together", () => {
  // The invariant, asserted as a property over a spread of shapes rather than
  // as one case: for every filter, no container may be on screen at the same
  // time as a building beneath it.
  for (const containerDepth of [1, 2, 3]) {
    for (const childDepth of [containerDepth + 1, containerDepth + 2, containerDepth + 5]) {
      const c = container(containerDepth, childDepth);
      const children = [childDepth, childDepth + 1, childDepth + 3].map(building);
      for (let filter = 0; filter <= childDepth + 4; filter++) {
        if (!visibleAt(c, filter)) continue;
        for (const child of children) {
          assert.equal(
            visibleAt(child, filter),
            false,
            `filter=${filter} draws container(depth ${containerDepth}) with child(depth ${child.depth})`,
          );
        }
      }
    }
  }
});

test("no filter value can hide the three special places", () => {
  // The Yard, Workshop and Depot are where an event lands. Hiding one would mean
  // a worker with nowhere to stand, which is why they carry depth 0.
  for (const place of [building(0), container(0, 0)]) {
    for (const filter of [0, 1, 2, 7]) {
      assert.equal(visibleAt(place, filter), true, `a place was hidden at filter ${filter}`);
    }
  }
});

test("a container with no children below the filter still stands in", () => {
  // A container whose children are all deeper than the filter describes ground
  // the filter cannot otherwise account for, so it must be drawn.
  const deep = container(1, 4);
  assert.equal(visibleAt(deep, 1), true);
  assert.equal(visibleAt(deep, 3), true, "still standing in while nothing else covers its bytes");
  assert.equal(visibleAt(deep, 4), false, "steps aside exactly when its children arrive");
});

test("no label is shown until it is hovered or focused", () => {
  // The defect this defends against, measured on a real eighteen-site town
  // rather than imagined: labelling the top level outright left thirteen boards
  // on screen at once, and the map read as a wall of type instead of a skyline.
  assert.equal(labelVisible("b1", null, null), false, "a label with neither hover nor focus stays hidden");
  assert.equal(labelVisible("b1", "other", "another"), false, "an unrelated hover must not light it");
});

test("hovering shows a label and moving off hides it", () => {
  assert.equal(labelVisible("b1", "b1", null), true, "the hovered label is shown");
  assert.equal(labelVisible("b1", null, null), false, "and hidden again when the pointer leaves");
});

test("focusing pins a label open", () => {
  assert.equal(labelVisible("b1", null, "b1"), true, "the focused label stays open with no pointer on it");
});

test("the focus moves rather than accumulating", () => {
  // The reader's own words: the label disappears from the last thing and shows
  // on the one being focused. One focused id is what makes that the only thing
  // the model can express — a flag per label could hold two at once.
  assert.equal(labelVisible("b1", null, "b2"), false, "the previously focused label goes dark");
  assert.equal(labelVisible("b2", null, "b2"), true, "and the newly focused one lights");
});

test("a hover and a focus can both be lit", () => {
  // Pointing at a second building to read its name must not throw away the one
  // that was clicked: the preview is weaker than the pin.
  assert.equal(labelVisible("b1", "b2", "b1"), true, "the focused object keeps its label");
  assert.equal(labelVisible("b2", "b2", "b1"), true, "and the hovered one shows alongside it");
  assert.equal(labelVisible("b3", "b2", "b1"), false, "while a third stays hidden");
});

test("losing the focus leaves only the hover standing", () => {
  assert.equal(labelVisible("b1", null, null), false);
  assert.equal(labelVisible("b1", "b1", null), true, "a hover alone still shows its label");
});

// --- the land --------------------------------------------------------------
//
// The land is sized by a different rule from the sites: it is always in the
// picture, because the field a town stands on does not come and go with the
// detail filter. Sizing it from the sites alone was a real defect whose symptom
// is the town's own fields cut off mid-tile.

const proj = (x: number, y: number) => ({ x: (x - y) / 2, y: (x + y) / 4 });
/** The projection inverted, for asserting the box against known world corners. */
const unproj = (x: number, y: number) => ({ x: 2 * y + x, y: 2 * y - x });

test("the land box is the layout's own extent, padded", () => {
  const box = landBox(948, 610, 48, proj);
  // The four world corners of the padded land, projected.
  const want = [
    proj(-48, -48),
    proj(948 + 48, -48),
    proj(-48, 610 + 48),
    proj(948 + 48, 610 + 48),
  ];
  assert.equal(box.minX, Math.min(...want.map((p) => p.x)), "the land's left edge is wrong");
  assert.equal(box.maxX, Math.max(...want.map((p) => p.x)), "the land's right edge is wrong");
  assert.equal(box.minY, Math.min(...want.map((p) => p.y)), "the land's top edge is wrong");
  assert.equal(box.maxY, Math.max(...want.map((p) => p.y)), "the land's bottom edge is wrong");
});

test("the land box covers the whole rectangle, not a pair of corners", () => {
  // The defect this defends against: deriving the box from two hand-picked
  // corners instead of all four. For a 2:1 projection the extreme x is reached
  // at a different world corner than the extreme y, so a pair loses half the
  // span on one axis — measured at 353 pixels off the left of this repository.
  //
  // Asserting the four corners land inside the box would be circular, since the
  // box is defined as their extremes. The real property is that the box is WIDE
  // ENOUGH for the rectangle, which is only true if all four contributed.
  const width = 948;
  const height = 610;
  const pad = 48;
  const box = landBox(width, height, pad, proj);
  // A projected rectangle spans exactly (w + h) / 2 in x — every world corner
  // contributes to that, so a two-corner derivation comes up short whenever the
  // rectangle is not square.
  const spanX = (width + 2 * pad + height + 2 * pad) / 2;
  assert.equal(box.maxX - box.minX, spanX, "the land box is not as wide as the land");
  // The same for y, which spans (w + h) / 4.
  const spanY = (width + 2 * pad + (height + 2 * pad)) / 4;
  assert.equal(box.maxY - box.minY, spanY, "the land box is not as tall as the land");

  // A two-corner derivation, for the record: it spans only half the rectangle's
  // height in x, which is the bug.
  const pair = [proj(-pad, -pad), proj(width + pad, height + pad)];
  const pairSpan = Math.max(...pair.map((p) => p.x)) - Math.min(...pair.map((p) => p.x));
  assert.ok(pairSpan < spanX, "the pair derivation should be measurably short");
});

test("a box contains itself, and a smaller one inside it", () => {
  const outer = landBox(948, 610, 48, proj);
  assert.equal(boxContains(outer, outer), true, "a box must contain itself");
  const inner = landBox(400, 300, 48, proj);
  assert.equal(boxContains(outer, inner), true, "the land must contain a town inside it");
  assert.equal(boxContains(inner, outer), false, "a smaller box must not be said to contain a bigger one");
});

test("the sites of a town must fit inside its land", () => {
  // The property that was broken: the ground canvas is sized from the land, and
  // every site's drawn footprint has to fall inside it or the map has buildings
  // standing beyond the edge of the world.
  const land = landBox(948, 610, 48, proj);
  for (const [x, y, w, h] of [[40, 238, 302, 332], [370, 238, 302, 240], [700, 238, 142, 170]]) {
    const corners = [proj(x, y), proj(x + w, y), proj(x, y + h), proj(x + w, y + h)];
    const box = {
      minX: Math.min(...corners.map((p) => p.x)), maxX: Math.max(...corners.map((p) => p.x)),
      minY: Math.min(...corners.map((p) => p.y)), maxY: Math.max(...corners.map((p) => p.y)),
    };
    assert.equal(boxContains(land, box), true, `district at ${x},${y} falls outside the land`);
  }
});

// --- turning the view ------------------------------------------------------
//
// The turn is applied to the layout rather than threaded through the camera,
// the kerbs, the ground, the workers and the hit zones. That is only safe if
// turning is linear and re-basing is uniform, which is what these hold.

test("turning a layout shifts every rectangle by one shared amount", () => {
  // The property that matters, and the one a per-rectangle re-base would break:
  // every turned corner is the rotated corner plus a single shift shared by the
  // whole town. If each rectangle were re-based on its own, buildings would slide
  // off the districts they stand on while every rectangle still looked sane.
  //
  // The shift is *solved* per rectangle — from its own turned corners — and the
  // rectangles must then agree on it. Solving it independently is what makes
  // this a real cross-check rather than a restatement of the implementation.
  //
  // Corners are handled as a set: a rotation permutes them, so a turned
  // rectangle's minimum corner is generally the image of a different corner than
  // its own minimum. Comparing minimums directly was the first version of this
  // test, and it was wrong.
  const layout = {
    sites: [
      { x: 60, y: 288, w: 78, h: 78 },
      { x: 244, y: 288, w: 78, h: 78 },
      { x: 700, y: 238, w: 142, h: 170 },
    ],
    districts: [{ x: 40, y: 238, w: 302, h: 332 }],
    width: 948,
    height: 610,
  };
  const corners = (r: { x: number; y: number; w: number; h: number }) =>
    [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]];

  for (const turn of TURNS) {
    if (turn === 0) continue;
    const t = turnLayout(turn, layout);
    const rects = [...layout.sites, ...layout.districts];
    const after = [...t.sites, ...t.districts];

    const shared: { x: number; y: number }[] = [];
    for (let i = 0; i < rects.length; i++) {
      const rotCorners: { x: number; y: number }[] = corners(rects[i]).map(([x, y]) => turnPoint(turn, x, y));
      // The turned set's own minimum corner, which is what the produced
      // rectangle's origin must be, plus the town-wide shift.
      const minX = Math.min(...rotCorners.map((c) => c.x));
      const minY = Math.min(...rotCorners.map((c) => c.y));
      const shift = { x: after[i].x - minX, y: after[i].y - minY };
      if (shared.length === 0) shared.push(shift);
      const s0 = shared[0];
      assert.ok(
        Math.abs(shift.x - s0.x) < 1e-9 && Math.abs(shift.y - s0.y) < 1e-9,
        `turn ${turn}: rect ${i} was shifted by ${shift.x},${shift.y} where the town used ${s0.x},${s0.y}`,
      );
      // And every turned corner must be present in the produced rectangle.
      for (const w of rotCorners) {
        const hit = corners(after[i]).some(
          (g) => Math.abs(g[0] - (w.x + s0.x)) < 1e-9 && Math.abs(g[1] - (w.y + s0.y)) < 1e-9,
        );
        assert.ok(hit, `turn ${turn}: rect ${i} lost the corner ${w.x},${w.y}`);
      }
    }
    // The shift is what makes the town start at the origin.
    const allX = after.flatMap((r) => [r.x, r.x + r.w]);
    const allY = after.flatMap((r) => [r.y, r.y + r.h]);
    assert.ok(Math.min(...allX) >= 0 && Math.min(...allY) >= 0, `turn ${turn}: the town starts outside the origin`);
  }
});

test("a turned layout starts at the origin and swaps its extent", () => {
  const layout = { sites: [{ x: 40, y: 238, w: 302, h: 332 }], districts: [], width: 948, height: 610 };
  const one = turnLayout(1, layout);
  assert.equal(one.width, 610, "an odd turn must swap the width");
  assert.equal(one.height, 948, "an odd turn must swap the height");
  // Every rect is inside the declared extent, which is what the ground painter
  // and the land box assume.
  for (const s of one.sites) {
    assert.ok(s.x >= 0 && s.y >= 0, `turn 1: a site starts at ${s.x},${s.y}, outside the layout`);
    assert.ok(s.x + s.w <= one.width + 1e-9 && s.y + s.h <= one.height + 1e-9, "turn 1: a site escapes the layout");
  }
  // And an even turn is the original box.
  const two = turnLayout(2, layout);
  assert.equal(two.width, 948, "two turns must not swap the extent");
  assert.equal(two.height, 610);
});

test("four turns are the identity", () => {
  const layout = {
    sites: [{ x: 60, y: 288, w: 78, h: 78 }, { x: 700, y: 238, w: 142, h: 170 }],
    districts: [{ x: 40, y: 238, w: 302, h: 332 }],
    width: 948,
    height: 610,
  };
  const back = turnLayout(4, layout);
  assert.deepEqual(back, layout, "four turns must return the town exactly");
});

test("turning never changes a site's size", () => {
  // Every footprint is square and a square projects to the same bounding box at
  // every quarter turn, which is why one cel size serves all four orientations.
  const layout = { sites: [{ x: 40, y: 238, w: 302, h: 332 }], districts: [], width: 948, height: 610 };
  for (const turn of TURNS) {
    const t = turnLayout(turn, layout);
    const before = layout.sites[0];
    const after = t.sites[0];
    assert.ok(
      (after.w === before.w && after.h === before.h) || (after.w === before.h && after.h === before.w),
      `turn ${turn}: a rectangle's size changed unexpectedly`,
    );
  }
});
