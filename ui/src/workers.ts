// Workers: the animated figures that move to where the agent is working.
//
// This is the product. Everything else exists so that a worker can stand on the
// right building and visibly do the thing the agent is doing.
//
// Four decisions carry most of the quality here:
//
//   - Frames are advanced from the art's own `FRAME_MS` table, one worker at a
//     time, rather than through Phaser's animation manager. That is not
//     preference: Phaser 4's animation config carries a single frame rate for a
//     whole animation, and this town's whole read depends on a hammer blow being
//     fast and its follow-through slow. Averaging those into one rate would
//     delete the action's rhythm — the thing that tells a glance what the agent
//     is doing.
//   - The walk is advanced by distance travelled, not by a clock. Counting
//     cycles per journey gives feet that plant plausibly and an arrival time
//     tied to the work, where a fixed rate either slides the feet or makes a
//     worker look like it is strolling.
//   - A machine crossing a road faces the way that road runs, and its body rides
//     its tracks at a rate tied to the ground it is actually covering. A figure
//     that slides sideways holding a single pose is a sprite being dragged, and
//     dragging is the one motion on this map that says nothing about what the
//     agent is doing — which is the only thing the map is for.
//   - A figure is never removed while the daemon still reports it. A worker that
//     vanished mid-hammer would say the agent stopped, which is the one thing
//     the town must not lie about.

// Phaser is imported for its types only. The one reason is testability: a value
// import pulls the whole engine into the module graph, and the engine touches
// `window` while it is being *imported*, so a plain `node --test` process could
// not load this file at all and none of the decisions above could be pinned by a
// test. The two event names it used to supply are strings — 'update' and
// 'shutdown' — and `update` was already written out literally below, so this is
// one spelling of each rather than a second way of saying it.
import type Phaser from "phaser";
import { CREW_COLOURS } from "./art/palette";
import { ATLAS, type Atlas, machineFrame } from "./art/bake";
import { WorldView, normaliseTurn, routeAlongRoads, turnPoint, type Point, type RoadLine } from "./view";
import { FRAME_MS, type Tier, type WorkerState } from "./art/worker";
import { POSE_FOR, machineFor, type MachineKind } from "./art/machine";
import { PLACARD, placard } from "./art/placard";
import { actionInfo, targetOf } from "./actions";
import { SITE_ID_BUILDING_PREFIX, type Action, type Layout, type Site, type Worker, useTown } from "./store";
import { labelVisible, workerLabelId } from "./visibility";
/** The shortest a journey may take, in milliseconds. Long enough to read as
 *  movement, short enough that a fast agent does not leave workers trailing far
 *  behind what actually happened. */
const MIN_TRAVEL_MS = 420;

/** The distance, in picture pixels, one walk cycle is authored to cover. Two
 *  steps of about seven pixels each: the figure's own stride at this size, which
 *  is what makes the feet look planted rather than skating. */
const STRIDE_PX = 14;

/** The most walk cycles one journey may play. Beyond this the legs read as a
 *  blur, which looks less like hurrying than like a fault — so a long journey
 *  covers more ground per cycle instead and the figure slides very slightly.
 *  That trade is taken deliberately: a slightly sliding long walk is far less
 *  noticeable than a blurring one. */
const MAX_CYCLES = 7;

/** The ground shadow, in picture pixels, drawn as a flattened ellipse: what a
 *  body's shadow looks like on isometric ground at this scale. */
const SHADOW_W = 7;
const SHADOW_H = 3;

/** The crew tag above a figure, so two crews on one repo stay tellable apart. */
const TAG_W = 4;
const TAG_H = 3;
const TAG_LIFT = 27;

/** How far above a figure's feet its action caption floats, in picture pixels.
 *  Above the crew tag rather than beside it, so the two never overlap: the tag
 *  says *who*, the caption says *what*, and both are wanted at once. */
const CAPTION_LIFT = 38;

/**
 * The depth a figure's hit target sits at.
 *
 * Above every site's zone and below every label. The sites' own zones are placed
 * at the screen y of the corner they stand on, which is what orders a near
 * building over a far one — and it also means a figure standing on a building is
 * *underneath* that building's zone, so Phaser's `topOnly` hit test hands the
 * pointer to the building and the figure can never be pointed at. Measured on a
 * live worker: its building's zone covered the point and the sprite was not in
 * the hit list at all.
 *
 * Raising the sprite's own depth would fix the hit test and break the drawing,
 * because a figure must be drawn where it stands. So the target is its own
 * object, which is the same separation the scene makes for a building's zone.
 */
const HIT_DEPTH = 80000;

/** One walk cycle's duration, from the art's own per-frame timings. */
const WALK_CYCLE_MS = FRAME_MS.walk.reduce((a, b) => a + b, 0);

/**
 * The slowest a travelling machine's legs may move, as a multiple of the art's
 * own walk rhythm.
 *
 * Half, which is 240ms a pose. Below that a machine holds one pose long enough
 * to read as stopped rather than as slow, and a town that appears to have
 * stopped is a town saying something false. The journeys that would ask for it
 * are hops of a couple of pixels, short enough that the clamp is not what the
 * reader sees.
 */
const MIN_WALK_RATE = 0.5;

