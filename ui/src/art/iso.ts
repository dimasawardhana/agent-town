// Iso: the projection, and the box/roof primitives every building is built
// from.
//
// The layout stays in top-down world units and is never recomputed in the
// browser (ADR-0012). This module only *projects* it:
//
//     sx = (wx - wy) / 2
//     sy = (wx + wy) / 4 - z
//
// which is the classic 2:1 dimetric every 16-bit town-builder used. Moving one
// world unit along x moves the picture half a pixel right and a quarter down;
// moving along y moves it half a pixel left and a quarter down. A square
// footprint therefore projects to a diamond twice as wide as it is tall.
//
// Everything here rasterises by walking integers in world space and plotting
// pixels, never by filling a canvas path. Canvas path filling is antialiased
// and cannot be switched off — `imageSmoothingEnabled` governs image sampling,
// not geometry — so a Graphics-drawn diamond would always arrive with a soft,
// muddy rim. Plotting is also what makes a 2:1 stair-step exact rather than
// approximate.

import { type Ink, Pix, rgba } from "./surface";
import { type Turn, normaliseTurn, turnPoint } from "../view";

/**
 * A wall of a world box: fixed along one axis, running along the other.
 *
 * A face is described this way rather than as a pair of corners because the two
 * things the renderer must decide about it — whether the camera can see it, and
 * how its pixels overwrite a neighbour's — are both single numbers derived from
 * its midpoint, and a corner pair would invite comparing the wrong two.
 */
interface Face {
  /** 0 for a face fixed in world x, 1 for one fixed in world y. */
  axis: 0 | 1;
  fixed: number;
  from: number;
  to: number;
}

/** A point in the picture, in pixels. */
export interface Point {
  x: number;
  y: number;
}

/**
 * IsoPix is a Pix with the projection bound to it.
 *
 * `ox`/`oy` are the picture-space origin: the pixel that world (0, 0, 0) lands
 * on. Each baked asset sets its own origin so the sprite's bounding box starts
 * at (0, 0) without every caller re-deriving the offset.
 *
 * `turn` orients the cel. Because a cel is plotted in its own local frame and
 * the turn is linear about the world origin, turning here composes exactly with
 * the site's own turned placement — the art of a turned building, put at the
 * turned site, is the turned picture of that building. Nothing about the cel's
 * size or origin changes: a square footprint projects to the same bounding box
 * at every quarter turn, so the atlas cell is invariant and only the pixels
 * differ.
 */
export class IsoPix {
  readonly pix: Pix;
  private readonly ox: number;
  private readonly oy: number;
  readonly turn: Turn;

  constructor(w: number, h: number, ox: number, oy: number, turn = 0) {
    this.pix = new Pix(w, h);
    this.ox = ox;
    this.oy = oy;
    this.turn = normaliseTurn(turn);
  }

  /** project maps a world point to this surface's pixel coordinates. */
  project(wx: number, wy: number, z = 0): Point {
    const p = turnPoint(this.turn, wx, wy);
    return {
      x: (p.x - p.y) / 2 + this.ox,
      y: (p.x + p.y) / 4 - z + this.oy,
    };
  }

  /**
   * plot places one world point.
   *
   * Rounding is half-up and monotonic in each axis, so a run of world points
   * that steps by one unit produces a gapless stair rather than a dotted line.
   */
  plot(wx: number, wy: number, z: number, ink: Ink): this {
    const p = this.project(wx, wy, z);
    this.pix.set(Math.round(p.x), Math.round(p.y), ink);
    return this;
  }

  /**
   * column fills a vertical pixel run between two heights at one world point.
   *
   * A wall face's screen x depends only on its horizontal world coordinate, so
   * a face is exactly a stack of these. Filling this way instead of plotting
   * every (height, depth) pair is what keeps a wall solid: it cannot leave the
   * single-pixel gaps that a naive 3D loop does when two world steps land on
   * the same pixel.
   */
  column(wx: number, wy: number, zBottom: number, zTop: number, ink: Ink): this {
    const top = this.project(wx, wy, zTop);
    const bottom = this.project(wx, wy, zBottom);
    const x = Math.round(top.x);
    const y0 = Math.round(top.y);
    const y1 = Math.round(bottom.y);
    this.pix.vline(x, Math.min(y0, y1), Math.max(y0, y1), ink);
    return this;
  }

