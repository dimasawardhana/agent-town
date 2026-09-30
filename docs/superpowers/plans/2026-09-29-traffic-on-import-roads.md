# Traffic on Import Roads Implementation Plan

> **Superseded.** Executed in full on `feature/liveliness`, then **reverted in
> `a8c80e8`**: the cars and the import road bands were removed and the import
> fact moved onto the building as `Site.Imports`. Nothing in this plan ships.
> The plan is kept because it records what was tried and why it failed, and
> because the traffic tests it grew are the ones that caught the sprite being
> unreadable. Do not execute it.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a car on every import road, travelling from the importing building to the imported one, so a reader can see which districts are coupled by watching the traffic.

**Architecture:** The daemon already emits one deduplicated `Road` of kind `"import"` per building pair. Today `Road` carries only a rectangle and a kind, so the renderer cannot tell *which way* a car should go. This plan adds an optional `from`/`to` pair to the wire type, threads it through `roadsAsLines`, and adds a `Traffic` layer that runs one car per road, staggered so the town reads as flow rather than as a start line.

**Tech Stack:** Go 1.x (daemon, `internal/analyzer`, `internal/web`), TypeScript 5 + Phaser 3 (`ui/src`), `node --test` via esbuild for UI tests, Phaser `Graphics` for car bodies (generated, so **no atlas cels and no budget cost**).

**Spec:** `docs/superpowers/specs/2026-09-29-town-liveliness.md`, section "1. Cars on import roads — the spine". Read it before starting; the second section of this plan's task 1 quotes it back to you so you cannot proceed on a wrong reading.

## Global Constraints

- **The town is a pure function of the analysis and the event stream** (ADR-0012). The browser never recomputes geometry; a car's path must be derived from the road the daemon emitted, never re-derived.
- **Determinism is absolute.** No `Math.random()`, and nothing may depend on map-iteration order. A car's phase along its road must be a pure function of the road's identity, so two clients draw the same town and a reload does not reshuffle the traffic.
- **Generated art costs no cels.** Cars are drawn with Phaser `Graphics` at runtime, like the ember and the sky. A baked car would come out of the atlas budget, which has 135 spare and is already spoken for.
- **No claim the data does not support.** One car per *road*, never one per import statement: 111 statements collapse to 9 roads on this repository, and a car per statement would say a dependency exists 111 times.
- **Containment roads get no traffic.** "This sits inside that" is a true fact and a static one.
- Repo house style: heavy explanatory comments explaining **why** and what would break otherwise. Every new comment is checked by `ui/test/commenttruth.test.ts`, which fails on a comment that does not match the code beside it.
- Verification commands, from the repository root:
  - `go test ./... -count=1`
  - `cd ui && npm test`
  - `cd ui && npm run test:mutate` — **must report 8 caught, 0 unaccounted for**
    (6 today, plus the 2 this plan adds in task 5)
  - `cd ui && ./node_modules/.bin/tsc --noEmit -p tsconfig.json`
  - `gofmt -l ./internal/` — must print nothing

---

### Task 1: The road needs a direction

A car cannot be placed until the road says which end is the importer. Today `Road` is a rectangle plus a kind, and a rectangle has no direction, so the renderer would have to guess — and a guess here is a false claim about which building depends on which.

**Files:**
- Modify: `internal/analyzer/layout.go:148-160` (the `Road` struct)
- Modify: `internal/analyzer/layout.go:651-693` (`importRoads`, where the literal is built)
- Test: `internal/analyzer/layout_test.go`

**Interfaces:**
- Consumes: `importEdgesCounting(root string, buildings map[string]bool) (map[[2]string]bool, int)` — already exists, returns ordered pairs where the first element imports the second.
- Produces:
  ```go
  type Road struct {
      X, Y, W, H float64
      Kind        string  `json:"kind"` // "row", "district", "containment", "import"
      // From and To are the building paths an import road runs between, in
      // that order: the importer, then the imported. Empty for every other kind.
      From string `json:"from,omitempty"`
      To   string `json:"to,omitempty"`
  }
  ```

- [x] **Step 1: Write the failing test**

Append to `internal/analyzer/layout_test.go`:

