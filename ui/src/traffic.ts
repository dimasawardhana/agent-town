// Cars on import roads.
//
// The town already has real import roads — one deduplicated edge per building
// pair — and nothing has ever travelled one. A car running an import road from
// the importer to the imported says *this building uses that one*, and a town
// with heavy traffic has tightly coupled districts. That is true, and before this
// it was completely invisible.
//
// **One car per road, never one per import statement.** 111 statements collapse
// to 9 roads on this repository, and a car per statement would claim a
// dependency exists 111 times. The road is already the deduplicated fact.
//
// **Generated, not baked.** Drawn with Phaser Graphics at runtime, like the
// ember and the sky, so this costs no atlas cels. The atlas has 135 spare and
// they are spoken for.
//
// **Depth comes from where the car stands, not from a constant.** Road bands
// are painted into the ground texture (`paintRoads` in `scene.ts`), so a car is a
// ground-plane object and has to sort among the buildings by screen position
// exactly as they do. One constant cannot do that: the town spans thousands of
// pixels of y, so any single value either floats every car over every roof or
// hides every car behind every building in front of it. `roadsAsLines` already
// returned projected screen coordinates, so the car's own y is the number.

// A *type-only* Phaser import, and deliberately so. `Graphics.fillStyle` takes a
// number while every colour in `P` is a hex string, so the conversion below is
// `Number.parseInt` — the same form `scene.ts` and `workers.ts` already use —
// rather than a call into `Phaser.Display.Color`. Reaching for Phaser for that
// one value would drag the browser build into the bundle, and it touches
// `window` while initialising, which is the difference between this suite
// running under `node --test` and not running at all.
import type Phaser from "phaser";

import { P } from "./art/palette";
import type { RoadLine } from "./view";

/**
 * The car, drawn once per run at 1x and rotated onto its road.
 *
 * Nine characters wide-ish per row, authored as text so the shape can be read
 * in the source and diffed when it changes — a car made of `fillRect` calls is
 * four numbers and nobody can see what it is supposed to be.
 *
 *   o  ink outline          3  lit: the top-left step of the traffic ramp
 *   d  tyre                 2  mid
 *   g  glass                1  shadowed: the bottom-right step
 *   ~  cast shadow, half-transparent
 *   .  nothing
 *
 * Five things do the reading, in the order they matter:
 *
 *  1. **A light direction.** Every cell on the left is lighter than the one
 *     beside it on the right, and every row lighter than the one below — the
 *     same top-left key `shade()` lights every building with. This is what the
 *     previous version got wrong and it is why it looked flat: the value ran
 *     light at the nose to dark at the tail, *evenly across the width*. Two
 *     halves of one value meeting in the middle is a gradient, not a form — the
 *     sprite had no light in it and nothing for the eye to read depth from.
 *  2. **The taper.** The nose is eight pixels and the middle twelve. A car
 *     whose front and back are the same width is a bar.
 *  3. **Four wheel blocks**, at rows 3 and 5, standing two pixels proud of the
 *     body on both sides. Rails along the flank read as a skirt, and wheels are
 *     most of what says "vehicle" at this size.
 *  4. **Two glass bands**, windscreen and rear window, with body between them
 *     for a roof. Without them the shape is a table.
 *  5. **A cast shadow**, offset one pixel down-right and drawn at half alpha.
 *     The light is top-left, so the shadow falls the other way; without it the
 *     car is a sticker on the tarmac rather than a thing above it. Half alpha
 *     is legal here and nowhere else: this is generated art and never baked, so
 *     no palette invariant ever sees it — the same exception the ember's glow
 *     makes.
 *
 * Ten tall against fourteen wide, because a car is long and low and anything
 * else reads as a van or a pill. The nose points at the *top* of the texture,
 * so `update` adds a quarter turn when it lays the car on its road.
 */
export const CAR_ART: readonly string[] = [
  "...oooooooo...",
  "..o33333331o..",
  ".o3333211111o.",
  "ddo33321111odd",
  "..o3gggggg1o..",
  "ddo33321111odd",
  ".o3333211111o.",
  ".o3333gg1111o.",
  ".o1111111111o.",
  "...oooooooo...",
  "....oooooooo..",
];