  /** horizontal steps along world x at a fixed y, used for ground and beams. */
  row(wx0: number, wx1: number, wy: number, z: number, ink: Ink): this {
    for (let wx = wx0; wx <= wx1; wx++) this.plot(wx, wy, z, ink);
    return this;
  }

  /**
   * footprint fills a world rectangle lying flat at height `z`.
   *
   * This is the ground of every plot and the base of every building, so it is
   * also the shape a shadow takes. The two loops walk world coordinates; the
   * overlap they produce is what makes the fill solid.
   */
  footprint(x: number, y: number, w: number, h: number, z: number, ink: Ink): this {
    for (let wy = y; wy <= y + h; wy++) {
      for (let wx = x; wx <= x + w; wx++) this.plot(wx, wy, z, ink);
    }
    return this;
  }

  /** footprintRim draws only the outline of a footprint, 1px, in the order the
   *  edges appear on screen so a broken rim can be closed deliberately. */
  footprintRim(x: number, y: number, w: number, h: number, z: number, ink: Ink): this {
    for (let wx = x; wx <= x + w; wx++) {
      this.plot(wx, y, z, ink);
      this.plot(wx, y + h, z, ink);
    }
    for (let wy = y; wy <= y + h; wy++) {
      this.plot(x, wy, z, ink);
      this.plot(x + w, wy, z, ink);
    }
    return this;
  }

  /**
   * faceMid is the world midpoint of a face.
   *
   * A midpoint rather than a corner, because for a square footprint a corner is
   * shared by two faces and therefore cannot distinguish them.
   */
  private faceMid(f: Face): Point {
    return f.axis === 0
      ? { x: f.fixed, y: (f.from + f.to) / 2 }
      : { x: (f.from + f.to) / 2, y: f.fixed };
  }

  /**
   * depth is how near a world point is to the camera, larger being nearer.
   *
   * The projection puts larger `x + y` lower on screen, and lower on screen is
   * nearer the viewer for anything standing on the ground. Derived from the
   * turned point rather than from a table of which axis is near at which turn,
   * so it cannot disagree with the projection it is deciding about.
   */
  private depth(wx: number, wy: number): number {
    const p = turnPoint(this.turn, wx, wy);
    return p.x + p.y;
  }

  /** screenX is the picture-space horizontal position of a world point, which
   *  is what decides which of two visible faces reads as lit. */
  private screenX(wx: number, wy: number): number {
    const p = turnPoint(this.turn, wx, wy);
    return p.x - p.y;
  }

  /**
   * visibleFaces picks the two walls of a box the camera can see, and says which
   * of them catches the light.
   *
   * The old code hard-coded the world faces at `x+w` and `y+h`, which is correct
   * only for an unrotated town: turn the world and those two become the *far*
   * walls, hidden behind the box's own top, and a tower renders with no walls at
   * all. Choosing by turned screen position is the general form of the same
   * rule and reduces to it exactly at turn 0.
   *
   * Light is assigned by screen position, not by world axis, because the light is
   * fixed in the picture (`palette.ts`): the face on the picture's left flank
   * catches it whichever world wall that happens to be.
   */
  private visibleFaces(x: number, y: number, w: number, h: number): { lit: Face; shadow: Face } {
    const candidates: Face[] = [
      { axis: 0, fixed: x + w, from: y, to: y + h },
      { axis: 0, fixed: x, from: y, to: y + h },
      { axis: 1, fixed: y + h, from: x, to: x + w },
      { axis: 1, fixed: y, from: x, to: x + w },
    ];
    // The two nearest by midpoint; the rest are behind the box.
    const ordered = [...candidates].sort((a, b) => {
      const ma = this.faceMid(a);
      const mb = this.faceMid(b);
      return this.depth(mb.x, mb.y) - this.depth(ma.x, ma.y);
    });
    const two = ordered.slice(0, 2);
    // Of the two, the one further left in the picture takes the light.
    two.sort((a, b) => {
      const ma = this.faceMid(a);
      const mb = this.faceMid(b);
      return this.screenX(ma.x, ma.y) - this.screenX(mb.x, mb.y);
    });
    return { lit: two[0], shadow: two[1] };
  }

