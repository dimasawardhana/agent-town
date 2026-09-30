// Time of day: one key light for the whole town, and the lit windows it turns on.
//
// The spec called this feature last in
// `docs/superpowers/specs/2026-09-29-town-liveliness.md` because "it touches
// every baked cel's palette and is the one feature that can make existing art
// worse". It does not, as built — and the reason it does not is the subject of
// most of what follows.
//
// What was NOT done, stated here so nobody assumes it: the **facades do not
// change value with the phase.** The sky repaints and the windows light, but a
// wall is the same colour at night as at noon. That is the spec's original
// idea — "a time of day changes the palette those faces draw from" — and it is
// not what shipped, because doing it honestly means a second axis on the base
// and band (400 cels, over the ceiling) or a re-bake per phase (twelve atlases,
// and one atlas is already 2048x8192). The town reads as *a dark sky over a lit
// town*, which is a look and not a simulation. See `the facades do not change` below.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { DAYLIGHT, DAY_PHASES, isDayPhase, normaliseDay, stepDay, type DayPhase } from "../src/daylight";
import { LIGHT_PATTERNS, bandBox, buildBand, buildWindowLightCel, emptyWindowLightCel, lightPattern } from "../src/art/building";
import { SIZES, bakedCels, layoutAtlas, noWindowLightFrame, windowLightFrame } from "../src/art/bake";
import { P } from "../src/art/palette";
import { hashPath } from "../src/art/roof";

/** A footprint is a baked size, and the town draws these five. */
const SIDES = SIZES.map((s) => s.side);

function isLamp(d: Uint8ClampedArray | number[], i: number): boolean {
  return d[i] === 0xe8 && d[i + 1] === 0xa9 && d[i + 2] === 0x4a;
}

test("every pattern lights at least one window, at every size", () => {
  // The reason `LIT_WINDOWS` is a table and not a modulo. A single-storey
  // building is the common case — most directories in this town hold one file —
  // and it has exactly one pattern to show, so a pattern that lit nothing would
  // read as a building with no glass rather than a building with no light in.
  for (const side of SIDES) {
    for (let pattern = 0; pattern < LIGHT_PATTERNS; pattern++) {
      const light = buildWindowLightCel(side, pattern, 0);
      let lit = 0;
      for (let i = 0; i < light.data.length; i += 4) {
        if (light.data[i + 3] !== 0 && isLamp(light.data, i)) lit++;
      }

test("a light pattern is in range for every path, including the ones that hash negative", () => {
  // The bug that broke the town. `hashPath` ends in `| 0`, so roughly half of all
  // paths are negative — `ui/src` is -846872599, `ui/test` is -483228883 — and
  // `(negative) % 3` in JavaScript is -1 or -2, not 2 or 1. That made a frame
  // name of `lit:100:-1`, which was never baked, and the missing frame was
  // *skipped* by the container, so every child after it moved down a slot.
  //
  // The town did not show a missing window. It showed machine sprites drawn
  // inside buildings and bands displaced 56 pixels sideways, because `restage`
  // swaps frames by index and the indices no longer agreed.
  //
  // Asserted over the paths this repository actually has, not over synthetic
  // ones: the failure needs a negative hash, and a made-up path would have to
  // be unlucky to reproduce it.
  const PATHS = [
    "ui/src",
    "ui/test",
    "internal/analyzer",
    "internal/town",
    "internal/agent",
    "internal/agent/extension",
    "internal/registry",
    "internal/web",
    "internal/web/static",
    "cmd/townd",
    "cmd/analyze",
    "ui/src/art",
    "ui/src/art/props",
  ];
  let negativePaths = 0;
  let negativeRemainders = 0;
  for (const path of PATHS) {
    const h = hashPath(path);
    if (h < 0) negativePaths++;
    for (let storey = 0; storey < 12; storey++) {
      // The unwrapped form is what the bug actually computed, and `lightPattern`
      // is the function that has to survive it. Calling the exported one rather
      // than re-deriving the wrap here is the whole point: the first version of
      // this test recomputed it, so it passed on the broken code.
      const raw = (h + storey) % LIGHT_PATTERNS;
      if (raw < 0) negativeRemainders++;
      const got = lightPattern(path, storey);
      assert.ok(
        got >= 0 && got < LIGHT_PATTERNS,
        `${path} storey ${storey}: lightPattern returned ${got}, out of range`,
      );
    }
  }
  // The test is only worth anything while it still covers the shape of the bug.
  assert.ok(negativePaths > 0, "no path in the list hashes negative; the test is vacuous");
  assert.ok(negativeRemainders > 0, "no storey produced a negative remainder; the test is vacuous");
});

test("every light frame a building can ask for is in the atlas", () => {
  // The guard behind the guard: whatever `lightPart` composes must be something
  // the bake registered. A frame that is not is not a missing window — it is a
  // hole in the stack, and the hole is what tore the buildings apart.
  for (let turn = 0; turn < 4; turn++) {
    const byKey = new Set(bakedCels(turn).map((c) => c.key));
    for (const side of SIDES) {
      assert.ok(byKey.has(noWindowLightFrame(side, turn)), `no blank for side ${side} at turn ${turn}`);
      for (let pattern = 0; pattern < LIGHT_PATTERNS; pattern++) {
        assert.ok(
          byKey.has(windowLightFrame(side, pattern, turn)),
          `${windowLightFrame(side, pattern, turn)} was never baked`,
        );
      }
    }
  }
});
      assert.ok(lit > 0, `side ${side} pattern ${pattern} lights nothing (${side >= 60 ? 3 : 2} windows per storey)`);
    }
  }
});