```go
// An import road says which building imports which, and says nothing when it
// is not an import road.
//
// A car cannot be placed without it, and a car placed by guessing the direction
// would draw "this building uses that one" backwards — a false claim about a
// dependency, on a map whose entire claim is that it only says true things.
func TestImportRoadsCarryTheirDirection(t *testing.T) {
	root := t.TempDir()
	mk := func(rel, body string) {
		full := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	mk("ui/src/a.ts", "import { x } from \"../shared\";\n")
	mk("ui/shared/b.ts", "export const x = 1;\n")
	mk("ui/src/contained.ts", "export const y = 2;\n")

	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	l := LayoutTown(town)

	var found bool
	for _, r := range l.Roads {
		switch r.Kind {
		case "import":
			found = true
			if r.From == "" || r.To == "" {
				t.Errorf("an import road has no direction: %+v", r)
			}
			// ui/src imports ui/shared, and the order is the whole claim.
			if r.From == "ui/shared" || r.To == "ui/src" {
				t.Errorf("import road points the wrong way: %s -> %s", r.From, r.To)
			}
		default:
			if r.From != "" || r.To != "" {
				t.Errorf("a %s road claims a direction: %+v", r.Kind, r)
			}
		}
	}
	if !found {
		t.Fatal("no import road was emitted at all")
	}
}
```

- [x] **Step 2: Run the test to verify it fails**

Run: `go test ./internal/analyzer/ -run TestImportRoadsCarryTheirDirection -v -count=1`
Expected: FAIL — `r.From undefined (type Road has no field or method From)`.

- [x] **Step 3: Add the fields to `Road`**

In `internal/analyzer/layout.go`, replace the `Roads` field's struct with the struct shown in the Interfaces block. Use this doc comment verbatim:

```go
	// From and To are the building paths an import road runs between, in that
	// order: the importer, then the imported.
	//
	// They are empty for every other kind of road, and they are *omitted* rather
	// than sent empty, because a reader that has to distinguish "no direction"
	// from "an empty direction" is a reader that will get it wrong eventually.
	//
	// This travels the wire rather than being recomputed in the browser for the
	// same reason roads do: the layout is the single source of truth (ADR-0012),
	// and a renderer that worked out the direction for itself would be a second
	// implementation of the dependency graph.
	From string `json:"from,omitempty"`
	To   string `json:"to,omitempty"`
```

- [x] **Step 4: Emit the direction where import roads are built**

The import road is built in **`internal/analyzer/layout.go`**, not in `imports.go`, inside the function `importRoads(root string, l *Layout)` (declared at `layout.go:651`). Its loop is already over ordered pairs, and the ordering is already the direction:

```go
	for _, e := range pairs {
		c, p := byPath[e[0]], byPath[e[1]]   // c imports p
		...
		l.Roads = append(l.Roads, Road{
			X:    math.Min(cx, px) - band/2,
			Y:    math.Min(cy, py) - band/2,
			W:    math.Abs(px-cx) + band,
			H:    math.Abs(py-cy) + band,
			Kind: "import",
		})
	}
```

`e[0]` is the importer and `e[1]` the imported — `c, p := byPath[e[0]], byPath[e[1]]` already says so. Add the two fields to the literal and nothing else:

```go
			Kind: "import",
			From: e[0],
			To:   e[1],
```

`pairs` is sorted before the loop (`sort.Slice` on `[0]` then `[1]`), so the direction is deterministic and adding these fields cannot reorder anything. **This is the only place a `Kind: "import"` road is constructed** — `grep -rn '"import"' internal/analyzer/` returns this literal and four test assertions, and no other production site.

- [x] **Step 5: Run the test to verify it passes**

Run: `go test ./internal/analyzer/ -run TestImportRoadsCarryTheirDirection -v -count=1`
Expected: PASS.

- [x] **Step 6: Run the whole Go suite**

Run: `go test ./... -count=1 && gofmt -l ./internal/`
Expected: all packages `ok`, gofmt prints nothing.

- [x] **Step 7: Commit**

```bash
git add internal/analyzer/layout.go internal/analyzer/layout_test.go
git commit -m "An import road says which building imports which

A car cannot be placed until the road says which end is the importer. Today
Road is a rectangle plus a kind, and a rectangle has no direction, so a car
placed on it would have to guess — and a guess here is a false claim about
which building depends on which."
```