/**
 * The fastest a travelling machine's legs may move, as a multiple of the art's
 * own walk rhythm.
 *
 * Two, which is 60ms a pose and a full cycle every 240ms. At three, a one-pixel
 * ride twenty-five times a second is a shimmer rather than a ride, and a
 * shimmer reads as a fault in the same way a blur does. The bound costs almost
 * nothing in honesty: by the time a crossing is this fast the machine is
 * covering ground so quickly that the difference between two steps per unit and
 * three is a slide no eye can measure, while the difference between *any* rate
 * and the authored one is a moonwalk. This is the same trade `MAX_CYCLES` takes
 * one level up — more ground per step rather than a blur — and it binds on the
 * hauls long enough to have reached that cap.
 */
const MAX_WALK_RATE = 2;

/**
 * How far a travelling machine's body rides its tracks, in picture pixels: one
 * entry per walk pose, down, down, up, up.
 *
 * The fleet has a single authored travel cel rather than a walk cycle, so the
 * cadence cannot be spent on a frame change — there is no second frame to
 * change to. What it is spent on instead is the ride: the body rises and settles
 * as the tracks turn, which is the one motion that separates a machine driving
 * from a cel being carried across the map.
 *
 * Two poses down and two up, because a bounce with a single low pose is a
 * stutter. One pixel, because the tracks never leave the ground — the shadow
 * and the depth stay put, so the body is the only thing that moves, and a larger
 * lift would put the machine's own undercarriage in the air.
 */
const WALK_LIFT = [0, 1, 1, 0];

/**
 * A journey in picture pixels.
 *
 * `startedAt` and `ms` are what let the walk be driven by progress rather than
 * by a timer, which is the difference between feet that plant and feet that
 * skate.
 */
interface Journey {
  /** The polyline walked, in picture pixels. One straight leg when there is
   *  nowhere to detour. */
  path: { x: number; y: number }[];
  /** How long the polyline is, in picture pixels. Carried rather than measured
   *  again every frame: it is the ground the cadence is measured against, and
   *  it cannot change while the journey is in flight. */
  walked: number;
  /** The way the leg under the machine runs, in *world* units.
   *
   *  Held in world rather than picture units on purpose. A journey is a fact
   *  about the map, and the map's own coordinates are what it is authored in;
   *  the screen is a rendering of that fact and is the one thing a turn changes.
   *  So the direction is captured where the geometry is known and asked of the
   *  view where the sprite is, rather than being read back off the picture
   *  where it was never stated. */
  dir: Point;
  x1: number;
  y1: number;
  ms: number;
  startedAt: number;
}

/** The total length of a polyline, which is what a walk cycle is timed from. */
function pathLength(path: { x: number; y: number }[]): number {
  let d = 0;
  for (let i = 1; i < path.length; i++) d += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  return d;
}

/**
 * The point a fraction of the way along a polyline, and the way the leg it is
 * on runs.
 *
 * The direction comes out with the point because it is free here and not free
 * anywhere else: the leg is already being walked to find the point, and the
 * machine's facing is the only thing that wants to know which way that leg
 * points. A zero-length or absent polyline has no direction to report, and
 * reports a zero one — which the facing rule reads as "no opinion" rather than
 * as a turn.
 */
function pointAlong(
  path: { x: number; y: number }[],
  t: number,
): { x: number; y: number; dx: number; dy: number } {
  const total = pathLength(path);
  if (total <= 0 || path.length < 2) return { ...path[path.length - 1], dx: 0, dy: 0 };
  let want = total * Math.max(0, Math.min(1, t));
  for (let i = 1; i < path.length; i++) {
    const ex = path[i].x - path[i - 1].x;
    const ey = path[i].y - path[i - 1].y;
    const leg = Math.hypot(ex, ey);
    if (want <= leg || i === path.length - 1) {
      const f = leg <= 0 ? 1 : want / leg;
      return { x: path[i - 1].x + ex * f, y: path[i - 1].y + ey * f, dx: ex / leg, dy: ey / leg };
    }
    want -= leg;
  }
  return { ...path[path.length - 1], dx: 0, dy: 0 };
}

/**
 * worldDirection is the world direction a picture-space vector points, at this
 * turn.
 *
 * The inverse of the projection, written out rather than pulled from a matrix:
 * screen x is (X - Y) / 2 and screen y is (X + Y) / 4, so X is x + 2y and Y is
 * 2y - x. The turn is then undone, because this layer is handed a layout that
 * has already been turned — the composition ADR-0012 rests on, run backwards to
 * recover the direction the map was authored in. Turned twice it would be a
 * direction nobody drew, which is the mistake a turn makes look like nothing at
 * all until a machine drives the wrong way across the map.
 */
export function worldDirection(view: WorldView, sx: number, sy: number): Point {
  return turnPoint(normaliseTurn(-view.turn), sx + 2 * sy, 2 * sy - sx);
}

/**
 * mirrored says whether a machine travelling this world direction draws
 * flipped.
 *
 * The view decides, and this module only asks. `WorldView.screenDir` is where
 * the town settles what a direction looks like on screen, and its own comment
 * states the rule this uses: the sign of the screen-x component is the flip. A
 * machine heading straight up or straight down has no screen x at all, and
 * keeps the facing it was authored with — a diagonal road then reads as a road
 * going away from the camera, which is what it is, rather than as a mirror
 * that flickers on and off as the figure crosses the halfway line.
 */
export function mirrored(view: WorldView, dx: number, dy: number): boolean {
  return view.screenDir(dx, dy).x < 0;
}

