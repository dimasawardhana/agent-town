// Turning the town is the one operation where a *small* error is invisible on
// screen and *catastrophic* in aggregate: every building shares the same wrong
// offset, so the town still looks like a town while no longer being where it
// belongs. Measured on a live town, the base cel sat at exactly (-56, -76) from
// the projected cell corner at **every** turn — a constant, and therefore not
// drift, but the same numbers would have hidden a real drift too.
//
// These tests pin the properties that a drift would break. The lesson they
// encode is the one this project has now paid three times — the damage
// overlay's origins, the ember's two clocks, and a mark placed against a
// coordinate space it does not share: **a mark placed against a coordinate
// space it does not share is a mark that drifts.** So everything is checked
// against one shared reference rather than against itself.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  TURN_COUNT,
  WorldView,
  normaliseTurn,
  turnLayout,
  turnPoint,
} from "../src/view";

function layout() {
  return {
    sites: [
      { id: "building:a", kind: "building", path: "a", x: 10, y: 20, w: 4, h: 4 },
      { id: "building:b", kind: "building", path: "b", x: 51, y: 23, w: 4, h: 4 },
    ],
    districts: [{ id: "d1", x: 0, y: 0, w: 60, h: 30 }],
    roads: [{ id: "r1", x: 12, y: 4, w: 1, h: 20 }],
    width: 60,
    height: 30,
  };
}

const pair = (L: ReturnType<typeof turnLayout>) => {
  const a = L.sites[0];
  const b = L.sites[1];
  return Math.hypot(b.x - a.x, b.y - a.y);
};

test("four quarter turns return every point to where it started", () => {
  for (const p of [
    { x: 0, y: 0 },
    { x: 13, y: 7 },
    { x: -40, y: 92 },
    { x: 128, y: -3 },
  ]) {
    let q = p;
    for (let i = 0; i < TURN_COUNT; i++) q = turnPoint(1, q.x, q.y);
    assert.deepEqual(q, p, `${p.x},${p.y} did not survive four turns`);
  }
});

test("a quarter turn has order four, and two of them are a half turn", () => {
  // Not an involution: a quarter turn applied twice is a half turn, and only the
  // half turn is its own inverse. Getting this wrong is easy and would make a
  // test that "proves" rotation by asserting a property rotation does not have.
  for (const p of [
    { x: 13, y: 7 },
    { x: -40, y: 92 },
  ]) {
    const q = turnPoint(1, p.x, p.y);
    assert.deepEqual(turnPoint(1, q.x, q.y), turnPoint(2, p.x, p.y), "two quarters are not a half");
    const h = turnPoint(2, p.x, p.y);
    assert.deepEqual(turnPoint(2, h.x, h.y), p, "a half turn is not its own inverse");
  }
});

test("turning is idempotent for a fixed turn, never accumulated", () => {
  // The scene keeps the un-turned layout aside precisely so that turning twice
  // means "which orientation" rather than "twice turned".
  for (let t = 0; t < TURN_COUNT; t++) {
    assert.deepEqual(turnLayout(t, layout()), turnLayout(t, layout()), `turn ${t} accumulated`);
  }
  assert.notDeepEqual(turnLayout(1, layout()).sites, layout().sites, "turn 1 changed nothing");
});

test("rotation preserves the separation of every pair of sites", () => {
  // A rotation is distance-preserving. A layer that applied the turn twice, or
  // once too few, would separate or close the pair — and because every
  // building shares the error, the town would still read as a town.
  const d0 = pair(turnLayout(0, layout()));
  for (let t = 0; t < TURN_COUNT; t++) {
    assert.equal(pair(turnLayout(t, layout())), d0, `turn ${t} changed the separation`);
  }
});