---

### Task 2: The browser learns the direction

The wire type gains a field, and the thing that turns a `Road` into a `RoadLine` has to carry it. If it is dropped here, everything downstream silently draws a one-way road that is not one.

**Files:**
- Modify: `ui/src/view.ts:412-440` (`roadsAsLines`, and the `RoadLine` type)
- Modify: `ui/src/store.ts` (the `Road` interface the browser holds)
- Test: `ui/test/turnroads.test.ts` (existing suite for this function)

**Interfaces:**
- Consumes: the `from`/`to` fields from task 1, arriving as `Road.from` and `Road.to` in `ui/src/store.ts`.
- Produces:
  ```ts
  export interface RoadLine {
    a: Point;
    b: Point;
    /** The building paths this road runs between, importer first. Empty when
     *  the road is not an import road. */
    from?: string;
    to?: string;
  }
  ```

- [x] **Step 1: Write the failing test**

Append to `ui/test/turnroads.test.ts`:

```ts
test("a road line carries which end is the importer", () => {
  const project = (x: number, y: number) => ({ x: (x - y) / 2, y: (x + y) / 4 });
  const lines = roadsAsLines(
    [
      // Importer first: ui/src imports ui/shared.
      { x: 0, y: 0, w: 10, h: 4, kind: "import", from: "ui/src", to: "ui/shared" },
      // A containment road claims no direction, and must come back claiming none.
      { x: 20, y: 0, w: 10, h: 4, kind: "containment" },
    ],
    project,
  );
  assert.equal(lines[0].from, "ui/src");
  assert.equal(lines[0].to, "ui/shared");
  assert.equal(lines[1].from, undefined, "a containment road grew a direction");
});
```

Add at the top of the file if not already present:
```ts
import { roadsAsLines } from "../src/view";
```

- [x] **Step 2: Run the test to verify it fails**

Run: `cd ui && npm run test:turnroads`
Expected: FAIL — `lines[0].from` is `undefined`, `expected 'ui/src'`.

- [x] **Step 3: Add the fields to the types and pass them through**

In `ui/src/view.ts`, extend `RoadLine` with the optional `from`/`to` shown in Interfaces, and change the signature of `roadsAsLines` to accept the fields:

```ts
export function roadsAsLines(
  roads: readonly {
    x: number;
    y: number;
    w: number;
    h: number;
    from?: string;
    to?: string;
  }[],
  project: (x: number, y: number) => { x: number; y: number },
): RoadLine[] {
```

and inside the `out.push({ ... })` for each line, add `from: r.from, to: r.to`. **Do not reorder `a` and `b`** — the projection already decides which end is nearer, and a car walks `a`→`b`; if you swap them here, every car reverses and nothing says so.

In `ui/src/store.ts`, add to the `Road` interface:

```ts
  /** The building paths an import road runs between, importer first. Absent on
   *  every other kind of road, and absent on any payload serialized before this
   *  field existed. */
  from?: string;
  to?: string;
```

- [x] **Step 4: Run the test to verify it passes**

Run: `cd ui && npm run test:turnroads`
Expected: PASS.

- [x] **Step 5: Run the whole UI suite**

Run: `cd ui && npm test`
Expected: every suite green, `ℹ fail 0` for each.

- [x] **Step 6: Commit**

```bash
git add ui/src/view.ts ui/src/store.ts ui/test/turnroads.test.ts
git commit -m "A road line carries which end is the importer

Dropped here it would be invisible: every downstream layer would draw a
one-way road that is not one, and a test asserting 'cars move' would still pass."
```

---

### Task 3: One car, and its position without a random number

The layer itself. The hard requirement is that a car's position is a **pure
function of the road**, because a car that is placed by `Math.random()` moves on
every reload, and two clients watching the same town would draw different traffic
— which breaks the property the whole layout rests on.

**Files:**
- Create: `ui/src/traffic.ts`
- Test: `ui/test/traffic.test.ts`
- Modify: `ui/package.json` (register the suite)