/**
 * walkRate is how fast a journey's legs move, as a multiple of the art's own
 * walk timings.
 *
 * The reference is the art's: `FRAME_MS.walk` paces one walk cycle over
 * `STRIDE_PX` of ground, so a machine covering ground at that rate is
 * automatically at rate one and the authored timings are used exactly as
 * written. Everything else is measured against it — ground covered over ground
 * authored — which is the whole of "step at the rate you are travelling". A
 * crossing faster than the reference takes its steps faster, and that is what
 * stops it moonwalking: legs that keep the authored time while the ground comes
 * at them are a cel being carried, and the reader sees the ground, not the
 * rhythm.
 *
 * A journey that measured nothing takes rate one. So does one the numbers say
 * nothing about, which is a stand-in rather than a claim: the first frame of a
 * journey and any degenerate path still get the art's own rhythm.
 */
function walkRate(walked: number, ms: number): number {
  if (!(walked > 0) || !(ms > 0)) return 1;
  const rate = (walked * WALK_CYCLE_MS) / (ms * STRIDE_PX);
  if (rate < MIN_WALK_RATE) return MIN_WALK_RATE;
  return rate > MAX_WALK_RATE ? MAX_WALK_RATE : rate;
}

/**
 * walkPhase is the walk pose a machine is standing in, `elapsed` milliseconds
 * into a journey covering `walked` picture pixels in `ms`.
 *
 * Read off the elapsed time rather than accumulated frame by frame, because a
 * journey's length is not known until the route is, and an accumulator seeded
 * at the wrong moment starts a machine mid-stride. The art's own table is still
 * what paces the poses — `walkRate` only says how fast that table is read — so
 * the hammer's uneven strike and the walk's even one stay distinguishable, and
 * a walk that happens to travel at the reference speed is read at the timings
 * the art was drawn against.
 */
export function walkPhase(walked: number, ms: number, elapsed: number): number {
  const poses = FRAME_MS.walk;
  // The rate scales the clock, not the table: a machine travelling at three
  // times the reference speed is three times as far along the walk by the time
  // a pose is up, so it reads the *same* table three times as fast. Scaling the
  // table instead would leave every journey taking exactly one cycle however
  // fast it was driven, which is the held pose this replaced wearing a
  // different hat.
  const rate = walkRate(walked, ms);
  // Folded into the cycle first, so the walk below is a single lap and cannot
  // spin: a journey left running for a minute must not cost a minute of loop.
  let left = ((elapsed > 0 ? elapsed : 0) * rate) % WALK_CYCLE_MS;
  let pose = 0;
  while (left >= poses[pose]) {
    left -= poses[pose];
    pose = (pose + 1) % poses.length;
  }
  return pose;
}

/**
 * walkLift is how far off its ground a machine's body rides, in picture pixels.
 *
 * Exported with the rest of the walk because it is the only part of the cadence
 * a reader can see, and a cadence that cannot be seen is a cadence nobody can
 * claim is right.
 */
export function walkLift(pose: number): number {
  return WALK_LIFT[((pose % WALK_LIFT.length) + WALK_LIFT.length) % WALK_LIFT.length];
}

/** Where a figure is in its current animation. */
interface AnimState {
  state: WorkerState;
  tier: Tier;
  /** Which machine this session drives. Carried on the animation rather than
   *  looked up, so the frame can be resolved without the worker list. */
  agent: string;
  /** Milliseconds spent in the current frame. */
  elapsed: number;
  index: number;
}

/**
 * The action a worker is doing, as an animation.
 *
 * The daemon's Action strings and the art's WorkerState names are deliberately
 * the same words — the Go test `TestUIActionVocabulary` asserts it — so this is
 * a cast with a stated reason rather than a translation table that could drift
 * silently. That drift has happened once already: every read rendered with the
 * default animation because the daemon said "inspecting" while the renderer only
 * knew "reading".
 */
function stateFor(action: Action): WorkerState {
  return action as WorkerState;
}

/** The texture key for a caption that has not been lettered yet. Every caption
 *  starts on this and is swapped by `caption` on the first sync, so there is one
 *  code path deciding what a caption says rather than two that can disagree
 *  about the initial state. */
const BLANK = "wc:blank";
/**
 * WorkerLayer owns the moving parts of the town: the figures, their shadows,
 * their crew tags, and the motion that shows what they are doing.
 *
 * It is separate from the scene because the scene's job is the map — ground,
 * districts, buildings, camera — and this is the thing that moves on it.
 * Keeping them apart means a redraw of the map does not have to reason about
 * animation, and an animation tick never touches the map.
 */
