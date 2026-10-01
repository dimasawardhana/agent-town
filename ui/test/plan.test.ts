// The town from directly above.
//
// The plan view is a second drawing of the **layout**, not a camera over the art.
// These tests are about that boundary and about the one thing a plan has to
// carry that it cannot draw: the size signal the isometric town draws as height.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { PLAN_PAD, isViewMode, planBox, planFloors, type ViewMode } from "../src/plan";
import type { Layout, Site } from "../src/store";

/**
 * A real `Layout`, built rather than cast.
 *
 * `as unknown as Layout` is what `selftest.test.ts` exists to forbid, and it is
 * right: a cast is a claim the compiler cannot check, and the first version of
 * this file used three of them. So the fixture is typed, and `planBox` has to
 * work against the real shape.
 */
const layout: Layout = {
  width: 1044,
  height: 634,
  sites: [],
  districts: [
    { name: "ui", kind: "source", x: 40, y: 238, w: 368, h: 284 },
    { name: "internal", kind: "source", x: 472, y: 238, w: 326, h: 356 },
  ],
};

/** A site with only the fields `planFloors` reads, typed as a real `Site`. */
const siteWithFloors = (floors: number | undefined): Site =>
  ({ id: "building:x", kind: "building", path: "x", x: 0, y: 0, w: 44, h: 44, files: 1, floors } as Site);

test("the plan box frames the whole layout, with a margin", () => {
  const b = planBox(layout);
  assert.equal(b.x, -PLAN_PAD, "the plan's left edge does not clear the layout");
  assert.equal(b.y, -PLAN_PAD, "the plan's top edge does not clear the layout");
  assert.equal(b.w, layout.width + PLAN_PAD * 2);
  assert.equal(b.h, layout.height + PLAN_PAD * 2);
});

test("the plan box follows the districts, not just the layout's own number", () => {
  // A town whose districts reach past `l.width` would be framed short — the same
  // reason `worldBounds` measures the corners rather than trusting the field.
  const wide: Layout = { ...layout, width: 10, height: 10 };
  const b = planBox(wide);
  assert.ok(b.w > 10, "a layout narrower than its districts framed the plan short");
});

test("a plan print is a number, and never a nonsense one", () => {
  assert.equal(planFloors(siteWithFloors(20)), 20);
  assert.equal(planFloors(siteWithFloors(0)), 1, "a building of no floors");
  assert.equal(planFloors(siteWithFloors(-3)), 1);
  assert.equal(planFloors(siteWithFloors(undefined)), 1, "a site with no floor count at all");
  assert.equal(planFloors(siteWithFloors(9999)), 32, "the clamp is not applied");
  assert.equal(planFloors(siteWithFloors(Number.NaN)), 1);
  assert.equal(planFloors(siteWithFloors(Number.POSITIVE_INFINITY)), 1);
});

test("only two view modes exist, and anything else falls back", () => {
  assert.ok(isViewMode("iso"));
  assert.ok(isViewMode("plan"));
  for (const bad of [null, undefined, 0, "", "top", "Isometric"]) {
    assert.equal(isViewMode(bad), false, `${JSON.stringify(bad)} was accepted as a view mode`);
  }
  // And the type is exactly those two, which is what stops a third from being
  // added without a renderer for it.
  const modes: ViewMode[] = ["iso", "plan"];
  assert.equal(modes.length, 2);
});

test("the plan carries the size signal the isometric view draws as height", () => {
  // The whole reason `planFloors` exists, stated as a test: a plan is rectangles,
  // and without the number the town's most important field is simply absent. If
  // this ever returns 1 for everything, the plan is lying by omission.
  const tall = planFloors(siteWithFloors(20));
  const short = planFloors(siteWithFloors(1));
  assert.ok(tall > short, "a twenty-floor building and a hut print the same number");
});