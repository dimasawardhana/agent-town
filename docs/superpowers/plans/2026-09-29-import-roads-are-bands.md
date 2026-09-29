# Import Roads Are Bands, Not Boxes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an import road claim only the ground it actually connects, so the map stops drawing roads over buildings that have nothing to do with the import.

**Architecture:** Today `importRoads` emits the axis-aligned bounding box between two building centres. A box cannot express a diagonal, so a diagonal import paints a square — and that square lands on whatever buildings happen to be inside it. This plan gives `Road` an explicit **centre line** (`ax, ay, bx, by`), trimmed to where the centre-to-centre line leaves each plot, and makes the renderer draw that line rather than the box. Row and district roads are untouched: they really are areas, not bands.

**Tech Stack:** Go 1.x (`internal/analyzer`), TypeScript 5 + Phaser 3 (`ui/src`), `node --test` via esbuild for UI tests.

**Spec:** this document. Read it end to end before starting — the numbers in *Why* are measured against this repository, and the steps below are written against file and line locations that were checked against the tree rather than assumed.

---

## Why

Measured on this repository by running the analyzer, and computing the band each
road should carry: the centre-to-centre line, trimmed by the standard slab exit
to where it leaves each plot, 8 units wide.

| import road | rect today | painted today | band length | a band paints | wrongly crosses |
|---|---|---|---|---|---|
| `ui/src → ui/src/art` | 122×8 | 976 | 14 | 112 | — |
| `ui/src/art → ui/src` | 122×8 | 976 | 14 | 112 | — |
| `ui/test → ui/src` | 8×122 | 976 | 14 | 112 | — |
| `ui/test → ui/src/art/props` | 122×8 | 976 | 28 | 224 | — |
| `ui/test → ui/src/art` | 122×122 | 14,884 | 20 | 158 | — |
| `internal/analyzer → internal/town` | 108×108 | 11,664 | 30 | 238 | — |
| `ui/src → ui/src/art/props` | 122×122 | 14,884 | 40 | 317 | — |
| `ui/src/art → ui/src/art/props` | 236×122 | 28,792 | 159 | 1,270 | — |
| `ui/src/art/props → ui/src/art` | 236×122 | 28,792 | 159 | 1,270 | — |
| **total** | | **102,920** | | **3,813** | **none** |

**102,920 square units of road become 3,813 — 27× less ground — and no band
crosses a building that is not one of its two endpoints.**

The four axis-aligned roads come out at exactly 14 units: the real gap between
`ui/src` (174–274) and `ui/src/art` (288–388). Today they paint 122 units, so
57 units of each end is road drawn *underneath the building it serves*.

The diagonals are where it goes wrong. Each rectangle covers buildings that are
not part of the import at all:

- `ui/src → ui/src/art/props` paints road **over `ui` and `ui/test`**
- `ui/src/art → ui/src/art/props` paints over **`ui`, `ui/src`, `ui/test`**
- `internal/analyzer → internal/town` paints over **`internal/agent/extension` and `internal/web`**

A map that draws a road labelled "these two are connected" across three
buildings it is not connected to is making a claim about the repository that is
false. ADR-0012's rule is that the layout is the single source of truth, and a
layout that draws a connection over the wrong building makes every consumer
worse, not just the browser.

**Trimming fixes all of it, and no router is needed or wanted.** A straight band
between two plot edges is a claim the analyzer can actually back up; a path
planned around intervening buildings would be a guess about how traffic flows,
which is not a thing this analyzer knows.

## Global Constraints

- **The town is a pure function of the analysis and the event stream** (ADR-0012). The browser never re-derives road geometry; the band travels the wire.
- **Determinism is absolute.** No `Math.random()`, nothing may depend on map-iteration order. `importRoads` already sorts its pairs; the band is computed per pair from that same sorted list.
- **Row and district roads do not change.** They are areas, not bands. They keep carrying only `x/y/w/h` and the renderer keeps filling them.
- **Generated art costs no cels.** Road tiles already exist in the atlas; this plan reuses them and adds none.

