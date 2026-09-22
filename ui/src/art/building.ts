// Buildings: one building that gains a part at a time.
//
// The stages are not eight drawings. They are eight *parts*, and the picture for
// a stage is every part up to it drawn in order — so stage N is, by
// construction, stage N-1 plus exactly one more thing. That structure is the
// point rather than a convenience: it is what makes a glance at the map answer
// "how finished is this?" instead of only "has something happened?", and it
// makes it impossible to draw a roof on a building with no walls.
//
// The order is the order a real building goes up in, and it follows what the
// work actually is: a plot is staked out, footings go in, the frame is raised,
// the walls close it in, the roof makes it weathertight — and then the finishing
// trades, glazing and the door, which are what a *passing test* earns. Structure
// is made by changing things; finish is earned by proving the work holds.
//
// Two things are deliberately not parts: the scaffold and the spoil heap. They
// are the *site* rather than the building, so they are derived from the rank
// range instead of being added by one. Scaffolding is up while there is a frame
// to climb and struck once the roof is on; the spoil heap is left by the
// footings and cleared away as the finishing trades arrive.
//
// The footprint comes from the layout, not from here: buildings are 44, 60, 78
// or 100 world units on a side (internal/analyzer/layout.go). A building is
// therefore drawn at whatever size the analyzer chose, and a bigger building is
// both wider and taller — size reads twice, which is the point of sizing
// buildings by file count at all.

import { P, type Ramp } from "./palette";
import { IsoPix } from "./iso";
import { STOREY, bandHeight } from "./stack";
import { type Pix } from "./surface";

/**
 * How far a building has been built. These are exactly internal/town's Status
 * values, in the same order, and both sides are asserted against each other by
 * a test — a renderer that does not know a stage the daemon can emit draws the
 * wrong picture silently.
 */
export type Stage =
  | "planned"
  | "foundation"
  | "framed"
  | "walled"
  | "roofed"
  | "glazed"
  | "doored"
  | "completed";

/** The ladder in order, lowest first. */
export const STAGE_ORDER: readonly Stage[] = [
  "planned",
  "foundation",
  "framed",
  "walled",
  "roofed",
  "glazed",
  "doored",
  "completed",
];

/** A stage's position on the ladder. */
export function stageRank(s: Stage): number {
  const i = STAGE_ORDER.indexOf(s);
  return i < 0 ? 0 : i;
}

/**
 * The part each rank adds, and the order the parts are drawn in.
 *
 * This table is the whole stage model. Drawing a stage means drawing every
 * entry from rank 0 up to and including that stage's own, in this order, which
 * is why a later stage cannot lose an earlier part and why nothing can skip.
 *
 * The order within a rank matters for occlusion: the frame's posts stand in
 * front of the foundations they sit on, the walls infill between the posts,
 * and the roof closes over the top of the walls.
 */
type PartName =
  | "stakes"
  | "footings"
  | "frame"
  | "walls"
  | "roof"
  | "windows"
  | "door"
  | "trim";

const PART_FOR_STAGE: Record<Stage, PartName> = {
  planned: "stakes",
  foundation: "footings",
  framed: "frame",
  walled: "walls",
  roofed: "roof",
  glazed: "windows",
  doored: "door",
  completed: "trim",
};

/** What each rank adds, in one line, for the panel and for the tests. */
export const STAGE_ADDS: Record<Stage, string> = {
  planned: "plot staked out",
  foundation: "footings and spoil",
  framed: "pillars and beams",
  walled: "walls closed in",
  roofed: "roof on, weathertight",
  glazed: "windows fitted",
  doored: "door hung",
  completed: "trim, plinth and chimney",
};

// --- Site props ------------------------------------------------------------
//
// Derived from the rank range, never added by a single rank: a building does not
// "gain scaffolding", it is scaffolded for part of its life.

/** Scaffolding is up from the frame until the roof makes the shell weathertight. */
function hasScaffold(s: Stage): boolean {
  const r = stageRank(s);
  return r >= stageRank("framed") && r < stageRank("roofed");
}

/** The spoil heap is left by the footings and cleared as the finish goes on. */
function hasSpoil(s: Stage): boolean {
  const r = stageRank(s);
  return r >= stageRank("foundation") && r < stageRank("glazed");
}

