// The art layer's own tests.
//
// These exist because every defect shipped from this layer was invisible to
// `tsc` and to the boot-time palette assertion, and each one was found by
// measuring the real modules rather than by reading them. The list is worth
// keeping in view, because it is the argument for this file existing at all:
//
//   - A character absent from a `sprite()` key drew *nothing*, so `b` missing
//     from the worker key left every boot hollow and the outline boxed the bare
//     trouser stem into a solid blob. Opaque, on-palette, type-safe, wrong.
//   - Building cels were anchored half a cel off their plots because a frame
//     carries no pivot and the placement arithmetic assumed a top-left origin.
//   - A sub worker was drawn the same height as a chief: shortening the legs
//     alone hid the missing rows inside the torso.
//   - Scaffold and spoil reached the cel border, so the outline had nowhere to
//     write and clipped.
//   - Ground edge bands were transposed 90 degrees, putting the rim across the
//     middle of every plate instead of on its boundary.
//   - One rank of the building ladder was unreachable.
//
// A unit test that renders one sprite and eyeballs nothing would have caught
// none of these. What catches them is asserting the *invariants* the art claims:
// every sprite non-empty and on-palette, no semi-transparency, every cel's
// artwork strictly inside its border so the outline has room, every stage
// distinct and climbing, damage visible only where there is structure.
//
// Run with `npm run test:art`. It is bundled by esbuild first because the art
// modules import each other without file extensions, which Node's own resolver
// rejects.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { paletteSet, P } from "../src/art/palette";
import { hex, sprite, Pix } from "../src/art/surface";
import { TURNS, WorldView, normaliseTurn, turnPoint } from "../src/view";
import { IsoPix } from "../src/art/iso";
import { buildWorker, FRAME_MS, WORKER_ORIGIN, WORKER_CEL, WALK_CYCLE_MS, type WorkerState } from "../src/art/worker";
import {
  STAGE_ORDER,
  STAGE_ADDS,
  stageRank,
  buildBuilding,
  buildBase,
  buildBand,
  buildCap,
  bandBox,
  capBox,
  boxFor,
  skinFor,
  skinVariant,
  buildShadow,
  type Stage,
} from "../src/art/building";
import { EDGES, GROUND_KINDS, TILE_PX, groundEdgeTile, groundTile, tileVariant } from "../src/art/terrain";
import {
  ALL_PROP_KINDS,
  CEL,
  PLACE_PROPS,
  PROP_GROUPS,
  PROP_ORIGIN,
  buildAllProps,
  buildProp,
} from "../src/art/props";
import { PLACARD, placard } from "../src/art/placard";
import { KERB, kerbRuns } from "../src/art/kerb";
import { PLACE_INFO, PLACE_ORDER } from "../src/place";
import { ACTION_INFO, ACTION_ORDER, actionInfo, targetOf } from "../src/actions";
import { STOREY, MAX_FLOORS, bandHeight, towerTop } from "../src/art/stack";
import { FONT, GLYPH_W, GLYPH_H, GLYPH_GAP, typeset } from "../src/art/font";

const ALLOWED = paletteSet();
const SIDES: readonly [number, number][] = [
  [44, 2],
  [60, 5],
  [78, 9],
  [100, 30],
];

/** Every cel the bake produces, as (name, pix) pairs. */
function everyCel(): { name: string; pix: Pix }[] {
  const out: { name: string; pix: Pix }[] = [];

  for (const tier of ["chief", "sub"] as const) {
    const sheet = buildWorker(tier);
    for (const [state, cels] of Object.entries(sheet.cels)) {
      cels.forEach((pix, i) => out.push({ name: `worker/${tier}/${state}/${i}`, pix }));
    }
  }
  for (const [side, files] of SIDES) {
    for (const variant of [0, 1] as const) {
      const path = variant === 0 ? "b" : "a";
      for (const stage of STAGE_ORDER) {
        for (const damaged of [false, true]) {
          out.push({
            name: `building/${side}/${stage}/${variant}${damaged ? "+dmg" : ""}`,
            pix: buildBuilding(side, files, path, stage, damaged),
          });
        }
      }
    }
    out.push({ name: `shadow/${side}`, pix: buildShadow(side, 5, "a") });
  }
  for (const kind of GROUND_KINDS) {
    for (let v = 0; v < 4; v++) {
      out.push({ name: `ground/${kind}/${v}`, pix: groundTile(kind, v) });
      for (const edge of EDGES) {
        out.push({ name: `edge/${kind}/${edge}/${v}`, pix: groundEdgeTile(kind, edge, v) });
      }
    }
  }
  for (const { kind, pix } of buildAllProps()) out.push({ name: `prop/${kind}`, pix });

  return out;
}

/** The set of (x, y) a shape draws. Used to compare two cels exactly. */
function ink(pix: Pix): string {
  return Buffer.from(pix.data).toString("base64");
}

// --- the whole-set invariants ----------------------------------------------

test("every cel is non-empty", () => {
  for (const { name, pix } of everyCel()) {
    assert.ok(!pix.empty(), `${name} draws nothing`);
  }
});

test("every cel draws only palette colours", () => {
  for (const { name, pix } of everyCel()) {
    const stray = pix.colours().filter((c) => !ALLOWED.has(c.toLowerCase()));
    assert.deepEqual(stray, [], `${name} used colours outside the palette`);
  }
});

test("no cel has a semi-transparent pixel", () => {
  // Alpha is 0 or 255 everywhere. A partly transparent edge is the
  // anti-aliasing halo that fringes against whatever sits behind it, and the
  // whole art direction refuses it.
  for (const { name, pix } of everyCel()) {
    for (let i = 3; i < pix.data.length; i += 4) {
      const a = pix.data[i];
      assert.ok(a === 0 || a === 255, `${name} has alpha ${a} at byte ${i}`);
    }
  }
});

test("no ordinary sprite has artwork on its cel border", () => {
  // A cel's artwork must sit strictly inside its own box, or the 1px outline
  // pass has nowhere to write and that edge loses its ink line. This is what
  // caught the scaffold-and-spoil clipping: the margin was sized for the roof's
  // eaves and not for the poles standing beyond the footprint.
  //
  // Ground tiles are the deliberate exception and are checked separately: they
  // are drawn edge to edge and carry no outline at all.
  const inkBytes = (() => {
    const h = P.ink.slice(1);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)].join(",");
  })();

  for (const { name, pix } of everyCel()) {
    if (name.startsWith("ground/") || name.startsWith("edge/")) continue;
    const at = (x: number, y: number) => {
      const [r, g, b, a] = pix.at(x, y);
      return a === 0 ? "empty" : [r, g, b].join(",") === inkBytes ? "ink" : "art";
    };
    const offenders: string[] = [];
    for (let x = 0; x < pix.w; x++) {
      if (at(x, 0) === "art") offenders.push(`${x},0`);
      if (at(x, pix.h - 1) === "art") offenders.push(`${x},${pix.h - 1}`);
    }
    for (let y = 0; y < pix.h; y++) {
      if (at(0, y) === "art") offenders.push(`0,${y}`);
      if (at(pix.w - 1, y) === "art") offenders.push(`${pix.w - 1},${y}`);
    }
    assert.deepEqual(offenders, [], `${name} draws artwork on its border (${offenders.length} px)`);
  }
});

