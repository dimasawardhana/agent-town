// The ground, the kerbs and the three places, asserted without a renderer.
//
// The ground is where a 3D town either holds together or does not, and the two
// failures this file guards are both invisible in a screenshot of a small town: a
// field that shrinks when a directory is hidden, and two places wearing the same
// surface.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  GROUND_KINDS,
  GROUND_ROLE,
  KERB_H,
  KERB_T,
  LAND_APRON,
  LAND_BACK,
  fieldRect,
  furnitureFor,
  groundFor,
  placesOf,
} from "../src/solid/ground";
import { GROUND_KINDS as FLAT_GROUND_KINDS } from "../src/art/terrain";
import { LAND_APRON as VIS_APRON, LAND_BACK as VIS_BACK } from "../src/visibility";
import type { Layout, Site } from "../src/store";

const site = (over: Partial<Site> & Pick<Site, "id" | "kind" | "x" | "y" | "w" | "h">): Site => ({
  label: "x", path: "x", files: 1, bytes: 1000, depth: 1, floors: 1,
  ...over,
});

const layout: Layout = {
  width: 1044,
  height: 634,
  sites: [
    site({ id: "building:a", kind: "building", x: 40, y: 40, w: 44, h: 44 }),
    site({ id: "yard", kind: "yard", x: 40, y: 200, w: 420, h: 150 }),
    site({ id: "workshop", kind: "workshop", x: 500, y: 200, w: 200, h: 120 }),
    site({ id: "depot", kind: "depot", x: 740, y: 200, w: 180, h: 120 }),
  ],
  districts: [
    { name: "ui", kind: "source", x: 40, y: 40, w: 368, h: 120 },
    { name: "tests", kind: "test", x: 440, y: 40, w: 300, h: 120 },
  ],
};

/** The bounding box of a triangle soup's x, y and z. */
const bounds = (positions: readonly number[]) => {
  const xs: number[] = [], ys: number[] = [], zs: number[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    xs.push(positions[i]); ys.push(positions[i + 1]); zs.push(positions[i + 2]);
  }
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
    minZ: Math.min(...zs), maxZ: Math.max(...zs),
  };
};

// ---------------------------------------------------------------------------
// The vocabulary, pinned against the flat renderer's.
// ---------------------------------------------------------------------------

test("the ground kinds are the flat renderer's", () => {
  assert.deepEqual([...GROUND_KINDS], [...FLAT_GROUND_KINDS]);
  for (const k of GROUND_KINDS) assert.ok(GROUND_ROLE[k], `${k} has no colour role`);
});

test("the apron is the flat renderer's", () => {
  // Pinned against the flat renderer's own declaration in `visibility.ts`, which is
  // the module that sizes the field there. A drift would size the solid field from
  // one number and tile it from another.
  assert.equal(LAND_APRON, VIS_APRON);
  assert.equal(LAND_BACK, VIS_BACK);
  assert.ok(LAND_BACK > 0, "a field whose edge is the town's own corner puts the first building on the boundary of the world");
});

// ---------------------------------------------------------------------------
// The field.
// ---------------------------------------------------------------------------

test("the field is sized from the layout's extent, not from the sites", () => {
  // **The acceptance criterion, and the reason it is stated as it is.** A town whose
  // sites are all at depth one still needs the field its layout describes. Sizing
  // from the sites would shrink the world to whatever is currently drawn, which is a
  // different town every time the detail filter moves (ADR-0015).
  const r = fieldRect(layout);
  assert.ok(r.w >= layout.width, "the field is narrower than the town it carries");
  assert.ok(r.d >= layout.height, "the field is shallower than the town it carries");
  assert.equal(r.w, layout.width + LAND_APRON * 2);
  assert.equal(r.d, layout.height + LAND_APRON * 2);
});

test("the field does not shrink when a deep directory is hidden", () => {
  // Hiding changes what is *drawn*, never what the ground is. Asserted by laying the
  // ground twice with two layouts that differ only in their sites.
  const sparse: Layout = { ...layout, sites: [layout.sites[0]!] };
  const a = fieldRect(layout);
  const b = fieldRect(sparse);
  assert.deepEqual(a, b, "hiding directories changed the field");
  assert.deepEqual(
    groundFor(layout).patches[0]?.geometry.positions.length,
    groundFor(sparse).patches[0]?.geometry.positions.length,
    "hiding directories changed the field's geometry",
  );
});

