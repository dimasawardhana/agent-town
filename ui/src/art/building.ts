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
import { normaliseTurn, turnPoint } from "../view";
import { STOREY, bandHeight, towerTop } from "./stack";
import { type Pix } from "./surface";
import {
  buildRoof, buildRoofDamage, buildRoofStack, buildRoofTrim, hashPath, roofFor, roofHeight, type RoofKind,
} from "./roof";
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
 * BuildingSkin is the wall material a building is made of.
 *
 * The analyzer sizes a building by how much source it holds; the skin is the other
 * half of that reading. A skin is chosen from the building's own path so a district
 * tends to share a material and a large building can be a different tier from a
 * small one — a town where every building is the same cottage reads as a
 * placeholder, not as a place.
 *
 * **It is a wall-material axis only.** It used to carry `roof` and `roofHeight` as
 * well, and those moved to `art/roof.ts` when the roof became its own axis
 * (ADR-0021). The measurement that justified the move: the skin's contribution to
 * the cap was mostly idle — 48 of its 64 (footprint × stage × damage) cap variants
 * were byte-identical, while on the base and band the variant is live. So the cap
 * was where the skin was doing least, which is what made it the right thing to
 * trade for a live roof axis.
 */
export interface BuildingSkin {
  wall: Ramp;
  // There is deliberately no `wallHeight` here any more. A storey is a fixed 20
  // world units (`art/stack.ts`), so the wall's height is a property of the
  // building's floor count and not of its skin. Keeping a per-skin wall height
  // alongside floors would be two numbers for one fact, and the skin's copy would
  // be the one nothing read — it was, before this was removed.
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
  return (Math.abs(hashPath(path)) % 2) as 0 | 1;
}

/**
 * skinFor chooses a building's wall material from how much source it holds.
 *
 * The file-count thresholds are the analyzer's own footprint steps
 * (internal/analyzer/layout.go), written as those numbers rather than as a general
 * scale so that size and material always say the same thing: a big directory is a
 * big stone hall, not a small cottage drawn large.
 */
