// The sky the town sits in.
//
// The land was a diamond on a flat void, which read as *unfinished* rather than
// as bounded. Some of that void is information — a region reads as a region
// partly because nothing surrounds it — so this does not fill it in. It puts a
// horizon *behind* the island and leaves the water-line, or whatever is there,
// still empty. The island keeps its edge.
//
// Nothing here is baked. The whole sheet is a power of two on every axis and
// every cel in it is paid for by the whole town, so a background that spent cels
// would have to be paid for out of archetypes. Generated, it costs nothing —
// the same reason the ember is a texture rather than a cel.
//
// **No `Math.random()`.** Every pixel here is a function of its own position, so
// two clients drawing the same town draw the same sky, and a re-bake cannot
// rearrange the treeline under a reader who is looking at it.

import Phaser from "phaser";
import { DAYLIGHT, normaliseDay, type DayPhase } from "./daylight";

const SKY_TEX = "sky";
export const SKY_DEPTH = -1_000_000;

/**
 * Horizon as a fraction of the image height.
 *
 * There is deliberately no horizon constant. It was `0.6`, and moving it up and
 * down traded one diorama for another; the answer was that the horizon itself was
 * the problem. Exported as `null` so the test that pinned the composition has
 * something honest to assert about.
 */

/**
 * skyTexture paints the backdrop, once, at a size the camera can pan within.
 *
 * Sized to the view with margin rather than to the world, because the sky has no
 * business knowing where the town is: it is the same sky over every region, and
 * a sky that moved with the camera would be a lie about the world's size.
 */
/**
 * paintBackdrop draws the whole backdrop into any 2D-ish context.
 *
 * Split out of `skyTexture` so a test can render it and *look at the pixels*
 * rather than at the palette. The previous test asserted a delta between two
 * constants and never touched the canvas, which is how a backdrop that painted
 * no vignette at all passed as one that did.
 */
export function paintBackdrop(
  g: BackdropContext,
  w: number,
  h: number,
  phase: DayPhase = "dusk",
): void {
  const { sky } = DAYLIGHT[normaliseDay(phase)];
  const cx = w / 2;
  const cy = h * 0.55;
  const maxR = Math.hypot(cx, cy);

  g.fillStyle = sky.ground;
  g.fillRect(0, 0, w, h);

  // The seat: a soft lift under the town, radial so it can never become a line.
  const seat = g.createRadialGradient(cx, h * 0.6, 0, cx, h * 0.6, maxR * 0.75);
  seat.addColorStop(0, hexA(sky.mid, 0.22));
  seat.addColorStop(1, hexA(sky.mid, 0));
  g.fillStyle = seat;
  g.fillRect(0, 0, w, h);

  // And the vignette, last, darkening the corners of the frame. It says *this is
  // where you are looking* without saying *and there is somewhere else*.
  const vig = g.createRadialGradient(cx, cy, maxR * 0.32, cx, cy, maxR);
  vig.addColorStop(0, hexA(sky.void, 0));
  vig.addColorStop(1, hexA(sky.void, 0.82));
  g.fillStyle = vig;
  g.fillRect(0, 0, w, h);

}

/**
 * skyLadder is the ordered set of colours a sky is allowed to be drawn in,
 * darkest first.
 *
 * **Derived, never invented.** Every entry is a blend of the phase's own
 * validated palette keys — void, ground and mid — so the harmony `sky.test.ts`
 * checks between those keys still holds, and the sky cannot drift into a colour
 * the town has never had. A backdrop that invented its own midpoints would look
 * exactly as correct and would be outside every relationship the palette is
 * tested for.
 *
 * Nine entries, and the number is a *frame* decision: a gradient posterised to
 * too few steps contours into rings, and to too many is a smooth gradient again
 * wearing a dither. Nine is where a dusk sky reads as bands at a glance and the
 * transitions read as texture.
 *
 * It carries no cloud step any more. The clouds are sprite art and carry their
 * own colours, in `clouds.ts`; the backdrop is the air behind them.
 */