  /**
   * runFace fills one wall, walking it far-to-near.
   *
   * The order only matters where two faces meet, at the shared vertical corner:
   * whichever is drawn second owns that pixel column. Walking far-to-near is what
   * keeps the nearer face's edge intact, and at turn 0 it is the ascending walk
   * the hard-coded version used, so the unrotated picture is unchanged.
   */
  private runFace(f: Face, zBottom: number, zTop: number, ink: Ink): void {
    const near = f.axis === 0 ? this.depth(f.fixed, f.to) > this.depth(f.fixed, f.from) : this.depth(f.to, f.fixed) > this.depth(f.from, f.fixed);
    if (near) {
      for (let v = f.from; v <= f.to; v++) this.columnAt(f, v, zBottom, zTop, ink);
    } else {
      for (let v = f.to; v >= f.from; v--) this.columnAt(f, v, zBottom, zTop, ink);
    }
  }

  /** columnAt raises one column of a wall at the run's offset `v`. */
  private columnAt(f: Face, v: number, zBottom: number, zTop: number, ink: Ink): void {
    if (f.axis === 0) this.column(f.fixed, v, zBottom, zTop, ink);
    else this.column(v, f.fixed, zBottom, zTop, ink);
  }

  /**
   * rect3d draws an axis-aligned world box.
   *
   * Of the four walls only two are ever visible from a fixed camera: the ones
   * at x+w and y+h. In the picture the y+h wall lies on the lower-left flank
   * and the x+w wall on the lower-right, so they are named `lit` and `shadow`:
   * the light is up and to the left, so the lower-left wall catches it and the
   * lower-right turns away. Naming them by world axis instead keeps being read
   * backwards at every call site.
   */
  box(
    x: number,
    y: number,
    w: number,
    h: number,
    zBottom: number,
    zTop: number,
    shade: { top: Ink; lit: Ink; shadow: Ink; edge?: Ink },
  ): this {
    // Which walls exist is a question about the turn, not about the world:
    // `visibleFaces` picks the two the camera can see and says which is lit.
    const { lit, shadow } = this.visibleFaces(x, y, w, h);
    this.runFace(shadow, zBottom, zTop, shade.shadow);
    this.runFace(lit, zBottom, zTop, shade.lit);

    // The top, far rows first, then each row far-to-near. Larger depth projects
    // lower and is therefore nearer the camera, so walking by increasing depth
    // draws back to front and the near rows land last — which is what keeps the
    // seam between the top and the wall below it a single pixel wide.
    //
    // The row order follows the turn rather than always walking y upward, which
    // is the same correction the walls needed: at turn 0 it *is* y upward.
    const rowsNearerWithY = this.depth(x, y + h) > this.depth(x, y);
    for (let i = 0; i <= h; i++) {
      const wy = rowsNearerWithY ? y + i : y + h - i;
      for (let wx = x; wx <= x + w; wx++) this.plot(wx, wy, zTop, shade.top);
    }

    if (shade.edge) {
      for (let v = shadow.from; v <= shadow.to; v++) this.edgeAt(shadow, v, zBottom, shade.edge);
      for (let v = lit.from; v <= lit.to; v++) this.edgeAt(lit, v, zBottom, shade.edge);
    }
    return this;
  }

  /**
   * litWall and shadowWall are the two visible walls of a square footprint.
   *
   * Art that decorates a *face* — windows, a door, the spoil a footing leaves —
   * must go on whichever world walls the camera can currently see, and must put
   * its light-side decoration on whichever of those catches the light. Passing
   * the face rather than a world axis is what makes one drawing routine serve
   * all four orientations: at turn 0 these resolve to the `y = side` and
   * `x = side` faces the art was originally written against, so the unrotated
   * picture is unchanged.
   */
  litWall(side: number): Face {
    return this.visibleFaces(0, 0, side, side).lit;
  }