**Interfaces:**
- Consumes: `RoadLine` from task 2, with `from`/`to` present on import roads.
- Produces:
  ```ts
  export const CAR_LENGTH = 6;
  /** carAt is where along its road a car is at time `now`, in 0..1.
   *  Pure: the same road and the same clock always give the same answer, which
   *  is what keeps two clients drawing the same town. */
  export function carAt(road: RoadLine, now: number): number;
  export class Traffic {
    constructor(scene: Phaser.Scene, depth: number);
    sync(roads: RoadLine[]): void;
    update(now: number): void;
    destroy(): void;
  }
  ```

- [x] **Step 1: Write the failing test**

Create `ui/test/traffic.test.ts`:

```ts
// A car's position must be a pure function of its road.
//
// Not a style preference: a car placed by `Math.random()` jumps on every reload
// and two clients watching the same town draw different traffic. That breaks
// determinism (ADR-0012) in the most visible way available — the town is not the
// same place twice.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { carAt, CAR_LENGTH } from "../src/traffic";
import type { RoadLine } from "../src/view";

const road: RoadLine = { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, from: "a", to: "b" };

test("a car at the same moment is in the same place", () => {
  assert.equal(carAt(road, 1000), carAt(road, 1000));
  assert.equal(carAt(road, 0), carAt(road, 0));
});

test("a car advances, and never leaves its road", () => {
  const early = carAt(road, 0);
  const later = carAt(road, 4000);
  assert.notEqual(early, later, "the car never moved");
  for (const t of [0, 1000, 2500, 999999, -500]) {
    const p = carAt(road, t);
    assert.ok(p >= 0 && p < 1, `car escaped its road: ${p} at t=${t}`);
  }
});

test("two different roads carry two different cars", () => {
  const other: RoadLine = { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, from: "x", to: "y" };
  // Same geometry, different identity: a town must not put every car in step.
  assert.notEqual(carAt(road, 3000), carAt(other, 3000), "cars are synchronised across roads");
});

test("a road with no importer carries no car", () => {
  const bare: RoadLine = { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } };
  assert.equal(bare.from, undefined, "a containment road grew a direction");
  assert.ok(CAR_LENGTH > 0);
});
```

- [x] **Step 2: Register the suite and run it to verify it fails**

Add to `ui/package.json` scripts:
```json
"test:traffic": "./node_modules/.bin/esbuild --bundle --format=esm --platform=node --outfile=ui-traffic.test.mjs test/traffic.test.ts --log-level=warning && node --test ui-traffic.test.mjs"
```
and append `&& npm run test:traffic` to the end of the `test` script.

Add `ui-traffic.test.mjs` to `.gitignore`.

Run: `cd ui && npm run test:traffic`
Expected: FAIL — `Cannot find module '../src/traffic'`.

- [x] **Step 3: Write `ui/src/traffic.ts`**

```ts
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

import Phaser from "phaser";

import { P } from "./art/palette";
import type { RoadLine } from "./view";

export const CAR_LENGTH = 6;

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
  const phase = hash(`${road.from ?? ""}\u0000${road.to ?? ""}`);
  const t = ((now / CYCLE_MS) + phase) % 1;
  return t < 0 ? t + 1 : t;
}

/** Traffic draws one car on every import road. */
export class Traffic {
  private cars = new Map<string, Phaser.GameObjects.Graphics>();
  private roads: RoadLine[] = [];
  private scene: Phaser.Scene;
  private depth: number;

  constructor(scene: Phaser.Scene, depth: number) {
    this.scene = scene;
    this.depth = depth;
  }

  /** sync replaces the road set, dropping a car for a road that is gone. */
  sync(roads: RoadLine[]): void {
    // A containment road is a true fact and a static one; "this sits inside
    // that" is not a dependency and a car on it would claim one that is not there.
    this.roads = roads.filter((r) => r.from && r.to);
    const live = new Set(this.roads.map((r) => `${r.from} ${r.to}`));
    for (const [id, car] of this.cars) {
      if (!live.has(id)) {
        car.destroy();
        this.cars.delete(id);
      }
    }
    for (const road of this.roads) {
      const id = `${road.from} ${road.to}`;
      if (this.cars.has(id)) continue;
      const car = this.scene.add.graphics().setDepth(this.depth);
      this.cars.set(id, car);
    }
  }

  update(now: number): void {
    for (const road of this.roads) {
      const car = this.cars.get(`${road.from} ${road.to}`);
      if (!car) continue;
      const p = carAt(road, now);
      const x = road.a.x + (road.b.x - road.a.x) * p;
      const y = road.a.y + (road.b.y - road.a.y) * p;
      car.clear();
      // `Graphics.fillStyle` takes a number, while every colour in `P` is a hex
      // string, so the conversion is a real step and not a detail to skim.
      // `HexStringToColor` is Phaser's own, and `metal[2]` is the lit step of the
      // ramp: a 6-pixel body needs one flat value, because a gradient on a
      // rectangle that size is a blob.
      car.fillStyle(Phaser.Display.Color.HexStringToColor(P.metal[2]).color, 1);
      car.fillRect(-CAR_LENGTH / 2, -1, CAR_LENGTH, 2);
      car.setPosition(x, y);
    }
  }

  destroy(): void {
    for (const car of this.cars.values()) car.destroy();
    this.cars.clear();
  }
}
```