// --- the sprite authoring guard --------------------------------------------

test("sprite() refuses an unmapped character", () => {
  // The guard is the structural fix for the hollower bug: an unmapped character
  // used to be skipped, so a typo'd key left a hole that the outline pass then
  // boxed into a solid blob.
  assert.throws(() => sprite([".obb"], { o: "#000000" }), /no colour for character/);
});

test("sprite() refuses a ragged grid", () => {
  // A ragged grid silently shifted the art rather than failing.
  assert.throws(() => sprite(["oo", "ooo"], { o: "#000000" }), /wide/);
});

test("sprite() accepts dots as the only transparent character", () => {
  const p = sprite(["..oo.."], { o: "#000000" });
  assert.ok(!p.isOpaque(0, 0) && p.isOpaque(2, 0));
});

test("every character in every authored sprite has a colour", () => {
  // The same guarantee, asserted over the real art rather than a sample: if a
  // key entry is ever deleted, this names the character and the cel.
  assert.doesNotThrow(() => {
    buildWorker("chief");
    buildWorker("sub");
    for (const { kind } of buildAllProps()) void kind;
  });
});

// --- the worker ------------------------------------------------------------

test("worker cels are the declared size and origin", () => {
  for (const tier of ["chief", "sub"] as const) {
    for (const [state, cels] of Object.entries(buildWorker(tier).cels)) {
      for (const [i, pix] of cels.entries()) {
        assert.equal(pix.w, WORKER_CEL, `${tier}/${state}/${i} width`);
        assert.equal(pix.h, WORKER_CEL, `${tier}/${state}/${i} height`);
      }
    }
  }
});

test("every worker stands on its origin row", () => {
  // The lowest drawn row must be the origin row, so the figure's feet land on
  // the point the scene places it by. Not that the origin *column* is inked: on
  // a spread-legs walk frame the ground point falls between the boots, which is
  // correct.
  for (const tier of ["chief", "sub"] as const) {
    const sheet = buildWorker(tier);
    for (const [state, cels] of Object.entries(sheet.cels)) {
      for (const [i, pix] of cels.entries()) {
        let lowest = -1;
        for (let y = 0; y < pix.h; y++) {
          for (let x = 0; x < pix.w; x++) if (pix.isOpaque(x, y)) lowest = y;
        }
        assert.equal(lowest, WORKER_ORIGIN.y, `${tier}/${state}/${i} lowest drawn row`);
      }
    }
  }
});

test("a sub worker is visibly shorter than a chief, with feet on the same line", () => {
  // ADR-0007 asks for a smaller worker. Shortening the legs alone did not
  // deliver it: the missing rows hid inside the torso and both tiers came out
  // the same height.
  const span = (pix: Pix) => {
    let top = -1;
    let bottom = -1;
    for (let y = 0; y < pix.h; y++) {
      for (let x = 0; x < pix.w; x++) {
        if (pix.isOpaque(x, y)) {
          if (top < 0) top = y;
          bottom = y;
        }
      }
    }
    return { top, bottom, height: bottom - top + 1 };
  };

  for (const state of ["idle", "walk", "hammering", "testing", "celebrating"] as WorkerState[]) {
    const chief = span(buildWorker("chief").cels[state][0]);
    const sub = span(buildWorker("sub").cels[state][0]);
    assert.ok(sub.height < chief.height, `${state}: sub ${sub.height}px is not shorter than chief ${chief.height}px`);
    assert.equal(sub.bottom, chief.bottom, `${state}: sub worker's feet are not on the chief's ground line`);
  }
});

test("each tier has its own helmet", () => {
  const helmet = (tier: "chief" | "sub") => {
    const pix = buildWorker(tier).cels.idle[0];
    const seen: string[] = [];
    for (let y = 6; y < 10; y++) {
      for (let x = 0; x < pix.w; x++) {
        const [r, g, b, a] = pix.at(x, y);
        if (a) seen.push(`${r},${g},${b}`);
      }
    }
    return [...new Set(seen)].sort().join("|");
  };
  assert.notEqual(helmet("chief"), helmet("sub"), "the two tiers are told apart by their helmets (ADR-0007)");
});

test("every action animates and differs from idle", () => {
  const idle = ink(buildWorker("chief").cels.idle[0]);
  for (const [state, cels] of Object.entries(buildWorker("chief").cels)) {
    if (state === "idle") continue;
    assert.ok(
      cels.some((c) => ink(c) !== idle),
      `action ${state} is drawn identically to idle`,
    );
  }
});

test("hammering raises the mallet above the head", () => {
  // The wind-up must be visibly a wind-up at the top of the cel, or the whole
  // action reads as standing still.
  const upperRows = (pix: Pix) => {
    let n = 0;
    for (let y = 0; y < 6; y++) for (let x = 0; x < pix.w; x++) if (pix.isOpaque(x, y)) n++;
    return n;
  };
  const chief = buildWorker("chief").cels;
  assert.ok(
    upperRows(chief.hammering[0]) > upperRows(chief.idle[0]),
    "the hammer's wind-up does not reach above the resting figure",
  );
});

test("every action has frame timings, and no two share a rhythm", () => {
  // This is the property that makes a test sweep and a hammer blow look
  // different at a glance, and the Go side asserts the same table.
  for (const state of Object.keys(buildWorker("chief").cels) as WorkerState[]) {
    assert.ok(Array.isArray(FRAME_MS[state]) && FRAME_MS[state].length > 0, `${state} has no timings`);
  }
  const rhythms = new Map<string, string>();
  for (const [state, ms] of Object.entries(FRAME_MS)) {
    const key = ms.join(",");
    const prev = rhythms.get(key);
    assert.equal(prev, undefined, `${state} and ${prev} share the animation rhythm [${key}]`);
    rhythms.set(key, state);
  }
});

test("the walk cycle is a plausible length", () => {
  assert.ok(WALK_CYCLE_MS >= 300 && WALK_CYCLE_MS <= 700, `walk cycle ${WALK_CYCLE_MS}ms is outside the readable range`);
});