/** The car's plan, one string per row, transparent where the string is a dot. */
export const CAR_W = CAR_ART[0].length;
export const CAR_H = CAR_ART.length;

/** carTexture draws the car once and hands back the texture key.
 *
 *  Generated rather than baked, so it costs the atlas nothing — the same trick
 *  the ember and the sky use, and for the same reason. It is also what makes
 *  rotation safe: the rasteriser paints these nine rows at whole pixels, and
 *  Phaser's `pixelArt` carries the rotation through with nearest-neighbour
 *  sampling, so the edges stay hard. Drawing into a `Graphics` instead would
 *  rasterise the rectangles and *then* rotate them, which is how the half-pixel
 *  rows arrived in the first place.
 */
export function carTexture(scene: Phaser.Scene, key: string): string {
  if (scene.textures.exists(key)) return key;
  const canvas = scene.textures.createCanvas(key, CAR_W, CAR_H);
  if (!canvas) return key;
  const g = canvas.getContext() as CanvasRenderingContext2D;
  const ramp: Record<string, string> = {
    "o": P.ink,
    "g": P.glass[1],
    "1": P.traffic[0],
    "2": P.traffic[1],
    "3": P.traffic[2],
    // Tyres are `rubber[2]`, not `rubber[0]`. The darkest rubber step is 4.8:1
    // against the ink outline — near enough the same value that the wheels
    // disappear into it and the silhouette is a plain rectangle. `rubber[2]` is
    // 34:1 from the outline and 13.8:1 from the body, so a wheel reads as a
    // block in its own right, which is the whole job.
    "d": P.rubber[2],
  };
  // The shadow is the only translucent pixel in the town, and like the ember's
  // glow it is legal only because this is generated art and never baked — no
  // palette invariant reads it. A hard-edged shadow would be a second car
  // outline, which is worse than none.
  const SHADOW_ALPHA = 0.45;
  for (let y = 0; y < CAR_H; y++) {
    for (let x = 0; x < CAR_W; x++) {
      const ch = CAR_ART[y][x];
      if (ch === ".") continue;
      g.globalAlpha = ch === "~" ? SHADOW_ALPHA : 1;
      g.fillStyle = ch === "~" ? P.ink : ramp[ch];
      g.fillRect(x, y, 1, 1);
    }
  }
  g.globalAlpha = 1;
  return key;
}

/** Milliseconds per pixel of road, and the floor under one crossing.
 *
 *  A car's *speed* is constant, so its *cycle* is proportional to the length of
 *  the road it is on — which is what the liveliness spec asks for ("at a speed
 *  tied to the road's length"). It is why a long district road crawls and a
 *  short one between two neighbours is brisk: the distance is real, and a car
 *  covering it at a fixed rate is saying so.
 *
 *  The floor is what stops a 14-pixel gap — which is all the road there is
 *  between two plots on the same row — from taking a fifth of a second and
 *  reading as a blink rather than a journey. */
const MS_PER_ROAD_PIXEL = 55;
const MIN_CYCLE_MS = 1500;

/** cycleMs is how long a car takes to cross this road, in milliseconds. */
export function cycleMs(road: RoadLine): number {
  return Math.max(MIN_CYCLE_MS, Math.hypot(road.bx - road.ax, road.by - road.ay) * MS_PER_ROAD_PIXEL);
}

/** hash is a small deterministic string hash, for staggering cars.
 *
 *  Its only job is to give each road its own phase, so a fleet does not start in
 *  step. It is a hash rather than an index so the phase does not change when a
 *  road is added elsewhere in the town — a car's position must depend on the road
 *  it is on and on nothing else. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** carAt is where along its road a car is at time `now`, in 0..1.
 *
 *  Pure. The same road and the same clock always give the same answer, which is
 *  what keeps two clients drawing the same town and a reload from reshuffling
 *  the traffic. */
