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

/** How long a car is, in pixels.
 *
 *  Sized to be *seen*. The first version was 6×2 in the metal ramp, which was
 *  the right size for a thing nobody was meant to notice: a 6-pixel body drawn
 *  in the value of a building's own wall reads as a smudge on the wall, and
 *  nine of them on nine roads produced a town that looked exactly as it did
 *  with no traffic at all. A car has to clear the building behind it, so the
 *  number here is about legibility and not about realism — see `CAR_HEIGHT`. */
export const CAR_LENGTH = 14;

/** How tall a car is, in pixels.
 *
 *  Two thirds of its length, which at this camera angle is what separates a
 *  vehicle from a painted stripe. Thinner and it vanishes into the road's own
 *  kerb; taller and it stops being a car and becomes a block. */
export const CAR_HEIGHT = 5;

/** The lower, full-width part of the car: the body.
 *
 *  Three of the five pixels, and it spans the car's whole length. */
const CAR_BODY_HEIGHT = 3;

/** The upper part: the cabin, sitting on the body.
 *
 *  Two pixels, narrower than the body and pushed forward, so the silhouette
 *  has a front and a back rather than being symmetric. */
const CAR_CABIN_HEIGHT = 2;

/** How far the cabin starts from the nose, and how far the tail runs past it.
 *
 *  The cabin is not centred: a centred cabin is a lozenge, which reads as a
 *  pebble. Offset, it reads as a windscreen. */
const CAR_NOSE = 4;
const CAR_TAIL = 2;

/** The car's colour as the number `Graphics.fillStyle` takes.
 *
 *  Hoisted so the parse is not repeated for every car on every frame, and flat
 *  because a body this size has no room for a ramp — a gradient across it is a
 *  blob, not a car. */
const CAR_TINT = Number.parseInt(P.traffic.slice(1), 16);

/** How long one car takes to cross its road, in milliseconds.
 *
 *  Tied to the road rather than fixed, so a short street is crossed quickly and
 *  a long one slowly — otherwise a busy district reads as a queue and a quiet one
 *  as a crawl, and the speed stops meaning anything. */
const CYCLE_MS = 9000;

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
  const phase = hash(`${road.from ?? ""}${road.to ?? ""}`);
  const t = ((now / CYCLE_MS) + phase) % 1;
  return t < 0 ? t + 1 : t;
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
  private cars = new Map<string, Phaser.GameObjects.Graphics>();
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
    const live = new Set(this.roads.map((r) => `${r.from}${r.to}`));
    for (const [id, car] of this.cars) {
      if (!live.has(id)) {
        car.destroy();
        this.cars.delete(id);
      }
    }
    for (const road of this.roads) {
      const id = `${road.from}${road.to}`;
      if (this.cars.has(id)) continue;
      // Depth is set every frame rather than once here, because it is a function
      // of where the car is on its road. The value given at creation is only the
      // first one, and it stops mattering as soon as the car moves.
      this.cars.set(id, this.scene.add.graphics());
    }
  }

  update(now: number): void {
    for (const road of this.roads) {
      const car = this.cars.get(`${road.from}${road.to}`);
      if (!car) continue;
      const p = carAt(road, now);
      // The car walks a → b. `a` and `b` are the two ends of the *projected*
      // line, and which is nearer the camera has nothing to do with which
      // building imports which — the claim the car carries is `from`/`to`, sent
      // by the analyzer, and the projection only decides where the road is
      // drawn.
      const x = road.ax + (road.bx - road.ax) * p;
      const y = road.ay + (road.by - road.ay) * p;
      car.clear();
      car.fillStyle(CAR_TINT, 1);
      // Two rectangles, not one, and both on integer pixels.
      //
      // One rectangle is a *bar* — it reads as a lane marking, and zoomed in it
      // is a blank amber box with nothing in it. The narrower upper half is the
      // cabin: two steps is all it takes for the shape to say "a thing with a
      // roof on it" rather than "a stripe", and the car is small enough that
      // anything more is mush.
      //
      // Integer bounds on purpose. A centred rectangle starts at -7 x -2.5, and
      // the half pixel lands the far edge between two pixels — which the
      // renderer antialiases into two half-lit rows, so the car came out looking
      // like a pair of lines. The whole town is drawn on whole pixels for the
      // same reason.
      car.fillRect(-CAR_LENGTH / 2, 0, CAR_LENGTH, CAR_BODY_HEIGHT);
      car.fillRect(-CAR_LENGTH / 2 + CAR_NOSE, -CAR_CABIN_HEIGHT, CAR_LENGTH - CAR_NOSE - CAR_TAIL, CAR_CABIN_HEIGHT);
      // Facing the way it is going. A car that pointed the same way on every
      // road in the town would be a small lie on the vertical ones, and the
      // angle is already known — it is the road's own direction.
      car.setRotation(Math.atan2(road.by - road.ay, road.bx - road.ax));
      car.setPosition(x, y);
      car.setDepth(y);
    }
  }

  destroy(): void {
    for (const car of this.cars.values()) car.destroy();
    this.cars.clear();
  }
}