export class WorkerLayer {
  private scene: Phaser.Scene;
  private atlas: Atlas;
  /**
   * Whether the pointer has travelled far enough to be a drag rather than a
   * click, asked at the moment of the click.
   *
   * Supplied by the scene because it already tracks this for its own zones — a
   * building must not be selected by a map drag that happened to end over it, and
   * a figure must not be focused the same way. Two independent notions of "was
   * that a drag" would disagree on exactly the gestures readers make most.
   */
  private dragged: () => boolean;
  /**
   * The orientation of the layout this layer draws, asked about directions.
   *
   * Held rather than reached for because a turn redraws the map, and a redraw
   * rebuilds this layer: there is one orientation per layer, so the question has
   * one answer for the layer's whole life.
   */
  private view: WorldView;
  private sprites = new Map<string, Phaser.GameObjects.Sprite>();
  private shadows = new Map<string, Phaser.GameObjects.Ellipse>();
  private tags = new Map<string, Phaser.GameObjects.Rectangle>();
  // Where each figure is in its animation. Advanced by `tick` from the art's own
  // per-frame timings, which Phaser's own animation manager cannot express — it
  // carries one frame rate for a whole animation, and this town's read depends
  // on a hammer blow being fast and its follow-through slow.
  private anim = new Map<string, AnimState>();
  // What each figure is doing, lettered above it. Keyed by worker id and holding
  // the *text last drawn* as well as the object: a caption is a texture upload,
  // and re-lettering every figure on every frame — which is what a live town
  // delivers — would put a canvas decode in the frame budget for text that
  // changes a few times a minute.
  private captions = new Map<string, { text: Phaser.GameObjects.Image; label: string }>();
  /** One transparent target per figure, so it can be pointed at over a building. */
  private hitZones = new Map<string, Phaser.GameObjects.Zone>();
  /**
   * The road network, in picture pixels, so a figure can be routed along it.
   *
   * Kept here rather than asked of the scene per journey because a live town
   * re-routes on every event, and reaching into the scene for the same static
   * geometry each time would be a lookup per event for a thing that never
   * changes until the layout does.
   */
  private roads: RoadLine[] = [];
  private travel = new Map<string, Journey>();
  /** One per figure in flight, so its update listener can be removed again. */
  private steppers = new Map<string, () => void>();
  /**
   * The ground each figure stands on, in picture pixels.
   *
   * Kept beside the sprite rather than read off it, because a travelling
   * machine's body is not on the ground: it rides its tracks. Depth, shadow,
   * crew tag and caption all belong to the ground, so a shadow that rose and
   * settled with the body would be a shadow that had come off the ground, and a
   * depth that flickered by a pixel would have the figure re-ordering against
   * buildings it has not moved relative to.
   */
  private groundY = new Map<string, number>();
  private disposed = false;

  /** setRoads gives the layer the network to route along. Called when the map
   *  is (re)drawn, so a turn re-routes figures against the turned roads. */
  setRoads(roads: RoadLine[]): void {
    this.roads = roads;
  }

  /**
   * positionOf is where a figure is right now, in picture pixels, or null when
   * there is no such figure.
   *
   * Read by the follow camera, which has to ask every frame and cannot work it
   * out for itself: a travelling machine's position is written by its own
   * stepper from the arc length of its route (`stepper`), and neither the route
   * nor the sprite is reachable from outside this class.
   *
   * The sprite's own position rather than `groundY`, which differs by the walk
   * lift of 0 or 1 pixel: a camera aiming at a body that bobs on its tracks
   * inherits the bob, and one aiming at the ground it is not standing on would
   * be aiming at a point the reader cannot see anything at.
   *
   * Null rather than a stale point is the whole contract. `remove` destroys the
   * sprite and every per-worker map when the daemon stops reporting a session,
   * and a follow camera holding the last coordinate it saw would sit over empty
   * ground for the rest of the session — pointing at nothing with full
   * confidence, which is the one thing this town must never do.
   */
  positionOf(id: string): Point | null {
    const sprite = this.sprites.get(id);
    if (!sprite) return null;
    return { x: sprite.x, y: sprite.y };
  }

  constructor(scene: Phaser.Scene, _atlasKey: string, atlas: Atlas, dragged: () => boolean) {
    this.scene = scene;
    this.atlas = atlas;
    this.dragged = dragged;
    // The orientation the layout this layer is about to be handed has been
    // turned to. Read here rather than passed in because the scene builds the
    // layer inside the same pass that turns the layout, and a turn is one of the
    // things that rebuilds it — so the two cannot drift apart.
    //
    // It is asked about *directions* only. Every position in this layer comes
    // from the turned layout already, and turning those a second time is the
    // error this instance exists to make impossible.
    this.view = new WorldView(useTown.getState().turn);
    // One pixel of nothing, so a caption has something to point at before it is
    // lettered. A Phaser Image with a missing texture draws Phaser's own green
    // placeholder box, which would flash on every new worker.
    if (!scene.textures.exists(BLANK)) {
      const one = scene.textures.createCanvas(BLANK, 1, 1);
      one?.refresh();
    }
    // One update hook for every figure rather than a tween each: the frames of
    // an action must keep their exact rhythm, and a tween per worker would let
    // a busy town's frame budget smear that rhythm unevenly across figures.
    //
    // 'update' and 'shutdown' are Phaser's own event names, spelled out because
    // the steppers below already register on 'update' literally. One spelling
    // each, rather than the same hook written two ways.
    scene.events.on('update', this.tick, this);
    scene.events.once('shutdown', () => {
      scene.events.off('update', this.tick, this);
      this.disposed = true;
    });
  }