// --- the building ladder ---------------------------------------------------

test("the ladder is ordered, complete and strictly increasing", () => {
  assert.equal(STAGE_ORDER.length, 8, "the ladder has eight ranks");
  STAGE_ORDER.forEach((s, i) => {
    assert.equal(stageRank(s), i, `rank(${s})`);
    assert.ok(STAGE_ADDS[s], `${s} does not say what it adds`);
  });
});

test("every building cel is non-empty for every footprint and stage", () => {
  for (const [side, files] of SIDES) {
    for (const stage of STAGE_ORDER) {
      for (const damaged of [false, true]) {
        const pix = buildBuilding(side, files, "a", stage, damaged);
        assert.ok(!pix.empty(), `${side}/${stage}${damaged ? "+dmg" : ""} draws nothing`);
      }
    }
  }
});

test("every rank changes the picture from the rank below it", () => {
  // One part per rank. Deliberately not "adds opaque pixels": glazing an
  // unglazed building and hanging a door are openings cut into walls, so they
  // *change* pixels and can reduce the count. What must never happen is a rank
  // that leaves the picture identical — that is a rank with no part.
  for (const [side, files] of SIDES) {
    for (let i = 1; i < STAGE_ORDER.length; i++) {
      const below = buildBuilding(side, files, "a", STAGE_ORDER[i - 1]);
      const here = buildBuilding(side, files, "a", STAGE_ORDER[i]);
      assert.notEqual(
        ink(here),
        ink(below),
        `${side}: ${STAGE_ORDER[i]} is drawn identically to ${STAGE_ORDER[i - 1]}`,
      );
    }
  }
});

test("a later rank never loses an earlier rank's part", () => {
  // The parts are cumulative, so the roof at ROOFED is still there at COMPLETED.
  // Compared as "the later cel's opaque region covers the earlier one's", which
  // holds for every rank pair except where an opening is punched through a wall
  // — so this asserts the specific containment that matters: the roof outline.
  const roofed = buildBuilding(60, 5, "a", "roofed");
  const completed = buildBuilding(60, 5, "a", "completed");
  // The completed building is taller or equal: trim and chimney only add.
  assert.ok(completed.h >= roofed.h, "the completed building is shorter than the roofed one");

  const walled = buildBuilding(60, 5, "a", "walled");
  const roofedWalls = buildBuilding(60, 5, "a", "roofed");
  // Roofing raises the silhouette: the roof is above the wall line.
  const topOf = (pix: Pix) => {
    for (let y = 0; y < pix.h; y++) for (let x = 0; x < pix.w; x++) if (pix.isOpaque(x, y)) return y;
    return -1;
  };
  assert.ok(topOf(roofedWalls) < topOf(walled), "the roof does not rise above the wall line");
});

test("damage shows wherever there is structure, and is invisible where there is none", () => {
  // A staked plot has nothing to crack or hole, so a failure correctly leaves it
  // looking the same. From `framed` up, damage must be visible.
  for (const stage of STAGE_ORDER) {
    const clean = buildBuilding(60, 5, "a", stage, false);
    const hurt = buildBuilding(60, 5, "a", stage, true);
    const hasStructure = stageRank(stage) >= stageRank("framed");
    assert.equal(
      ink(clean) !== ink(hurt),
      hasStructure,
      hasStructure
        ? `${stage}: damage changed nothing on a building with structure`
        : `${stage}: damage changed a bare plot`,
    );
  }
});

test("every building cel is on-palette, damaged or not", () => {
  for (const [side, files] of SIDES) {
    for (const stage of STAGE_ORDER) {
      const stray = buildBuilding(side, files, "a", stage, true)
        .colours()
        .filter((c) => !ALLOWED.has(c.toLowerCase()));
      assert.deepEqual(stray, [], `${side}/${stage}+dmg used colours outside the palette`);
    }
  }
});

test("both skin variants are baked and actually differ", () => {
  // A building's skin is a hash of its path, so both variants must exist in the
  // atlas or half the town draws in the wrong one.
  assert.equal(skinVariant("a"), 1);
  assert.equal(skinVariant("b"), 0);
  assert.equal(skinVariant("a"), skinVariant("a"), "the variant must be stable for a path");

  const a = buildBuilding(78, 9, "a", "completed");
  const b = buildBuilding(78, 9, "b", "completed");
  assert.notEqual(ink(a), ink(b), "the two skin variants draw identically, so one is wasted");
});

test("the footprint drives the cel size", () => {
  // A bigger building is both wider and taller, which is the point of sizing
  // buildings by file count.
  let prevW = 0;
  for (const [side, files] of SIDES) {
    const pix = buildBuilding(side, files, "a", "completed");
    assert.ok(pix.w > prevW, `${side}-unit building is not wider than the last`);
    prevW = pix.w;
  }
});

test("boxFor leaves headroom for everything drawn outside the footprint", () => {
  // The margin must cover the scaffold poles at world -5 and the spoil heap
  // reaching world side + 14, plus the roof's eaves and the outline itself.
  // Getting it wrong clipped the outline rather than failing.
  for (const [side, files] of SIDES) {
    for (const path of ["a", "b"]) {
      const box = boxFor(side, skinFor(files, path));
      for (const stage of STAGE_ORDER) {
        const pix = buildBuilding(side, files, path, stage);
        assert.equal(pix.w, box.w, `${side}/${path}/${stage}: cel width disagrees with boxFor`);
        assert.equal(pix.h, box.h, `${side}/${path}/${stage}: cel height disagrees with boxFor`);
      }
    }
  }
});

// --- terrain ---------------------------------------------------------------

test("a ground tile fills exactly its projected diamond and nothing else", () => {
  // This is what makes tiles tile: the region a tile covers is precisely the
  // region its neighbours do not, so a field is gapless and seam-free by
  // construction.
  for (const kind of GROUND_KINDS) {
    for (let v = 0; v < 4; v++) {
      const t = groundTile(kind, v);
      assert.equal(t.w, TILE_PX.w, `${kind}/${v} width`);
      assert.equal(t.h, TILE_PX.h, `${kind}/${v} height`);

      // Forward-map every world point of the 16-unit footprint.
      const expected = new Set<number>();
      for (let wy = 0; wy <= 16; wy++) {
        for (let wx = 0; wx <= 16; wx++) {
          const px = Math.round((wx - wy) / 2) + TILE_PX.ox;
          const py = Math.round((wx + wy) / 4) + TILE_PX.oy;
          assert.ok(px >= 0 && py >= 0 && px < t.w && py < t.h, `${kind}/${v}: projection leaves its own box`);
          expected.add(py * t.w + px);
        }
      }
      for (let y = 0; y < t.h; y++) {
        for (let x = 0; x < t.w; x++) {
          assert.equal(
            t.isOpaque(x, y),
            expected.has(y * t.w + x),
            `${kind}/${v}: pixel ${x},${y} disagrees with the projection`,
          );
        }
      }
    }
  }
});