  shadowWall(side: number): Face {
    return this.visibleFaces(0, 0, side, side).shadow;
  }

  /**
   * wallAt is the world point at offset `u` along a face's own run.
   *
   * `u` runs 0..side in increasing world coordinate along the face, so a
   * drawing's left-to-right in `u` turns with the wall it is on. Decoration that
   * is asymmetric on purpose — `windows` spaces its lit-wall openings wider than
   * its shadow-wall ones — therefore stays asymmetric the same way round after a
   * turn, rather than mirroring because the underlying axis changed.
   */
  private wallAt(f: Face, u: number): Point {
    return f.axis === 0 ? { x: f.fixed, y: f.from + u } : { x: f.from + u, y: f.fixed };
  }

  /** wallPlot places one pixel on a face at offset `u`, height `z`. */
  wallPlot(f: Face, u: number, z: number, ink: Ink): this {
    const p = this.wallAt(f, u);
    return this.plot(p.x, p.y, z, ink);
  }

  /** wallColumn raises a pixel run on a face at offset `u`. */
  wallColumn(f: Face, u: number, zBottom: number, zTop: number, ink: Ink): this {
    const p = this.wallAt(f, u);
    return this.column(p.x, p.y, zBottom, zTop, ink);
  }

  /** edgeAt plots the ground-level pixel of a wall's run. */
  private edgeAt(f: Face, v: number, z: number, ink: Ink): void {
    if (f.axis === 0) this.plot(f.fixed, v, z, ink);
    else this.plot(v, f.fixed, z, ink);
  }

  /**
   * gable draws a pitched roof over a footprint.
   *
   * The ridge runs along world x, which from this camera reads as the roof
   * sloping toward and away from the viewer — the silhouette that says "house"
   * at a glance, where a flat roof says "warehouse".
   *
   * Both slopes are walked far-to-near and filled at every world x, so the
   * surface is solid rather than a set of depth lines. The near slope is drawn
   * last and takes the ridge pixel, which is what makes the ridge line itself
   * separate the two planes instead of needing its own stroke.
   */
  gable(
    x: number,
    y: number,
    w: number,
    h: number,
    zEave: number,
    height: number,
    shade: { near: Ink; far: Ink; ridge: Ink; gable: Ink; edge?: Ink },
  ): this {
    // The ridge runs along world x when the town is unrotated, which is the
    // silhouette that says "house" at a glance. Turning the town turns the ridge
    // with it, so which world axis the ridge follows is a question about the
    // turn — and so is which of the two slopes faces the camera.
    //
    // The ridge is the axis that runs *across* the viewer's line of sight: after
    // the turn, the direction whose picture-space span is horizontal. At turn 0
    // that is world x, which is why the unrotated roof is unchanged.
    const alongX = this.ridgeRunsAlongX();

    // `span` walks the ridge's own axis; `across` walks away from the ridge
    // toward the eaves, and its two ends are the far and near slopes.
    const ridgeFrom = alongX ? x : y;
    const ridgeTo = alongX ? x + w : y + h;
    const acrossFrom = alongX ? y : x;
    const acrossTo = alongX ? y + h : x + w;
    const acrossHalf = Math.max(1, (acrossTo - acrossFrom) / 2);
    const ridgeMid = Math.round(acrossFrom + acrossHalf);

    // Which end of `across` is farther from the camera, and therefore the far
    // slope that must be drawn first.
    const fromIsFar = this.depth(alongX ? x : acrossFrom, alongX ? acrossFrom : y) < this.depth(alongX ? x : acrossTo, alongX ? acrossTo : y);
    const farEnd = fromIsFar ? acrossFrom : acrossTo;
    const nearEnd = fromIsFar ? acrossTo : acrossFrom;
    const dir = nearEnd > farEnd ? 1 : -1;

    /** at builds the world point at a ridge offset and an across offset. */
    const at = (r: number, a: number): { wx: number; wy: number } =>
      alongX ? { wx: r, wy: a } : { wx: a, wy: r };

    // Far slope: the plane facing away, from its eave up to the ridge.
    for (let a = farEnd; a !== ridgeMid + dir; a += dir) {
      const z = zEave + height * (1 - Math.abs(a - (acrossFrom + acrossHalf)) / acrossHalf);
      for (let r = ridgeFrom; r <= ridgeTo; r++) {
        const p = at(r, a);
        this.plot(p.wx, p.wy, z, shade.far);
      }
    }

    // Near slope: drawn second, so it overlaps the ridge seam rather than
    // leaving a gap at it, and takes the ridge pixel itself.
    for (let a = ridgeMid; a !== nearEnd + dir; a += dir) {
      const z = zEave + height * (1 - Math.abs(a - (acrossFrom + acrossHalf)) / acrossHalf);
      for (let r = ridgeFrom; r <= ridgeTo; r++) {
        const p = at(r, a);
        this.plot(p.wx, p.wy, z, Math.abs(a - ridgeMid) <= 0 ? shade.ridge : shade.near);
      }
    }

    // The gable end: the triangle under the roof at the far end of the ridge
    // axis. Without it the roof floats, because nothing connects the eave line
    // to the ridge.
    for (let a = acrossFrom; a <= acrossTo; a++) {
      const z = zEave + height * (1 - Math.abs(a - (acrossFrom + acrossHalf)) / acrossHalf);
      const r = alongX ? x + w : y + h;
      const p = at(r, a);
      this.column(p.wx, p.wy, zEave, z, shade.gable);
      if (shade.edge) this.plot(p.wx, p.wy, zEave, shade.edge);
    }
    return this;
  }

