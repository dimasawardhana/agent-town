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

export const CAR_LENGTH = 6;

/** The lit step of the metal ramp, as the number `Graphics.fillStyle` takes.
 *
 *  Hoisted so the parse is not repeated for every car on every frame, and flat
 *  because a 6-pixel body has no room for a ramp: a gradient on a rectangle
 *  that size is a blob. */
const CAR_TINT = Number.parseInt(P.metal[2].slice(1), 16);

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
    this.roads = roads.filter((r) => r.from && r.to);
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
      car.fillRect(-CAR_LENGTH / 2, -1, CAR_LENGTH, 2);
      car.setPosition(x, y);
      car.setDepth(y);
    }
  }

  destroy(): void {
    for (const car of this.cars.values()) car.destroy();
    this.cars.clear();
  }
}