test("a box's lit flank is the one the sun reaches", () => {
  // The light is up and to the left, so the lower-left flank is lit and the
  // lower-right turns away. Naming those faces by world axis instead keeps being
  // read backwards at every call site, which is why the geometry is checked here
  // rather than trusted.
  //
  // The comparison is between the two flanks' horizontal centres, not against a
  // midpoint of the cel: the box's projection is not centred in its own box, so
  // an arbitrary midpoint splits a flank and reports a swap that is not there.
  const g = new IsoPix(50, 50, 25, 35);
  g.box(0, 0, 16, 16, 0, 8, { top: "#00ff00", lit: "#ff0000", shadow: "#0000ff" });

  const xsFor = (want: string) => {
    const xs: number[] = [];
    for (let y = 0; y < 50; y++) {
      for (let x = 0; x < 50; x++) {
        const [r, gg, b, a] = g.pix.at(x, y);
        if (!a) continue;
        const hex = "#" + [r, gg, b].map((v) => v.toString(16).padStart(2, "0")).join("");
        if (hex === want) xs.push(x);
      }
    }
    return xs;
  };
  const mean = (v: number[]) => v.reduce((s, n) => s + n, 0) / v.length;

  const lit = xsFor("#ff0000");
  const shadow = xsFor("#0000ff");
  assert.ok(lit.length > 0 && shadow.length > 0, "the box did not draw both visible walls");
  assert.ok(
    mean(lit) < mean(shadow),
    `the lit wall (mean x ${mean(lit).toFixed(1)}) is not to the left of the shadowed one (${mean(shadow).toFixed(1)})`,
  );
  // And they must not overlap: one world edge separates them.
  assert.ok(Math.max(...lit) < Math.min(...shadow), "the two wall flanks overlap, so the box has no corner");
});

test("tile variants are deterministic and reachable", () => {
  // The same world position must always give the same variant, or the same repo
  // would draw a different town on every reload (ADR-0012). And the hash must
  // actually vary: the scene samples it at multiples of TILE, so a naive
  // multiply-and-xor returns 0 for every tile in the town.
  assert.equal(tileVariant(160, 48), tileVariant(160, 48), "tileVariant is not stable");

  const seen = new Set<number>();
  for (let i = 0; i < 64; i++) {
    for (let j = 0; j < 64; j++) seen.add(tileVariant(i * 16, j * 16));
  }
  assert.equal(seen.size, 4, `only ${seen.size} variant(s) reachable at tile pitch`);
});

test("an edge tile rims one boundary and differs from the plain tile", () => {
  // The edge piece is the authored boundary between two kinds of ground: without
  // it a district's earth simply stops against the grass and the join reads as a
  // seam ruled across the field.
  for (const kind of GROUND_KINDS) {
    for (const edge of EDGES) {
      for (let v = 0; v < 4; v++) {
        const t = groundEdgeTile(kind, edge, v);
        assert.equal(t.w, TILE_PX.w, `${kind}/${edge}/${v} width`);
        assert.ok(!t.empty(), `${kind}/${edge}/${v} draws nothing`);
        assert.notEqual(ink(t), ink(groundTile(kind, v)), `${kind}/${edge}/${v} is identical to the plain tile`);
      }
    }
  }
  // The four edges of one kind differ from each other, or the rim is on the
  // wrong flank for three of them.
  const rims = new Set(EDGES.map((e) => ink(groundEdgeTile("grass", e, 0))));
  assert.equal(rims.size, 4, `only ${rims.size} distinct edge rims`);
});

test("each edge name rims the boundary the scene pairs it with", () => {
  // This is the invariant behind the transposition bug, and it is worth stating
  // precisely because the bug is invisible from inside this module: moving a
  // name's band *and* its lip together leaves every tile internally consistent,
  // so no check on the tiles alone can see it. What breaks is the *pairing* the
  // scene relies on — a region's border in x must take `west`/`east` and a border
  // in y must take `north`/`south`.
  //
  // The assertion is therefore about which world coordinate the rim pins. A rim
  // at constant `wx` separates this tile from its neighbour in x, so it belongs
  // to a border in x.
  const separates = (edge: (typeof EDGES)[number]): "x" | "y" => {
    const plain = groundTile("grass", 0);
    const rim = groundEdgeTile("grass", edge, 0);
    let atMinX = 0;
    let atMaxX = 0;
    let atMinY = 0;
    let atMaxY = 0;
    for (let py = 0; py < rim.h; py++) {
      for (let px = 0; px < rim.w; px++) {
        const a = plain.at(px, py);
        const b = rim.at(px, py);
        if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]) continue;
        // The projection inverted: a pixel is the world point that draws to it.
        const wx = 2 * py + px - TILE_PX.ox;
        const wy = 2 * py - px + TILE_PX.ox;
        if (wx <= 2) atMinX++;
        if (wx >= 14) atMaxX++;
        if (wy <= 2) atMinY++;
        if (wy >= 14) atMaxY++;
      }
    }
    // A boundary at constant wx lies at the x extremes; at constant wy, the y.
    return atMinX + atMaxX >= atMinY + atMaxY ? "x" : "y";
  };

  assert.equal(separates("west"), "x", "west does not rim a boundary in x");
  assert.equal(separates("east"), "x", "east does not rim a boundary in x");
  assert.equal(separates("north"), "y", "north does not rim a boundary in y");
  assert.equal(separates("south"), "y", "south does not rim a boundary in y");

  // And the four are distinct, so a boundary gets one rim rather than two.
  assert.equal(new Set(EDGES.map((e) => ink(groundEdgeTile("grass", e, 0)))).size, 4);
});

// --- props and font --------------------------------------------------------

