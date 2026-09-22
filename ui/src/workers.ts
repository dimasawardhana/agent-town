// Workers: the animated figures that move to where the agent is working.
//
// This is the product. Everything else exists so that a worker can stand on the
// right building and visibly do the thing the agent is doing.
//
// Three decisions carry most of the quality here:
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
//   - A figure is never removed while the daemon still reports it. A worker that
//     vanished mid-hammer would say the agent stopped, which is the one thing
//     the town must not lie about.

import Phaser from "phaser";
import { CREW_COLOURS } from "./art/palette";
import { ATLAS, type Atlas, workerFrame } from "./art/bake";
import { FRAME_MS, type Tier, type WorkerState } from "./art/worker";
import { PLACARD, placard } from "./art/placard";
import { actionInfo, targetOf } from "./actions";
import { SITE_ID_BUILDING_PREFIX, type Action, type Layout, type Site, type Worker, useTown } from "./store";
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

/** One walk cycle's duration, from the art's own per-frame timings. */
const WALK_CYCLE_MS = FRAME_MS.walk.reduce((a, b) => a + b, 0);

/**
 * A journey in picture pixels.
 *
 * `startedAt` and `ms` are what let the walk be driven by progress rather than
 * by a timer, which is the difference between feet that plant and feet that
 * skate.
 */
interface Journey {
  x1: number;
  y1: number;
  ms: number;
  startedAt: number;
}

/** Where a figure is in its current animation. */
interface AnimState {
  state: WorkerState;
  tier: Tier;
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
  private travel = new Map<string, Journey>();
  private disposed = false;

  constructor(scene: Phaser.Scene, _atlasKey: string, atlas: Atlas) {
    this.scene = scene;
    this.atlas = atlas;
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
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.tick, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.events.off(Phaser.Scenes.Events.UPDATE, this.tick, this);
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
    const sprite = this.scene.add.sprite(at.x, at.y, ATLAS, workerFrame(tier, "idle", 0));
    const frame = this.atlas[workerFrame(tier, "idle", 0)];
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
    const text = this.scene.add.image(at.x, at.y - CAPTION_LIFT, BLANK);
    text.setOrigin(0.5, 1).setDepth(at.y + 2);
    this.captions.set(w.id, { text, label: "" });

    this.anim.set(w.id, { state: "idle", tier, elapsed: 0, index: 0 });
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
      this.syncVisual(w.id);
      return;
    }

    // The journey's duration and its walk-cycle count are decided together, so
    // the feet plant at a plausible rate for the distance travelled.
    const cycles = Math.min(MAX_CYCLES, Math.max(1, Math.round(distance / STRIDE_PX)));
    this.travel.set(w.id, {
      x1: to.x,
      y1: to.y,
      ms: Math.max(MIN_TRAVEL_MS, cycles * WALK_CYCLE_MS),
      startedAt: sprite.scene.time.now,
    });

    // Face the direction of travel. A mirrored cel is how a 16-bit figure turns
    // around: at this size an authored left-facing set would be
    // indistinguishable and would double the art for nothing.
    sprite.setFlipX(to.x < sprite.x);

    this.scene.tweens.add({
      targets: sprite,
      x: to.x,
      y: to.y,
      duration: this.travel.get(w.id)!.ms,
      ease: "Linear",
      onUpdate: () => this.syncVisual(w.id),
      onComplete: () => {
        this.travel.delete(w.id);
        this.syncVisual(w.id);
      },
    });
  }

  /** syncVisual keeps a figure's depth, shadow, tag and caption together while
   *  it moves. Depth is its feet's y, which is what makes a worker pass in
   *  front of a building it is standing below rather than behind it. The tag and
   *  the caption ride above, on their own depths, so a figure walking toward the
   *  camera draws over one behind it and both their labels stay legible. */
  private syncVisual(id: string): void {
    const sprite = this.sprites.get(id);
    if (!sprite) return;
    sprite.setDepth(sprite.y);
    this.shadows.get(id)?.setPosition(sprite.x, sprite.y).setDepth(sprite.y - 1);
    this.tags.get(id)?.setPosition(sprite.x, sprite.y - TAG_LIFT).setDepth(sprite.y + 1);
    this.captions.get(id)?.text.setPosition(sprite.x, sprite.y - CAPTION_LIFT).setDepth(sprite.y + 2);
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
   * follow-through survive into the game; a walk is derived from how far the
   * figure has actually travelled, so its feet plant where the ground is.
   */
  private tick(_time: number, delta: number): void {
    if (this.disposed) return;
    for (const [id, a] of this.anim) {
      const sprite = this.sprites.get(id);
      if (!sprite) continue;

      const journey = this.travel.get(id);
      if (journey) {
        // The walk reaches its last frame exactly as the figure arrives, so a
        // long journey does not finish its cycle early and then stand still
        // mid-stride, and a short one does not stop half way through a step.
        const p = Phaser.Math.Clamp(
          (sprite.scene.time.now - journey.startedAt) / journey.ms,
          0,
          1,
        );
        const count = FRAME_MS.walk.length;
        const index = Math.min(count - 1, Math.floor(p * count));
        if (a.state !== "walk") {
          a.state = "walk";
          a.index = index;
          sprite.setFrame(workerFrame(a.tier, "walk", index));
        } else if (index !== a.index) {
          a.index = index;
          sprite.setFrame(workerFrame(a.tier, "walk", index));
        }
        continue;
      }

      const durations = FRAME_MS[a.state];
      a.elapsed += delta;
      let guard = 0;
      while (a.elapsed >= durations[a.index] && guard++ < 4) {
        a.elapsed -= durations[a.index];
        a.index = (a.index + 1) % durations.length;
        sprite.setFrame(workerFrame(a.tier, a.state, a.index));
      }
      // The first frame of a new animation is set here rather than in setState,
      // because setState runs on the sync path where the frame may not exist yet.
      if (sprite.frame.name !== workerFrame(a.tier, a.state, a.index)) {
        sprite.setFrame(workerFrame(a.tier, a.state, a.index));
      }
    }
  }

  /** remove tears down one figure and everything attached to it. */
  private remove(id: string): void {
    const sprite = this.sprites.get(id);
    if (sprite) this.scene.tweens.killTweensOf(sprite);
    sprite?.destroy();
    this.shadows.get(id)?.destroy();
    this.tags.get(id)?.destroy();
    this.captions.get(id)?.text.destroy();
    this.sprites.delete(id);
    this.shadows.delete(id);
    this.tags.delete(id);
    this.captions.delete(id);
    this.anim.delete(id);
    this.travel.delete(id);
  }

  /** destroy tears down every figure. Used when the map is rebuilt. */
  destroy(): void {
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