> **`P.metal` is a `Ramp`** — four hex strings, dark to light — so `P.metal[2]`
> is valid. It is indexable, but it is *not* a number, and `Graphics.fillStyle`
> does not take a string: passing `P.metal[2]` directly compiles and renders
> nothing, which is a silent failure and the reason the conversion is spelled out
> rather than left to the reader.

- [x] **Step 4: Run the test to verify it passes**

Run: `cd ui && npm run test:traffic`
Expected: PASS, 4 tests.

- [x] **Step 5: Commit**

```bash
git add ui/src/traffic.ts ui/test/traffic.test.ts ui/package.json .gitignore
git commit -m "One car per import road, placed without a random number

A car's position is a pure function of its road, so a reload does not reshuffle
the traffic and two clients watching the same town draw the same cars. A car
placed by Math.random() is the most visible possible way to break
determinism."
```

---

### Task 4: The cars drive

The layer exists and is not yet on the map. This wires it into the redraw, next
to the chimneys and the embers, and makes it survive a turn.

**Files:**
- Modify: `ui/src/scene.ts` (imports, the redraw path beside `Chimneys`, and `update`)
- Test: `ui/test/traffic.test.ts` (extend)

**Interfaces:**
- Consumes: `Traffic` from task 3; `roadsAsLines(...)` and `this.project` already present in `scene.ts`.
- Produces: a `private traffic: Traffic | null` field on the town scene.

- [x] **Step 1: Write the failing test**

This cannot be asserted headlessly — it is a renderer wiring change. Assert the
*invariant* instead, in `ui/test/traffic.test.ts`:

```ts
import { bakedCels } from "../src/art/bake";

test("a car costs the atlas nothing", () => {
  // Traffic is generated, so it must not appear in the bake. If a car ever gets
  // baked it comes out of a budget with 135 spare, and this is the assertion
  // that says so before anyone notices the count.
  const keys = bakedCels(0).map((c) => c.key);
  assert.equal(
    keys.filter((k) => k.startsWith("car:")).length,
    0,
    "a car was baked into the atlas; traffic is generated and must not cost cels",
  );
});
```

- [x] **Step 2: Run it to verify it fails or passes honestly**

Run: `cd ui && npm run test:traffic`
Expected: PASS — and that is the correct outcome, because the assertion is about
the *absence* of a regression that has not happened. **If it fails, a car has been
baked; stop and find out where.**

- [x] **Step 3: Wire the layer into the scene**

In `ui/src/scene.ts`:

1. Add the import next to `import { Embers } from "./embers";`:
   `import { Traffic } from "./traffic";`
2. Add the field beside `private embers: Embers | null = null;`:
   ```ts
   /** Cars on the import roads. Generated, so no atlas cost, and re-synced with
    *  the draw so a turn re-routes them against the turned roads. */
   private traffic: Traffic | null = null;
   ```
3. In the redraw, beside where `Chimneys` and `Embers` are recreated:
   ```ts
   this.traffic?.destroy();
   this.traffic = new Traffic(this, DEPTH.traffic);
   this.traffic.sync(roadsAsLines(layout.roads ?? [], (x, y) => this.project(x, y)));
   ```