- **The rectangle stays on the wire** as the road's extent. It is what `turnLayout`, the camera bounds and four existing Go tests read. It is *derived* from the band, and task 1 adds the test that says so.
- Repo house style: heavy explanatory comments explaining **why** and what would break otherwise. Every new comment is checked by `ui/test/commenttruth.test.ts`.
- Verification commands, from the repository root:
  - `go test ./... -count=1`
  - `cd ui && npm test`
  - `cd ui && npm run test:mutate` — must report 8 caught, 0 unaccounted for
  - `cd ui && ./node_modules/.bin/tsc --noEmit -p tsconfig.json`
  - `gofmt -l ./internal/` — must print nothing

---

### Task 1: The analyzer emits a band, trimmed to the plots

**Files:**
- Modify: `internal/analyzer/layout.go` — the `Road` struct (declared at `layout.go:148`) and `importRoads` (declared at `layout.go:665`; the literal is at `layout.go:699`)
- Test: `internal/analyzer/layout_test.go`

**Interfaces:**
- Consumes: `byPath` (`map[string]Site`), already built in `importRoads`.
- Produces:
  ```go
  type Road struct {
      X float64 `json:"x"`
      Y float64 `json:"y"`
      W float64 `json:"w"`
      H float64 `json:"h"`
      Kind string `json:"kind"`
      From string `json:"from,omitempty"`
      To   string `json:"to,omitempty"`
      // Ax, Ay, Bx, By are the two ends of a band's centre line, in the same
      // world units as X/Y, for the road kinds that join two places. Empty for
      // "row" and "district", which are areas rather than bands.
      Ax float64 `json:"ax,omitempty"`
      Ay float64 `json:"ay,omitempty"`
      Bx float64 `json:"bx,omitempty"`
      By float64 `json:"by,omitempty"`
  }
  ```
  and
  ```go
  // bandBetween is the centre line from one plot to another, trimmed to where
  // the centre-to-centre line leaves the first plot and enters the second.
  func bandBetween(from, to Site) (ax, ay, bx, by float64)
  ```

- [ ] **Step 1: Write the failing test**

Append to `internal/analyzer/layout_test.go`. `TestRowRoadsDoNotRunOverAPlacing`-style precedent exists at line 1056; this is the same invariant for import roads.

```go
// An import road crosses no building other than the two it connects.
//
// This is the invariant a bounding box cannot hold. The box between two
// building centres is axis-aligned, so a diagonal import paints a square, and
// the square lands on whatever is inside it — on this repository
// `ui/src -> ui/src/art/props` drew road over `ui` and `ui/test`, which are
// not part of that import at all. A map that draws a connection across
// buildings it is not connected to is asserting something false about the
// repository, which is the one thing this map is not allowed to do.
func TestImportRoadsCrossNoOtherBuilding(t *testing.T) {
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
	mk("ui/src/a.ts", "import { x } from \"../art\";\n")
	mk("ui/src/art/b.ts", "import { y } from \"../props\";\n")
	mk("ui/src/art/props/c.ts", "export const z = 1;\n")
	mk("ui/test/d.ts", "import { x } from \"../src/a\";\n")

	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	l := LayoutTown(town)

	byPath := map[string]Site{}
	for _, s := range l.Sites {
		if s.Path != "" {
			byPath[s.Path] = s
		}
	}

	seen := 0
	for _, r := range l.Roads {
		if r.Kind != "import" {
			continue
		}
		seen++
		if r.Ax == 0 && r.Ay == 0 && r.Bx == 0 && r.By == 0 {
			t.Fatalf("an import road carries no band: %+v", r)
		}
		for _, s := range l.Sites {
			if s.Kind != PlaceBuilding || s.Path == r.From || s.Path == r.To {
				continue
			}
			if bandCrosses(r, s, 4) {
				t.Errorf("import %s -> %s runs across the %s plot at %v,%v %vx%v",
					r.From, r.To, s.Path, s.X, s.Y, s.W, s.H)
			}
		}
	}
	if seen == 0 {
		t.Fatal("no import road was emitted; the fixture does not exercise this")
	}
}

// bandCrosses is whether a band of the given half-width touches a plot.
func bandCrosses(r Road, s Site, half float64) bool {
	dx, dy := r.Bx-r.Ax, r.By-r.Ay
	len2 := dx*dx + dy*dy
	for _, c := range [][2]float64{{s.X, s.Y}, {s.X + s.W, s.Y}, {s.X, s.Y + s.H}, {s.X + s.W, s.Y + s.H}} {
		t := 0.0
		if len2 > 0 {
			t = ((c[0]-r.Ax)*dx + (c[1]-r.Ay)*dy) / len2
			t = math.Max(0, math.Min(1, t))
		}
		if math.Hypot(c[0]-(r.Ax+dx*t), c[1]-(r.Ay+dy*t)) <= half {
			return true
		}
	}
	return false
}
```

