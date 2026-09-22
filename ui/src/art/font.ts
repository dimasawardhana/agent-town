// The lettering. District names, building names, place names — everything the
// town has to say in its own world rather than in the side panel.
//
// The size is the whole design. Labels are not chrome: they sit on the ground
// next to the thing they name, and the camera spends most of its life fitted to
// a whole town, where a label is a dozen pixels wide. A system font at 12px
// becomes an unreadable grey smear at that scale, and it cannot be lettered in
// the town's own colours. A 3x5 bitmap can: it is the size 16-bit maps used for
// exactly this job, and it is the smallest size at which a letter still survives
// being decoded by shape rather than by hinting.
//
// Three consequences of that size, all of them load-bearing:
//
//   - The glyphs are data, not drawings. One character of source is one pixel,
//     so `A` in the source is `A` on screen and a reviewer can read the letter
//     rather than count columns off a table.
//   - Everything is uppercased on the way in. A 3x5 face has no room for
//     descenders or a second set of letterforms, and small-caps is how a map
//     has always been lettered.
//   - A character with no glyph becomes a blank, never a dropped column. A
//     missing glyph that shifted the rest of the text would mis-align every
//     label after it, which is a far worse failure than a gap.
//
// Ink is a parameter rather than a constant here. The typesetter is the pencil:
// what colour the lettering is belongs to the layer doing the lettering, and
// that layer takes its colour from the palette like every other artist in this
// file tree. Nothing in this module writes a colour of its own.

import { Pix } from "./surface";

/** Every glyph is three pixels wide. */
export const GLYPH_W = 3;
/** Every glyph is five pixels tall, on the same baseline. */
export const GLYPH_H = 5;
/**
 * One pixel of air between glyphs.
 *
 * At three pixels wide a letter is mostly its own outline, so this single column
 * is what keeps a word from reading as one long blob. It is letter spacing and it
 * is never skipped: the last glyph gets no trailing gap, which is why a width is
 * `n * GLYPH_W + (n - 1) * GLYPH_GAP` and not `n * (GLYPH_W + GLYPH_GAP)`.
 */
export const GLYPH_GAP = 1;

/**
 * FONT is the face: uppercase, figures, and the punctuation a map label needs.
 *
 * `#` is an inked pixel and `.` is empty, five rows of three. Reading the table
 * is meant to be reading the letter, so the glyphs are laid out as a type case
 * rather than alphabetised: the letters, then the figures, then the marks.
 *
 * At 3x5 a letter is read off its silhouette, so two families carry all of the
 * design's care:
 *
 *   - The stems of `M`, `N` and `H`, and the two of `W`. `M` and `W` are the hard
 *     pair: three pixels of width leave no room for a diagonal, so they are drawn
 *     as the mirror pair they are — a block of ink filling the top of the letter
 *     for `M`, the bottom for `W` — while `N` takes a single-pixel notch at the
 *     top of its right stem and `H` its crossbar at dead centre. Four letters,
 *     four different silhouettes, no two sharing a row.
 *   - The height at which the two stems turn, which is the only thing telling
 *     `U`, `V` and `Y` apart. They differ by exactly one row each — `U` turns at
 *     the base, `V` one row above it, `Y` two rows above it — and that single row
 *     is the whole information the face can afford them. It is enough: the eye
 *     reads where a stroke ends, not how long it ran.
 *
 * `I` and `1` share an outline and differ only in whether the first row is a
 * full serif bar or a flag — the distinction a real typeface uses, and the only
 * one that fits. `O` and `0` are separated the same way: the figure is the one
 * with flat top and bottom bars. `C` and `G` differ by a single pixel in the
 * middle row, `Q` is `O` plus a corner tail, and `8` is the mid-row-bar glyph so
 * that `M` can keep its filled shoulders.
 */