4. Add a `traffic` key to the `DEPTH` object in `ui/src/scene.ts:88`, **with the
   value chosen by looking, not by reasoning** — see the note below.
5. In `override update()`, beside the `this.embers.reconcile(...)` call:
   ```ts
   this.traffic?.update(this.time.now);
   ```

- [x] **Step 4: Verify the whole UI suite and the type check**

Run:
```bash
cd ui && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && npm test
```
Expected: clean, every suite green.

- [x] **Step 5: Look at it**

```bash
cd ui && ./node_modules/.bin/vite build && cd .. && go install ./cmd/townd
townd --port 7851 --dir "$PWD" &
```

Open `http://127.0.0.1:7851`, wait for the town, and confirm: cars move along
the **checkered import roads only**; they are not on the containment footpaths;
they are not synchronised with each other; and the town still looks the same with
every car removed.

> **Choosing the depth.** `DEPTH` runs `ground: -100000`, `smoke: 80000`,
> `ember: 85000`, `label: 90000` — so the gaps are wide, and the number that
> matters is the depth the *buildings* are drawn at, which this plan has not
> measured. A car must sit above the ground plane and **below the buildings**,
> because a building passing over its own road is how a town reads as solid, and a
> car floating over a roof says the map is a diagram.
>
> Find the real value with `grep -n "setDepth\|add.container" ui/src/scene.ts`
> and put the car a little above `ground`. Then **look at a building that has an
> import road crossing it** and confirm the building occludes the car. A depth
> chosen by arithmetic rather than by that check is a guess, and this plan does
> not ship guesses.

> **If the cars are not on the roads you expected**, stop and check
> `ui/src/traffic.ts` `sync()` — it filters on `r.from && r.to`, so a car appears
> only on roads the daemon gave a direction. `curl -s localhost:7851/api/town |
> jq '.projects[].layout.roads[] | select(.kind=="import")'` will show whether the
> daemon is emitting them at all.

- [x] **Step 6: Commit**

```bash
git add ui/src/scene.ts ui/test/traffic.test.ts
git commit -m "Cars drive

Synced with the draw, so a turn re-routes them against the turned roads rather
than leaving them crossing a landscape they no longer belong to."
```

---

### Task 5: Prove the whole thing bites

Everything above is verified by assertions that could in principle be satisfied
by a car that does not move. This breaks it deliberately.

**Files:**
- Modify: `ui/test/mutate.mjs`

**Interfaces:**
- Consumes: the runner's existing shape — an array of `{ what, file, from, to, suite }`.
- Produces: two new entries in that array.

- [x] **Step 1: Add the mutations**

Append to the `MUTATIONS` array in `ui/test/mutate.mjs`:

```js
  {
    what: "a car's position stops depending on its road",
    file: "src/traffic.ts",
    from: "const t = ((now / CYCLE_MS) + phase) % 1;",
    to: "const t = (now / CYCLE_MS) % 1;",
    suite: "test:traffic",
  },
  {
    what: "cars drive on containment roads too",
    file: "src/traffic.ts",
    from: "this.roads = roads.filter((r) => r.from && r.to);",
    to: "this.roads = roads;",
    suite: "test:traffic",
  },
```

- [x] **Step 2: Run the mutation runner**

Run: `cd ui && npm run test:mutate`
Expected: **8 mutations · 8 caught · 0 unaccounted for.**

If either new one reports `SURVIVES`, the assertion it should have broken is
missing — add it to `ui/test/traffic.test.ts` and run again. Do not add
`survives: true` to make the runner green; that escape hatch exists for a
*recorded* limit, and this is a defect.

- [x] **Step 3: Confirm the tree is unchanged after the run**

Run: `git status --porcelain`
Expected: no output. The runner restores every file it mutates; a modified file
here means a mutation's anchor text did not match and it was skipped as `STALE`.

- [x] **Step 4: Commit**

```bash
git add ui/test/mutate.mjs
git commit -m "Two mutations that a car must fail

A car whose position does not depend on its road, and cars driving on
containment roads. Both are claims the map would then be making wrongly."
```

---

