// The archetype axis: what a building *is*, rather than which roof shape its
// path hashed to.
//
// The seam is the same one the renderer uses — the archetype set, the selector,
// and the frame key that reaches the atlas — so a test here is a statement about
// what the town draws, not about how the lookup is written.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { ARCHETYPES, archetypeFor, archetypeHeight, MATERIALS, type Archetype } from "../src/art/roof";
import { capBox, buildCap, STAGE_ORDER, stageRank } from "../src/art/building";
import { capFrame, damageFrame, bakedCels, layoutAtlas } from "../src/art/bake";
import { ALL_PROP_KINDS } from "../src/art/props";
import { EDGES, GROUND_KINDS } from "../src/art/terrain";
import { FRAME_MS } from "../src/art/worker";

test("the axis is named places, not roof shapes", () => {
  const shapeWords = ["pitched", "flat", "sawtooth", "gantried", "domed", "gable"];
  for (const a of ARCHETYPES) {
    assert.ok(!shapeWords.includes(a), `"${a}" is a roof shape, not a place`);
  }
  assert.equal(ARCHETYPES.length, 11, "eleven archetypes ship; the Restaurant was cut in ticket 05");
});

test("every archetype is reachable and the selector is deterministic", () => {
  const seen = new Set<Archetype>();
  for (let i = 0; i < 2000; i++) {
    const path = `src/pkg${i}/mod.ts`;
    const first = archetypeFor(undefined, path);
    assert.equal(archetypeFor(undefined, path), first, `${path} resolved differently on a second call`);
    seen.add(first);
  }
  assert.deepEqual(
    [...seen].sort(),
    [...ARCHETYPES].sort(),
    "some archetype is unreachable by any path",
  );
});

test("each archetype is a distinct drawing, not a relabelled one", () => {
  // Two archetypes that drew identically would be two names for one picture.
  // Height is not part of this claim: a Hall and a Cottage may stand the same
  // height at one footprint and still be different buildings. What has to hold
  // is that they draw differently, and that the set spans more than one height
  // so the skyline is not a row of equals.
  const drawn = ARCHETYPES.map((a) => buildCap(100, a, "completed", false));
  for (let i = 0; i < drawn.length; i++) {
    for (let j = i + 1; j < drawn.length; j++) {
      const a = ARCHETYPES[i];
      const b = ARCHETYPES[j];
      assert.notDeepEqual(
        Array.from(drawn[i].data),
        Array.from(drawn[j].data),
        `"${a}" and "${b}" draw the same cap; one of the two names is a lie`,
      );
    }
  }
  const heights = new Set(ARCHETYPES.map((a) => archetypeHeight(a, 100)));
  assert.ok(
    heights.size > 1,
    `every archetype stands the same height at side 100, so the skyline is a row of equals: ${[...heights]}`,
  );
});

test("the frame key names the archetype, so the atlas can be read", () => {
  const key = capFrame(78, "hall", "completed", false, 0);
  assert.equal(key, "cap:78:hall:completed");
  // Verification keeps its suffix and its position, so the ordinary cap still
  // carries the short key it has always had.
  // Damage is not a cap axis at all: it is a mark laid over the roof, and it
  // lives under its own key. That is what stopped it doubling the cap family.
  assert.equal(damageFrame(78, "hall", 0), "dmg:78:hall");
  assert.equal(capFrame(78, "hall", "completed", true, 0), "cap:78:hall:completed:v");
  // And a pre-roof stage still drops the archetype, because it draws nothing.
  assert.equal(capFrame(78, "hall", "planned", false, 0), "cap:78:planned");
});

test("every archetype's cap is baked, at every stage that draws one", () => {
  const keys = new Set(bakedCels().map((c) => c.key));
  for (const side of [44, 60, 78, 100]) {
    for (const a of ARCHETYPES) {
      for (const stage of STAGE_ORDER) {
        for (const damaged of [false, true]) {
          for (const verified of [false, true]) {
            const key = capFrame(side, a, stage, verified, 0);
            assert.ok(keys.has(key), `no baked cel answers to ${key}`);
          }
        }
      }
    }
  }
});

