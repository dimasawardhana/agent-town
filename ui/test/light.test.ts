import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildBase, skinFor } from "../src/art/building";
import { TURNS } from "../src/view";

test("the lit wall stays on the picture's lower-left at every turn", () => {
  // The defect this was written to catch: `boxFor`/`bandBox`/`capBox` padded each
  // cel from the UNROTATED footprint corners, so a turned cel's origin was 39
  // pixels off for a 78-unit footprint. Measured before the fix — turn 1 had 16
  // opaque pixels on the lower-left flank against 800 on the lower-right, i.e.
  // almost the whole lit wall was outside its own cel.
  //
  // The light is fixed in the picture (palette.ts). So however the town is
  // turned, the brighter wall must be the one on the lower-left flank and the
  // darker one on the lower-right. If a turn moved the light with the world, the
  // town would appear to carry its own sun around — and worse, a tower would be
  // lit from the left at one orientation and from the right at the next.
  const side = 78;
  const skin = skinFor(side, "b");
  const report: string[] = [];

  for (const turn of TURNS) {
    const pix = buildBase(side, side, "b", "completed", false, turn);
    // Sum brightness of opaque pixels on the left and right halves, below the
    // building's midline, so only the two lower wall flanks are compared.
    let left = 0, leftN = 0, right = 0, rightN = 0;
    const midX = pix.w / 2;
    const midY = pix.h / 2;
    for (let y = Math.floor(midY); y < pix.h; y++) {
      for (let x = 0; x < pix.w; x++) {
        const [r, g, b, a] = pix.at(x, y);
        if (a === 0) continue;
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (x < midX) { left += lum; leftN++; } else { right += lum; rightN++; }
      }
    }
    const lAvg = leftN ? left / leftN : 0;
    const rAvg = rightN ? right / rightN : 0;
    report.push(`turn ${turn}: left=${lAvg.toFixed(1)} (n=${leftN}) right=${rAvg.toFixed(1)} (n=${rightN})`);
    // The lower-left flank must be at least as bright as the lower-right one.
    // (Not strictly greater: an outline pass inks the silhouette, and the two
    // flanks can tie on a small footprint.)
    if (lAvg + 2 < rAvg) {
      throw new Error(`turn ${turn}: the lower-right flank is brighter than the lower-left, so the light has moved with the world`);
    }
  }
  // The report is carried in the assertion message so a failure says what the
  // four orientations actually measured, rather than only that one was wrong.
  assert.ok(report.length === TURNS.length);
});