/**
 * BuildingSkin is the material a building is made of.
 *
 * The analyzer sizes a building by how much source it holds; the skin is the
 * other half of that reading. A skin is chosen from the building's own path so
 * a district tends to share a material and a large building can be a different
 * tier from a small one — a town where every building is the same cottage reads
 * as a placeholder, not as a place.
 */
export interface BuildingSkin {
  wall: Ramp;
  roof: Ramp;
  // There is deliberately no `wallHeight` here any more. A storey is a fixed 20
  // world units (`art/stack.ts`), so the wall's height is a property of the
  // building's floor count and not of its skin. Keeping a per-skin wall height
  // alongside floors would be two numbers for one fact, and the skin's copy
  // would be the one nothing read — it was, before this was removed.
  /** Roof height in world units. */
  roofHeight: number;
  /** Whether the walls are exposed framed timber rather than plastered. */
  framed: boolean;
}

/**
 * skinVariant reduces a building's path to the 0/1 choice of material pair.
 *
 * It is exported, and `skinFor` is built on it, so the bake and the scene
 * cannot disagree about which variant a building is: the bake bakes both and
 * the scene asks for this one. Deriving the choice twice is how a building ends
 * up drawn in a skin the atlas never rasterised.
 *
 * A hash of the path rather than of a counter, because the answer must not
 * depend on iteration order — the same repo must draw the same town forever
 * (ADR-0012).
 */
export function skinVariant(path: string): 0 | 1 {
  let h = 0;
  for (let i = 0; i < path.length; i++) h = (h * 31 + path.charCodeAt(i)) | 0;
  return (Math.abs(h) % 2) as 0 | 1;
}

/**
 * skinFor chooses a building's material from how much source it holds.
 *
 * The file-count thresholds are the analyzer's own footprint steps
 * (internal/analyzer/layout.go), written as those numbers rather than as a
 * general scale so that size and material always say the same thing: a big
 * directory is a big stone hall, not a small cottage drawn large.
 */
export function skinFor(files: number, path: string): BuildingSkin {
  const warm = skinVariant(path) === 0;

  if (files <= 2) {
    // A hut: low walls, a steep thatch roof, mostly roof from this angle.
    return { wall: P.plaster, roof: P.thatch, roofHeight: 12, framed: true };
  }
  if (files <= 5) {
    return { wall: P.plaster, roof: warm ? P.roof : P.thatch, roofHeight: 16, framed: true };
  }
  if (files <= 12) {
    // A workshop: taller walls, tile roof. Two materials, so a district of
    // mid-sized buildings is not a row of identical boxes.
    return { wall: warm ? P.stone : P.plaster, roof: P.roof, roofHeight: 20, framed: !warm };
  }
  // A hall: stone, high walls, a shallow roof, so its mass reads as width.
  return { wall: P.stone, roof: P.roof, roofHeight: 22, framed: false };
}

/** The picture-space box a skin occupies over a footprint of side `s`. */
export interface BuildingBox {
  w: number;
  h: number;
  /** Where the footprint's (x, y) corner lands in the picture. */
  ox: number;
  oy: number;
  /** Total height of the finished building in world units. */
  zTop: number;
}

/**
 * boxFor computes the cel size for a footprint.
 *
 * It projects the footprint's own corners rather than using a closed form, so
 * the cel can never disagree with the projection the scene draws at — and then
 * adds the margin everything drawn *outside* the footprint needs.
 *
 * The margin has to cover every overhang, and two of them are not part of the
 * building: the scaffold's poles stand five world units beyond the near corner
 * and its walk boards reach the same edge, and the spoil heap sits four units
 * out to the side. When the margin did not include them, the outline pass had
 * nowhere to write on those two cel edges, so the left ends of the scaffold's
 * boards and the lower edge of the spoil heap lost their ink line on all
 * sixteen `constructing` and `testing` cels.
 */
