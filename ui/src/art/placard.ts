// Placards: a label with a board behind it.
//
// Bare lettering works when it is the only thing on the screen. On this map it
// is not: a district's name sits over grass, pebbles and the corner of a
// building, and at the fitted zoom a 5-pixel-tall run of `paper` over `earth`
// four steps from it in value is genuinely hard to find. The fix that a real
// sign uses is the board behind the letters, and it is also the fix that costs
// nothing: a plate is a rectangle, and a rectangle of the right colour makes the
// type legible without changing the type.
//
// Three details do the work and each is deliberate:
//
//   - The plate is *dark* and the type *light*, the way a painted shop sign is.
//     The inverse reads as a printed caption floating on the ground rather than
//     as a board standing on it.
//   - The plate is one pixel wider than the type on every side, and carries a
//     1px ink border. That border is what separates the plate from the ground;
//     without it a dark plate on dark earth loses its own edge and the label
//     reads as a smudge with a top and bottom.
//   - The type is inset by one pixel on each side and sits on the plate's
//     baseline row, so consecutive labels on one street line up. A placard whose
//     text floats at a different height from its neighbours looks like a
//     mistake even when each one is correct alone.
//
// The board is not a prop: a prop is a thing standing in the world with a
// footprint, and this is lettering with a backing. Keeping it here means the
// scene, the worker layer and any future legend all letter the same way.

import { Pix } from "./surface";
import { P } from "./palette";
import { GLYPH_H, typeset } from "./font";

/** How far the plate extends past the type, in pixels, on every side. One
 *  pixel is the whole of the border, so this is also the border's width. */
const INSET = 1;

/** How many pixels of plate are left above and below the type. A plate tight to
 *  the glyphs reads as a highlight rather than as a board. */
const PADDING_Y = 1;

/**
 * placard renders one line of text on a board.
 *
 * `ink` is the type's colour and `plate` the board's. `border` defaults to the
 * palette's ink, because a board that is not outlined has no edge of its own —
 * pass a different colour only where a board sits on something darker than
 * itself.
 *
 * The result is exactly the plate: `GLYPH_H + 2 * PADDING_Y + 2 * INSET` tall
 * and as wide as the type plus the same margin. Like `typeset`, it never
 * throws — a label is lettered from data the scene did not author, and a name
 * with an unexpected character must leave a gap rather than take a frame down.
 */
export function placard(text: string, ink: string, plate: string, border: string = P.ink): Pix {
  const type = typeset(text, ink);
  const w = type.w + INSET * 2;
  const h = type.h + PADDING_Y * 2 + INSET * 2;
  const out = new Pix(w, h);

  // The board, then the type over it. Filling by `set` rather than by `blit` so
  // the plate is opaque where the type is not — the whole point of the board.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out.set(x, y, plate);
  }
  out.blit(type, INSET, INSET + PADDING_Y);

  // The border last, so it lands on the plate's own edge rather than being
  // overwritten by it.
  for (let x = 0; x < w; x++) {
    out.set(x, 0, border);
    out.set(x, h - 1, border);
  }
  for (let y = 0; y < h; y++) {
    out.set(0, y, border);
    out.set(w - 1, y, border);
  }
  return out;
}

/** How tall a placard is, for a caller laying several out in a column. */
export const PLACARD_H = GLYPH_H + PADDING_Y * 2 + INSET * 2;

/**
 * The four placard treatments, so a label's role is readable before its text
 * is. They are named for the job rather than the colour, because the colours
 * are the palette's business and a call site asking for "the paper one" would
 * have to be changed every time the palette moved a step.
 */
export const PLACARD = {
  /** A district's or a building's own name: ordinary lettering. */
  name: { ink: P.paper, plate: P.plateDim, border: P.ink },
  /** A test district, dimmed to match its browner ground. */
  test: { ink: P.paperDim, plate: P.plateDim, border: P.ink },
  /** A place's name: the loudest label on the map, on the warm plate, because
   *  the three places are what the legend exists to explain. */
  place: { ink: P.accent, plate: P.plateWarm, border: P.accentDim },
  /** What a worker is doing. Small, high, and on the cool plate, so it never
   *  competes with the figures it describes. */
  doing: { ink: P.paper, plate: P.plateCool, border: P.ink },
} as const;

export type PlacardRole = keyof typeof PLACARD;