  /**
   * ridgeProfile roofs a footprint with a surface whose height varies along the
   * **ridge axis**, rather than across it the way `gable` does.
   *
   * That one difference is what makes a sawtooth expressible. A gable's profile is
   * a triangle across the span: every point at the same distance from the ridge is
   * at the same height, which is what "pitched roof" means. A sawtooth is the
   * opposite — its height depends on where you are *along* the ridge — so it needs
   * a primitive that sweeps a profile down the ridge's length instead of out from
   * it, and every tooth is one period of that profile.
   *
   * `profile` takes the world offset along the ridge, 0..`w` (or 0..`h` after a
   * turn), and returns the rise above `zEave`. Where the profile **falls** the
   * sweep fills a vertical face from the lower height up to the higher one, which
   * is both what makes the surface solid and what gives a sawtooth its glazed
   * flank — the drop between two teeth is a real plane of the roof, not a gap.
   *
   * The ridge axis is chosen by the same `ridgeRunsAlongX` test `gable` uses, so
   * the serration stays across the viewer's line of sight as the town turns, and
   * both roof kinds turn with the world rather than with the camera.
   */
  ridgeProfile(
    x: number,
    y: number,
    w: number,
    h: number,
    zEave: number,
    profile: (along: number) => number,
    shade: { surface: Ink; face: Ink; edge?: Ink },
  ): this {
    const alongX = this.ridgeRunsAlongX();
    const from = alongX ? x : y;
    const to = alongX ? x + w : y + h;
    const acrossFrom = alongX ? y : x;
    const acrossTo = alongX ? y + h : x + w;

    /** at builds the world point at an along-ridge offset and an across offset. */
    const at = (r: number, a: number): { wx: number; wy: number } =>
      alongX ? { wx: r, wy: a } : { wx: a, wy: r };

    // Which end of `across` is farther from the camera, so the rows can be walked
    // far-to-near. Nearer rows are drawn last and take the pixels where two rows
    // overlap in screen space, which is what keeps a step's top and the wall below
    // it a single clean edge.
    const fromIsFar =
      this.depth(alongX ? x : acrossFrom, alongX ? acrossFrom : y) <
      this.depth(alongX ? x : acrossTo, alongX ? acrossTo : y);
    const farEnd = fromIsFar ? acrossFrom : acrossTo;
    const nearEnd = fromIsFar ? acrossTo : acrossFrom;
    const step = nearEnd > farEnd ? 1 : -1;

    for (let a = farEnd; step > 0 ? a <= nearEnd : a >= nearEnd; a += step) {
      let prev = 0;
      for (let r = from; r <= to; r++) {
        const rise = profile(r - from);
        const p = at(r, a);
        // Filling the span between this step and the previous one is what makes
        // the surface **solid**, and it is not optional here the way it is in
        // `gable`. A gable's profile varies *across* the ridge, so consecutive
        // steps along it differ by a quarter pixel and plotting one point each
        // happens to leave no gaps. A swept profile varies *along* the ridge with a
        // steep rise, so consecutive steps can be several pixels apart vertically
        // and plotting points alone leaves the roof as a sparse lattice — which is
        // exactly what the first version of this drew, and it read as a wireframe
        // rather than as a roof.
        //
        // Which colour the span takes says which plane it is: a rise is the
        // surface you are looking down at, and a fall is the near-vertical flank
        // between two teeth. That is what gives a sawtooth its glazing without the
        // flank being drawn as a separate shape that could come adrift from it.
        if (r > from) {
          this.column(p.wx, p.wy, zEave + Math.min(prev, rise), zEave + Math.max(prev, rise),
            rise >= prev ? shade.surface : shade.face);
        }
        this.plot(p.wx, p.wy, zEave + rise, shade.surface);
        prev = rise;
      }
    }
    return this;
  }