## Self-review

**Spec coverage.** The spec's section 1 asks for: a car per import road, importer →
imported, speed tied to the road, one per *road* not per statement, no cars on
containment, generated art, and determinism. Tasks 1–5 cover every one; the
speed clause is in `CYCLE_MS` and its doc, and the per-road-not-per-statement
rule is in task 3's header and asserted by `carAt`'s purity test.

**What this plan does not do, deliberately.** The spec's features 2–5 (failing-test
figures, admitting idleness, ambient motion, time of day) are **separate
subsystems with their own plans**. This one produces working, testable software on
its own: after task 5 the town has traffic and nothing else has changed.

**Type consistency.** `RoadLine.from`/`to` are introduced in task 2 and consumed
in task 3 by `Traffic.sync`. `carAt(road, now)` is introduced in task 3 and used
in task 3's `update` and task 5's mutation. `DEPTH.traffic` is introduced in
task 4 and used only there. No name is used before it is defined.

**Corrections made to this plan before execution.** Four, each found by checking
a claim against the tree rather than by re-reading it:

1. **`test:mutate` said 6 caught in Global Constraints and 8 in task 5.** Task 5
   is right — 6 today plus the 2 this plan adds. Fixed.
2. **Task 1 pointed at `imports.go`.** The literal is at `layout.go:691`, inside
   `importRoads` declared at `layout.go:651`, and the pair ordering that makes
   `From`/`To` meaningful is already there. Task 1 now names the file, the
   function, the line, and the exact edit.
3. **`P.metal[2]` was passed straight to `fillStyle`.** `P.metal` is a `Ramp` of
   four hex strings, so the index is valid and the *type* is wrong;
   `Graphics.fillStyle` takes a number. That compiles, renders nothing, and reads
   as correct. Now converted with Phaser's own `HexStringToColor`.
4. **A duplicated `fillStyle` line was documented as a wart to remove in task 4,
   and task 4 had no such step.** Rather than leave a promise the plan does not
   keep, the duplicate is gone and the reason the body is flat is a comment.

## What actually differed, executing this

Every box above is ticked, but six steps did not run as written. Recorded here
because ticking a box that does not describe what happened is the same defect
this repository's `commenttruth` exists to catch, applied to a plan.

1. **`RoadLine` is `{ax, ay, bx, by, halfWidth}`**, not the `{a: Point, b: Point}`
   the Interfaces block shows. Every fixture in task 3 was corrected.
2. **`Phaser.Display.Color.HexStringToColor` cannot be used.** Every other
   `src/` module lets Phaser tree-shake away, which is *why* these suites run
   under `node --test`; reaching for it for one value drags in the browser build,
   which touches `window` while initialising. Used
   `Number.parseInt(hex.slice(1), 16)`, the form `scene.ts` and `workers.ts`
   already use.
3. **Task 4's depth is per-car, not a `DEPTH.traffic` constant.** The plan says
   to find the value by looking; looking showed road bands are painted into the
   *ground texture*, so a car is a ground-plane object and has to sort among the
   buildings by screen position. The town spans thousands of pixels of y, so no
   constant can be right.
4. **Task 5's car is 14×5 in a new `P.traffic`, not 6×2 in `P.metal[2]`.** At
   6×2 in the metal ramp — the value of a building's own windows — nine cars
   looked identical to no cars at all. Measured: 32 visible pixels per frame
   before, 154 after.
5. **`drivenRoads` was extracted out of `sync`.** The plan's own containment
   mutation *survived* as written, because the filter was only reachable through
   a constructor needing a live scene. The plan said a survivor is a defect to
   be fixed, not recorded.
6. **`CYCLE_MS` was a fixed 9000 under a comment claiming the opposite.** The
   liveliness spec asks for "a speed tied to the road's length"; a later review
   found the constant never was. Now proportional, with a 1500ms floor.

Two further defects were found only by looking at the rendered town, which is
the check the plan asked for and the one most easily skipped: the car's centred
rectangle started at a half-pixel and antialiased into something that literally
looked like two lines, and `roadsAsLines` took `b` as the midpoint of the near
edge, which made the line's length a function of the road's *thickness* — a
53px road produced a 2.2px line.