  /**
   * sync reconciles the drawn figures with the workers the daemon reports.
   *
   * It reads the store rather than taking workers as an argument, because it is
   * called both on a map redraw and on every live update — and on a redraw the
   * caller has the map but not the current workers.
   */
  sync(layout: Layout): void {
    if (this.disposed) return;
    const places = new Map<string, Site>();
    for (const s of layout.sites) places.set(s.id, s);
    // A worker on a building that no longer exists falls back to the Yard,
    // because somewhere real beats a missing figure.
    const fallback = places.get("yard");

    const { live } = useTown.getState();
    const seen = new Set<string>();

    for (const w of live.workers) {
      seen.add(w.id);
      const site = places.get(w.place) ?? fallback;
      if (!site) continue;

      const target = this.standPoint(site, stableOffset(w.id));
      this.ensure(w, target);
      this.move(w, target);
      this.setState(w);
      this.caption(w.id, w);
    }

    // Anything the daemon no longer reports is gone. A crew that left has left,
    // and leaving its figures behind would misrepresent the town.
    for (const id of [...this.sprites.keys()]) {
      if (!seen.has(id)) this.remove(id);
    }

    // A figure created by this pass started hidden, and a live update changes
    // neither the hover, the focus nor the follow — so nothing else would run
    // the rule and a worker appearing under an existing focus, or belonging to
    // the session being followed, would stay dark until the reader moved the
    // pointer. Applying it here is what makes the rule hold for figures that
    // arrive after the click.
    const { focused, hovered, following } = useTown.getState();
    this.applyLabels(focused, hovered, following);
  }

  /**
   * standPoint is where a figure stands on a site.
   *
   * The spread is hashed from the worker's own id and scaled to the site: the
   * Yard is 420 by 150 world units and holds a dozen workers on a busy session,
   * while a 44-unit hut holds one. A fixed spread cannot serve both — measured
   * against a real Yard, a ±6-unit jitter projects to ±3 pixels, which put six
   * figures on top of each other and read as one worker. Scaling to the site
   * keeps multi-agent work legible, which ADR-0004 requires.
   */
  private standPoint(site: Site, spread: { x: number; y: number }): { x: number; y: number } {
    // Half the site's own extent, so the figures stay on its ground.
    const rx = site.w / 2 - 10;
    const ry = site.h / 2 - 8;
    const wx = site.x + site.w / 2 + spread.x * rx;
    const wy = site.y + site.h / 2 + spread.y * ry;
    const p = this.project(wx, wy);
    // Four pixels up from the projected point, so the figure stands on the plate
    // rather than in front of whatever is behind it.
    return { x: p.x, y: p.y - 4 };
  }
  /** project is the town's projection. It is restated here so this layer can
   *  place figures without reaching into the scene's private method; the art
   *  layer's own `IsoPix.project` is the same formula and a test asserts the two
   *  agree, because a discrepancy would put every worker off its building. */
  private project(wx: number, wy: number): { x: number; y: number } {
    return { x: (wx - wy) / 2, y: (wx + wy) / 4 };
  }

  /** ensure creates a worker's figure if it does not exist yet. */
  private ensure(w: Worker, at: { x: number; y: number }): void {
    if (this.sprites.has(w.id)) return;

    // The shadow is its own object, not part of the cel: it must stay on the
    // ground while the figure bobs, and drawing it into the cel would make it
    // hop along with the walk.
    const shadow = this.scene.add.ellipse(at.x, at.y, SHADOW_W, SHADOW_H, 0x000000, 0.22);
    shadow.setDepth(at.y - 1);
    this.shadows.set(w.id, shadow);

    const tier: Tier = w.tier === "sub" ? "sub" : "chief";
    // A machine per agent, chosen by hash so the same session is the same
    // machine on every client and across every reload.
    const kind = machineFor(w.agent || w.id);
    const sprite = this.scene.add.sprite(at.x, at.y, ATLAS, machineFrame(kind, tier, "idle"));
    const frame = this.atlas[machineFrame(kind, tier, "idle")];
    // The origin is the cel's own recorded anchor — between the feet for a
    // worker — so the figure stands on its point instead of being centred on it.
    if (frame) sprite.setOrigin(frame.ox / frame.w, frame.oy / frame.h);
    sprite.setDepth(at.y);
    this.sprites.set(w.id, sprite);

    // The crew tag: a small square in the crew's colour, so which agent is
    // driving a session is legible without a legend.
    const tag = this.scene.add.rectangle(at.x, at.y - TAG_LIFT, TAG_W, TAG_H, crewTint(w.agent));
    tag.setDepth(at.y + 1);
    this.tags.set(w.id, tag);

    // The action caption: what this figure is doing, lettered above it.
    //
    // The town's whole claim is that a glance tells you what the session is
    // doing, and an animation alone only tells you the *kind* of work. "Hammer
    // moving" and "editing a file" are the same picture, and the difference is
    // exactly what a reader wants. The caption supplies it without the panel,
    // which matters because the panel can be scrolled, collapsed, or on another
    // screen entirely while the map is what is being watched.
    //
    // It starts blank and is lettered by `caption` on the first sync, so there
    // is one code path that decides what a caption says rather than two that can
    // disagree about the initial state.
    //
    // It is hidden until the figure is pointed at. A busy session runs a dozen
    // crews, and a caption each would tile the map in type — the skyline, which
    // is what the map exists to show, would be the thing least visible. The
    // figure itself is the affordance: point at a worker and it says what it is
    // doing, which is the same bargain the building names make.
    const text = this.scene.add.image(at.x, at.y - CAPTION_LIFT, BLANK);
    text.setOrigin(0.5, 1).setDepth(at.y + 2).setVisible(false);
    this.captions.set(w.id, { text, label: "" });

    // The target is a transparent zone over the cel rather than the cel itself,
    // for the reason `HIT_DEPTH` records: the sprite is drawn at its feet, which
    // puts it under the zone of the building it stands on, and the building would
    // take every pointer. The zone is sized to the cel — a figure is a dozen
    // pixels tall and aiming at its boots to learn what it is doing would be its
    // own small cruelty.
    const cellW = sprite.width, cellH = sprite.height;
    const zone = this.scene.add
      .zone(at.x, at.y, cellW, cellH)
      .setOrigin(sprite.originX, sprite.originY)
      .setDepth(HIT_DEPTH)
      .setInteractive({ useHandCursor: false });
    this.hitZones.set(w.id, zone);

    // Pointing at the figure reveals its caption; clicking it follows the
    // machine. Both go through the store, so a building's name and a worker's
    // caption obey one rule and following a worker clears the building focused
    // before it — which is the reader's own description of the behaviour.
    //
    // `useHandCursor` stays false: this is not a link, and the whole map is
    // draggable. A hand appearing over a worker but not over the ground around it
    // would promise a navigation that does not exist.
    zone.on("pointerover", () => useTown.getState().hover(workerLabelId(w.id)));
    zone.on("pointerout", () => {
      if (useTown.getState().hovered === workerLabelId(w.id)) useTown.getState().hover(null);
    });
    zone.on("pointerup", () => {
      // The same gesture that focused a caption now follows the machine, and
      // the two are the same act: pointing at a figure and clicking it is asking
      // what it is *and* to watch it, and the walk between buildings is most of
      // what a machine does — a caption says "Hammering / internal" and shows
      // none of it.
      if (this.dragged()) return;
      // Clicking the machine you are already following stops following it, so
      // the same gesture both starts and ends. There is no keyboard handler in
      // this app and adding one for an escape hatch would be the first
      // (TownScene.controls registers pointer events only), and a visible stop
      // control is in the panel either way.
      const { following, follow, unfollow } = useTown.getState();
      if (following === w.id) unfollow();
      else follow(w.id);
    });

    this.anim.set(w.id, { state: "idle", tier, agent: w.agent || w.id, elapsed: 0, index: 0 });

    this.groundY.set(w.id, at.y);
  }