test("the atlas still fits after the cutover", () => {
  const cels = bakedCels();
  const layout = layoutAtlas(cels);
  // The count is derived from the same tables the bake iterates, never
  // remembered: renaming five values bakes no extra cels, and a hard-coded 836
  // would keep passing after the atlas had changed underneath it.
  const stages = STAGE_ORDER.length;
  const preRoof = STAGE_ORDER.filter((s) => stageRank(s) < stageRank("roofed")).length;
  const perFootprint =
    stages * MATERIALS.length /* band, per material */ +
    stages * MATERIALS.length /* base, per material */ +
    MATERIALS.length * 2 /* base rubble and its blank */ +
    preRoof /* the shared blank cap */ +
    (stages - preRoof) * ARCHETYPES.length * 2 /* cap, per archetype and verified */ +
    ARCHETYPES.length * 2 /* a damage mark and its blank, per archetype */ +
    1 /* shadow */;
  const ground = GROUND_KINDS.length * 4 * (1 + EDGES.length);
  const props = ALL_PROP_KINDS.length * 2;
  const workers = 2 * Object.values(FRAME_MS).reduce((n, f) => n + f.length, 0);
  assert.equal(cels.length, workers + 4 * perFootprint + ground + props);
  // Cell height is 101, not 93: the Chapel is 30 units tall at the largest
  // footprint, and a spire that is not the tallest thing on the skyline is not
  // a spire. That costs 112 cels of ceiling (1408 -> 1296) and is worth it — the
  // ticket records the trade rather than hiding it.
  assert.equal(layout.cellH, 101, "cell height changed; re-measure the ceiling in ADR-0021");
  assert.equal(layout.height, 8192, "the sheet grew a power of two; re-measure ADR-0021");
  assert.ok(
    cels.length <= 1296,
    `${cels.length} cels against a 1296 ceiling — the headroom the budget assumed is gone`,
  );
});

// --- Declared archetypes -------------------------------------------------

test("a declaration this build knows wins over the hash", () => {
  // The whole point of the manifest: a repository saying what a directory is
  // beats a hash that knows nothing about it.
  assert.equal(archetypeFor("stadium", "ui/src"), "stadium");
  // And it wins even when the hash would have said something else.
  for (const a of ARCHETYPES) {
    const site = { path: "internal/town", archetype: a };
    assert.equal(archetypeFor(site.archetype, site.path), a, `a declaration of ${a} was overridden`);
  }
});

test("an undeclared path falls back to the hash", () => {
  // A repo with no manifest behaves exactly as it did before declarations
  // existed, which is what makes this safe to add.
  for (const path of ["ui/src", "internal/town", "cmd/townd", "docs/adr"]) {
    assert.equal(archetypeFor(undefined, path), archetypeFor(undefined, path));
  }
  // An empty string is no declaration either.
  assert.equal(archetypeFor("", "ui/src"), archetypeFor(undefined, "ui/src"));
});

test("a declaration this build cannot draw falls back rather than vanishing", () => {
  // A repo that declared an archetype this build has since renamed, or one that
  // never existed, should get a sane building rather than a hole in the map.
  // The *name* is still reported by the panel, so the request is not lost —
  // this only says the map falls back.
  const hashed = archetypeFor(undefined, "ui/src");
  assert.equal(archetypeFor("bakery", "ui/src"), hashed);
  assert.equal(archetypeFor("cathedral", "ui/src"), hashed);
});

test("a site with neither a path nor a declaration still resolves", () => {
  // The Yard and the three special places have no path; the rule must not throw
  // or return undefined on them.
  for (const [declared, path] of [[undefined, undefined], [undefined, ""], ["stadium", undefined]] as const) {
    assert.ok(ARCHETYPES.includes(archetypeFor(declared, path)), `${declared}/${path} did not resolve`);
  }
});