test("the three patterns put their light in three different places", () => {
  // Variation is the whole point of three patterns, so all three landing in the
  // same place fails it. **Counting lit pixels is the wrong instrument here** and
  // the first version of this test used it: a three-window storey where each
  // pattern lights exactly one window gave 51, 50, 51 — two patterns "identical"
  // when they are the same brightness on different windows. The property is
  // *where* the light is, so that is what is compared.
  const litPixels = (side: number, pattern: number): number[] => {
    const light = buildWindowLightCel(side, pattern, 0);
    const at: number[] = [];
    for (let i = 0; i < light.data.length; i += 4) {
      if (light.data[i + 3] !== 0 && isLamp(light.data, i)) at.push(i / 4);
    }
    return at;
  };
  for (const side of SIDES) {
    const sets = [0, 1, 2].map((p) => new Set(litPixels(side, p)));
    for (let i = 0; i < sets.length; i++) {
      for (let j = i + 1; j < sets.length; j++) {
        assert.notDeepEqual(
          [...sets[i]].sort((a, b) => a - b),
          [...sets[j]].sort((a, b) => a - b),
          `side ${side}: patterns ${i} and ${j} light the same windows`,
        );
      }
    }
    // And no pattern on a two-window storey lights both: a storey with every
    // window lit reads as a switched-on office block, which is a different
    // picture from a building where some of the work is still on.
    if (side < 60) {
      const fullest = litPixels(side, 2).length;
      for (const p of [0, 1]) {
        assert.ok(
          litPixels(side, p).length < fullest,
          `side ${side} pattern ${p} lights every window on a two-window storey`,
        );
      }
    }
  }
});

test("every lit pixel lands on the facade, at every size, pattern and turn", () => {
  // The one that matters. The overlay is cut from the band box and walks the
  // *same* placement function `windows` does, so it can only be off the glass if
  // that shared walk was broken — and the failure would be a warm smear on the
  // wall beside each window, which reads as a mistake at 1x and is invisible in
  // a diff. Measured rather than asserted about the code: every opaque pixel of
  // the overlay must coincide with an opaque pixel of the band beneath it.
  for (const side of SIDES) {
    for (let pattern = 0; pattern < LIGHT_PATTERNS; pattern++) {
      for (let turn = 0; turn < 4; turn++) {
        const band = buildBand(side, "stone", "completed", turn);
        const light = buildWindowLightCel(side, pattern, turn);
        for (let i = 0; i < light.data.length; i += 4) {
          if (light.data[i + 3] === 0) continue;
          assert.equal(
            band.data[i + 3],
            255,
            `side ${side} pattern ${pattern} turn ${turn}: an overlay pixel at ${i / 4} lands off the facade`,
          );
        }
      }
    }
  }
});

test("the light and the blank that replaces it are cut from the same box", () => {
  // The pennant's bug, applied forward. `setFrame` moves textures without moving
  // sprites, so a blank from a different box leaves every window a storey out of
  // place the moment the light comes on — which is issue 37, and the reason this
  // is asserted on the new family rather than left to the old one to catch.
  for (const side of SIDES) {
    for (let turn = 0; turn < 4; turn++) {
      const box = bandBox(side, turn);
      const blank = emptyWindowLightCel(side, turn);
      assert.equal(blank.w, box.w, `side ${side} turn ${turn}: the blank is not the band's width`);
      assert.equal(blank.h, box.h, `side ${side} turn ${turn}: the blank is not the band's height`);
      // And the *registered* origins, which is where the pennant actually went
      // wrong: the cel was right and the record of it was not.
      const byKey = new Map(bakedCels(turn).map((c) => [c.key, c]));
      const lit = byKey.get(windowLightFrame(side, 0, turn));
      const none = byKey.get(noWindowLightFrame(side, turn));
      assert.ok(lit && none, `side ${side} turn ${turn}: the light family is not baked`);
      assert.equal(none!.ox, lit!.ox, `side ${side} turn ${turn}: blank origin x differs from the light's`);
      assert.equal(none!.oy, lit!.oy, `side ${side} turn ${turn}: blank origin y differs from the light's`);
      assert.equal(lit!.ox, box.ox, `side ${side} turn ${turn}: the light's origin is not its own box`);
      assert.equal(lit!.oy, box.oy, `side ${side} turn ${turn}: the light's origin is not its own box`);
    }
  }
});