  /**
   * applyLabels shows exactly the captions the rule allows.
   *
   * Called by the scene's sweep rather than from a store subscription of its
   * own, so that one pointer move resolves one rule. A second subscription here
   * would have to know which labels the scene owns in order to leave them alone,
   * and that knowledge is exactly what drifts.
   *
   * A followed figure's caption is lit for as long as the follow lasts, for the
   * reason `labelVisible` states: the caption is what names the action, and a
   * machine being followed with no caption is one the reader cannot act on.
   */
  applyLabels(focused: string | null, hovered: string | null, following: string | null): void {
    for (const [id, entry] of this.captions) {
      entry.text.setVisible(labelVisible(workerLabelId(id), hovered, focused, following));
    }
  }

  /**
   * move sends a figure to a new point, or leaves it where it is.
   *
   * An in-flight walk is never restarted: a fast agent emits events far more
   * often than a worker takes to cross the town, and restarting on every one
   * would leave the figure jittering in place instead of travelling.
   */
  private move(w: Worker, to: { x: number; y: number }): void {
    const sprite = this.sprites.get(w.id);
    if (!sprite) return;

    const current = this.travel.get(w.id);
    if (current) {
      // Already heading somewhere. Retarget only if the destination actually
      // moved — which is what happens when the agent moves to a new building.
      if (Math.hypot(to.x - current.x1, to.y - current.y1) < 3) return;
      this.scene.tweens.killTweensOf(sprite);
      this.travel.delete(w.id);
      this.syncVisual(w.id);
    }

    const distance = Math.hypot(sprite.x - to.x, sprite.y - to.y);
    if (distance < 2) {
      sprite.setPosition(to.x, to.y);
      this.groundY.set(w.id, to.y);
      this.syncVisual(w.id);
      return;
    }

    // Walk the roads rather than the line between two points. A figure that
    // crosses the grass ignores the ground the map says is there, and a road
    // nobody travels is a road that is only decoration.
    const path = routeAlongRoads({ x: sprite.x, y: sprite.y }, to, this.roads);
    const walked = pathLength(path);

    // The journey's duration and its walk-cycle count are decided together, so
    // the feet plant at a plausible rate for the distance travelled. A long haul
    // is therefore a *faster* crossing than a short one, which is what makes the
    // cadence in `walkPhase` mean something: ground covered, not clock time.
    const cycles = Math.min(MAX_CYCLES, Math.max(1, Math.round(walked / STRIDE_PX)));
    const ms = Math.max(MIN_TRAVEL_MS, cycles * WALK_CYCLE_MS);
    // The first leg is the direction the machine sets off in, seeded here so it
    // is known before the first frame: the facing is asked of the view on the
    // tick, and a tick that ran first would otherwise have no direction to ask
    // about and would draw the machine facing whichever way it was authored.
    const off = pointAlong(path, 0);
    this.travel.set(w.id, {
      path,
      walked,
      dir: worldDirection(this.view, off.dx, off.dy),
      x1: to.x,
      y1: to.y,
      ms,
      startedAt: sprite.scene.time.now,
    });

    // The position is advanced by hand rather than by a tween on x and y,
    // because a tween walks a straight line and this walks a polyline. The
    // walk cycle is driven off the same progress, so feet plant at the same
    // rate on a long road as on a short one.
    const started = sprite.scene.time.now;
    // The listener is held so it can be removed again. It is not enough to let a
    // finished journey's closure die on its own: the layer is destroyed and
    // rebuilt on every draw — that is, on every event — and nothing was
    // unhooking these, so a live session accumulated one per journey forever.
    // The map leaked memory a few hundred bytes at a time and nothing ever
    // failed, which is the worst way for a leak to present.
    const step = this.stepper(w.id, started, ms);
    this.steppers.set(w.id, step);
    this.scene.events.on(`update`, step);
  }