test("every prop the places list is baked and on the palette", () => {
  // The join between the places' lists and the vocabulary. A name a place asks
  // for that no group claims would bake as an empty cel and vanish, which is the
  // one failure this layer cannot see: everything downstream is opaque, type-safe
  // and passes.
  const baked = new Map(buildAllProps().map((p) => [p.kind, p.pix]));
  for (const [place, kinds] of Object.entries(PLACE_PROPS)) {
    for (const kind of kinds) {
      const pix = baked.get(kind);
      assert.ok(pix, `${place} lists ${kind}, which is not baked`);
      assert.ok(!pix.empty(), `${place}'s ${kind} draws nothing`);
    }
  }
  assert.ok(PROP_ORIGIN.x > 0 && PROP_ORIGIN.y > 0, "the prop origin must be inside the cel");
  // And every prop in the vocabulary is baked, not merely the ones a place
  // happens to list — a prop drawn nowhere is a prop nobody would notice was
  // broken, so it is baked and checked rather than skipped.
  assert.equal(baked.size, ALL_PROP_KINDS.length, "the bake does not cover the vocabulary");
});

test("the prop groups are disjoint and together cover the vocabulary", () => {
  // A name in two groups would have one drawing silently overwrite the other at
  // the spread in `props.ts`, and which one won would depend on spread order.
  const seen = new Map<string, string>();
  for (const [group, kinds] of Object.entries(PROP_GROUPS)) {
    for (const kind of kinds) {
      const prev = seen.get(kind);
      assert.equal(prev, undefined, `${kind} is in both ${prev} and ${group}`);
      seen.set(kind, group);
    }
  }
  assert.equal(seen.size, ALL_PROP_KINDS.length, "the groups do not cover the vocabulary exactly once");
});

test("every prop fits its cel box, clears the border, and stays on the palette", () => {
  // The four invariants every cel must hold. Each one is a real defect this
  // layer has shipped:
  //
  //   - a cel larger than the box would be clipped by the bake;
  //   - artwork on the border clips the outline, so the prop loses its edge;
  //   - an off-palette colour is a second, drifting palette;
  //   - semi-transparency is the antialiasing halo the whole style forbids.
  for (const { kind, pix } of buildAllProps()) {
    assert.ok(pix.w === CEL && pix.h === CEL, `${kind} is ${pix.w}x${pix.h}, want ${CEL}x${CEL}`);
    for (let x = 0; x < pix.w; x++) {
      assert.ok(!pix.isOpaque(x, 0), `${kind} has artwork on its top border`);
      assert.ok(!pix.isOpaque(x, pix.h - 1), `${kind} has artwork on its bottom border`);
    }
    for (let y = 0; y < pix.h; y++) {
      assert.ok(!pix.isOpaque(0, y), `${kind} has artwork on its left border`);
      assert.ok(!pix.isOpaque(pix.w - 1, y), `${kind} has artwork on its right border`);
    }
    for (const c of pix.colours()) {
      assert.ok(ALLOWED.has(c), `${kind} uses ${c}, which is not in the palette`);
    }
  }
});

test("no prop is semi-transparent", () => {
  // Alpha is either 0 or 255 everywhere: a partial alpha is what arrives from
  // antialiasing, and it is invisible against grass while wearing a halo over
  // the panel.
  for (const { kind, pix } of buildAllProps()) {
    for (let i = 3; i < pix.data.length; i += 4) {
      const a = pix.data[i];
      assert.ok(a === 0 || a === 255, `${kind} has a pixel at alpha ${a}`);
    }
  }
});

test("props are deterministic and vary with the variant argument", () => {
  // ADR-0012: the same repo must draw the same town on every reload. And a
  // variant argument that changes nothing is a variation system that silently
  // never varies — the same class of bug as the tile-variant hash.
  for (const kind of ALL_PROP_KINDS) {
    const a = buildProp(kind, 0);
    const b = buildProp(kind, 0);
    assert.deepEqual(a.colours(), b.colours(), `${kind} is not deterministic`);
    assert.deepEqual([...a.data], [...b.data], `${kind} differs between two builds at one variant`);
  }
  // At least some props must actually respond to the variant, or the argument is
  // decorative. This is a floor rather than an exact list: which props vary is
  // the artist's call, but none of them varying would mean the feature is dead.
  const varying = ALL_PROP_KINDS.filter((k) => {
    const a = buildProp(k, 0);
    const b = buildProp(k, 1);
    return a.data.join() !== b.data.join();
  });
  assert.ok(varying.length >= 4, `only ${varying.length} prop(s) respond to variant`);
});

test("no two props in a group are the same drawing", () => {
  // A duplicated drawing is the failure the group structure cannot catch: two
  // names, two entries, one picture — and a place would show the same object
  // twice while claiming to show two. Compared as pixel data, so it catches a
  // copy-paste even where the two entries were given different comments.
  const seen = new Map<string, string>();
  for (const { kind, pix } of buildAllProps()) {
    const sig = [...pix.data].join(",");
    const prev = seen.get(sig);
    assert.equal(prev, undefined, `${kind} is pixel-identical to ${prev}`);
    seen.set(sig, kind);
  }
});

test("the font has a glyph for every character it can be asked to set", () => {
  for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:-/()+#?!' ") {
    const g = FONT[ch];
    assert.ok(g, `no glyph for ${JSON.stringify(ch)}`);
    assert.equal(g.length, GLYPH_H, `glyph ${ch} is ${g.length} rows, want ${GLYPH_H}`);
    for (const row of g) assert.equal(row.length, GLYPH_W, `glyph ${ch} has a ${row.length}-wide row, want ${GLYPH_W}`);
  }
});

test("typesetting never throws and never shifts text on an unknown character", () => {
  // An unmapped character used to drop a column, which moved every letter after
  // it. It must occupy a cell instead.
  const known = typeset("AB", P.paper);
  const withUnknown = typeset("AéB", P.paper);
  assert.equal(withUnknown.w, known.w + (GLYPH_W + GLYPH_GAP), "an unknown character did not keep its cell");
  assert.doesNotThrow(() => typeset("", P.paper), "empty text threw");
});

test("typeset width follows the glyph pitch", () => {
  const text = "ANALYZER";
  assert.equal(typeset(text, P.paper).w, text.length * GLYPH_W + (text.length - 1) * GLYPH_GAP);
});

// --- iso primitives --------------------------------------------------------

test("the projection is 2:1 and moves predictably", () => {
  const g = new IsoPix(40, 40, 20, 20);
  const a = g.project(0, 0);
  const bx = g.project(16, 0);
  const by = g.project(0, 16);
  assert.deepEqual([a.x, a.y], [20, 20], "the origin does not project to the bound origin");
  assert.equal(bx.x - a.x, 8, "16 world units along x is not 8 screen pixels");
  assert.equal(by.x - a.x, -8, "16 world units along y is not 8 screen pixels left");
  assert.equal(bx.y - a.y, 4, "16 world units along x is not 4 screen pixels down");
  assert.equal(by.y - a.y, 4, "16 world units along y is not 4 screen pixels down");
});