test("turning preserves every layer's extent, and drops none of them", () => {
  // Sites, districts and roads are each turned and moved by one shared shift
  // derived from the whole town. A field that got its own shift, or none, would
  // place the roads in a different town from the buildings — the exact failure
  // `turnLayout` already had once, where roads vanished entirely because the
  // return type never mentioned them. Area is what a correct quarter turn
  // preserves, and what a double-applied or half-applied turn would not.
  const base = layout();
  for (let t = 0; t < TURN_COUNT; t++) {
    const L = turnLayout(t, base);
    assert.equal(L.sites.length, base.sites.length, `turn ${t} lost sites`);
    assert.equal(L.districts.length, base.districts.length, `turn ${t} lost districts`);
    assert.equal(L.roads!.length, base.roads!.length, `turn ${t} lost roads`);
    for (let i = 0; i < base.sites.length; i++) {
      assert.equal(
        Math.abs(L.sites[i].w * L.sites[i].h),
        base.sites[i].w * base.sites[i].h,
        `turn ${t} resized site ${i}`,
      );
    }
    for (let i = 0; i < base.districts.length; i++) {
      assert.equal(
        Math.abs(L.districts[i].w * L.districts[i].h),
        base.districts[i].w * base.districts[i].h,
        `turn ${t} resized district ${i}`,
      );
    }
    // Every layer has to land in the same non-negative town, or the camera
    // that frames one of them will not frame the others.
    for (const r of [...L.sites, ...L.districts, ...L.roads!]) {
      assert.ok(r.x >= 0 && r.y >= 0, `turn ${t} placed a rect outside the town`);
    }
  }
});

test("a turned town starts at the origin, so the camera can fit it", () => {
  // Turn 0 is returned unchanged — there is nothing to rotate, so the origin
  // shift is skipped and the camera has to cope with both cases. It does, by
  // fitting the bounding box, but the asymmetry is worth stating rather than
  // discovering: a layer that assumed a shifted origin would be right at turns 1
  // to 3 and wrong at turn 0, which is the quietest possible way to be wrong.
  for (let t = 1; t < TURN_COUNT; t++) {
    const L = turnLayout(t, layout());
    const xs = [...L.sites, ...L.districts, ...L.roads!].map((r) => Math.min(r.x, r.y));
    assert.equal(Math.min(...xs), 0, `turn ${t} does not start at the origin`);
  }
  assert.deepEqual(turnLayout(0, layout()), layout(), "turn 0 must not touch the layout");
});

test("a turn is normalised rather than trusted", () => {
  assert.equal(normaliseTurn(TURN_COUNT), 0);
  assert.equal(normaliseTurn(-1), normaliseTurn(TURN_COUNT - 1));
  assert.equal(normaliseTurn(-1 - TURN_COUNT), normaliseTurn(TURN_COUNT - 1));
  assert.equal(new WorldView(7).turn, 3);
});

test("a turned sprite lands where the turned layout says it does", () => {
  // The scene's convention, and the one every layer follows: `turnLayout` has
  // already turned the layout, so a sprite layer projects the turned
  // coordinates with the plain formula. `WorldView` is the other path — it takes
  // un-turned world coordinates and turns them itself. Asserting the two agree
  // is what stops a new layer from quietly applying the turn a second time, or
  // not at all, and both failures look like a town.
  const base = layout();
  for (let t = 0; t < TURN_COUNT; t++) {
    const L = turnLayout(t, base);
    const deltas: { i: number; x: number; y: number }[] = [];
    for (let i = 0; i < base.sites.length; i++) {
      const site = L.sites[i];
      const nearX = site.x + site.w;
      const nearY = site.y + site.h;
      // The sprite layer: plain projection of the already-turned layout.
      const sprite = { x: (nearX - nearY) / 2, y: (nearX + nearY) / 4 };
      // The other path: turn the *original* world corner, then project.
      const w = turnPoint(normaliseTurn(t), base.sites[i].x + base.sites[i].w, base.sites[i].y + base.sites[i].h);
      const viaView = new WorldView(t).project(
        base.sites[i].x + base.sites[i].w,
        base.sites[i].y + base.sites[i].h,
      );
      // They are not equal, and must not be: `turnLayout` moves the whole town
      // so it starts at the origin, and `WorldView` applies no such move. What
      // has to hold is that the difference is the *same* for every building —
      // a per-building constant would leave the town looking fine while no
      // longer being a town, which is the failure this file exists to catch.
      deltas.push({ i, x: sprite.x - viaView.x, y: sprite.y - viaView.y });
      assert.ok(Number.isFinite(w.x) && Number.isFinite(w.y), "turn produced a non-finite corner");
    }
    const first = deltas[0];
    for (const d of deltas) {
      assert.equal(d.x, first.x, `turn ${t}: building ${d.i} is offset differently from ${first.i}`);
      assert.equal(d.y, first.y, `turn ${t}: building ${d.i} is offset differently from ${first.i}`);
    }
  }
});