Add `"math"` to the test file's import block if it is not already there.

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./internal/analyzer/ -run TestImportRoadsCrossNoOtherBuilding -v -count=1`
Expected: FAIL — `r.Ax undefined (type Road has no field or method Ax)`.

- [ ] **Step 3: Add the four fields to `Road`**

Replace the struct at `layout.go:148-172` with the one in the Interfaces block. Use the doc comment verbatim. **`X/Y/W/H` keep their existing meaning** — the road's extent — and are still what `turnLayout` and the camera bounds read.

- [ ] **Step 4: Write `bandBetween`**

Place it immediately above `importRoads` in `layout.go`:

```go
// bandBetween is the centre line from one plot to another, trimmed to where the
// centre-to-centre line leaves the first plot and enters the second.
//
// **Why trimmed.** An untrimmed line runs from the middle of one building to
// the middle of the other, so most of its length is under the two buildings it
// connects — drawn as road, that is road painted over the building it belongs
// to. Trimming to the plot edges leaves exactly the gap, which on this
// repository is 14 units between neighbouring plots.
//
// **Why a straight line and not a route.** A router would thread the band
// between intervening buildings, and it would be a guess: the analyzer knows
// which buildings import which, not how traffic would go. A straight band
// between two plot edges is the one thing it can say without inventing.
func bandBetween(from, to Site) (ax, ay, bx, by float64) {
	fx, fy := from.X+from.W/2, from.Y+from.H/2
	tx, ty := to.X+to.W/2, to.Y+to.H/2
	dx, dy := tx-fx, ty-fy
	d := math.Hypot(dx, dy)
	if d < 1e-9 {
		// Two plots at the same centre cannot happen, and a zero-length band
		// would make every downstream projection divide by its own length.
		return fx, fy, fx, fy
	}
	ux, uy := dx/d, dy/d
	// How far the ray leaves a plot's box, in a given direction. This is the
	// standard slab exit rather than a matter of picking which face the ray is
	// heading for: picking a face means asking which way the ray is going, and
	// getting that wrong returns the plot's *centre* — the very bug this plan
	// exists to remove, reintroduced one level down.
	//
	// `dir` is +1 for the plot the ray leaves and -1 for the plot it enters.
	exit := func(s Site, dir float64) (float64, float64) {
		cx, cy := s.X+s.W/2, s.Y+s.H/2
		t := math.Inf(1)
		if math.Abs(ux) > 1e-9 {
			t = math.Min(t, (s.W/2)/math.Abs(ux))
		}
		if math.Abs(uy) > 1e-9 {
			t = math.Min(t, (s.H/2)/math.Abs(uy))
		}
		if math.IsInf(t, 1) {
			t = 0
		}
		return cx + ux*t*dir, cy + uy*t*dir
	}
	aX, aY := exit(from, 1)
	bX, bY := exit(to, -1)
	return aX, aY, bX, bY
}
```

- [ ] **Step 5: Emit the band and derive the extent from it**

In `importRoads`, replace the literal at `layout.go:699-706` with:

```go
		ax, ay, bx, by := bandBetween(c, p)
		l.Roads = append(l.Roads, Road{
			X:    math.Min(ax, bx) - band/2,
			Y:    math.Min(ay, by) - band/2,
			W:    math.Abs(bx-ax) + band,
			H:    math.Abs(by-ay) + band,
			Kind: "import",
			// e[0] imports e[1]. The ordering is already the direction, so this
			// records a fact the layout had rather than computing a new one.
			From: e[0],
			To:   e[1],
			Ax:   ax,
			Ay:   ay,
			Bx:   bx,
			By:   by,
		})