export function boxFor(side: number, skin: BuildingSkin, floors = 1): BuildingBox {
  // The height became a parameter when floors did. It cannot be derived from the
  // skin alone any more, because the same skin now stands one storey or twenty —
  // and a cel sized for one storey would clip a tower.
  const zTop = bandHeight(floors) + skin.roofHeight + 6; // +6 for the ridge and shadow
  // The four footprint corners, projected by hand from the same formula the
  // scene uses. Deriving them here rather than in the scene is what lets the
  // cel's own size be the authority on where the building's origin is.
  const xs = [0, side / 2, -side / 2, 0];
  const ys = [0, side / 4, side / 4, side / 2];

  // Scaffold poles and boards reach 5 world units beyond the near corner; the
  // spoil heap reaches 14 along x and 8 along y. Both project to at most a few
  // pixels, so 6 covers them along with the roof's 2-unit eaves and the 1px
  // outline itself. Clipping any of it cuts a hole in a building, and a clipped
  // outline is worse than no outline at all.
  const m = 6;
  const minX = Math.floor(Math.min(...xs)) - m;
  const maxX = Math.ceil(Math.max(...xs)) + m;
  const minY = Math.floor(Math.min(...ys) - zTop) - m;
  const maxY = Math.ceil(Math.max(...ys)) + m;
  return {
    w: maxX - minX + 1,
    h: maxY - minY + 1,
    ox: -minX,
    oy: -minY,
    zTop,
  };
}

/**
 * The three parts a building is assembled from.
 *
 * A building is drawn as a base, a run of identical storey bands, and a cap,
 * held in one container by the scene. The split is by **how a part tiles**, not
 * by which rank introduces it: base and cap occur once, the band repeats.
 *
 * That is forced by arithmetic rather than chosen for elegance. A storey is
 * `STOREY` world units, so a 20-storey tower on a 100-unit footprint occupies a
 * 113x427 cel; one baked cel per (footprint, height, stage, damage) combination
 * is unbounded memory for a picture that is a vertical repeat. `art/stack.ts`
 * proves the repeat is exact, which is what makes stacking safe.
 *
 * Every part draws its own base at local z = 0, so placement is one rule for all
 * three: put it at `i * STOREY` and its own origin lands where it belongs. Getting
 * this wrong by one storey is invisible on a single-storey building, which is
 * why the rule is stated here rather than left to each call site.
 */

/** bandBox is the cel one storey occupies: the wall's projection, plus the
 *  margin the outline needs, and no headroom above because stacking supplies it. */
export function bandBox(side: number): BuildingBox {
  const xs = [0, side / 2, -side / 2, 0];
  const ys = [0, side / 4, side / 4, side / 2];
  const m = 6;
  const minX = Math.floor(Math.min(...xs)) - m;
  const maxX = Math.ceil(Math.max(...xs)) + m;
  const minY = Math.floor(Math.min(...ys) - STOREY) - m;
  const maxY = Math.ceil(Math.max(...ys)) + m;
  return { w: maxX - minX + 1, h: maxY - minY + 1, ox: -minX, oy: -minY, zTop: STOREY };
}

/** capBox is the cel the roof and its finishing trades occupy, with its own base
 *  at local z = 0 — the cap is placed one storey above the top band, so its base
 *  already *is* the top of the wall. */
export function capBox(side: number, skin: BuildingSkin): BuildingBox {
  const xs = [0, side / 2, -side / 2, 0];
  const ys = [0, side / 4, side / 4, side / 2];
  const m = 6;
  const top = skin.roofHeight + 6;
  const minX = Math.floor(Math.min(...xs)) - m;
  const maxX = Math.ceil(Math.max(...xs)) + m;
  const minY = Math.floor(Math.min(...ys) - top) - m;
  const maxY = Math.ceil(Math.max(...ys)) + m;
  return { w: maxX - minX + 1, h: maxY - minY + 1, ox: -minX, oy: -minY, zTop: top };
}

/**
 * storeyShell is the shell of exactly one storey, drawn at local z 0..STOREY.
 *
 * Every storey of a building is this same function, which is the property that
 * makes a tower expressible: floor 0's shell is drawn into the base's cel and
 * every floor above it into the band's, and because both are the same drawing at
 * the same height the facade is continuous across the join.
 *
 * Scaffolding is here rather than in the base because a building under
 * construction is scaffolded up its whole height, not just at its foot: with the
 * posts drawn per storey they stack into continuous runs, which is what a
 * scaffold around a tower actually is.
 */