  /**
   * stepper advances one figure along its route.
   *
   * Bound per journey rather than a single sweep, so a figure whose route
   * changes mid-walk is not advanced by a stale closure: the journey is read
   * back from the map on every tick, and a figure with no journey is left
   * alone.
   *
   * Position lives here rather than on the tick because the tick is registered
   * first and so runs first: a lift applied there would be overwritten by the
   * ground this writes a moment later, and the machine would never leave its
   * own shadow. The pose and the facing are the tick's, because the tick is what
   * knows the animation.
   */
  private stepper(id: string, startedAt: number, ms: number): () => void {
    return () => {
      const j = this.travel.get(id);
      const sprite = this.sprites.get(id);
      if (!j || !sprite) return;
      const now = sprite.scene.time.now;
      const t = Math.min(1, (now - startedAt) / ms);
      const p = pointAlong(j.path, t);
      // The way this leg runs, kept in world units: a route that turns a corner
      // is a machine that turns, and reading the facing off the destination
      // instead would leave it driving the first leg's way round every corner.
      j.dir = worldDirection(this.view, p.dx, p.dy);
      const arrived = t >= 1;
      // The ride settles to nothing on arrival. A machine that stopped with its
      // body a pixel up would be standing on air, and the one frame in which
      // that is true is a frame every reader of that corner of the map sees.
      const lift = arrived ? 0 : walkLift(walkPhase(j.walked, j.ms, now - j.startedAt));
      this.groundY.set(id, p.y);
      sprite.setPosition(p.x, p.y - lift);
      this.syncVisual(id);
      if (arrived) {
        this.travel.delete(id);
        this.unhook(id);
      }
    };
  }

  /** unhook removes a finished journey's per-frame listener. */
  private unhook(id: string): void {
    const step = this.steppers.get(id);
    if (!step) return;
    this.scene.events.off(`update`, step);
    this.steppers.delete(id);
  }

  /** syncVisual keeps a figure's depth, shadow, tag and caption together while
   *  it moves. Depth is the ground it stands on, which is what makes a worker
   *  pass in front of a building it is standing below rather than behind it. The
   *  tag and the caption ride above, on their own depths, so a figure walking
   *  toward the camera draws over one behind it and both their labels stay
   *  legible. */
  private syncVisual(id: string): void {
    const sprite = this.sprites.get(id);
    if (!sprite) return;
    // The ground, not the sprite's own y: a travelling machine's body rides its
    // tracks, and everything below belongs to the ground rather than to the
    // body. The hit zone is the exception — it has to cover the cel as drawn,
    // so it follows the body.
    const ground = this.groundY.get(id) ?? sprite.y;
    sprite.setDepth(ground);
    const zone = this.hitZones.get(id);
    if (zone) {
      zone.setPosition(sprite.x, sprite.y);
      zone.setSize(sprite.width, sprite.height);
    }
    this.shadows.get(id)?.setPosition(sprite.x, ground).setDepth(ground - 1);
    this.tags.get(id)?.setPosition(sprite.x, ground - TAG_LIFT).setDepth(ground + 1);
    this.captions.get(id)?.text.setPosition(sprite.x, ground - CAPTION_LIFT).setDepth(ground + 2);
  }

  /**
   * caption letters what a figure is doing, if it has changed.
   *
   * The guard is the point of the method. Everything else in the live path is
   * cheap enough to redo on any frame, but a label is a canvas that has to be
   * rasterised and uploaded as a texture — so it is done on change only, and the
   * last drawn string is remembered per worker for exactly that comparison.
   *
   * The text is the action in the *world's* words, matching the animation beside
   * it: a caption reading "editing a file" over a figure swinging a mallet would
   * be two facts disagreeing. `actions.ts` holds both readings, and the panel
   * takes the other one.
   *
   * The target is appended because "Hammering" alone leaves the reader to guess
   * *which* building — and a directory name is exactly the word they recognise.
   */
  private caption(id: string, w: Worker): void {
    const entry = this.captions.get(id);
    if (!entry) return;
    const doing = actionInfo(w.action).world;
    const at = targetOf(w.place, SITE_ID_BUILDING_PREFIX);
    const label = at && at !== "yard" && at !== "workshop" && at !== "depot" ? `${doing} / ${at}` : doing;
    if (entry.label === label) return;
    entry.label = label;

    const key = `wc:${label}`;
    if (!this.scene.textures.exists(key)) {
      const style = PLACARD.doing;
      this.scene.textures.addCanvas(key, placard(label, style.ink, style.plate, style.border).toCanvas());
    }
    entry.text.setTexture(key);
  }

  /** setState picks the animation a worker should be playing, and resets its
   *  rhythm when the animation actually changes. Without the reset, a change
   *  from a fast action to a slow one would inherit the previous action's
   *  frame phase and start half way through. */
  private setState(w: Worker): void {
    const a = this.anim.get(w.id);
    if (!a) return;
    if (this.travel.has(w.id)) return; // walking is driven by progress instead

    const next = stateFor(w.action);
    if (a.state === next) return;
    a.state = next;
    a.index = 0;
    a.elapsed = 0;
  }