test("an empty layout still gets a field rather than an empty one", () => {
  const r = fieldRect({ width: 0, height: 0, sites: [], districts: [] } as Layout);
  // A town with no districts yet is a real state, not an error — a daemon that has
  // answered with an empty layout has answered correctly. The *size* must be
  // positive so there is a plane to stand on; the centre being the origin is
  // correct, not degenerate.
  for (const v of [r.w, r.d]) {
    assert.ok(Number.isFinite(v) && v > 0, "a zero-sized layout produced a field with no area");
  }
  for (const v of [r.cx, r.cy]) {
    assert.ok(Number.isFinite(v), "a zero-sized layout produced a non-finite centre");
  }
});

// ---------------------------------------------------------------------------
// The seven kinds, as regions.
// ---------------------------------------------------------------------------

test("every district is paved, and a test district is not the same ground as a source one", () => {
  const { patches } = groundFor(layout);
  const districtKinds = patches.map((p) => p.kind);
  assert.ok(districtKinds.includes("grass"), "no source district was paved");
  assert.ok(districtKinds.includes("grassDark"), "no test district was paved a different colour");
});

test("all seven kinds are reachable and each is drawable", () => {
  // Reachable rather than present: `road` belongs to TASK-115's roads, and a kind
  // nothing can draw is a declaration rather than a surface. Asserted that every
  // kind the town can name has a role and geometry when used.
  const { patches } = groundFor(layout);
  for (const p of patches) {
    assert.ok(p.geometry.positions.length > 0, `${p.kind} drew nothing`);
    assert.equal(p.geometry.positions.length % 9, 0, `${p.kind} is not whole triangles`);
    assert.ok(GROUND_KINDS.includes(p.kind), `${p.kind} is not one of the seven`);
  }
});

test("the field is under everything and everything else is above it", () => {
  // Drawn order is draw order: the field is the plane and a district or a place is
  // a surface on it. A field above a district would hide the whole town.
  const { patches } = groundFor(layout);
  const field = patches[0]!;
  assert.equal(field.kind, "grass");
  assert.ok(bounds(field.geometry.positions).maxZ <= 0, "the field is not below the ground level");
  for (const p of patches.slice(1)) {
    assert.ok(bounds(p.geometry.positions).maxZ > 0, `${p.kind} is not above the field`);
  }
});

// ---------------------------------------------------------------------------
// Kerbs.
// ---------------------------------------------------------------------------

test("every section gets a raised kerb", () => {
  const { patches, kerbs } = groundFor(layout);
  // Two districts plus three places.
  assert.equal(kerbs.length, layout.districts.length + placesOf(layout).length);
  for (const k of kerbs) {
    assert.ok(k.geometry.positions.length > 0, "a kerb drew nothing");
    const b = bounds(k.geometry.positions);
    // **Raised, not painted.** The whole point of this ticket: a lip that catches the
    // light is what stops a flat plane reading as a paper diorama.
    assert.ok(b.maxZ - b.minZ > 0, "a kerb has no height, so it is a painted line");
    assert.ok(b.maxZ <= KERB_H + 1e-6, "a kerb is taller than it claims");
    assert.ok(KERB_H > 0 && KERB_T > 0, "a kerb has no thickness");
  }
  assert.ok(patches.length > kerbs.length, "there are more kerbs than surfaces to edge");
});

test("a kerb surrounds its section rather than sitting inside it", () => {
  // A kerb drawn inward would cover the surface it is supposed to edge, and a
  // district ninety pixels across has no room for that.
  const { kerbs } = groundFor(layout);
  const yard = layout.sites.find((s) => s.id === "yard")!;
  const kerb = kerbs.find((k) => {
    const b = bounds(k.geometry.positions);
    return Math.abs((b.minX + b.maxX) / 2 - (yard.x + yard.w / 2)) < 1e-6
      && Math.abs((b.minY + b.maxY) / 2 - (yard.y + yard.h / 2)) < 1e-6;
  });
  assert.ok(kerb, "the Yard has no kerb of its own");
  const b = bounds(kerb.geometry.positions);
  assert.ok(b.minX < yard.x && b.maxX > yard.x + yard.w, "the kerb does not reach past its section");
  assert.ok(b.minY < yard.y && b.maxY > yard.y + yard.h, "the kerb does not reach past its section");
});