  /**
   * dome roofs a footprint with a surface whose height depends on **distance from
   * the centre**, falling to the eave at the perimeter.
   *
   * The third and last way a roof can vary, after `gable` (height varies across the
   * ridge) and `ridgeProfile` (height varies along it). A dome varies in *both*
   * directions at once, which is exactly why it cannot be expressed with either:
   * both of those sweep a one-dimensional profile, and a dome has no profile
   * direction — every radius is the same fall.
   *
   * `fall` takes the normalised distance from the centre, 0 at the apex and 1 at
   * the perimeter, and returns the rise above `zEave`. Passing it in rather than
   * hardcoding a hemisphere lets a kind choose its own curvature, which matters
   * because a true circle at these sizes reads as a bead rather than as a roof.
   *
   * Rows are walked far-to-near in world y, and within a row the rise is not
   * constant — so like `ridgeProfile` this must fill between consecutive steps or
   * the surface comes out as a lattice. It does both: the span between neighbours
   * inside a row, and nothing between rows, because adjacent rows differ by a
   * quarter pixel once the fall is normalised.
   */
  dome(
    x: number,
    y: number,
    w: number,
    h: number,
    zEave: number,
    fall: (t: number) => number,
    shade: { top: Ink; near: Ink; far: Ink; eave: Ink; edge?: Ink },
  ): this {
    const cx = x + w / 2;
    const cy = y + h / 2;
    // The half-extent along each axis, so a footprint that is not square still
    // domes to its own perimeter rather than bulging past one edge.
    const rx = Math.max(1, w / 2);
    const ry = Math.max(1, h / 2);

    // Far rows first, so nearer rows overwrite them at the seam — the same
    // far-to-near rule `box` and `ridgeProfile` follow.
    for (let wy = y; wy <= y + h; wy++) {
      let prev = -1;
      for (let wx = x; wx <= x + w; wx++) {
        // Normalised radial distance: 0 at the centre, 1 at the perimeter. The
        // clamp keeps the corner samples — which are further than 1 by definition on
        // a square footprint — from pushing the surface below the eave.
        const dx = (wx - cx) / rx;
        const dy = (wy - cy) / ry;
        const t = Math.min(1, Math.sqrt(dx * dx + dy * dy));
        const rise = fall(t);
        // Which band of the dome this is, by height and by depth. Naming the plane
        // is what gives the dome its shading, and it is derived from the height
        // rather than from the position so the three bands always meet cleanly.
        const ink = rise >= fall(0) * 0.66 ? shade.top : wy < cy ? shade.far : shade.near;
        this.plot(wx, wy, zEave + rise, ink);
        if (prev >= 0) {
          this.column(wx, wy, zEave + Math.min(prev, rise), zEave + Math.max(prev, rise),
            rise >= prev ? ink : shade.eave);
        }
        prev = rise;
      }
    }
    return this;
  }