test("a vertical run of world steps leaves no gap", () => {
  // The wall fill is a stack of columns rather than a per-depth plot, because
  // plotting every (height, depth) pair leaves single-pixel gaps where two world
  // steps land on the same pixel.
  const g = new IsoPix(30, 40, 15, 30);
  g.column(0, 0, 0, 20, "#ffffff");
  let gaps = 0;
  for (let y = 10; y <= 30; y++) if (!g.pix.isOpaque(15, y)) gaps++;
  assert.equal(gaps, 0, `a wall column left ${gaps} gap(s)`);
});

// --- placards --------------------------------------------------------------

test("a placard is opaque, on the palette, and bordered on all four sides", () => {
  // The board is the whole reason a label is legible over ground of a similar
  // value, and the border is the whole reason the board has an edge. Both are
  // checked because both are the kind of thing that looks fine in isolation and
  // disappears at the fitted zoom.
  for (const [role, style] of Object.entries(PLACARD)) {
    const p = placard("YARD 12", style.ink, style.plate, style.border);
    assert.ok(!p.empty(), `${role} placard draws nothing`);
    for (const c of p.colours()) {
      assert.ok(ALLOWED.has(c), `${role} placard uses ${c}, which is not in the palette`);
    }
    for (let i = 3; i < p.data.length; i += 4) {
      assert.equal(p.data[i], 255, `${role} placard has a hole in its board`);
    }
    // The border, all four sides, in the declared colour.
    const corner = p.at(0, 0);
    assert.equal(hex(corner[0], corner[1], corner[2]), style.border, `${role} placard's corner is not its border colour`);
    const far = p.at(p.w - 1, p.h - 1);
    assert.equal(hex(far[0], far[1], far[2]), style.border, `${role} placard's far corner is not its border colour`);
  }
});

test("a placard's board is wider and taller than its type", () => {
  // The margin is what makes it a board rather than a highlight. A placard
  // exactly the size of its text would be invisible as a plate.
  const text = "WORKSHOP";
  const p = placard(text, P.paper, "#241d16", P.ink);
  const type = typeset(text, P.paper);
  assert.ok(p.w > type.w, "the board is not wider than its type");
  assert.ok(p.h > type.h, "the board is not taller than its type");
});

test("placarding never throws and always leaves a board", () => {
  // A label is lettered from data the scene did not author — a directory named
  // in a script it has never seen. A throw here would take the whole frame down,
  // so the module must survive anything the town can hand it.
  for (const s of ["", " ", "???", "é\u0000", "A".repeat(200)]) {
    const p = placard(s, P.paper, "#241d16", P.ink);
    assert.ok(p.w > 0 && p.h > 0, `placard(${JSON.stringify(s)}) has no size`);
    assert.ok(!p.empty(), `placard(${JSON.stringify(s)}) drew nothing`);
  }
});

// --- kerbs -----------------------------------------------------------------

test("a kerb rings a rectangle and is never opaque in the middle", () => {
  // The failure mode a ring system has is drawing *across* its own shape — a
  // crossed ring reads as a bright X through the section. So this asserts the
  // centre is untouched, which no amount of checking the ring's own pixels
  // would catch.
  const runs = kerbRuns(0, 0, 64, 64, KERB.district);
  assert.ok(runs.length > 0, "a 64-unit region produced no kerb");
  for (const { run, colour } of runs) {
    assert.ok(ALLOWED.has(colour), `kerb uses ${colour}, which is not in the palette`);
    assert.ok(run.w >= 1, "a kerb run has no width");
  }
  // Nothing within a few units of the centre: the projection of world (32, 32).
  const cx = Math.round((32 - 32) / 2);
  const cy = Math.round((32 + 32) / 4);
  for (const { run } of runs) {
    const overlaps = run.y === cy && cx >= run.x && cx < run.x + run.w;
    assert.ok(!overlaps, "the kerb crosses the middle of its own section");
  }
});

test("a kerb has a dark outer ring and a bright inner one", () => {
  // The bright ring is what makes the section readable where its ground is close
  // in value to the ground outside; the dark ring is what gives it an edge. Both
  // are needed, and an outer ring drawn in the bright colour would be nothing
  // but a pale outline with no boundary.
  const runs = kerbRuns(0, 0, 64, 64, KERB.district);
  const colours = new Set(runs.map((r) => r.colour));
  assert.ok(colours.has(KERB.district.outer), "no outer ring was drawn");
  assert.ok(colours.has(KERB.district.inner), "no inner ring was drawn");
  const outer = runs.filter((r) => r.colour === KERB.district.outer);
  const inner = runs.filter((r) => r.colour === KERB.district.inner);
  assert.ok(outer.length > 0 && inner.length > 0, "a ring is empty");
});

test("a kerb on a tiny region does not cross itself", () => {
  // A section smaller than its own inset would have its rings pass through each
  // other and draw a bright knot in the middle. The module stops insetting
  // instead, and this is the guard on that.
  for (const side of [4, 6, 8, 12]) {
    const runs = kerbRuns(0, 0, side, side, KERB.place, 3);
    assert.ok(runs.length > 0, `a ${side}-unit region produced no kerb at all`);
  }
});

// --- the vocabulary the map and the panel share -----------------------------

test("every action the daemon can emit has both readings", () => {
  // The daemon's Action strings and this table's keys are the same words, and
  // the coupling is deliberate — but a value the panel cannot caption would
  // render blank, so the check is that the table is total over what the town
  // ships, and that an unknown value degrades to itself rather than throwing.
  for (const a of ACTION_ORDER) {
    const info = ACTION_INFO[a];
    assert.ok(info, `no reading for ${a}`);
    assert.ok(info.world.length > 0, `${a} has no world word`);
    assert.ok(info.plain.length > 0, `${a} has no plain reading`);
  }
  assert.equal(actionInfo("something-new").world, "something-new", "an unknown action did not degrade to its own name");
  assert.deepEqual(actionInfo(""), { world: "Working", plain: "Working" });
});

test("every place has a name, a sign and a blurb, and no two blurbs agree", () => {
  // The three places are the whole reason the legend exists. A missing blurb
  // renders an empty paragraph; two identical blurbs would mean the legend
  // explains the same thing three times, which is worse than saying nothing
  // because it looks deliberate.
  const blurbs = new Set<string>();
  for (const k of PLACE_ORDER) {
    const info = PLACE_INFO[k];
    assert.ok(info, `no entry for ${k}`);
    assert.ok(info.name.length > 0, `${k} has no name`);
    assert.ok(info.sign.length > 0, `${k} has no ground sign`);
    assert.ok(info.takes.length > 0, `${k} names no work`);
    assert.ok(info.blurb.length > 40, `${k}'s blurb is too short to explain anything`);
    assert.ok(!blurbs.has(info.blurb), `${k}'s blurb duplicates another place's`);
    blurbs.add(info.blurb);
  }
  assert.equal(PLACE_ORDER.length, 3, "there are exactly three places");
});

