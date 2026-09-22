// Parts: the shapes the props are built from.
//
// A prop is 10 to 40 pixels across. At that size a shape is a silhouette plus
// two tones, and most of this town's furniture is one of four silhouettes
// wearing different colours: an open container, a stacked pile, a board on legs,
// a disc. Drawing those once here is not abstraction for its own sake — it is
// the difference between a Yard that reads as one yard and a Yard that reads as
// thirty separate drawings that happen to be near each other.
//
// Every helper takes the same `Shade` the `IsoPix.box` primitive takes, so a
// drawer can colour a part from any ramp without this module knowing which one
// or why.

import { type IsoPix } from "../iso";
import { type Ink } from "../surface";
import { type Shade } from "./kinds";

/**
 * hollowBox draws an open-topped container: a skip, a water butt, a mixer's
 * drum, a tool tray, a crate of offcuts.
 *
 * The opening is the whole read. The same box drawn solid says "crate"; with
 * its top surface replaced by a floor one unit in, it says "container". That rim
 * is the only pixel of information separating the two, which is why this is a
 * named part rather than a `box` call repeated at each site.
 */
export function hollowBox(
  iso: IsoPix,
  x: number,
  y: number,
  w: number,
  h: number,
  zBottom: number,
  zTop: number,
  shade: Shade & { inner: Ink },
): void {
  iso.box(x, y, w, h, zBottom, zTop, shade);
  // The floor, inset one unit, so the wall left standing around it is the rim.
  iso.footprint(x + 1, y + 1, w - 2, h - 2, zTop, shade.inner);
}

/**
 * slabStack draws a pile of courses: bricks, girders, pallets, stacked sheet.
 *
 * The seam under each course is load-bearing. Without it a seven-course pile is
 * one tall block with a highlight on top, and the *count* — the whole reason to
 * draw a pile rather than a box — is invisible.
 */
export function slabStack(
  iso: IsoPix,
  x: number,
  y: number,
  w: number,
  h: number,
  layers: number,
  unit: number,
  gap: number,
  shade: Shade & { seam: Ink },
): void {
  for (let i = 0; i < layers; i++) {
    const z = i * (unit + gap);
    iso.box(x, y, w, h, z, z + unit, shade);
    if (i > 0) {
      // The lit top edge of the course below, run along the two visible walls,
      // which is where a stack's courses actually catch the light.
      iso.beamX(x, x + w, y + h, z, shade.seam, 1);
      iso.beamY(y, y + h, x + w, z, shade.seam, 1);
    }
  }
}

/**
 * plankPile draws sawn boards hand-stacked.
 *
 * Offsetting every other board's depth by one unit is what stops a pile reading
 * as a texture. A perfectly aligned stack is a pattern; a yard's timber is
 * stacked, and the irregularity is the only thing saying so.
 */
export function plankPile(
  iso: IsoPix,
  x: number,
  y: number,
  len: number,
  wide: number,
  count: number,
  z0: number,
  shade: Shade & { end: Ink },
): void {
  for (let i = 0; i < count; i++) {
    const z = z0 + i * 3;
    const off = i % 2 === 0 ? 0 : 1;
    iso.box(x + off, y, len - off, wide, z, z + 2, shade);
    // The end grain at the near end, so the boards have depth and a reader can
    // count them rather than seeing a slab.
    iso.beamY(y, y + wide, x, z + 1, shade.end, 1);
  }
}

/**
 * disc draws a wheel, drum end, reel or handwheel as an octagon.
 *
 * A true circle is impossible at four pixels of radius, and an octagon is what
 * the hardware was. Its flat bottom is also what reads as "resting on the
 * ground" rather than "floating above it".
 */
export function disc(
  iso: IsoPix,
  cx: number,
  cy: number,
  radius: number,
  z: number,
  rim: Ink,
  hub: Ink,
): void {
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    // The vertical radius is flattened to two-thirds, which is the same 2:1
    // foreshortening the ground uses — a circle seen in this projection is an
    // ellipse lying the same way.
    iso.plot(cx + Math.cos(ang) * radius, cy + Math.sin(ang) * radius * 0.65, z, rim);
  }
  iso.plot(cx, cy, z, hub);
}

/**
 * bracedBoard draws a board standing on two legs: a toolboard, a noticeboard,
 * a plan board.
 *
 * The board's face is its `lit` wall, because the camera sees the lower-left
 * flank of a one-unit-deep slab and that flank is the whole surface a reader
 * looks at. Drawers hang their own detail on it.
 */
export function bracedBoard(
  iso: IsoPix,
  x: number,
  y: number,
  w: number,
  zBottom: number,
  zTop: number,
  shade: Shade & { face: Ink },
): void {
  // The legs first, so the board lands on them rather than floating in front.
  iso.post(x + 1, y, zBottom, zTop, shade.shadow, 1);
  iso.post(x + w - 1, y, zBottom, zTop, shade.shadow, 1);
  // The board: a slab eleven units tall, its face on the near wall.
  iso.box(x, y, w, 1, zTop - 11, zTop, {
    top: shade.top,
    lit: shade.face,
    shadow: shade.shadow,
    edge: shade.edge,
  });
}

/**
 * drum draws a barrel-shaped vessel: staves, two hoops, and a rim.
 *
 * It is the shape a mixer, a water butt and a cable reel all take at this size,
 * so it is here rather than drawn three times with three different bellies.
 */
export function drum(
  iso: IsoPix,
  x: number,
  y: number,
  w: number,
  h: number,
  zBottom: number,
  zTop: number,
  shade: Shade & { hoop: Ink; rim: Ink },
): void {
  const belly = Math.round((zTop - zBottom) * 0.4);
  const zm = zBottom + belly;
  // Bottom course, waist, top course: three boxes of increasing then decreasing
  // width are what give the silhouette its swell.
  iso.box(x + 1, y + 1, w - 2, h - 2, zBottom, zm, shade);
  iso.box(x, y, w, h, zm, zTop - 2, shade);
  iso.box(x + 1, y + 1, w - 2, h - 2, zTop - 2, zTop, shade);
  // The hoops, at the two heights a real cask is bound.
  iso.beamY(y, y + h, x + w, zm + 1, shade.hoop, 1);
  iso.beamY(y, y + h, x, zTop - 4, shade.hoop, 1);
  iso.footprintRim(x + 1, y + 1, w - 2, h - 2, zTop, shade.rim);
}