export function carAt(road: RoadLine, now: number): number {
  const phase = hash(roadId(road));
  const t = ((now / cycleMs(road)) + phase) % 1;
  return t < 0 ? t + 1 : t;
}

/** roadId identifies a road for a car's map key and for its phase hash.
 *
 *  The two ends are joined with a character that cannot appear in a path,
 *  because joining them bare makes the id ambiguous: from="ab", to="c" and
 *  from="a", to="bc" are both "abc", and two roads would share one car — one
 *  road's car driving along another's, and whichever was created second never
 *  being placed. Repository paths are slash-separated so the collision cannot
 *  happen today, and a key that is only correct because of that is a key that
 *  breaks the first time an id comes from anywhere else.
 *
 *  The same function builds the key and the phase, because a phase and a key
 *  that disagreed would mean two cars for one road, which is the same bug from
 *  the other side. */
export function roadId(road: RoadLine): string {
  return `${road.from ?? ""}\u0000${road.to ?? ""}`;
}

/** drivenRoads is the road set that carries traffic: the import roads only.
 *
 *  A containment road is a true fact and a static one — "this sits inside
 *  that" is not a dependency, and a car on it would claim one that is not
 *  there. Row and district roads are the ground the town is drawn on, not
 *  journeys between buildings.
 *
 *  Named and exported rather than left as an inline filter because this *is* the
 *  claim "a car only ever says this building uses that one", and a rule that is
 *  only reachable through a constructor that needs a live scene is a rule no
 *  headless test can check. The mutation runner holds this line honest. */
export function drivenRoads(roads: readonly RoadLine[]): RoadLine[] {
  return roads.filter((r) => r.from && r.to);
}

/** Traffic draws one car on every import road. */
export class Traffic {
  private cars = new Map<string, Phaser.GameObjects.Image>();
  private roads: RoadLine[] = [];
  private scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** sync replaces the road set, dropping a car for a road that is gone. */
  sync(roads: RoadLine[]): void {
    // A containment road is a true fact and a static one; "this sits inside
    // that" is not a dependency and a car on it would claim one that is not there.
    this.roads = drivenRoads(roads);
    const key = carTexture(this.scene, CAR_TEX);
    const live = new Set(this.roads.map(roadId));
    for (const [id, car] of this.cars) {
      if (!live.has(id)) {
        car.destroy();
        this.cars.delete(id);
      }
    }
    for (const road of this.roads) {
      const id = roadId(road);
      if (this.cars.has(id)) continue;
      // Every car is the same nine rows of pixels, so they share one texture.
      // `setOrigin` centres it on the road; without that a car sits a row and a
      // half above the tarmac and reads as hovering.
      //
      // Depth is set every frame rather than once here, because it is a
      // function of where the car is on its road. The value given at creation is
      // only the first one, and it stops mattering as soon as the car moves.
      const car = this.scene.add.image(0, 0, key).setOrigin(0.5, 0.5);
      this.cars.set(id, car);
    }
  }

  update(now: number): void {
    for (const road of this.roads) {
      const car = this.cars.get(roadId(road));
      if (!car) continue;
      const p = carAt(road, now);
      // The car walks a → b. `a` and `b` are the two ends of the *projected*
      // line, and which is nearer the camera has nothing to do with which
      // building imports which — the claim the car carries is `from`/`to`, sent
      // by the analyzer, and the projection only decides where the road is
      // drawn.
      const x = road.ax + (road.bx - road.ax) * p;
      const y = road.ay + (road.by - road.ay) * p;
      // Facing the way it is going, plus a quarter turn because the art points
      // its nose at the top of the texture. The angle is already known — it is
      // the road's own direction — and a car that pointed the same way on every
      // road in the town would be a small lie on the vertical ones.
      car.setRotation(Math.atan2(road.by - road.ay, road.bx - road.ax) + Math.PI / 2);
      car.setPosition(x, y);
      car.setDepth(y);
    }
  }

  destroy(): void {
    for (const car of this.cars.values()) car.destroy();
    this.cars.clear();
  }
}

/** The texture key every car shares. One key, one set of nine rows. */
const CAR_TEX = "traffic:car";