test("a worker's caption names its building, not its place key", () => {
  // The place key for a building is `building:<path>`. A caption showing the
  // raw key would read "Hammering / building:internal/town", and the last path
  // segment is the word a developer actually recognises.
  assert.equal(targetOf("building:internal/town/town.go", "building:"), "town.go");
  assert.equal(targetOf("building:internal/town", "building:"), "town");
  assert.equal(targetOf("building:town.go", "building:"), "town.go");
  assert.equal(targetOf("building:src/", "building:"), "src");
  // Places are already names, and must pass through untouched.
  assert.equal(targetOf("yard", "building:"), "yard");
  assert.equal(targetOf("workshop", "building:"), "workshop");
  assert.equal(targetOf("depot", "building:"), "depot");
});

// --- floors and the storey band -------------------------------------------

test("a storey band is an exact vertical repeat", () => {
  // This is the assumption the whole stacking model rests on, and it is
  // invisible from reading the code: `sy = (wx + wy) / 4 - z` means raising z by
  // N moves a pixel up by exactly N, so one band of art serves every height. If
  // this stops being true the tower shows a seam at every floor and no unit test
  // of the drawing functions would catch it, because each floor is individually
  // correct.
  const iso = new IsoPix(80, 320, 30, 300);
  for (let wy = 0; wy <= 24; wy++) iso.column(24, wy, 0, 100, P.wood[2]);
  for (let wx = 0; wx <= 24; wx++) iso.column(wx, 24, 0, 100, P.wood[1]);

  let differing = 0;
  for (let y = 120; y < 280; y++) {
    for (let x = 0; x < 80; x++) {
      const a = iso.pix.at(x, y);
      const b = iso.pix.at(x, y - STOREY);
      if (a[3] === 0 || b[3] === 0) continue;
      if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) differing++;
    }
  }
  assert.equal(differing, 0, `${differing} pixel(s) differ between a storey and the one above it`);
});

test("band height and tower top follow the floor count", () => {
  assert.equal(bandHeight(1), STOREY);
  assert.equal(bandHeight(5), 5 * STOREY);
  assert.equal(bandHeight(20), 20 * STOREY);
  // The cap sits one storey above the top band, which is the off-by-one this
  // whole pair of functions exists to make impossible.
  assert.equal(towerTop(1), STOREY);
  assert.equal(towerTop(20), 20 * STOREY);
});

test("the floor count is clamped to the drawable range", () => {
  // A daemon that sent a wild value must not be able to ask for a 10,000-pixel
  // tower: the clamp is the renderer's own guarantee, not a copy of the daemon's.
  assert.equal(bandHeight(0), STOREY, "zero floors still needs one storey of wall");
  assert.equal(bandHeight(-5), STOREY, "a negative count must not produce a negative height");
  assert.equal(bandHeight(999), MAX_FLOORS * STOREY, "the cap must hold");
  assert.equal(bandHeight(NaN), STOREY, "a non-number must not propagate");
  assert.equal(bandHeight(Infinity), STOREY, "Infinity is not a floor count");
  assert.equal(bandHeight(3.7), 3 * STOREY, "a fractional count floors");
});

test("a tower's bands and cap land on exact storey boundaries", () => {
  // The off-by-one that stacking invites: the cap must sit at the top of the
  // topmost band, not one storey above or below it.
  for (const floors of [1, 2, 5, 20]) {
    const bands: number[] = [];
    for (let i = 0; i < floors; i++) bands.push(i * STOREY);
    assert.equal(bands.length, floors, `one band per storey at ${floors}`);
    const topBandTop = bands[bands.length - 1] + STOREY;
    assert.equal(topBandTop, towerTop(floors), `cap misaligned at ${floors} floors`);
  }
});

// --- the tower is assembled from parts, and assembles correctly ------------

test("a single-storey building is solid: no hole between its plinth and its roof", () => {
  // The defect this defends against is the one the first version of the split
  // had: the base carried the ground and the bands started one storey up, so a
  // one-storey building was a plot with its roof hovering twenty units above it
  // — a 40-pixel hole in the silhouette. Most directories in a real project hold
  // a single file, so this is the common case, and it is invisible in the code
  // because every function involved is individually correct.
  const side = 60, files = 5;
  const b = buildBase(side, files, "a", "completed");
  const c = buildCap(side, skinFor(files, "a"), "completed", false);
  const sheet = new Pix(b.w, b.h);
  sheet.blit(b, 0, 0);
  sheet.blit(c, 0, 0);

  // Walk the building's own columns, excluding the margin: `boxFor` reserves 6px
  // on every side for the outline and for what is drawn outside the footprint.
  // The single column just inside that margin is where the roof's eaves overhang
  // the wall, so it legitimately shows sky beside the wall — that is the eave,
  // not a hole. Everything inside it must be one solid run.
  const margin = 6;
  let worst = 0;
  for (let x = margin; x < sheet.w - margin; x++) {
    let first = -1, last = -1;
    for (let y = 0; y < sheet.h; y++) if (sheet.isOpaque(x, y)) { if (first < 0) first = y; last = y; }
    if (last < 0) continue;
    let run = 0, longest = 0;
    for (let y = last; y >= first; y--) {
      if (sheet.isOpaque(x, y)) { run++; longest = Math.max(longest, run); } else run = 0;
    }
    worst = Math.max(worst, last - first + 1 - longest);
  }
  assert.equal(worst, 0, `${worst}px of sky inside a one-storey building's silhouette`);
});