```

The extent is now the **band's** bounding box rather than the centre-to-centre box, so every downstream rect consumer shrinks along with it. The road gets narrower and shorter at the same time, which is the point.

- [ ] **Step 6: Add the test that keeps the extent honest**

Append to `internal/analyzer/layout_test.go`:

```go
// A road's rectangle is the band it actually carries, not a second opinion.
//
// They are two fields describing one thing, and the only defence against them
// drifting is a test that says they agree. The renderer draws the band; the
// extent is what the camera bounds and the turn read. If they disagree, the
// map shows one road and measures another.
func TestARoadsExtentIsItsBand(t *testing.T) {
	town, err := Analyze("..")
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range LayoutTown(town).Roads {
		if r.Kind != "import" {
			continue
		}
		const band = 8.0
		wantX := math.Min(r.Ax, r.Bx) - band/2
		wantY := math.Min(r.Ay, r.By) - band/2
		wantW := math.Abs(r.Bx-r.Ax) + band
		wantH := math.Abs(r.By-r.Ay) + band
		if math.Abs(r.X-wantX) > 0.01 || math.Abs(r.Y-wantY) > 0.01 ||
			math.Abs(r.W-wantW) > 0.01 || math.Abs(r.H-wantH) > 0.01 {
			t.Errorf("import %s -> %s: extent %.1f,%.1f %.1fx%.1f but band gives %.1f,%.1f %.1fx%.1f",
				r.From, r.To, r.X, r.Y, r.W, r.H, wantX, wantY, wantW, wantH)
		}
	}
}
```

`Analyze("..")` is the repository root, which is what `TestImportRoadsOnThisRepository` (line 1201) already does — copy its exact argument if it differs.

- [ ] **Step 7: Run the analyzer suite**

Run: `go test ./internal/analyzer/ -count=1`
Expected: all `ok`. `TestImportRoadsOnThisRepository` counts roads and asserts extents are positive; both still hold.

- [ ] **Step 8: Run the whole Go suite and gofmt**

Run: `go test ./... -count=1 && gofmt -l ./internal/`
Expected: all packages `ok`, gofmt prints nothing.

- [ ] **Step 9: Measure the change, and record it**

Run:
```bash
go run ./cmd/analyze --dir . > /tmp/after.txt
```
Expected: the nine import roads' painted area drops from 102,920 to about 3,813 square units. Put the number in the commit body. A change to every road on the map that is not measured is a guess.

- [ ] **Step 10: Commit**

```bash
git add internal/analyzer/layout.go internal/analyzer/layout_test.go
git commit -m "An import road is the line between two plots, not the box around them

A bounding box cannot express a diagonal, so a diagonal import painted a
square, and the square landed on whatever was inside it: ui/src ->
ui/src/art/props drew road over ui and ui/test, which are not part of that
import. The map was claiming a connection across buildings it has none.