function storeyShell(iso: IsoPix, side: number, skin: BuildingSkin, stage: Stage): void {
  const want = stageRank(stage);
  if (want >= stageRank("framed")) framing(iso, side, STOREY);
  if (want >= stageRank("walled")) walls(iso, side, STOREY, skin);
  // Windows are per storey, which is the one place this deliberately departs
  // from the ladder's "one part per rank" reading of a facade: a tower with a
  // single row of windows at the top reads as a mistake, and the band is the
  // only part that repeats, so a per-storey window has to live in it.
  if (want >= stageRank("glazed")) windows(iso, side, STOREY, side >= 60 ? 3 : 2);
  if (want >= stageRank("completed")) cornerBoards(iso, side, skin);
  if (hasScaffold(stage)) scaffold(iso, side, STOREY + 8);
}

/** cornerBoards is the completed rank's vertical trim, one storey's worth. Drawn
 *  per storey so the boards run the full height of a finished tower. */
function cornerBoards(iso: IsoPix, side: number, skin: BuildingSkin): void {
  for (let z = 0; z <= STOREY; z++) {
    iso.plot(side, side, z, skin.wall[0]);
    iso.plot(side + 1, side, z, skin.wall[1]);
  }
}

/**
 * buildBase is everything that happens exactly once, at the foot of the
 * building: the ground works, the ground storey's shell, the street door, and
 * whatever damage is visible from the ground.
 *
 * **It owns the ground storey**, and that is a correction of a real defect
 * rather than a stylistic choice. Splitting the wall so that the base carries
 * none and the bands start one storey up leaves a one-storey building — the
 * common case, since most directories hold one file — as a plot with its roof
 * hovering twenty units above it: measured as a 40-pixel hole in the silhouette
 * at every footprint. Every function involved is individually correct, which is
 * why it is worth stating here.
 *
 * The plinth belongs here rather than with the top trim because it is the bottom
 * course of the wall's footing; drawing it per storey would put a step at the
 * base of every floor and a tower would gain a ring at each.
 */
export function buildBase(
  side: number,
  files: number,
  path: string,
  stage: Stage,
  damaged = false,
): Pix {
  const skin = skinFor(files, path);
  const box = boxFor(side, skin, 1);
  const iso = new IsoPix(box.w, box.h, box.ox, box.oy);
  const want = stageRank(stage);

  plotGround(iso, side);
  // The spoil heap sits on the ground beside the plot, so it goes down before
  // anything standing — otherwise a building would be drawn on top of its own
  // rubble.
  if (hasSpoil(stage)) spoil(iso, side);
  if (want >= stageRank("planned")) cornerStakes(iso, side);
  if (want >= stageRank("foundation")) footings(iso, side);

  storeyShell(iso, side, skin, stage);

  // The door is at street level, which is the base's storey by definition.
  // Putting it in the cap instead — as the first version did — hangs the front
  // door of a tower a hundred units up its face.
  if (want >= stageRank("doored")) door(iso, side, STOREY);
  if (want >= stageRank("completed")) plinth(iso, side, skin);

  if (damaged && hasDamage(stage)) {
    rubble(iso, side);
    // The crack goes on the ground storey so a damaged tower is cracked once, at
    // the base, rather than repeating a crack on every floor — which would read
    // as a facade pattern instead of as damage.
    if (want >= stageRank("walled")) crack(iso, side);
  }

  return iso.outline(P.ink);
}

/**
 * buildBand is one storey of wall: the part that repeats.
 *
 * Its height is exactly `STOREY`, and `art/stack.ts` proves a storey is an exact
 * vertical repeat, so stamping this cel up a tower leaves no seam.
 */
export function buildBand(side: number, skin: BuildingSkin, stage: Stage): Pix {
  const box = bandBox(side);
  const iso = new IsoPix(box.w, box.h, box.ox, box.oy);
  storeyShell(iso, side, skin, stage);
  return iso.outline(P.ink);
}