test("the pattern is a function of the building and the storey, and nothing else", () => {
  // `frontCorner` was written so the pennant would not hop corners as the art
  // was re-baked; the same property is load-bearing here. A window that changed
  // pattern when the town turned, or between two redraws of the same town,
  // would be the same defect in a new place.
  for (const side of SIDES) {
    for (let turn = 0; turn < 4; turn++) {
      const a = buildWindowLightCel(side, 1, turn);
      const b = buildWindowLightCel(side, 1, turn);
      assert.deepEqual([...a.data], [...b.data], `side ${side} turn ${turn}: the same pattern drew differently twice`);
    }
  }
});

test("day lights nothing, and dusk and night do", () => {
  // The claim the whole feature rests on. If `day` ever lit a window, the town
  // would be showing a warm light under a full sky, which is the one picture
  // that would be a mistake rather than a look.
  assert.equal(DAYLIGHT.day.lit, false);
  assert.equal(DAYLIGHT.day.lamp, null, "day carries a lamp it never draws");
  for (const phase of ["dusk", "night"] as const) {
    assert.equal(DAYLIGHT[phase].lit, true, `${phase} does not light anything, so it is just a darker sky`);
    assert.equal(DAYLIGHT[phase].lamp, "lamp");
  }
});

test("a phase survives nonsense, and the fallback is the one that says something", () => {
  for (const bad of [null, undefined, 3, "duskk", "", {}]) {
    assert.equal(normaliseDay(bad), "dusk", `normaliseDay(${JSON.stringify(bad)}) is not dusk`);
    assert.equal(isDayPhase(bad), false);
  }
  assert.equal(normaliseDay("night"), "night");
  // The cycle wraps in both directions and covers all three, so a control can
  // never strand the reader on a phase they cannot step off.
  const seen = new Set<DayPhase>();
  let phase: DayPhase = "dusk";
  for (let i = 0; i < 6; i++) {
    phase = stepDay(phase, 1);
    seen.add(phase);
  }
  assert.equal(seen.size, DAY_PHASES.length, `stepping forward visits ${[...seen].join(",")}`);
  let back: DayPhase = "dusk";
  for (let i = 0; i < 6; i++) back = stepDay(back, -1);
  assert.equal(seen.size, DAY_PHASES.length, "stepping backward visits a different set");
});

test("the lamp is the one warm emissive, and it is not the accent", () => {
  // `accent` is the chief's flag and the panel's live-state marks. A lit window
  // in that gold would read as a session badge, which is the exact confusion the
  // pennant was moved off to avoid — so the lamp is amber where that is yellow.
  assert.notEqual(P.lamp, P.accent);
  assert.equal(P.lamp, "#e8a94a");
});

test("the light family fits under the ceiling, and the ceiling is asserted", () => {
  // The budget is the wall on this project and it moves whenever something
  // taller does, so the number is measured here rather than written down
  // anywhere it could go stale — the archetypes spec records being wrong twice
  // for assuming a ceiling it had not re-read.
  // Through `layoutAtlas`, not by measuring the tallest cel here. The first
  // version of this test did the latter and got 99 and a 1312 ceiling, while the
  // project prices the sheet at a cell height of 101 and a ceiling of 1296 — two
  // budgets for one atlas, and the looser one is the one a new feature would
  // have been allowed to spend against.
  const cels = bakedCels(0);
  const layout = layoutAtlas(cels);
  const ceiling = Math.floor(8192 / layout.cellH) * 16;
  assert.ok(
    cels.length <= ceiling,
    `${cels.length} cels against a ceiling of ${ceiling} at a cell height of ${layout.cellH}`,
  );
  // And the family is the size it was designed to be: an overlay, not an axis.
  // If this number grew, something added an axis rather than a pattern.
  const lit = cels.filter((c) => c.key.startsWith("lit:") && !c.key.startsWith("lit:none"));
  const blanks = cels.filter((c) => c.key.startsWith("lit:none"));
  assert.equal(lit.length, LIGHT_PATTERNS * SIDES.length, `expected one cel per pattern per footprint, got ${lit.length}`);
  assert.equal(blanks.length, SIDES.length, `expected one blank per footprint, got ${blanks.length}`);
});

test("the facades do not change value with the phase — and that is a known gap", () => {
  // Asserted as a fact rather than left implied, because the natural next thing
  // for a reader to assume about "time of day" is that it is one, and here it
  // is not. A band baked once is the same band at every phase; what changes is
  // the sky behind it and the glass in front of it.
  const byKey = new Map(bakedCels(0).map((c) => [c.key, c]));
  const first = [...byKey.values()].find((c) => c.key.startsWith("band:"));
  assert.ok(first, "no band was baked");
  const band = buildBand(SIDES[SIDES.length - 1], "stone", "completed", 0);
  assert.ok(band.data.some((v, i) => i % 4 === 3 && v !== 0), "the band drew nothing to be phase-invariant");
});