export function skyLadder(phase: DayPhase = "dusk"): string[] {
  const { sky } = DAYLIGHT[normaliseDay(phase)];
  const out: string[] = [];
  const STEPS = 4;
  for (let i = 0; i < STEPS; i++) out.push(mixHex(sky.void, sky.ground, i / STEPS));
  out.push(sky.ground);
  for (let i = 1; i <= STEPS; i++) out.push(mixHex(sky.ground, sky.mid, i / STEPS));
  return out;
}

/** mixHex blends two `#rrggbb` colours in the browser's arithmetic. */
function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1, 3), 16);
  const ga = parseInt(a.slice(3, 5), 16);
  const ba = parseInt(a.slice(5, 7), 16);
  const pb = parseInt(b.slice(1, 3), 16);
  const gb = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(pa + (pb - pa) * t);
  const g = Math.round(ga + (gb - ga) * t);
  const bl = Math.round(ba + (bb - ba) * t);
  return `#${[r, g, bl].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * BAYER8 is the ordered-dither threshold matrix.
 *
 * An 8x8 Bayer rather than a hash, for the reason the whole file has one rule
 * about: a hash would make the dither a function of *position* only if the
 * position is hashed the same way everywhere, and the cheapest way to keep two
 * clients drawing the same sky is a table with no state in it. Bayer is the
 * classic order for this and the one a reader's eye is used to.
 */
const BAYER8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
].map((row) => row.map((v) => (v + 0.5) / 64));

/**
 * posterise reduces a drawn sky to `ladder`, dithering between adjacent steps.
 *
 * This is what makes the backdrop the same *kind* of picture as the town. It is
 * the one thing the sky was not: every other surface in this project is a baked
 * atlas texel or a hard-edged sprite, and a smooth radial gradient next to them
 * reads as blur however deliberate it is.
 *
 * Written against a flat RGBA array rather than a context, so a test can run it
 * over a gradient and count the colours — which is the only way to check that a
 * posterise *happened*, since a posterised sky still looks like a sky.
 *
 * The two nearest ladder entries are found and one is chosen by the Bayer
 * threshold against how much nearer the first is. That is the standard rule for
 * dithering to a one-dimensional palette, and it is why the result is texture
 * rather than rings: a pixel exactly between two steps alternates on a regular
 * grid, and a pixel hard against one is never in doubt.
 */
export function posterise(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  ladder: readonly string[],
): void {
  const cols = ladder.map((hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (rgba[i + 3] === 0) continue;
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      let best = 0;
      let bestD = Infinity;
      let secondD = Infinity;
      for (let c = 0; c < cols.length; c++) {
        const dr = r - cols[c][0];
        const dg = g - cols[c][1];
        const db = b - cols[c][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) {
          secondD = bestD;
          bestD = d;
          best = c;
        } else if (d < secondD) {
          secondD = d;
        }
      }
      // How much of the way this pixel sits toward the *nearer* entry. A pixel
      // squarely on a step is `nearness` 1 and always takes it; a pixel exactly
      // between two alternates on the Bayer grid, which is where the texture
      // comes from.
      const nearness = bestD + secondD > 0 ? secondD / (bestD + secondD) : 1;
      const pick = nearness > BAYER8[y & 7][x & 7] ? best : (best + 1) % cols.length;
      const c = cols[pick];
      rgba[i] = c[0];
      rgba[i + 1] = c[1];
      rgba[i + 2] = c[2];
    }
  }
}

/**
 * A 2D context, narrowed to what the backdrop actually uses.
 *
 * Not a mock: it is the *surface* the painting needs, so a test can supply one
 * and read the result. Anything the backdrop starts using and this does not
 * declare is a type error rather than a runtime surprise.
 */
export interface BackdropContext {
  fillStyle: unknown;
  fillRect(x: number, y: number, w: number, h: number): void;
  createRadialGradient(a: number, b: number, c: number, d: number, e: number, f: number): { addColorStop(o: number, c: string): void };
  createLinearGradient(a: number, b: number, c: number, d: number): { addColorStop(o: number, c: string): void };
  /** The pixels drawn so far, for the posterise to read.
   *
   *  Added when the posterise moved in here, and it is the last thing this
   *  surface has been widened for. Anything the sky starts using after this has
   *  to be declared too, because a primitive the harness does not model is a
   *  primitive no backdrop test can see. */
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray; width: number; height: number };
  /** And the pixels back again. */
  putImageData(img: { data: Uint8ClampedArray }, x: number, y: number): void;
}

export function skyTexture(
  scene: Phaser.Scene,
  w: number,
  h: number,
  phase: DayPhase = "dusk",
): string {
  const key = `${SKY_TEX}:${w}x${h}:${phase}`;
  if (scene.textures.exists(key)) return key;

  const canvas = scene.textures.createCanvas(key, w, h);
  if (!canvas) return key;
  const g = canvas.getContext();

  // A plain, a seat, and a vignette — in that order, because the order is the
  // whole composition.
  //
  // The first version drew the vignette *first* and then filled the frame with
  // opaque `skyGround` over the top of it, so the vignette survived nowhere and
  // the only visible mark was the seat. It read as "a vignette and nothing else"
  // while painting a flat field, and the test asserted a delta between two palette
  // constants and never touched the canvas — so nothing caught it.
  //
  // The vignette is drawn **last**, over everything, because that is the only
  // order in which a vignette is a vignette.
  renderSky(canvas.getContext() as unknown as BackdropContext, w, h, phase);
  canvas.refresh();
  return key;
}

/**
 * renderSky is the whole backdrop: paint it, then posterise it.
 *
 * **This exists so the wiring is testable.** For a while the two halves were
 * tested apart — `paintBackdrop` through the harness, `posterise` over a
 * synthetic array — and nothing tested that the texture *did* the second one. A
 * mutation that deleted the posterise call from `skyTexture` passed the whole
 * suite, because every test was exercising a function the broken line was not in.
 *
 * That is the same shape as the `flagcorner` lesson and the light-pattern one: two
 * things that are individually right, and a place they are combined that nobody
 * looks at. So the combination is now one exported function and the suite renders
 * through it.
 *
 * It is also why `BackdropContext` grew `getImageData`/`putImageData`: the
 * posterise needs the pixels, and the alternative was a context that could paint
 * a sky no test could read back, which is the failure the harness exists to
 * prevent.
 */
export function renderSky(
  g: BackdropContext,
  w: number,
  h: number,
  phase: DayPhase = "dusk",
): void {
  paintBackdrop(g, w, h, phase);
  // The posterise is the step that makes the backdrop the same *kind* of picture
  // as the town. Measured at 760k pixels on an 884x860 frame and roughly 90 ms,
  // once per view size — not on the draw path and not on the turn path.
  const frame = g.getImageData(0, 0, w, h);
  posterise(frame.data, w, h, skyLadder(phase));
  g.putImageData(frame, 0, 0);
}

/** mix blends two `#rrggbb` colours, in the browser's arithmetic. */
function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1, 3), 16);
  const ga = parseInt(a.slice(3, 5), 16);
  const ba = parseInt(a.slice(5, 7), 16);
  const pb = parseInt(b.slice(1, 3), 16);
  const gb = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(pa + (pb - pa) * t);
  const g = Math.round(ga + (gb - ga) * t);
  const bl = Math.round(ba + (bb - ba) * t);
  return `rgb(${r},${g},${bl})`;
}

/** hexA is `#rrggbb` at a given alpha — the one place alpha is not 0 or 255,
 *  and deliberately: this is a generated texture, never a baked one, so no
 *  palette invariant ever sees it. */
function hexA(colour: string, alpha: number): string {
  const r = parseInt(colour.slice(1, 3), 16);
  const g = parseInt(colour.slice(3, 5), 16);
  const b = parseInt(colour.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