/**
 * buildCap is everything that happens once, at the top: the roof and its
 * finishing trades.
 *
 * Its own base is the top of the topmost band, so the roof's eave sits at local
 * z = 0. The cap is placed one storey above the last band, so drawing the eave at
 * `STOREY` here as well would raise the roof a second time and leave a storey of
 * sky between the wall and its roof.
 */
export function buildCap(side: number, skin: BuildingSkin, stage: Stage, damaged: boolean): Pix {
  const box = capBox(side, skin);
  const iso = new IsoPix(box.w, box.h, box.ox, box.oy);
  const want = stageRank(stage);

  if (want >= stageRank("roofed")) roof(iso, side, 0, skin);
  if (want >= stageRank("completed")) {
    trim(iso, side, skin);
    chimney(iso, side, 0, skin);
  }
  if (damaged && want >= stageRank("roofed")) roofDamage(iso, side, skin);

  return iso.outline(P.ink);
}

/** The footprint line a building sits on: the near two edges, drawn as a strip
 *  of earth so a building is planted rather than floating. */
function plotGround(iso: IsoPix, side: number): void {
  iso.footprint(0, 0, side, side, 0, P.earth[1]);
  // The lit and shadow edges of the plot, so the ground under a building reads
  // as the same diamond as the district plate it sits on.
  iso.footprintRim(0, 0, side, side, 0, P.earth[0]);
}

/** cornerStakes are the four stakes that mark a plot. Stage 1: cleared ground
 *  and the outline of what is coming. */
function cornerStakes(iso: IsoPix, side: number): void {
  const inset = 4;
  const corners: [number, number][] = [
    [inset, inset],
    [side - inset, inset],
    [inset, side - inset],
    [side - inset, side - inset],
  ];
  // The near two stakes are drawn last so they stand in front of the plot.
  for (const [wx, wy] of corners) {
    iso.post(wx, wy, 0, 7, P.wood[1], 1);
    iso.plot(wx, wy, 8, P.wood[3]);
  }
  // String lines between the stakes: the survey, which is what a cleared plot
  // with stakes actually means.
  iso.beamX(inset, side - inset, side - inset, 1, P.wood[0]);
  iso.beamY(inset, side - inset, side - inset, 1, P.wood[0]);
}

/**
 * scaffold raises the poles and walk boards of a working site.
 *
 * It is drawn outside the footprint so it does not have to be removed again
 * when the walls go up: the walls grow inside it and the scaffold is what the
 * reader sees the building is being built *through*.
 */
function scaffold(iso: IsoPix, side: number, top: number): void {
  const out = 5;
  // Poles at the near corners and the midpoints of the near edges, so the
  // scaffold reads as a run of poles rather than four isolated sticks.
  const poles: [number, number][] = [
    [-out, side + out],
    [side / 2, side + out],
    [side + out, side + out],
    [side + out, side / 2],
  ];
  for (const [wx, wy] of poles) iso.post(wx, wy, 0, top, P.wood[1], 1);

  // Walk boards at two heights, in the lit wood step because they face up.
  for (const z of [top - 3, Math.round(top / 2)]) {
    iso.beamX(-out, side + out, side + out, z, P.wood[3], 1);
    iso.beamY(side + out, side + out, side + out, z, P.wood[2], 1);
  }
  // A leaning ladder, which is the detail that says "being worked on" rather
  // than "under construction, nobody here".
  for (let i = 0; i < top; i++) {
    iso.plot(side - 4, side + out, i, P.wood[2]);
    iso.plot(side - 3, side + out, i + 1, P.wood[1]);
  }
}

/** framing raises the stud walls: the skeleton a building wears at stage 2. */
function framing(iso: IsoPix, side: number, height: number): void {
  const studs = Math.max(2, Math.round(side / 16));
  for (let i = 0; i <= studs; i++) {
    const wx = Math.round((side * i) / studs);
    iso.post(wx, side, 0, height, P.wood[1], 1);
    iso.post(side, wx, 0, height, P.wood[1], 1);
  }
  // Top plates, so the studs terminate in something rather than in mid-air.
  iso.beamX(0, side, side, height, P.wood[3], 1);
  iso.beamY(0, side, side, height, P.wood[2], 1);
  // Two mid-rails: bracing, and they break the vertical rhythm so the framing
  // does not read as a fence.
  const mid = Math.round(height / 2);
  iso.beamX(0, side, side, mid, P.wood[0], 1);
  iso.beamY(0, side, side, mid, P.wood[0], 1);
}

