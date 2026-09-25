import { test } from "node:test";
import { buildBase, buildBand, buildCap, buildShadow, skinFor, STAGE_ORDER } from "../src/art/building";
import { ROOF_KINDS } from "../src/art/roof";
import { Pix } from "../src/art/surface";

const differs = (a: Pix, b: Pix): boolean => {
  if (a.w !== b.w || a.h !== b.h) return true;
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
    const p = a.at(x, y), q = b.at(x, y);
    if (p[0] !== q[0] || p[1] !== q[1] || p[2] !== q[2] || p[3] !== q[3]) return true;
  }
  return false;
};

test("measure turn dependence", () => {
  const counts: Record<string, { total: number; differsAny: number; sameUnder2: number }> = {};
  const bump = (fam: string, anyDiffers: boolean, sameUnder2: boolean) => {
    counts[fam] ??= { total: 0, differsAny: 0, sameUnder2: 0 };
    counts[fam].total++;
    if (anyDiffers) counts[fam].differsAny++;
    if (sameUnder2) counts[fam].sameUnder2++;
  };

  for (const side of [44, 60, 78, 100]) {
    for (const stage of STAGE_ORDER) {
      for (const v of [0, 1] as const) {
        const path = v === 0 ? "b" : "a";
        for (const dmg of [false, true]) {
          const a = buildBase(side, side, path, stage, dmg, 0 as 0);
          const b = buildBase(side, side, path, stage, dmg, 1 as 1);
          bump("base", differs(a, b), !differs(a, b));
        }
        const ba = buildBand(side, skinFor(side, path), stage, 0 as 0);
        const bb = buildBand(side, skinFor(side, path), stage, 1 as 1);
        bump("band", differs(ba, bb), !differs(ba, bb));
        // The cap answers to the **roof kind** now, not the skin variant, so the
        // turn dependence is measured per roof. Measuring it per variant would have
        // compared each roof against itself and reported a cap that never turns.
        for (const roof of ROOF_KINDS) {
          for (const dmg of [false, true]) {
            const ca = buildCap(side, roof, stage, dmg, 0 as 0);
            const cb = buildCap(side, roof, stage, dmg, 1 as 1);
            bump("cap", differs(ca, cb), !differs(ca, cb));
          }
        }
      }
    }
    const sa = buildShadow(side, side, "b", 0 as 0);
    const sb = buildShadow(side, side, "b", 1 as 1);
    bump("shadow", differs(sa, sb), !differs(sa, sb));
  }
  for (const [k, v] of Object.entries(counts)) {
    console.log(`MEASURE ${k.padEnd(8)} total=${v.total} differs=${v.differsAny} same=${v.sameUnder2}`);
  }
});