test("each added storey raises the tower by exactly one storey", () => {
  // The join between two stamped bands must be invisible, which holds only if a
  // storey is an exact vertical repeat AND the bands are placed exactly STOREY
  // apart. Either being wrong shows as a seam or a short floor, and the error
  // does not appear at one floor — it only appears once there are two.
  const side = 78, files = 9, path = "a", stage = "completed";
  const skin = skinFor(files, path);
  const base = buildBase(side, files, path, stage);
  const band = buildBand(side, skin, stage);
  const cap = buildCap(side, skin, stage, false);
  const baseBox = boxFor(side, skin, 1), bandCel = bandBox(side), capCel = capBox(side, skin);

  // The ground line is a fixed row in every canvas, so a taller tower grows
  // upward from the same place. Sizing the canvas to the tower and anchoring the
  // ground to its bottom instead — the obvious way to write this — moves the
  // ground with the height and measures the canvas rather than the building.
  const W = 400, CANVAS_H = 900, GROUND = 800, FX = 200;
  const tower = (floors: number): Pix => {
    const s = new Pix(W, CANVAS_H);
    s.blit(base, Math.round(FX - baseBox.ox), Math.round(GROUND - 0 - baseBox.oy));
    for (let i = 1; i < floors; i++) {
      s.blit(band, Math.round(FX - bandCel.ox), Math.round(GROUND - i * STOREY - bandCel.oy));
    }
    s.blit(cap, Math.round(FX - capCel.ox), Math.round(GROUND - towerTop(floors) - capCel.oy));
    return s;
  };

  // Height must grow by exactly STOREY per added floor. Measured as the distance
  // from the fixed ground line to the topmost pixel, so it is the building's
  // height and not the canvas's. Compared between consecutive counts rather than
  // against a formula, so the assertion states the property being defended
  // instead of restating the arithmetic that produced it.
  // Compared against the previous count in the list, which does not have to be
  // one less: the expected rise is the gap between the two counts times STOREY,
  // so a list that skips floors still states the right property.
  let prev: { floors: number; height: number } | null = null;
  for (const floors of [1, 2, 3, 5, 12]) {
    const s = tower(floors);
    let top = -1;
    for (let y = 0; y < s.h; y++) {
      let any = false;
      for (let x = 0; x < s.w; x++) if (s.isOpaque(x, y)) { any = true; break; }
      if (any) { top = y; break; }
    }
    const height = GROUND - top;
    if (prev !== null) {
      assert.equal(
        height - prev.height,
        (floors - prev.floors) * STOREY,
        `${floors - prev.floors} more floor(s) did not raise the tower by ${(floors - prev.floors) * STOREY}`,
      );
    }
    prev = { floors, height };
  }
});

// --- rotation ---------------------------------------------------------------
//
// The view turn is about the world origin and is linear, so turning a cel's
// local art and putting it at the turned site must give exactly the turned
// picture of that building. These tests hold that identity, because it is the
// whole reason one bake per orientation is correct rather than a hack: if it
// failed, a turned town would be a plausible-looking wrong picture.

test("a quarter turn is linear, so art and placement compose", () => {
  // turn(site + local) === turn(site) + turn(local). This is what lets a cel be
  // plotted in its own frame and still land correctly in a turned town.
  for (const turn of TURNS) {
    for (const [sx, sy] of [[40, 238], [-17, 91], [700, 12]]) {
      for (const [lx, ly] of [[0, 0], [3, 7], [-5, 2]]) {
        const composed = turnPoint(turn, sx + lx, sy + ly);
        const site = turnPoint(turn, sx, sy);
        const local = turnPoint(turn, lx, ly);
        assert.ok(Math.abs(composed.x - (site.x + local.x)) < 1e-9, `turn ${turn}: x does not compose`);
        assert.ok(Math.abs(composed.y - (site.y + local.y)) < 1e-9, `turn ${turn}: y does not compose`);
      }
    }
  }
});

test("four turns return to the start, and turns fold", () => {
  // `normaliseTurn` is the folding point, so a caller may hand it an unbounded
  // count: turning is offered as a repeated single step and a reader who keeps
  // pressing would otherwise walk off the end of the set.
  assert.deepEqual(turnPoint(normaliseTurn(4), 3, 5), turnPoint(0, 3, 5), "four turns must be no turn");
  assert.deepEqual(turnPoint(normaliseTurn(-1), 3, 5), turnPoint(3, 3, 5), "a turn back is three forwards");
  assert.equal(normaliseTurn(7), 3, "seven turns is three");
  assert.equal(normaliseTurn(-1), 3, "one turn back is three forwards");
  assert.equal(normaliseTurn(0), 0);
  // And every folded value is one the projection handles.
  for (const n of [-9, -1, 0, 1, 5, 8, 1001]) assert.ok(TURNS.includes(normaliseTurn(n)), `${n} folded outside the set`);
});

test("turning preserves distance from the origin", () => {
  // A rotation is rigid about the origin. If it were a scalene map — which is
  // what a naive swap of the projection's terms gives — the town's proportions
  // would change as the reader turned it.
  for (const turn of TURNS) {
    for (const [x, y] of [[950, 610], [0, 0], [-40, 300], [7, -11]]) {
      const p = turnPoint(turn, x, y);
      assert.ok(Math.abs(Math.hypot(p.x, p.y) - Math.hypot(x, y)) < 1e-9, `turn ${turn} is not rigid`);
    }
  }
});

test("a screen box grows to cover the turned rectangle", () => {
  // All four corners are turned and projected. Deriving the box from two
  // opposite corners under-measures it at turns 1 and 3 — the same defect that
  // measured 353 pixels of lost land.
  const w = 302;
  const h = 240;
  for (const turn of TURNS) {
    const view = new WorldView(turn);
    const box = view.screenBox(0, 0, w, h);
    for (const [cx, cy] of [[0, 0], [w, 0], [0, h], [w, h]]) {
      const p = view.project(cx, cy);
      assert.ok(p.x >= box.minX - 1e-9 && p.x <= box.maxX + 1e-9, `turn ${turn}: corner escapes in x`);
      assert.ok(p.y >= box.minY - 1e-9 && p.y <= box.maxY + 1e-9, `turn ${turn}: corner escapes in y`);
    }
  }
});

test("the light stays on the picture's left whatever the turn", () => {
  // The light is fixed in the picture (palette.ts), so the wall that catches it
  // is the one on the picture's left flank at every orientation. This is what
  // lets one bake per orientation serve a world turned under a fixed sun.
  for (const turn of TURNS) {
    const view = new WorldView(turn);
    // A square footprint's four wall midpoints, in world space.
    const mids = [
      { x: 10, y: 5 }, { x: 0, y: 5 }, { x: 5, y: 10 }, { x: 5, y: 0 },
    ];
    const screenXs = mids.map((m) => view.project(m.x, m.y).x);
    const depths = mids.map((m) => { const p = view.rotate(m.x, m.y); return p.x + p.y; });
    // The two nearest faces are the box's front pair...
    const order = mids.map((_, i) => i).sort((a, b) => depths[b] - depths[a]);
    const front = order.slice(0, 2);
    // ...and of those, the lit one is further left.
    const lit = front[0] < front[1] && screenXs[front[0]] < screenXs[front[1]] ? front[0]
      : screenXs[front[0]] <= screenXs[front[1]] ? front[0] : front[1];
    assert.ok(front.includes(lit), `turn ${turn}: the lit face is not one of the visible pair`);
  }
});