/**
 * walls closes the shell in.
 *
 * It is always drawn to the full wall height and always closed, because "walls
 * half up" is no longer this function's job: on the ladder that is the `framed`
 * stage, where the frame stands open and the walls have not started. One rank,
 * one part — so there is no `planked` argument any more, and no way to draw a
 * partly-built wall at the stage that is supposed to have finished ones.
 */
function walls(iso: IsoPix, side: number, height: number, skin: BuildingSkin): void {
  iso.box(0, 0, side, side, 0, height, {
    top: skin.wall[0],
    lit: skin.wall[3],
    shadow: skin.wall[1],
    edge: P.ink,
  });

  // Exposed framing: vertical timbers on both visible walls, one ramp step
  // darker than the wall so they read as inset rather than applied.
  if (skin.framed) {
    const studs = Math.max(2, Math.round(side / 18));
    for (let i = 1; i < studs; i++) {
      const wx = Math.round((side * i) / studs);
      iso.column(wx, side, 1, height, P.wood[1]);
      iso.column(side, wx, 1, height, P.wood[1]);
    }
    // A sill and a head: the horizontal members a framed wall actually has.
    iso.beamX(0, side, side, Math.round(height * 0.55), P.wood[2], 1);
    iso.beamY(0, side, side, Math.round(height * 0.55), P.wood[2], 1);
  }
}

/**
 * footings are what the foundation rank adds: trenches and pads on the plot.
 *
 * They are the one part that is nearly invisible from this angle, which is
 * correct — a foundation *is* mostly under the ground. The pads that show above
 * it are what tells the reader the plot has been dug rather than merely staked.
 */
function footings(iso: IsoPix, side: number): void {
  const pad = Math.max(3, Math.round(side / 12));
  // The trench outline, drawn in the darker earth so it reads as cut into the
  // plot rather than laid on it.
  iso.footprintRim(3, 3, side - 6, side - 6, 0, P.earth[0]);
  // Corner pads, sitting proud of the plot by one unit — the top of each is what
  // the frame's posts will land on.
  for (const [wx, wy] of [
    [pad, pad],
    [side - pad, pad],
    [pad, side - pad],
    [side - pad, side - pad],
  ] as [number, number][]) {
    iso.footprint(wx - 2, wy - 2, 4, 4, 0, P.stone[1]);
    iso.footprint(wx - 2, wy - 2, 4, 4, 1, P.stone[2]);
  }
}

/** plinth is the base course of the wall: a step out at the foot of the whole
 *  building, drawn once rather than per storey. Drawing it per floor would put a
 *  step at the bottom of every storey and a tower would gain a ring at each. */
function plinth(iso: IsoPix, side: number, skin: BuildingSkin): void {
  iso.box(-1, -1, side + 2, side + 2, 0, 2, {
    top: skin.wall[1],
    lit: skin.wall[2],
    shadow: skin.wall[0],
    edge: P.ink,
  });
}

/** trim is the fascia under the eave: the one piece of finishing that belongs to
 *  the top of the building rather than to a storey of it. The corner boards run
 *  per storey (see `cornerBoards`), and the plinth belongs to the base, because
 *  each of those three repeats a different number of times. */
function trim(iso: IsoPix, side: number, skin: BuildingSkin): void {
  iso.beamX(0, side, side, 0, skin.wall[0], 1);
  iso.beamY(0, side, side, 0, skin.wall[0], 1);
}
/**
 * windows punches lit openings into the two visible walls.
 *
 * A window is a rectangle in the wall's own two axes — along the wall and up
 * it — not a column. Getting that wrong is invisible on a 44-unit hut and
 * obvious on a 100-unit hall, so it is drawn as a surface: `span` units wide
 * and `h` tall, stepped along the wall's own coordinate.
 *
 * The placement is asymmetric on purpose (wider spacing on the lit wall) so
 * the two faces of one building do not read as a printed pattern.
 */