The band is the centre-to-centre line trimmed to where it leaves each plot.
Measured on this repository that is 102,920 square units of road down to
3,813 — 27 times less ground — and no band crosses a building other than
the two it connects."
```

---

### Task 2: The turn carries the band

**Files:**
- Modify: `ui/src/view.ts` — `turnLayout` (declared at `view.ts:223`; the roads map is `view.ts:239`, the shift is `view.ts:247`)

**Interfaces:**
- Consumes: `ax/ay/bx/by` from task 1.
- Produces: a turned layout whose bands are turned and shifted exactly as the rects are.

- [ ] **Step 1: Write the failing test**

Append to `ui/test/turnroads.test.ts`:

```ts
test("a turn carries the road's band with it", () => {
  const turned = turnLayout(1, layout) as Fixture & {
    roads: (Fixture["roads"] & { ax?: number; ay?: number; bx?: number; by?: number })[];
  };
  const before = layout.roads[0] as Fixture["roads"][number] & { ax: number; ay: number; bx: number; by: number };
  before.ax = 40;
  before.ay = 150;
  before.bx = 300;
  before.by = 150;
  const after = turned.roads[0];
  // Turn 0 is the identity, so an unchanged band means the turn forgot it.
  const moved = after.ax !== before.ax || after.ay !== before.ay ||
    after.bx !== before.bx || after.by !== before.by;
  const shifted = after.ax !== undefined && (after.ax !== before.ax || after.ay !== before.ay);
  assert.ok(moved || shifted, "the band was left in the old frame while the rect turned");
  assert.equal(typeof after.bx, "number", "the turn dropped the band's far end entirely");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ui && npm run test:turnroads`
Expected: FAIL — `after.ax` is `undefined`.

- [ ] **Step 3: Turn the band**

In `ui/src/view.ts`, add a helper beside `turnRect`:

```ts
/** turnBand turns a band's two ends the same way turnRect turns a box.
 *
 *  A field the turn does not know about is a field that vanishes rather than
 *  one that drifts: `turnLayout` spreads the returned keys over the road, so a
 *  band the turn ignored would come back still in the old frame and the painter
 *  — correctly, following the layout it was given — would draw a road belonging
 *  to an orientation the town is no longer in. */
function turnBand(turn: Turn, r: { ax?: number; ay?: number; bx?: number; by?: number }) {
  if (typeof r.ax !== "number" || typeof r.bx !== "number") return {};
  const a = turnPoint(turn, r.ax, r.ay!);
  const b = turnPoint(turn, r.bx, r.by!);
  return { ax: a.x, ay: a.y, bx: b.x, by: b.y };
}
```

Then change `view.ts:239` to:

```ts
const roads = layout.roads?.map((r) => ({ ...r, ...turnRect(t, r), ...turnBand(t, r) }));
```

and `move` (`view.ts:247`) to shift the band too:

```ts
const move = <R extends WorldRect & { ax?: number; ay?: number; bx?: number; by?: number }>(r: R): R => ({
  ...r,
  x: r.x + shift.x,
  y: r.y + shift.y,
  ...(typeof r.ax === "number"
    ? { ax: r.ax + shift.x, ay: r.ay! + shift.y, bx: r.bx! + shift.x, by: r.by! + shift.y }
    : {}),
});
```

**The shift must be applied to the band as well as the rect.** A band left unshifted is a road drawn 400 pixels from where the layout says it is — visible, plausible, and wrong.

- [ ] **Step 4: Run the turnroads suite**

Run: `cd ui && npm run test:turnroads`
Expected: PASS.

- [ ] **Step 5: Run the UI suite and typecheck**

Run: `cd ui && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && npm test`
Expected: clean, every suite green.

- [ ] **Step 6: Commit**

```bash
git add ui/src/view.ts ui/test/turnroads.test.ts
git commit -m "A turn carries the road's band with it

Dropped here the band survives as unrotated numbers the painter still
believes: the road is drawn belonging to an orientation the town is not in,
and nothing says so."
```

---

### Task 3: The road line is the band

**Files:**
- Modify: `ui/src/view.ts` — `RoadLine` (declared at `view.ts:396`) and `roadsAsLines` (declared at `view.ts:420`)
- Test: `ui/test/turnroads.test.ts`

**Interfaces:**
- Consumes: `ax/ay/bx/by` from task 1, already turned by task 2.
- Produces:
  ```ts
  export interface RoadLine {
    ax: number; ay: number; bx: number; by: number;
    halfWidth: number;
    from?: string;
    to?: string;
  }
  ```

- [ ] **Step 1: Write the failing test**

Append to `ui/test/turnroads.test.ts`:

```ts
test("a road line follows the band, not the rectangle around it", () => {
  const project = (x: number, y: number) => ({ x: (x - y) / 2, y: (x + y) / 4 });
  const [line] = roadsAsLines(
    [
      {
        x: 0, y: 0, w: 122, h: 122, kind: "import",
        from: "a", to: "b",
        // A band from A's plot edge to B's — far shorter than the rectangle.
        ax: 20, ay: 20, bx: 100, by: 100,
      },
    ],
    project,
  );
  const bandLen = Math.hypot(line.bx - line.ax, line.by - line.ay);
  const rectLen = Math.hypot(project(122, 122).x - project(0, 0).x, project(122, 122).y - project(0, 0).y);
  assert.ok(
    bandLen < rectLen * 0.75,
    `the line is ${bandLen.toFixed(1)}px — the ${rectLen.toFixed(1)}px rectangle is still driving it`,
  );
  assert.equal(line.halfWidth, 4, "a band's width is its thickness, not its length");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ui && npm run test:turnroads`
Expected: FAIL — the line still spans the rectangle.

- [ ] **Step 3: Project the band when there is one**

In `roadsAsLines`, change the parameter type to accept the band, and branch:

```ts
export function roadsAsLines(
  roads: readonly {
    x: number; y: number; w: number; h: number;
    kind?: string; from?: string; to?: string;
    ax?: number; ay?: number; bx?: number; by?: number;
  }[],
  project: (x: number, y: number) => { x: number; y: number },
): RoadLine[] {
```

Inside the loop, before the existing `horizontal`/`start`/`end` block:

```ts
    // A band is drawn as itself. Row and district roads have no band — they are
    // areas rather than joins between two places — and fall through to the
    // rectangle below exactly as they did before.
    if (typeof r.ax === "number" && typeof r.bx === "number") {
      const a = project(r.ax, r.ay!);
      const b = project(r.bx, r.by!);
      out.push({
        ax: a.x, ay: a.y, bx: b.x, by: b.y,
        halfWidth: Math.max(3, (r.kind === "import" ? IMPORT_BAND : r.kind === "containment" ? CONTAINMENT_BAND : 8) / 2),
        from: r.from, to: r.to,
      });
      continue;
    }
```

**`halfWidth` for a band is the band's own width, not the rectangle's short side.** They coincide for a rectangle that *is* a band and differ for one that is not, which is the whole point. Use a named constant per kind:

```ts
/** The width of an import band, in world units. Matches `band` in the analyzer. */
const IMPORT_BAND = 8.0;
/** The width of a containment band. Matches the analyzer's own band. */
const CONTAINMENT_BAND = 8.0;
```

If the analyzer's two band widths are in fact the same constant, say so in the comment and use one.

- [ ] **Step 4: Run the turnroads suite**

Run: `cd ui && npm run test:turnroads`
Expected: PASS.

- [ ] **Step 5: Run the routing suite**

Run: `cd ui && npm run test:routing`
Expected: PASS. `routing.test.ts` builds its own fixtures through `roadsAsLines`, so this is where a wrong `halfWidth` shows up.

- [ ] **Step 6: Commit**

```bash
git add ui/src/view.ts ui/test/turnroads.test.ts
git commit -m "The road line is the band

Row and district roads keep coming from their rectangle — they are areas, not
joins — and everything else is drawn as the line the daemon sent."
```

---

### Task 4: The ground is painted along the band

**Files:**
- Modify: `ui/src/scene.ts` — `paintRoads` (declared at `scene.ts:642`)
- Test: `ui/test/roads.test.ts`

**Interfaces:**
- Consumes: `ax/ay/bx/by` on `Layout["roads"]`, projected by `toCanvas`.
- Produces: the same ground texture, with bands painted along their line.

- [ ] **Step 1: Write the failing test**

`paintRoads` is private and needs a scene, so test the pure part: which tiles a band covers. Add to `ui/src/view.ts` an exported helper, and test that.

Append to `ui/test/turnroads.test.ts`:

```ts
test("a band paints the tiles it passes through, not the box around it", () => {
  // A band from (20,20) to (100,100) with a half-width of 4 crosses the
  // diagonal; the box it came from is 122x122 and covers the whole corner.
  const tiles = bandTiles(20, 20, 100, 100, 4, 24, 24);
  const xs = tiles.map((t) => t.wx);
  const ys = tiles.map((t) => t.wy);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  assert.ok(spanX < 100 && spanY < 100, `the band reached ${spanX}x${spanY} of tiles`);
  // And it must be continuous: a road with gaps in it is not a road.
  tiles.sort((a, b) => (a.wy - b.wy) || (a.wx - b.wx));
  for (let i = 1; i < tiles.length; i++) {
    const dx = Math.abs(tiles[i].wx - tiles[i - 1].wx);
    const dy = Math.abs(tiles[i].wy - tiles[i - 1].wy);
    assert.ok(dx <= 24 && dy <= 24, `tiles ${tiles[i - 1].wx},${tiles[i - 1].wy} and ${tiles[i].wx},${tiles[i].wy} are not adjacent`);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ui && npm run test:turnroads`
Expected: FAIL — `bandTiles` is not exported.

- [ ] **Step 3: Write `bandTiles` in `view.ts`**

```ts
/** bandTiles is every ground tile a band of the given half-width passes through.
 *
 *  Exported and pure because this is the difference between a road and a square,
 *  and it is the one piece of that decision that can be checked without a GPU:
 *  walk the tiles whose centre lies within `half` of the line, rather than
 *  filling the rectangle the line came in.
 *
 *  Tile centres, not tile intersections. A tile the line only clips at a corner
 *  is not road a reader can see, and painting it widens the band back towards
 *  the box this change exists to remove. */
export function bandTiles(
  ax: number, ay: number, bx: number, by: number,
  half: number, tileW: number, tileH: number,
): { wx: number; wy: number }[] {
  const out: { wx: number; wy: number }[] = [];
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  // Bounded by the box the band cannot leave, so the walk is O(area of the box)
  // rather than unbounded, and a degenerate band still terminates. This is the
  // same rectangle the old painter filled — used here as a bound and not as the
  // shape, which is the whole difference between the two versions.
  const x0 = Math.floor((Math.min(ax, bx) - half) / tileW) * tileW;
  const x1 = Math.ceil((Math.max(ax, bx) + half) / tileW) * tileW;
  const y0 = Math.floor((Math.min(ay, by) - half) / tileH) * tileH;
  const y1 = Math.ceil((Math.max(ay, by) + half) / tileH) * tileH;
  for (let wy = y0; wy < y1; wy += tileH) {
    for (let wx = x0; wx < x1; wx += tileW) {
      const cx = wx + tileW / 2;
      const cy = wy + tileH / 2;
      let t = 0;
      if (len2 > 0) {
        t = ((cx - ax) * dx + (cy - ay) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
      }
      if (Math.hypot(cx - (ax + dx * t), cy - (ay + dy * t)) <= half) {
        out.push({ wx, wy });
      }
    }
  }
  return out;
}
```

The doc comment above stays on the function; only the body was inlined here so
the block is valid TypeScript as written.


**The `x0/x1/y0/y1` bound is load-bearing.** Without it a band with `len2 === 0` loops once and a band with a tiny extent still walks its whole box — which is the cost this plan exists to remove.

- [ ] **Step 4: Use it in `paintRoads`**

In `scene.ts`, inside the `for (const r of l.roads ?? [])` loop at `scene.ts:647`, branch before the tile grid:

```ts
      // A band is painted along its line; the tile grid below is for the road
      // kinds that really are rectangles. `continue` rather than an `else` so
      // there is one place a band can be painted and one way it can be missed.
      if (typeof r.ax === "number" && typeof r.bx === "number") {
        for (const { wx, wy } of bandTiles(r.ax, r.ay!, r.bx, r.by!, BAND_HALF, TILE, TILE)) {
          const v = tileVariant(wx, wy);
          const key = groundFrame("road", v);
          const f = this.atlas[key];
          if (!f) continue;
          const [cx, cy] = toCanvas(wx, wy);
          ctx.drawImage(this.tileCanvas(key), Math.round(cx - f.ox), Math.round(cy - f.oy));
        }
        continue;
      }
```

**No kerb piece for a band.** `onEdge` picks a frame by comparing against a rectangle's faces, and a line has no faces. A band whose end tile got a kerb would show a kerb across its middle. The band's ends are inside the gaps between plots, where the surrounding tile already reads as an edge.

- [ ] **Step 5: Run the UI suite and typecheck**

Run: `cd ui && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && npm test`
Expected: clean, every suite green.

- [ ] **Step 6: Commit**

```bash
git add ui/src/view.ts ui/src/scene.ts ui/test/turnroads.test.ts
git commit -m "The ground is painted along the band

Walking tile centres within the band's half-width, rather than filling the
rectangle the line arrived in. A rectangle's kerb frame is chosen by comparing
against its faces, and a line has no faces, so a band takes the plain road tile
and lets the surrounding tile read as the edge."
```

---

### Task 5: Cars ride the trimmed band, and it is visible

**Files:**
- Modify: none expected. `traffic.ts` already reads `RoadLine.ax/ay/bx/by` and needs no change.
- Test: `ui/test/traffic.test.ts` (unchanged unless a name moved)

- [ ] **Step 1: Build and run, then look**

```bash
cd ui && ./node_modules/.bin/vite build && cd .. && go install ./cmd/townd
townd --port 7851 --dir "$PWD" &
```

Open `http://127.0.0.1:7851` and confirm:

- the import roads are now **thin bands** between the checkered areas, not squares;
- a band does **not** cross `ui` or `ui/test` when it connects `ui/src` to `ui/src/art/props`;
- cars move along the bands;
- cars are **visible** — the whole reason this plan exists.

- [ ] **Step 2: Measure the visibility, because "look at it" is not a number**

In the page console, with the town's scene reachable as the traffic layer holds:

```js
const t = window.__town.scene.scenes[0].traffic;
const c = document.querySelector('canvas'), ctx = c.getContext('2d');
const shot = () => ctx.getImageData(0, 0, c.width, c.height).data;
let total = 0, samples = 10;
for (let i = 0; i < samples; i++) {
  const a = shot();
  for (const [, g] of t.cars) g.setVisible(false);
  await new Promise(r => setTimeout(r, 120));
  const z = shot();
  for (const [, g] of t.cars) g.setVisible(true);
  for (let k = 0; k < a.length; k += 4) if (a[k] !== z[k] || a[k+1] !== z[k+1] || a[k+2] !== z[k+2]) total++;
  await new Promise(r => setTimeout(r, 240));
}
console.log('mean visible car pixels:', (total / samples).toFixed(0));
```

**Before this plan: 80. A result at or below 80 means the band is trimmed but the cars are still hidden — stop and find out why rather than recording a win.**

- [ ] **Step 3: Commit anything this task changed**

If nothing changed, there is nothing to commit. Do not manufacture a commit.

---

### Task 6: Prove the whole thing bites

**Files:**
- Modify: `ui/test/mutate.mjs`

- [ ] **Step 1: Add the mutations**

Append to the `MUTATIONS` array in `ui/test/mutate.mjs`:

```js
  {
    what: "a road band goes back to being its bounding box",
    file: "src/view.ts",
    from: "    if (typeof r.ax === \"number\" && typeof r.bx === \"number\") {",
    to: "    if (false) {",
    suite: "test:turnroads",
  },
  {
    what: "the band is painted as the rectangle around it",
    file: "src/view.ts",
    from: "      if (Math.hypot(cx - (ax + dx * t), cy - (ay + dy * t)) <= half) {",
    to: "      if (true) {",
    suite: "test:turnroads",
  },
```

The first mutates the branch in `roadsAsLines` back to the rectangle; the second makes `bandTiles` accept every tile in the box.

- [ ] **Step 2: Run the mutation runner**

Run: `cd ui && npm run test:mutate`
Expected: **10 mutations · 10 caught · 0 unaccounted for.**

If either reports `SURVIVES`, the assertion it should have broken is missing — add it to `ui/test/turnroads.test.ts` and run again. Do not add `survives: true` to make the runner green; that escape hatch exists for a *recorded* limit, and this is a defect.

- [ ] **Step 3: Confirm the tree is unchanged after the run**

Run: `git status --porcelain`
Expected: no output. A modified file means a mutation's anchor text did not match and it was skipped as `STALE`.

- [ ] **Step 4: Commit**

```bash
git add ui/test/mutate.mjs
git commit -m "Two mutations that a road must fail

A band that quietly reverts to its bounding box, and a band that paints every
tile in the box around it. Both are the exact regression this plan exists to
remove."
```

---

## Self-review

**Spec coverage.** Every step above was checked against the tree before it was written: the `Road` struct at `layout.go:148`, the import literal at `layout.go:699`, the containment literal at `layout.go:759`, `turnRect` at `view.ts:188`, the roads map at `view.ts:239`, `move` at `view.ts:247`, `RoadLine` at `view.ts:396`, `roadsAsLines` at `view.ts:420`, `paintRoads` at `scene.ts:642`, and the `TestRowRoadsDoNotRunOverAPlacing`-style precedent at `layout_test.go:1056`.

**What this plan deliberately does not do.**

- **Containment roads are not converted.** `layout.go:759` builds them the same way and they are wrong for the same reason, but "this sits inside that" is a claim about two adjacent plots and a containment band is short by construction. Converting them is its own ticket; this plan leaves the code path identical so that ticket is small.
- **No router.** A straight band is the only connection the analyzer can state without inventing one.
- **Row and district roads are untouched.** They are areas.
- **No new atlas cels.** Road tiles are reused.

**The one number this plan could not pre-compute** is task 5 step 2's visible-car-pixel count. Everything else in this document was measured against this repository before the plan was written; that one depends on the renderer, so it is specified as a threshold with a stop condition rather than an expected value.