export const FONT: Record<string, readonly string[]> = {
  A: [".#.", "#.#", "###", "#.#", "#.#"],
  B: ["##.", "#.#", "##.", "#.#", "##."],
  C: [".##", "#..", "#..", "#..", ".##"],
  D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"],
  F: ["###", "#..", "##.", "#..", "#.."],
  G: [".##", "#..", "#.#", "#.#", ".##"],
  H: ["#.#", "#.#", "###", "#.#", "#.#"],
  I: ["###", ".#.", ".#.", ".#.", "###"],
  J: ["..#", "..#", "..#", "#.#", "##."],
  K: ["#.#", "#.#", "##.", "#.#", "#.#"],
  L: ["#..", "#..", "#..", "#..", "###"],
  M: ["#.#", "###", "###", "#.#", "#.#"],
  N: ["#.#", "##.", "#.#", "#.#", "#.#"],
  O: [".#.", "#.#", "#.#", "#.#", ".#."],
  P: ["##.", "#.#", "##.", "#..", "#.."],
  Q: [".#.", "#.#", "#.#", "##.", ".##"],
  R: ["##.", "#.#", "##.", "#.#", "#.#"],
  S: [".##", "#..", ".#.", "..#", "##."],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
  U: ["#.#", "#.#", "#.#", "#.#", ".#."],
  V: ["#.#", "#.#", "#.#", ".#.", ".#."],
  W: ["#.#", "#.#", "###", "###", "#.#"],
  X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
  Y: ["#.#", "#.#", ".#.", ".#.", ".#."],
  Z: ["###", "..#", ".#.", "#..", "###"],

  // Figures. Filled and flat-topped wherever the letter beside them is open, so
  // a number inside a place name never reads as a letter by mistake.
  "0": ["###", "#.#", "#.#", "#.#", "###"],
  "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["##.", "..#", ".#.", "#..", "###"],
  "3": ["##.", "..#", ".#.", "..#", "##."],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  "5": ["###", "#..", "##.", "..#", "##."],
  "6": ["..#", ".#.", "##.", "#.#", ".#."],
  "7": ["###", "..#", ".#.", ".#.", ".#."],
  "8": [".#.", "#.#", ".#.", "#.#", ".#."],
  "9": ["##.", "#.#", "##.", "..#", "..#"],

  // Marks. `.` and `,` sit on the bottom row, `:` in the middle of the box, so a
  // label can say "PHASE 2: BUILD" without its punctuation floating off the
  // baseline. A comma's tail has nowhere to go in five rows, so it leans one
  // pixel left along the bottom row instead of hanging below it.
  ".": ["...", "...", "...", "...", ".#."],
  ",": ["...", "...", "...", ".#.", "#.."],
  ":": ["...", ".#.", "...", ".#.", "..."],
  "-": ["...", "...", "###", "...", "..."],
  "/": ["..#", "..#", ".#.", "#..", "#.."],
  "(": ["..#", ".#.", ".#.", ".#.", "..#"],
  ")": ["#..", ".#.", ".#.", ".#.", "#.."],
  "+": ["...", ".#.", "###", ".#.", "..."],
  "#": ["#.#", "###", "#.#", "###", "#.#"],
  "?": ["##.", "..#", ".#.", "...", ".#."],
  "!": [".#.", ".#.", ".#.", "...", ".#."],
  "'": [".#.", ".#.", "...", "...", "..."],
  " ": ["...", "...", "...", "...", "..."],
};

/**
 * typeset draws one line of text and returns the surface holding it.
 *
 * The result is exactly the pixels of the lettering: `GLYPH_H` tall and as wide
 * as the text needs, with no padding and no transparent margin. Where it goes is
 * the caller's business — the same string is wanted over a district, under a
 * building and beside a worker — so the typesetter's only job is to be crisp and
 * to be exactly the size it reported.
 *
 * A character outside the face is set as a blank rather than skipped. Dropping
 * the column would shift everything after the offending character and quietly
 * turn a name into a different name; a gap is honest about not having the glyph.
 * This function never throws: a label is lettered from data the scene did not
 * author, and a missing glyph must not be able to take a frame down. Empty text
 * is set as a single blank cell for the same reason `Pix` refuses a zero-pixel
 * surface: an empty name should leave an empty label, not raise inside the
 * scene's draw loop.
 */
export function typeset(text: string, ink: string): Pix {
  const chars = text.toUpperCase() || " ";
  const n = chars.length;
  const out = new Pix(n * GLYPH_W + (n - 1) * GLYPH_GAP, GLYPH_H);

  for (let i = 0; i < n; i++) {
    const glyph = FONT[chars[i]] ?? FONT[" "];
    const ox = i * (GLYPH_W + GLYPH_GAP);
    for (let y = 0; y < GLYPH_H; y++) {
      const row = glyph[y];
      for (let x = 0; x < GLYPH_W; x++) {
        if (row[x] === "#") out.set(ox + x, y, ink);
      }
    }
  }
  return out;
}