function windows(iso: IsoPix, side: number, height: number, count: number): void {
  const h = Math.max(3, Math.round(height / 5));
  const span = Math.max(2, Math.round(side / 16));
  const y = Math.round(height * 0.45);
  const gap = side / (count + 1);

  for (let i = 1; i <= count; i++) {
    const at = Math.round(gap * i);
    // The lit wall (world y = side), stepped along wx.
    for (let dx = -span; dx <= span; dx++) {
      for (let z = 0; z < h; z++) {
        iso.column(at + dx, side, y + z, y + z, P.glass[2]);
      }
      // Frame: one darker step above and below, which is what gives the glass
      // an edge without a second outline pass.
      iso.column(at + dx, side, y - 1, y - 1, P.wood[0]);
      iso.column(at + dx, side, y + h, y + h, P.wood[0]);
    }
    // The shadow wall (world x = side), stepped along wy. One ramp step darker
    // because it faces away from the light, like the wall it sits in.
    for (let dy = -span; dy <= span; dy++) {
      for (let z = 0; z < h; z++) {
        iso.column(side, at + dy, y + z, y + z, P.glass[1]);
      }
      iso.column(side, at + dy, y - 1, y - 1, P.wood[0]);
      iso.column(side, at + dy, y + h, y + h, P.wood[0]);
    }
  }
}

/**
 * door draws the one opening that gives a building an inside.
 *
 * Like a window it is a surface, not a column: a doorway two world units wide
 * and a head high, with a lintel over it. The door is what a viewer reads as
 * "finished", so it is drawn on the completed and broken stages only.
 */
function door(iso: IsoPix, side: number, height: number): void {
  const at = Math.round(side / 2);
  const h = Math.min(height - 3, 13);
  const half = Math.max(1, Math.round(side / 20));
  for (let dx = -half; dx <= half; dx++) {
    for (let z = 0; z < h; z++) iso.column(at + dx, side, z, z, P.wood[0]);
    // The lintel, one step up in the wood ramp so it catches the light and the
    // doorway reads as an opening rather than as a dark stripe.
    iso.column(at + dx, side, h, h, P.wood[2]);
    iso.column(at + dx, side, h + 1, h + 1, P.wood[1]);
  }
}

/**
 * roof closes the building over.
 *
 * The chimney is *not* here. It belongs to the trim, because a chimney is a
 * finishing trade rather than part of keeping the rain out — and putting it here
 * would mean the roofed rank already looked finished, which is precisely the
 * confusion the ladder exists to remove.
 */
function roof(iso: IsoPix, side: number, eave: number, skin: BuildingSkin): void {
  const overhang = 2;
  iso.gable(-overhang, -overhang, side + overhang * 2, side + overhang * 2, eave, skin.roofHeight, {
    near: skin.roof[2],
    far: skin.roof[1],
    ridge: skin.roof[3],
    gable: skin.wall[2],
    edge: P.ink,
  });
}

/**
 * chimney is part of the completed rank's trim: a stack on the far slope.
 *
 * It also gives the eye something at the ridge, which stops a long roof reading
 * as a flat coloured band — but that is a benefit, not the reason it is here.
 */
function chimney(iso: IsoPix, side: number, eave: number, skin: BuildingSkin): void {
  if (side < 60) return;
  const cx = Math.round(side * 0.22);
  iso.box(cx, Math.round(side * 0.42), 7, 7, eave + skin.roofHeight - 6, eave + skin.roofHeight + 8, {
    top: P.stone[3],
    lit: P.stone[2],
    shadow: P.stone[1],
    edge: P.ink,
  });
}

/** A pile of spoil beside a plot: the excavated earth the footings leave. */
function spoil(iso: IsoPix, side: number): void {
  const x = side + 4;
  const y = side - 2;
  iso.footprint(x, y, 10, 8, 0, P.earth[2]);
  iso.footprint(x, y, 10, 8, 1, P.earth[3]);
  iso.footprint(x + 1, y + 1, 8, 5, 2, P.earth[1]);
}