  /**
   * ridgeRunsAlongX says whether the roof's ridge follows world x at this turn.
   *
   * The ridge reads as a roof because it lies across the viewer's line of sight.
   * In picture space a line's horizontal extent is driven by `(x - y)`, so the
   * axis whose turned endpoints differ most in `x - y` is the one across the
   * view — which at turn 0 is world x, and at turn 1 is world y.
   */
  private ridgeRunsAlongX(): boolean {
    const xSpan = Math.abs(this.screenX(1, 0) - this.screenX(0, 0));
    const ySpan = Math.abs(this.screenX(0, 1) - this.screenX(0, 0));
    return xSpan >= ySpan;
  }

  /** beam draws a horizontal member at height z along world x: scaffolding,
   *  framing, a fence rail. */
  beamX(x0: number, x1: number, wy: number, z: number, ink: Ink, thick = 1): this {
    for (let wx = x0; wx <= x1; wx++) {
      for (let d = 0; d < thick; d++) this.plot(wx, wy, z - d, ink);
    }
    return this;
  }

  /** beamY is the same along world y. */
  beamY(y0: number, y1: number, wx: number, z: number, ink: Ink, thick = 1): this {
    for (let wy = y0; wy <= y1; wy++) {
      for (let d = 0; d < thick; d++) this.plot(wx, wy, z - d, ink);
    }
    return this;
  }

  /** post raises a single member from the ground: stakes, scaffolding poles. */
  post(wx: number, wy: number, zBottom: number, zTop: number, ink: Ink, thick = 1): this {
    for (let d = 0; d < thick; d++) {
      this.column(wx, wy, zBottom, zTop, ink);
      // A post one pixel thick in world terms is one pixel on screen only for
      // the near faces; widening along x keeps it visible against the ground.
      if (thick > 1) this.plot(wx, wy, zTop - d, ink);
    }
    return this;
  }

  /**
   * shadeFace darkens or lightens every opaque pixel inside a screen-space
   * rectangle. It is the cheap way to add a form shadow after the fact — under
   * an eave, beside a doorway — without re-running a fill with another colour.
   */
  tintRect(x0: number, y0: number, x1: number, y1: number, ink: string, amount: number): this {
    const [tr, tg, tb] = rgba(ink);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const [r, g, b, a] = this.pix.at(x, y);
        if (a === 0) continue;
        this.pix.set(x, y, [
          r + (tr - r) * amount,
          g + (tg - g) * amount,
          b + (tb - b) * amount,
          a,
        ]);
      }
    }
    return this;
  }

  /** outline inks the whole surface's outer edge. */
  outline(ink: string): Pix {
    return this.pix.outline(ink);
  }
}

/**
 * IsoBounds is the picture-space box a world rectangle occupies.
 *
 * It is derived by projecting the four corners rather than by formula, so a
 * change to the projection cannot silently desynchronise the sprite sizes from
 * the positions they are drawn at.
 */
export interface IsoBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  w: number;
  h: number;
}

/** boundsOf returns the picture-space box a world box occupies. */
export function boundsOf(
  x: number,
  y: number,
  w: number,
  h: number,
  zTop = 0,
  zBottom = 0,
): IsoBounds {
  const corners: Point[] = [
    { x: (x - y) / 2, y: (x + y) / 4 },
    { x: (x + w - y) / 2, y: (x + w + y) / 4 },
    { x: (x - (y + h)) / 2, y: (x + (y + h)) / 4 },
    { x: (x + w - (y + h)) / 2, y: (x + w + y + h) / 4 },
  ];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const minX = Math.floor(Math.min(...xs));
  const maxX = Math.ceil(Math.max(...xs));
  const minY = Math.floor(Math.min(...ys) - zTop);
  const maxY = Math.ceil(Math.max(...ys) - zBottom);
  return { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** The hand-drawn half-width of a footprint's shadow in world units. Shadow is
 *  what stops a building looking pasted onto the ground. */
export const SHADOW_OFFSET = 0;