export function skinFor(files: number, path: string): BuildingSkin {
  const warm = skinVariant(path) === 0;

  if (files <= 2) {
    // A hut: low plastered walls.
    return { wall: P.plaster, framed: true };
  }
  if (files <= 5) {
    return { wall: P.plaster, framed: true };
  }
  if (files <= 12) {
    // A workshop: taller walls, and two materials so a district of mid-sized
    // buildings is not a row of identical boxes.
    return { wall: warm ? P.stone : P.plaster, framed: !warm };
  }
  // A hall: stone walls, so its mass reads as width.
  return { wall: P.stone, framed: false };
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
 * footprintBox is the cel size one part of a building is drawn into.
 *
 * Every part projects the same footprint and needs the same margin, so the only
 * thing that differs between a base, a band, a cap and a shadow is how far *up*
 * the part reaches. That is the one parameter, and making it explicit is what
 * fixes the waste the previous single `boxFor` hid: it always reserved
 * `bandHeight(floors) + roofHeight + 6` of headroom, and the base cel and the
 * ground shadow both used it. Neither draws a roof. Reserving roof headroom in
 * them did not fail — it just made the tallest cel on the sheet taller than
 * anything it contained, and the tallest cel is what sets the atlas's cell height
 * for *every* cel on it, so two cels of waste cost the whole sheet.
 *
 * The margin must cover every overhang, and two of them are not part of the
 * building: the scaffold's poles stand five world units beyond the near corner
 * and its walk boards reach the same edge, and the spoil heap reaches fourteen
 * units along x and eight along y. When the margin did not include them, the
 * outline pass had nowhere to write on those two cel edges, so the left ends of
 * the scaffold's boards and the lower edge of the spoil heap lost their ink line
 * on all sixteen `constructing` and `testing` cels.
 */
function footprintBox(side: number, zTop: number, turn = 0): BuildingBox {
  // The footprint's corners as this turn projects them. Deriving them here rather
  // than in the scene is what lets the cel's own size be the authority on where
  // the building's origin is.
  const { xs, ys } = footprintScreen(side, turn);

  // 6 covers the scaffold's 5-unit poles and the spoil heap's overhang along with
  // the roof's 2-unit eaves and the 1px outline itself. Clipping any of it cuts a
  // hole in a building, and a clipped outline is worse than no outline at all.
  const m = 6;
  const minX = Math.floor(Math.min(...xs)) - m;
  const maxX = Math.ceil(Math.max(...xs)) + m;
  const minY = Math.floor(Math.min(...ys) - zTop) - m;
  const maxY = Math.ceil(Math.max(...ys)) + m;
  return { w: maxX - minX + 1, h: maxY - minY + 1, ox: -minX, oy: -minY, zTop };
}

/**
 * boxFor computes the cel a *whole* building occupies: every storey of wall plus
 * the roof on top.
 *
 * Only the composite in `buildBuilding` needs this, and that is a test-only
 * convenience with no production caller. The parts the atlas actually ships each
 * have their own box below, sized to what they draw — because a part that
 * reserves room for another part's artwork sets the sheet's cell height from a
 * cel no town ever shows.
 *
 * The height is a parameter because floors are: the same building stands one storey
 * or twenty, and a cel sized for one storey would clip a tower.
 */
export function boxFor(side: number, roof: RoofKind, floors = 1, turn = 0): BuildingBox {
  return footprintBox(side, bandHeight(floors) + capTop(side, roof), turn);
}

/**
 * baseBox is the cel the ground storey occupies: exactly one storey of wall, and
 * no headroom above for a roof the base never draws.
 *
 * It is deliberately identical to `bandBox`, and that is the point rather than a
 * coincidence: the base *is* one storey — `buildBase` draws `storeyShell` at
 * local z 0..STOREY, the same drawing the band draws — so the two must be the
 * same size or the floor they share would not line up.
 *
 * Scaffolding reaches `STOREY + 8`, which looks like it argues for a taller cel.
 * It does not, because the scaffold stands at the footprint's *near* corner:
 * `sy = (wx + wy) / 4 - z` puts a point five units beyond the near corner eleven
 * rows *below* the far corner's wall top on a 44-unit footprint, and further
 * below on every larger one. `art.test.ts` asserts nothing touches the cel's top
 * row, so the conclusion is measured rather than argued.
 */
export function baseBox(side: number, turn = 0): BuildingBox {
  return footprintBox(side, STOREY, turn);
}

/**
 * shadowBox is the cel the contact shadow occupies: a flat slab lying on the
 * ground, so there is no height above the footprint to reserve at all.
 *
 * zTop is 0 rather than a small positive number because `buildShadow` draws every
 * layer of the slab at z = 0 — it is a single `footprint` call, not a stack.
 */
export function shadowBox(side: number, turn = 0): BuildingBox {
  return footprintBox(side, 0, turn);
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

/**
 * footprintScreen returns a footprint's four projected corners at a turn.
 *
 * A square footprint projects to the same *size* box at every quarter turn — the
 * width is always `side` and the height always `side / 2` — but not to the same
 * box: the corners permute, so which corner is leftmost changes and the cel's
 * origin moves with it. Padding the cel from the unrotated corners was a real
 * defect: at turn 1 the art was drawn 39 pixels off for a 78-unit footprint,
 * which put nearly the whole lower-left wall outside its own cel.
 *
 * Derived from the turn rather than restated per axis, so it cannot disagree with
 * `IsoPix.project`, which is what plots the pixels into this box.
 */
function footprintScreen(side: number, turn: number): { xs: number[]; ys: number[] } {
  const corners: [number, number][] = [[0, 0], [side, 0], [0, side], [side, side]];
  const pts = corners.map(([x, y]) => {
    const p = turnPoint(normaliseTurn(turn), x, y);
    return { x: (p.x - p.y) / 2, y: (p.x + p.y) / 4 };
  });
  return { xs: pts.map((p) => p.x), ys: pts.map((p) => p.y) };
}

/** bandBox is the cel one storey occupies: the wall's projection, plus the
 *  margin the outline needs, and no headroom above because stacking supplies it. */
export function bandBox(side: number, turn = 0): BuildingBox {
  const { xs, ys } = footprintScreen(side, turn);
  const m = 6;
  const minX = Math.floor(Math.min(...xs)) - m;
  const maxX = Math.ceil(Math.max(...xs)) + m;
  const minY = Math.floor(Math.min(...ys) - STOREY) - m;
  const maxY = Math.ceil(Math.max(...ys)) + m;
  return { w: maxX - minX + 1, h: maxY - minY + 1, ox: -minX, oy: -minY, zTop: STOREY };
}

/**
 * capTop is how far above the wall top the cap's cel must reach.
 *
 * It composes two things that are deliberately separate: the roof kind's own rise,
 * and the 6px the box adds on every side. Keeping the `+ 6` here rather than inside
 * each kind means a kind only ever states the rise of its *artwork*, and the
 * margin stays a property of the projection — which is what it is.
 */
function capTop(side: number, roof: RoofKind): number {
  return roofHeight(roof, side) + 6;
}

/**
 * capBox is the cel the roof, its rooftop furniture and the roof's damage occupy,
 * with its own base at local z = 0 — the cap is placed one storey above the top
 * band, so its base already *is* the top of the wall.
 *
 * It takes the roof **kind** rather than the skin, which is the signature change
 * ADR-0021 predicted: the cap's height is a property of the roof, not of the wall
 * material, and a flat roof is 16 units shorter than a pitched one on the same
 * building. Sharing one height between them would have meant the taller kind's cel
 * sizing the shorter kind's art.
 */
export function capBox(side: number, roof: RoofKind, turn = 0): BuildingBox {
  return footprintBox(side, capTop(side, roof), turn);
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
  turn = 0,
): Pix {
  const skin = skinFor(files, path);
  // The base's own box, not the whole building's: `buildBase` draws one storey and
  // no roof, so a cel carrying roof headroom would be taller than its contents —
  // and this cel is the tallest on the sheet, which makes its height the sheet's
  // cell height for every other cel too.
  const box = baseBox(side, turn);
  const iso = new IsoPix(box.w, box.h, box.ox, box.oy, turn);
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
export function buildBand(side: number, skin: BuildingSkin, stage: Stage, turn = 0): Pix {
  const box = bandBox(side, turn);
  const iso = new IsoPix(box.w, box.h, box.ox, box.oy, turn);
  storeyShell(iso, side, skin, stage);
  return iso.outline(P.ink);
}

/**
 * buildCap draws everything that happens once, at the top: the roof, its rooftop
 * furniture and its finishing trades.
 *
 * Its own base is the top of the topmost band, so the roof's eave sits at local
 * z = 0. The cap is placed one storey above the last band, so drawing the eave at
 * `STOREY` here as well would raise the roof a second time and leave a storey of
 * sky between the wall and its roof.
 *
 * **The cap takes the roof kind and not the skin.** This is the cap's whole
 * appearance: shape, material, height, furniture and damage all come from the kind,
 * and the wall material the rest of the building wears deliberately does not reach
 * here. ADR-0021 records why — the skin's cap contribution was measured mostly
 * idle (48 of 64 variants byte-identical), so the cap was the right thing to trade
 * for a live roof axis rather than the wall material it was already barely using.
 *
 * The ladder order is preserved: the roof appears at `roofed`, and the furniture —
 * a chimney or rooftop housing, which is a finishing trade rather than part of
 * keeping the rain out — only at `completed`. A `roofed` building therefore does
 * not already look finished, which is precisely the confusion the ladder exists to
 * remove.
 */
export function buildCap(side: number, roof: RoofKind, stage: Stage, damaged: boolean, turn = 0): Pix {
  const box = capBox(side, roof, turn);
  const iso = new IsoPix(box.w, box.h, box.ox, box.oy, turn);
  const want = stageRank(stage);

  if (want >= stageRank("roofed")) buildRoof(iso, roof, side, 0);
  if (want >= stageRank("completed")) {
    buildRoofTrim(iso, roof, side);
    buildRoofStack(iso, roof, side, 0);
  }
  if (damaged && want >= stageRank("roofed")) roofDamage(iso, side, roof);

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

  // The two faces the camera can see, resolved for this cel's turn. Decorating
  // a *face* rather than a world axis is what keeps the windows on the walls the
  // reader is looking at: at turn 0 these are the `y = side` and `x = side` walls
  // the drawing was written against, and after a turn they are whichever two
  // walls have taken their place.
  const lit = iso.litWall(side);
  const shadow = iso.shadowWall(side);

  for (let i = 1; i <= count; i++) {
    const at = Math.round(gap * i);
    // The lit wall, stepped along its own run. One ramp step brighter, because
    // glass on the wall that catches the light catches it too.
    for (let dx = -span; dx <= span; dx++) {
      for (let z = 0; z < h; z++) iso.wallPlot(lit, at + dx, y + z, P.glass[2]);
      // Frame: one darker step above and below, which is what gives the glass
      // an edge without a second outline pass.
      iso.wallPlot(lit, at + dx, y - 1, P.wood[0]);
      iso.wallPlot(lit, at + dx, y + h, P.wood[0]);
    }
    // The shadow wall, one ramp step darker because it faces away from the
    // light, like the wall it sits in.
    for (let dy = -span; dy <= span; dy++) {
      for (let z = 0; z < h; z++) iso.wallPlot(shadow, at + dy, y + z, P.glass[1]);
      iso.wallPlot(shadow, at + dy, y - 1, P.wood[0]);
      iso.wallPlot(shadow, at + dy, y + h, P.wood[0]);
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
  // On the face the reader is looking at. A door is an opening in a wall, and
  // which wall that is depends on where the camera is standing — so it follows
  // the same face the walls themselves were drawn from.
  const wall = iso.litWall(side);
  for (let dx = -half; dx <= half; dx++) {
    for (let z = 0; z < h; z++) iso.wallColumn(wall, at + dx, z, z, P.wood[0]);
    // The lintel, one step up in the wood ramp so it catches the light and the
    // doorway reads as an opening rather than as a dark stripe.
    iso.wallColumn(wall, at + dx, h, h, P.wood[2]);
    iso.wallColumn(wall, at + dx, h + 1, h + 1, P.wood[1]);
  }
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

/**
 * roofDamage is the hole in the roof, drawn in the cap's own cel.
 *
 * It delegates to the kind, because how a roof *fails* is a property of the roof:
 * a pitched roof is holed through a slope, and a flat roof's bay collapses. One
 * shared hole would have put a puncture in a lid, which reads as neither.
 */
function roofDamage(iso: IsoPix, side: number, roof: RoofKind): void {
  buildRoofDamage(iso, roof, side, 0);
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
  turn = 0,
): Pix {
  // The roof comes from the path, like every other path-chosen appearance, so the
  // composite shows the same roof the scene will draw for that building.
  const roof = roofFor(path);
  const box = boxFor(side, roof, 1);
  // The composite is a test-only convenience, so its own IsoPix is never plotted
  // into — the blits below carry the turn themselves. It is still constructed with
  // the turn so that the box it derives cannot disagree with the parts it composes.
  const iso = new IsoPix(box.w, box.h, box.ox, box.oy, turn);

  // Each part is blitted so that its *own* origin lands where that part's world
  // origin belongs in the composite. The parts no longer share one box — a base cel
  // is one storey and a cap cel is a roof, each sized to what it draws — so each has
  // its own `oy`, and `(0, 0)` would now put the shorter base `capTop` pixels above
  // its own ground. Deriving the offset from the difference of the two origins is
  // what keeps this correct as the boxes change; hardcoding a zero was correct only
  // while they happened to be equal.
  const footBox = baseBox(side, turn);
  const topBox = capBox(side, roof, turn);

  // The base is the ground storey: its world origin is z = 0, which is the
  // composite's own origin row, `box.oy`.
  iso.pix.blit(buildBase(side, files, path, stage, damaged, turn), box.ox - footBox.ox, box.oy - footBox.oy);
  // The cap sits on top of one storey, so its base is at z = STOREY. Its cel's
  // origin is already the top of the wall rather than the ground (`capBox` uses the
  // roof's rise, not `STOREY` plus it), which is exactly why the offset for it comes
  // out as `box.oy - STOREY - topBox.oy` rather than a whole storey more.
  iso.pix.blit(buildCap(side, roof, stage, damaged, turn), box.ox - topBox.ox, box.oy - towerTop(1) - topBox.oy);

  return iso.pix;
}

/** buildShadow returns the ground shadow a stage throws. It is drawn under the
 *  building so the town has a floor rather than a set of floating props. */
export function buildShadow(side: number, files: number, path: string, turn = 0): Pix {
  const skin = skinFor(files, path);
  // A shadow is a slab on the ground, so its cel reserves no headroom. It used
  // the whole-building box, which made a flat shadow as tall as a roofed tower —
  // and being the second-tallest cel on the sheet, it would have kept the atlas's
  // cell height high on its own even after the base was fixed.
  const box = shadowBox(side, turn);
  const iso = new IsoPix(box.w, box.h, box.ox, box.oy, turn);
  iso.footprint(2, 3, side + 3, side + 3, 0, P.grass[0]);
  return iso.pix;
}