/**
 * Damage is a condition, not a stage (ADR-0004), so it is laid *over* whatever
 * has been built rather than replacing it: a half-built building that breaks
 * stays half-built and gains rubble and a crack, and a finished one keeps its
 * roof and gains a hole in it. Treating "broken" as a rank could not express
 * either — every broken building looked the same and lost its history.
 *
 * It is split three ways because damage now lands in three cels: the ground
 * storey's rubble and crack are in the base, and the hole in the roof is in the
 * cap. Each piece is drawn only where there is something for it to damage, so a
 * staked plot with a failed tool acquires no crack in a wall that does not exist.
 */

/** rubble is the pile fallen off a building that got as far as a frame. */
function rubble(iso: IsoPix, side: number): void {
  const rx = Math.round(side * 0.3);
  iso.footprint(rx, side + 2, 9, 6, 0, P.stone[1]);
  iso.footprint(rx + 1, side + 3, 6, 4, 1, P.stone[2]);
  iso.footprint(rx + 2, side + 4, 3, 2, 2, P.stone[3]);
}

/**
 * crack is a fault line up one storey of the lit wall.
 *
 * Drawn within a single storey rather than across the building's full height,
 * because it is stamped into the base's cel: a crack spanning the tower would be
 * a crack in the wind. It is jittered by a deterministic walk, never by
 * `Math.random`, so the same repo draws the same crack (ADR-0012).
 */
function crack(iso: IsoPix, side: number): void {
  let x = Math.round(side * 0.7);
  for (let z = 1; z < STOREY - 1; z++) {
    iso.column(x, side, z, z, P.ink);
    if (z % 3 === 0) x += z % 2 === 0 ? 1 : -1;
  }
}

/** roofDamage is the hole in the roof, drawn in the cap's own cel. */
function roofDamage(iso: IsoPix, side: number, skin: BuildingSkin): void {
  const hx = Math.round(side / 2);
  const hy = Math.round(side / 2);
  iso.footprint(hx, hy, 6, 6, skin.roofHeight, P.roof[0]);
  iso.beamX(hx, hx + 6, hy + 3, skin.roofHeight, P.wood[1], 1);
}

/** hasDamage is whether the stage has anything standing to be damaged. */
function hasDamage(stage: Stage): boolean {
  return stageRank(stage) >= stageRank("framed");
}

/**
 * buildBuilding renders one stage of one building as a single cel.
 *
 * It is a **composite of the three parts the scene actually draws**, not a
 * second implementation of them, and that is the point rather than a
 * convenience: the ladder tests below assert that each rank adds exactly one
 * part and never removes one, and if this function drew the building its own way
 * those tests would be validating art the town never shows. Round-tripping
 * through the real parts means a change to the band or the cap is caught here.
 *
 * It renders a **one-storey** building, because a single cel cannot express the
 * floors — those are composed at runtime from the same parts (see
 * `placeBuilding` in `scene.ts`). So this is the correct picture of the ground
 * floor plus its roof, which is exactly what the ladder describes.
 */
export function buildBuilding(
  side: number,
  files: number,
  path: string,
  stage: Stage,
  damaged = false,
): Pix {
  const skin = skinFor(files, path);
  const box = boxFor(side, skin, 1);
  const iso = new IsoPix(box.w, box.h, box.ox, box.oy);

  // The base carries the ground storey; its cel is already sized for the whole
  // one-storey building, so it lands at the origin.
  iso.pix.blit(buildBase(side, files, path, stage, damaged), 0, 0);
  // The cap is blitted at the base's own origin, NOT one storey above it. Its
  // cel is sized to the roof alone, so its anchor already sits one storey lower
  // in its own cel (`capBox` uses `roofHeight`, not `STOREY + roofHeight`), and
  // the two offsets cancel. Shifting by STOREY as well would lift the roof a
  // second time and leave a storey of sky between it and the wall.
  iso.pix.blit(buildCap(side, skin, stage, damaged), 0, 0);

  return iso.pix;
}

/** buildShadow returns the ground shadow a stage throws. It is drawn under the
 *  building so the town has a floor rather than a set of floating props. */
export function buildShadow(side: number, files: number, path: string): Pix {
  const skin = skinFor(files, path);
  const box = boxFor(side, skin);
  const iso = new IsoPix(box.w, box.h, box.ox, box.oy);
  iso.footprint(2, 3, side + 3, side + 3, 0, P.grass[0]);
  return iso.pix;
}