  /**
   * tick advances every figure's animation by the frame's elapsed time.
   *
   * Frames come from the art's own table, so the hammer's fast strike and slow
   * follow-through survive into the game. A machine in flight is the one figure
   * whose pose and facing are decided here rather than by the standing rhythm:
   * a walk is a question about the road and the ground, and both are answered
   * per tick from the journey in flight.
   */
  private tick(_time: number, delta: number): void {
    if (this.disposed) return;
    for (const [id, a] of this.anim) {
      const sprite = this.sprites.get(id);
      if (!sprite) continue;

      const journey = this.travel.get(id);
      if (journey) {
        // Face the way the machine is going, and take it from the view. The
        // direction is held in world units and the view is what says which way
        // that reads on screen, so the same rule governs a machine as governs
        // the road under it — and it is asked per tick rather than settled once
        // at the start of the journey, because a route that turns a corner is a
        // machine that turns.
        //
        // A mirrored cel is how a 16-bit figure turns around: at this size an
        // authored left-facing set would be indistinguishable and would double
        // the art for nothing.
        const flip = mirrored(this.view, journey.dir.x, journey.dir.y);
        if (sprite.flipX !== flip) sprite.setFlipX(flip);
        a.state = "walk";
        sprite.setFrame(this.frameFor(a, "walk"));
        continue;
      }

      // The rhythm still advances from the art's own table, so a machine keeps
      // the cadence of the action it stands for — but the frame it lands on is a
      // *pose*, not a frame of an animation. The state and the pose are kept
      // apart deliberately: ten states fold onto four poses, and folding them
      // here rather than baking ten would mean a new state could not drift out
      // of sync with its silhouette.
      const durations = FRAME_MS[a.state];
      a.elapsed += delta;
      let guard = 0;
      while (a.elapsed >= durations[a.index % durations.length] && guard++ < 4) {
        a.elapsed -= durations[a.index % durations.length];
        a.index = (a.index + 1) % durations.length;
      }
      if (sprite.frame.name !== this.frameFor(a, a.state)) {
        sprite.setFrame(this.frameFor(a, a.state));
      }
    }
  }

  /**
   * frameFor is the pose an animation's state is standing in.
   *
   * The single place the ten states meet the four poses, so the folding is
   * written out once and cannot be got wrong in two places.
   */
  private frameFor(a: AnimState, state: WorkerState): string {
    const kind: MachineKind = machineFor(a.agent);
    return machineFrame(kind, a.tier, POSE_FOR[state]);
  }

  /** remove tears down one figure and everything attached to it. */
  private remove(id: string): void {
    const sprite = this.sprites.get(id);
    if (sprite) this.scene.tweens.killTweensOf(sprite);
    sprite?.destroy();
    this.shadows.get(id)?.destroy();
    this.tags.get(id)?.destroy();
    this.captions.get(id)?.text.destroy();
    this.hitZones.get(id)?.destroy();
    this.sprites.delete(id);
    this.shadows.delete(id);
    this.tags.delete(id);
    this.anim.delete(id);
    this.groundY.delete(id);
    // The caption and the hit zone are destroyed above, so leaving them in their
    // maps leaves destroyed objects reachable by id — and a later tick writing to
    // one is a use-after-destroy rather than a missing sprite.
    this.captions.delete(id);
    this.hitZones.delete(id);
    this.travel.delete(id);
  }

  /** destroy tears down every figure. Used when the map is rebuilt. */
  destroy(): void {
    // Every listener goes before the figures, whether or not they finished their
    // walk: a layer torn down mid-journey would otherwise leave its closures
    // bound to the scene forever.
    for (const id of [...this.steppers.keys()]) this.unhook(id);
    for (const id of [...this.sprites.keys()]) this.remove(id);
  }
}

/**
 * stableOffset spreads several workers over one site, as a fraction of it.
 *
 * It returns a unit-fraction position rather than a world offset, because the
 * site it spreads over is not known here and a fixed offset cannot serve both a
 * 44-unit hut and a 420-unit Yard.
 *
 * It hashes the worker's id rather than drawing a random number, so a given
 * worker keeps its spot for the life of a session: a figure that teleported to a
 * new offset on every event would read as a fault rather than as crowds. The
 * hash is mixed with xor-shifts and a multiply before use, because consecutive
 * session ids differ in their last characters and a raw `h % n` would place
 * them in a line rather than spread across the plate.
 */
function stableOffset(id: string): { x: number; y: number } {
  const mix = (n: number): number => {
    let h = n | 0;
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
    return h >>> 0;
  };
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  // Two independent mixes, so x and y do not move together and the figures do
  // not fall on a diagonal.
  const x = (mix(h) % 1000) / 1000 - 0.5;
  const y = (mix(h ^ 0x5bf03635) % 1000) / 1000 - 0.5;
  return { x: x * 0.9, y: y * 0.9 };
}

/** crewTint is the crew's colour as a number, for a Phaser rectangle. */
function crewTint(agent: string): number {
  let h = 0;
  for (let i = 0; i < agent.length; i++) h = (h * 31 + agent.charCodeAt(i)) | 0;
  const hex = CREW_COLOURS[Math.abs(h) % CREW_COLOURS.length];
  // The palette's own crew colours, so a tag matches the panel's agent name
  // rather than being a second colour scheme for the same fact.
  return Number.parseInt(hex.slice(1), 16);
}

