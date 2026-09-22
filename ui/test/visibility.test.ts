// The rules that decide what the map shows.
//
// Both are tested here rather than through the renderer because both have a
// failure mode that a screenshot of a small town will not show: an empty
// neighbourhood, and a map buried under its own labels. The defects these
// assertions describe were measured on a real repository, not imagined.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { labelVisible, visibleAt } from "../src/visibility";

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