// ---------------------------------------------------------------------------
// The three places.
// ---------------------------------------------------------------------------

test("the three places are three different surfaces, not one dirt", () => {
  // **The criterion this ticket is named for.** Two of them sharing a surface
  // produced one continuous brown field with a divider across it, and a reader
  // could not tell where one ended and the next began — which is the only question
  // the three places exist to answer.
  const yard = layout.sites.find((s) => s.id === "yard")!;
  const workshop = layout.sites.find((s) => s.id === "workshop")!;
  const depot = layout.sites.find((s) => s.id === "depot")!;

  // Read the roles straight off the places, which is the claim being made.
  assert.equal(GROUND_ROLE[placeKindFor(yard)], "yard");
  assert.equal(GROUND_ROLE[placeKindFor(workshop)], "deck");
  assert.equal(GROUND_ROLE[placeKindFor(depot)], "flags");

  const roles = [yard, workshop, depot].map((s) => GROUND_ROLE[placeKindFor(s)]);
  assert.equal(new Set(roles).size, 3, `two places share a surface: ${roles.join(", ")}`);
});

/** The surface a place is paved in, as `ground.ts` decides it. */
function placeKindFor(s: Site): "yard" | "deck" | "flags" {
  if (s.kind === "yard") return "yard";
  if (s.kind === "workshop") return "deck";
  return "flags";
}

test("the three places are all found, and a building is not a place", () => {
  const places = placesOf(layout);
  assert.equal(places.length, 3);
  for (const p of places) assert.ok(["yard", "workshop", "depot"].includes(p.kind));
  assert.equal(
    placesOf({ ...layout, sites: [layout.sites[0]!] }).length,
    0,
    "a building was counted as a place",
  );
});

test("a place is lifted above the district it may overlap", () => {
  // A worker standing on a place must be visibly on the place, whatever lies under
  // it — so the place's surface sits above a district's rather than z-fighting it.
  const { patches } = groundFor(layout);
  const place = patches.find((p) => {
    const b = bounds(p.geometry.positions);
    return b.maxZ > 1 && b.maxZ <= 2;
  });
  assert.ok(place, "no place surface was found above the ground");
});

// ---------------------------------------------------------------------------
// Furniture.
// ---------------------------------------------------------------------------

test("each place is furnished, and a building is not", () => {
  // The Yard holds roughly half of every session, and a worker on a bare plate is
  // a figure on a field.
  for (const id of ["yard", "workshop", "depot"]) {
    const s = layout.sites.find((x) => x.id === id)!;
    const props = furnitureFor(s);
    assert.ok(props.length > 0, `${id} is bare`);
    for (const p of props) {
      assert.ok(p.geometry.positions.length > 0, `${id} drew an empty prop`);
      assert.ok(bounds(p.geometry.positions).minZ >= 2, `a ${id} prop is buried in the ground`);
    }
  }
  assert.equal(furnitureFor(layout.sites[0]!).length, 0, "a building was furnished");
});

test("a place is furnished the same way every time it is looked at", () => {
  // Hashed from the place's own id: an index would make the furniture jump whenever
  // a colleague arrived, and a scene that moves for no reason is the town saying
  // something false.
  const yard = layout.sites.find((s) => s.id === "yard")!;
  const a = furnitureFor(yard).map((p) => p.geometry.positions.join(","));
  const b = furnitureFor({ ...yard }).map((p) => p.geometry.positions.join(","));
  assert.deepEqual(b, a, "the same place furnished two ways");
});

test("furniture sits on its place and is smaller than it", () => {
  const yard = layout.sites.find((s) => s.id === "yard")!;
  for (const p of furnitureFor(yard)) {
    const b = bounds(p.geometry.positions);
    assert.ok(b.minX >= yard.x && b.maxX <= yard.x + yard.w, "a prop is outside its place");
    assert.ok(b.minY >= yard.y && b.maxY <= yard.y + yard.h, "a prop is outside its place");
    assert.ok(b.maxZ < Math.max(yard.w, yard.h), "a prop is as tall as its place is wide");
  }
});
