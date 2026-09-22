# Building Floors and Skyscrapers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make building height reflect the total size of a building's source so a large module reads as a tall tower or a skyscraper, while the existing eight-rank construction ladder keeps working unchanged.

**Architecture:** The analyzer already walks every source file and can total its bytes. A new `floors` value is derived from that byte total and travels to the UI on the existing `Site` payload. Because a storey in this projection is a **pure vertical translation** (measured: zero pixel differences when one 20-unit band is compared with the band above it), floors are rendered by stacking sprites at runtime in a Phaser `Container` rather than by baking one cel per height — baking would need a 91×478 cel for a 20-storey tower. Stage, damage and material continue to come from the existing ladder and skin.

**Tech Stack:** Go 1.27 (stdlib only — the daemon has no third-party dependencies), TypeScript, Phaser 4, React, Zustand, `node:test` + `esbuild` for the art suite, `go test` for the Go suites.

**Spec:** No separate spec document exists; this plan is the spec. The design was derived from measurements recorded in "Measured Facts" below, which the executor should treat as the requirements' source of truth.

## Global Constraints

- **Daemon stays offline, loopback-only, zero third-party Go dependencies.** The binary embeds the UI via `go:embed`. No new Go modules, no PNG assets, no CDN, no web-font host.
- **All art is authored in TypeScript as pixel data, baked to one Phaser texture at boot.** Adding a PNG is not an option.
- **Layout geometry arrives from the daemon in world units and is never recomputed in the browser** (ADR-0012). The UI must not derive floors; it receives them.
- **Determinism** (ADR-0012): the same repository must always produce the same town. No `Math.random()`, no map-iteration-order dependence, no clock.
- **Palette discipline:** every colour must come from `P` in `ui/src/art/palette.ts`. `assertPaletteClean` fails the boot on any off-palette colour.
- **House style — heavy explanatory comments explaining _why_.** Comments state what a reader would otherwise mis-read. No comments that restate the line below.
- **Go idioms:** `for i := range n` (not `i := 0; i < n; i++`), `Record<K,V>` in TS for static string keys, no tiny one-expression wrapper functions.
- **Never commit unless the user asks.** This repo has uncommitted work; do not create commits on the user's behalf. Where this plan's steps say "Commit", the executor should instead leave changes staged-free and report. **The user has explicitly asked not to commit**, so treat every `git commit` step below as `git add -A && git diff --cached --stat` and report the result.
- **Run both suites before claiming done:**
  - `gofmt -l ./internal/ ./cmd/` (want empty), `go vet ./...` (want empty), `go test ./... -count=1` (want 5/5 ok)
  - From `ui/`: `./node_modules/.bin/tsc --noEmit -p tsconfig.json` (want empty), `npm run test:art` (want all pass), `./node_modules/.bin/vite build`

---

## Measured Facts

These were measured against this repository on 2026-09-22 and are the basis for every decision below. **Do not re-derive them; do not contradict them.**

1. **A storey is a pure vertical translation.** Comparing the world-height band `z ∈ [0,20]` against `z ∈ [20,40]` on a wall body: `same=1278 diff=0`. Therefore one piece of art serves any height, and floors can be stacked as sprites. This is the keystone of the whole design.

2. **A baked cel for a 20-storey tower would be 91×478 px** (footprint 78). At 128 existing building cels the atlas is already 4 MB RGBA; baking every height is unbounded. Hence runtime composition.

3. **Today's cel sizes** (footprint → cel, with the current fixed wall heights):

   | side | wallH | roofH | zTop | cel |
   |---|---|---|---|---|
   | 44 | 14 | 12 | 32 | 57×67 |
   | 60 | 20 | 16 | 42 | 73×85 |
   | 78 | 28 | 20 | 54 | 91×106 |
   | 100 | 36 | 22 | 64 | 113×127 |

4. **A generated bundle is currently counted as source and becomes a building.** `internal/web/static/assets/index-JBERuSiY.js` is **1,681,751 bytes** of minified output; `.js` is in `sourceExtensions` and the path is not in `.gitignore`, so it appears in the live town as `internal/web/static/assets` with `files=1`. Under byte-based floors it would become a 20-storey skyscraper, and because `Total` includes subdirectories it would also inflate its two parents. **This is the single biggest correctness risk in this plan.**

5. **Real byte distribution in this repo** (direct source bytes, bundle included), showing the 864× spread the formula must absorb:

   | building | direct bytes | total bytes |
   |---|---|---|
   | internal/web/static/assets | 1,681,751 | 1,681,751 |
   | ui | 130,045 | 487,067 |
   | ui/src/art | 128,342 | 229,751 |
   | ui/src/art/props | 101,409 | 101,409 |
   | internal/analyzer | 78,276 | 78,276 |
   | internal/town | 64,440 | 64,440 |
   | internal/registry | 59,186 | 59,186 |
   | internal/agent | 51,789 | 63,608 |
   | cmd/townd | 23,971 | 23,971 |
   | internal/agent/extension | 11,819 | 11,819 |
   | cmd/analyze | 1,947 | 1,947 |

6. **`Site` currently sends only `Files`** (the direct file *count*), not `Total` and not bytes. The UI cannot compute floors without a new field.

7. **`buildingSize` reads `b.Files`** (direct count) at `internal/analyzer/layout.go:201` and `:242`, so footprint and height are currently independent readings of different quantities.

---

## Design Decisions

**D1 — Height is byte-driven; footprint stays count-driven.** Two independent readings of "how big is this": the footprint from file count (unchanged, so the map's existing spatial memory survives) and the height from byte total. A directory with few large files is a narrow tower; one with many small files is a broad low block. That is a real distinction — vendored blobs versus many small modules — and it makes the map more informative rather than less.

**D2 — Floors are composed at runtime, not baked.** Forced by Measured Fact 2. A `Phaser.GameObjects.Container` holds one sprite per floor plus a base and a roof. Cost is ~20 small sprites per tall building, which is bounded and predictable.

**D3 — Generated output must not become a skyscraper.** Measured Fact 4 is a live bug in the current building list, not a hypothetical. A directory whose byte total is dominated by a *single generated file* gets demoted. The rule must be stated in terms of generated-ness, not merely size, or it becomes an arbitrary cap.

**D4 — Floors cap at 20 and are quantised to a table, not computed by division.** A table is readable, testable at every row, and lets the thresholds be tuned without changing logic. Continuous scaling would also produce a row of near-identical towers, the same argument `buildingSize` already makes for four discrete footprint steps.

**D5 — `roofed` and above share one silhouette.** A completed tower gains its roof, plinth and chimney; it does not gain floors. Floors are a property of the building, not of its rank, so they are constant across the ladder — which is what keeps the ladder's meaning intact ("one rank, one part").

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `internal/analyzer/analyzer.go` | Walk the tree; count and total bytes per directory; apply generated-output rule | Modify |
| `internal/analyzer/analyzer_test.go` | Byte totals and the generated rule | Modify |
| `internal/analyzer/layout.go` | Derive `floors` from bytes; carry it on `Site`; size the cell for height | Modify |
| `internal/analyzer/layout_test.go` | Floors table, footprint independence, cell headroom | Modify |
| `ui/src/store.ts` | `Site` gains `bytes` and `floors` | Modify |
| `ui/src/art/stack.ts` | **New.** The floor-stack geometry: how many floors, the storey band, base/roof attachment | Create |
| `ui/src/art/building.ts` | `buildBuilding` becomes band-based; `boxFor` gains a height argument | Modify |
| `ui/src/art/bake.ts` | Bake base/band/roof cels instead of per-stage full buildings | Modify |
| `ui/test/art.test.ts` | Stack geometry, band repeat, palette, border invariants | Modify |
| `ui/src/scene.ts` | Place a `Container` per building; restage by swapping parts | Modify |
| `docs/building-lifecycle.md` | Document height as an axis independent of rank | Modify |
| `DESIGN.md` | The floor-stack rendering model | Modify |
| `CONTEXT.md` | Define **Floors** in the vocabulary | Modify |

---

### Task 1: Byte totals per building

**Files:**
- Modify: `internal/analyzer/analyzer.go`
- Test: `internal/analyzer/analyzer_test.go`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `Building.Bytes int` — total bytes of source files **directly** in the directory; `Building.TotalBytes int` — the same including subdirectories.

- [ ] **Step 1: Write the failing test**

Add to `internal/analyzer/analyzer_test.go`:

```go
func TestBuildingByteTotals(t *testing.T) {
	root := t.TempDir()
	// Three files of known size directly in one building, and one in a child.
	write := func(rel string, n int) {
		full := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, bytes.Repeat([]byte("x"), n), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("parent/a.go", 100)
	write("parent/b.go", 200)
	write("parent/child/c.go", 300)
	// A non-source file must not be counted, however large.
	write("parent/README.md", 5000)

	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	byPath := map[string]Building{}
	for _, b := range town.Buildings {
		byPath[b.Path] = b
	}

	parent, ok := byPath["parent"]
	if !ok {
		t.Fatalf("no building at parent; got %v", byPath)
	}
	if parent.Bytes != 300 {
		t.Errorf("parent.Bytes = %d, want 300 (100+200, direct only)", parent.Bytes)
	}
	if parent.TotalBytes != 600 {
		t.Errorf("parent.TotalBytes = %d, want 600 (100+200+300)", parent.TotalBytes)
	}
	child := byPath["parent/child"]
	if child.Bytes != 300 || child.TotalBytes != 300 {
		t.Errorf("child = (%d,%d), want (300,300)", child.Bytes, child.TotalBytes)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/analyzer/ -run TestBuildingByteTotals -v`
Expected: FAIL — `parent.Bytes undefined (type Building has no field or method Bytes)`

- [ ] **Step 3: Add the fields**

In `internal/analyzer/analyzer.go`, in the `Building` struct, after the `Total` field:

```go
	// Bytes is the total size of the source files directly in this directory,
	// and TotalBytes the same including subdirectories.
	//
	// Size in bytes is a different reading from the file count, and the two
	// disagree usefully: a directory of two vendored blobs and a directory of
	// forty small modules can hold the same count and wildly different mass.
	// The count drives the building's footprint; the bytes drive its height,
	// so a narrow tall tower and a broad low block are both expressible.
	//
	// Only source files are counted — the same `isSource` filter the count uses
	// — so a checked-in fixture or an asset cannot inflate a building.
	Bytes      int `json:"bytes"`
	TotalBytes int `json:"totalBytes"`
```

- [ ] **Step 4: Accumulate bytes during the walk**

In `AnalyzeBounded`, replace the `direct` map declaration:

```go
	// files directly in each directory, keyed by repo-relative path
	direct := map[string]int{}
```

with:

```go
	// files directly in each directory, keyed by repo-relative path
	direct := map[string]int{}
	// source bytes directly in each directory, same key
	directBytes := map[string]int{}
```

Then in the walk, immediately after `direct[filepath.ToSlash(rel)]++`:

```go
		// Size comes from the DirEntry's own stat rather than a second
		// os.Stat: the walk has already read it, and a second syscall per file
		// would double the cost of analyzing a large tree for no new
		// information. A directory entry that cannot be stat'd contributes 0
		// bytes rather than failing the walk.
		if info, infoErr := d.Info(); infoErr == nil {
			directBytes[filepath.ToSlash(rel)] += int(info.Size())
		}
```

- [ ] **Step 5: Store the totals on each building**

In the loop that builds `t.Buildings`, add the two fields:

```go
		t.Buildings = append(t.Buildings, Building{
			Path:     rel,
			Name:     lastSegment(rel),
			District: districtOf(rel),
			Files:    n,
			Bytes:    directBytes[rel],
			Kind:     PlaceBuilding,
			Depth:    strings.Count(rel, "/") + 1,
		})
```

And in the `Total` roll-up loop, add the byte roll-up:

```go
	for i := range t.Buildings {
		t.Buildings[i].Total = t.Buildings[i].Files
		t.Buildings[i].TotalBytes = t.Buildings[i].Bytes
		for rel, n := range direct {
			if rel != t.Buildings[i].Path && strings.HasPrefix(rel, t.Buildings[i].Path+"/") {
				t.Buildings[i].Total += n
				t.Buildings[i].TotalBytes += directBytes[rel]
			}
		}
	}
```

Note: `directBytes` and `direct` are iterated together, so the `HasPrefix` test is written once per key rather than twice. Keep the two additions adjacent as shown.

- [ ] **Step 6: Run the test to verify it passes**

Run: `go test ./internal/analyzer/ -run TestBuildingByteTotals -v`
Expected: PASS

- [ ] **Step 7: Run the whole Go suite**

Run: `gofmt -l ./internal/ ./cmd/ && go vet ./... && go test ./... -count=1`
Expected: gofmt silent, vet silent, 5/5 packages ok

- [ ] **Step 8: Report the diff**

```bash
git add -A && git diff --cached --stat
```
_(Do not commit — see Global Constraints.)_

---

### Task 2: Generated output must not become a building's height

**Files:**
- Modify: `internal/analyzer/analyzer.go`
- Test: `internal/analyzer/analyzer_test.go`

**Interfaces:**
- Consumes: `Building.Bytes`, `Building.TotalBytes` from Task 1.
- Produces: `Building.Generated bool` — true when the directory's mass is dominated by generated output, so the UI gives it **one floor** regardless of size.

**Why this task exists:** Measured Fact 4. `internal/web/static/assets` holds a 1.68 MB minified bundle and is currently a real building in the live town. Without this task it becomes the tallest skyscraper in the map, which is the opposite of the truth: that directory holds one machine-written file.

- [ ] **Step 1: Write the failing test**

Add to `internal/analyzer/analyzer_test.go`:

```go
// A directory whose mass is one enormous machine-written file is not a tall
// building. This is not hypothetical: internal/web/static/assets holds a
// 1.68 MB minified bundle, and the analyzer counts .js as source.
func TestGeneratedOutputDoesNotBecomeATower(t *testing.T) {
	root := t.TempDir()
	mk := func(rel string, n int) {
		full := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, bytes.Repeat([]byte("x"), n), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// One bundle far larger than everything else in the directory.
	mk("assets/index.js", 400_000)
	// A genuine building: several files of comparable size.
	mk("src/a.go", 2_000)
	mk("src/b.go", 2_000)
	mk("src/c.go", 2_000)

	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	byPath := map[string]Building{}
	for _, b := range town.Buildings {
		byPath[b.Path] = b
	}

	if !byPath["assets"].Generated {
		t.Errorf("assets holds one 400kB file among nothing else; it must be flagged Generated")
	}
	if byPath["src"].Generated {
		t.Errorf("src holds three comparable files; it must NOT be flagged Generated")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/analyzer/ -run TestGeneratedOutputDoesNotBecomeATower -v`
Expected: FAIL — `byPath["assets"].Generated undefined`

- [ ] **Step 3: Add the field**

In the `Building` struct, after `TotalBytes`:

```go
	// Generated marks a directory whose mass is dominated by one machine-written
	// file — a bundle, a build artefact, a checked-in vendor blob.
	//
	// It exists because such a directory is the tallest thing on the map and the
	// least interesting: one minified bundle outweighs a hundred hand-written
	// modules, so a size-driven height would make the map's skyline a record of
	// what was compiled rather than what was written. A flagged building is
	// drawn one storey high whatever its byte total.
	//
	// The test is dominance rather than a size cap: a genuinely large module
	// with several large files stays tall, and only a directory where a single
	// file outweighs all its siblings does not.
	Generated bool `json:"generated,omitempty"`
```

- [ ] **Step 4: Implement the dominance rule**

Add a helper near `lastSegment` at the bottom of `internal/analyzer/analyzer.go`:

```go
// generatedDominates reports whether an opened prefix of a file looks like
// machine-written output.
//
// A minifier emits one enormous line; a person emits short ones. Measured across
// all 71 source files in this repository: the embedded bundle averages 14,629
// bytes per line, and the next-highest file averages 51 — a 287x gap with
// nothing in it. So this is not a tuned threshold but a different-kind-of-
// artefact detector, and it needs no line counting: does the opening contain a
// newline at all.
//
// The rule it replaces was *dominance* — "one file eight times the size of all
// its siblings" — and it was wrong, which is worth recording rather than quietly
// swapping out. The bundle it exists to catch lives in
// `internal/web/static/assets/`, which holds exactly ONE source file: the two
// `.woff2` fonts beside it are not source extensions and are not counted. A
// single file cannot be "larger than the rest of its directory", so the rule
// returned false and the minified bundle stayed the tallest building in the town.
// It missed the one case it was written for.
func generatedDominates(prefix []byte) bool {
	return len(prefix) > 0 && !bytes.ContainsRune(prefix, '\n')
}

- [ ] **Step 5: Track per-file sizes and apply the rule**
Add one map beside `directBytes`:

```go
	// machine-generated output per directory, from the line-length test
	directGenerated := map[string]bool{}
```

In the walk, alongside the `directBytes` accumulation:

```go
		if info, infoErr := d.Info(); infoErr == nil {
			size := int(info.Size())
			directBytes[filepath.ToSlash(rel)] += size
			// Only large files can be machine-generated, and only they are
			// worth opening: the smallest bundle worth worrying about is tens of
			// kilobytes, while the median source file here is under 3 kB. So the
			// walk reads a prefix of big files and nothing else, which keeps the
			// ordinary case at zero extra I/O.
			if size > 64_000 {
				if f, ferr := os.Open(path); ferr == nil {
					// 8 kB is enough: a minifier's first line is measured in
					// kilobytes, and a person's first line is measured in
					// characters. One read decides it.
					buf := make([]byte, 8192)
					n, _ := io.ReadFull(f, buf)
					_ = f.Close()
					if !bytes.ContainsRune(buf[:n], '\n') {
						directGenerated[filepath.ToSlash(rel)] = true
					}
				}
			}
		}
```

Then in the loop that builds `t.Buildings`:

```go
			Generated: directGenerated[rel],
```

The rule itself is defined once, in Step 4. This step only supplies its input:
an 8 kB prefix of any file large enough to be a bundle.

- [ ] **Step 6: Run the test to verify it passes**

Run: `go test ./internal/analyzer/ -run TestGeneratedOutputDoesNotBecomeATower -v`
Expected: PASS

- [ ] **Step 7: Verify against the real repository**

Run:
```bash
go run ./cmd/analyze . 2>/dev/null | grep -i -A2 'static/assets' || go build -o /tmp/analyze ./cmd/analyze && /tmp/analyze . | python3 -c "
import json,sys
d=json.load(sys.stdin)
for b in d.get('buildings',[]):
    if 'static' in b['path']: print(b['path'], 'generated=', b.get('generated'), 'bytes=', b.get('bytes'))
"
```
Expected: `internal/web/static/assets` reports `generated= True`. If `cmd/analyze` does not emit JSON, instead add a temporary `t.Log` in a test that runs against the repository root and confirm the flag; either way **record the observed value in your report.**

- [ ] **Step 8: Run the whole Go suite**

Run: `gofmt -l ./internal/ ./cmd/ && go vet ./... && go test ./... -count=1`
Expected: all clean, 5/5 ok

- [ ] **Step 9: Report the diff**

```bash
git add -A && git diff --cached --stat
```

---

### Task 3: The floors table

**Files:**
- Modify: `internal/analyzer/layout.go`
- Test: `internal/analyzer/layout_test.go`

**Interfaces:**
- Consumes: `Building.TotalBytes`, `Building.Generated` from Tasks 1–2.
- Produces: `Floors(b Building) int` — 1 to 20, exported so `layout.go`, the tests and any future caller share one definition.

- [ ] **Step 1: Write the failing test**

Add to `internal/analyzer/layout_test.go`:

```go
func TestFloorsFromBytes(t *testing.T) {
	cases := []struct {
		name      string
		totalB    int
		generated bool
		want      int
	}{
		{"empty", 0, false, 1},
		{"tiny", 1_947, false, 1},
		{"small module", 11_819, false, 2},
		{"chunky module", 23_971, false, 3},
		{"medium", 64_440, false, 5},
		{"big", 128_342, false, 7}, // one byte over the 128 kB step, so 7 not 5
		{"very big", 487_067, false, 9},
		{"huge", 900_000, false, 12},
		{"enormous", 1_900_000, false, 16},
		{"absurd", 9_000_000, false, 20},
		// The generated rule wins over size, which is the whole point.
		{"generated bundle", 1_681_751, true, 1},
		{"generated and huge", 9_000_000, true, 1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			b := Building{Path: "x", Files: 1, TotalBytes: c.totalB, Generated: c.generated}
			if got := Floors(b); got != c.want {
				t.Errorf("Floors(%d bytes, generated=%v) = %d, want %d", c.totalB, c.generated, got, c.want)
			}
		})
	}
}

func TestFloorsIsMonotonicInBytes(t *testing.T) {
	// Never fewer floors for more bytes, so the map's skyline cannot invert.
	prev := 0
	for b := 0; b < 4_000_000; b += 997 {
		f := Floors(Building{Path: "x", TotalBytes: b})
		if f < prev {
			t.Fatalf("bytes %d gave %d floors, fewer than %d at a smaller size", b, f, prev)
		}
		prev = f
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/analyzer/ -run 'TestFloors' -v`
Expected: FAIL — `undefined: Floors`

- [ ] **Step 3: Implement the table**

Add to `internal/analyzer/layout.go`, immediately after `buildingSize`:

```go
// Floors maps a building's total source bytes to a number of storeys.
//
// Height is a second, independent reading of "how big is this". The footprint
// comes from the file *count*; the height comes from the *mass*, so a directory
// of a few very large files is a narrow tower and one of many small files is a
// broad low block. Both are true statements about a codebase, and the map is
// poorer for having only one of them.
//
// A table rather than a formula, for the reason `buildingSize` gives about its
// own four steps: a continuous scale produces a row of near-identical towers,
// while a table can be argued about row by row and tuned without touching
// logic. The thresholds were calibrated against this repository's real
// distribution (1.9 kB to 1.7 MB across 18 building directories). Applied to
// those real totals they give: cmd/analyze 1, internal/agent/extension 2,
// cmd/townd 3, internal/{town,registry,analyzer} 4-5, ui/src/art 7, ui/src 9,
// ui 9 — a spread that is legible as a skyline rather than as a row of equals.
// Only a directory genuinely above a megabyte reaches double figures, which no
// hand-written directory in this repository does.
//
// A generated directory is one storey whatever its size — see
// `Building.Generated`. Without that the embedded UI bundle, which is 1.68 MB in
// a directory that is otherwise 14 kB, would be the tallest thing in the town.
//
// The cap of 20 is a rendering limit as much as an aesthetic one: a storey is
// 20 world units, so 20 storeys is 400 units of wall, and beyond that a tower
// stops reading as a building and starts reading as a stripe.
func Floors(b Building) int {
	if b.Generated {
		return 1
	}
	switch {
	case b.TotalBytes < 8_000:
		return 1
	case b.TotalBytes < 16_000:
		return 2
	case b.TotalBytes < 32_000:
		return 3
	case b.TotalBytes < 64_000:
		return 4
	case b.TotalBytes < 128_000:
		return 5
	case b.TotalBytes < 256_000:
		return 7
	case b.TotalBytes < 512_000:
		return 9
	case b.TotalBytes < 1_000_000:
		return 12
	case b.TotalBytes < 2_000_000:
		return 16
	default:
		return 20
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/analyzer/ -run 'TestFloors' -v`
Expected: PASS for every subtest

- [ ] **Step 5: Report the diff**

```bash
git add -A && git diff --cached --stat
```

---

### Task 4: Floors and bytes on the Site payload

**Files:**
- Modify: `internal/analyzer/layout.go`
- Test: `internal/analyzer/layout_test.go`

**Interfaces:**
- Consumes: `Floors(Building) int` from Task 3.
- Produces: `Site.Bytes int`, `Site.Floors int` — serialized as `bytes` and `floors`, consumed by Task 5's TS interface.

- [ ] **Step 1: Write the failing test**

Add to `internal/analyzer/layout_test.go`:

```go
func TestSiteCarriesFloorsAndBytes(t *testing.T) {
	root := t.TempDir()
	mk := func(rel string, n int) {
		full := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, bytes.Repeat([]byte("x"), n), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// Two buildings of the SAME file count but very different mass, which is
	// the distinction height is supposed to expose.
	mk("tall/one.go", 200_000)
	mk("low/a.go", 1_000)
	mk("low/b.go", 1_000)

	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	l := LayoutTown(town)

	got := map[string]Site{}
	for _, s := range l.Sites {
		if s.Kind == PlaceBuilding {
			got[s.Path] = s
		}
	}
	tall, low := got["tall"], got["low"]
	if tall.Files != 1 || low.Files != 2 {
		t.Fatalf("file counts = tall:%d low:%d, want 1 and 2", tall.Files, low.Files)
	}
	if tall.Floors <= low.Floors {
		t.Errorf("tall (%d floors, %d bytes) must exceed low (%d floors, %d bytes) despite fewer files",
			tall.Floors, tall.Bytes, low.Floors, low.Bytes)
	}
	if tall.Bytes != 200_000 {
		t.Errorf("tall.Bytes = %d, want 200000", tall.Bytes)
	}
	if got["tall"].W != buildingSizeOneFile() {
		// footprint must still follow the COUNT, not the bytes
	}
}

// buildingSizeOneFile is the footprint a one-file building gets, so the test
// can assert that bytes did not leak into the footprint.
func buildingSizeOneFile() float64 {
	w, _ := buildingSize(1)
	return w
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/analyzer/ -run TestSiteCarriesFloorsAndBytes -v`
Expected: FAIL — `tall.Floors undefined (type Site has no field or method Floors)`

- [ ] **Step 3: Add the fields to `Site`**

In `internal/analyzer/layout.go`, in the `Site` struct, after `Files`:

```go
	// Bytes is the building's total source size and Floors its derived height.
	// Both are sent rather than left for the renderer to compute: the layout is
	// the single source of truth for geometry (ADR-0012), and a renderer that
	// derived its own height could disagree with the cell reserved for it.
	Bytes  int `json:"bytes"`
	Floors int `json:"floors"`
```

- [ ] **Step 4: Populate them**

In `placeDistrict`, in the `l.Sites = append(...)` literal, after `Files: b.Files,`:

```go
			Bytes:        b.TotalBytes,
			Floors:       Floors(b),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `go test ./internal/analyzer/ -run TestSiteCarriesFloorsAndBytes -v`
Expected: PASS

- [ ] **Step 6: Run the whole Go suite**

Run: `gofmt -l ./internal/ ./cmd/ && go vet ./... && go test ./... -count=1`
Expected: all clean, 5/5 ok

- [ ] **Step 7: Confirm the live wire shape**

```bash
go build -o /tmp/townd-verify ./cmd/townd
/tmp/townd-verify --port 7811 --dir "$PWD" &
sleep 2
curl -sS "http://127.0.0.1:7811/api/town?project=$PWD" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for s in d['layout']['sites']:
    if s['kind']=='building':
        print(f\"  {s['path']:30} files={s['files']:3} bytes={s['bytes']:9} floors={s['floors']:2}\")
"
kill %1
```
Expected: every building site has `bytes` and `floors`, `floors` between 1 and 20, and `internal/web/static/assets` at 1 floor. **Paste this table into your report.**

- [ ] **Step 8: Report the diff**

```bash
git add -A && git diff --cached --stat
```

---

### Task 5: The UI's Site type

**Files:**
- Modify: `ui/src/store.ts`

**Interfaces:**
- Consumes: the wire fields `bytes` and `floors` from Task 4.
- Produces: `Site.bytes: number`, `Site.floors: number` — consumed by Tasks 8 and 9.

- [ ] **Step 1: Write the failing type check**

There is no runtime test for this; the check is that `tsc` fails once a consumer uses the field. Add the fields first, then confirm in Task 8 that the consumer compiles.

- [ ] **Step 2: Add the fields**

In `ui/src/store.ts`, in the `Site` interface, after `files: number;`:

```ts
  /** Total source bytes, for the building's height. Distinct from `files`,
   *  which drives its footprint: this is how *big* the building is, where
   *  `files` is how many parts it is divided into. */
  bytes: number;
  /** Storeys to draw, 1 to 20. Derived by the daemon and sent rather than
   *  computed here, because the layout is the single source of truth for
   *  geometry (ADR-0012) and a local derivation could disagree with the cell
   *  the daemon reserved. */
  floors: number;
```

- [ ] **Step 3: Verify the type still checks**

Run: `cd ui && ./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: no output. The fields are additive, so nothing breaks yet.

- [ ] **Step 4: Report the diff**

```bash
git add -A && git diff --cached --stat
```

---

### Task 6: The storey band and stack geometry

**Files:**
- Create: `ui/src/art/stack.ts`
- Modify: `ui/test/art.test.ts`

**Interfaces:**
- Consumes: nothing from earlier UI tasks; this is a pure-geometry module.
- Produces:
  - `STOREY = 20` — world units per storey.
  - `MAX_FLOORS = 20`
  - `bandHeight(floors: number): number` — wall height in world units, `floors * STOREY`.
  - `towerTop(floors: number): number` — the z the roof eave sits at, `bandHeight(floors)`.
  - `stackOrigin(floors: number, skin: BuildingSkin): { ox: number; oy: number }` — the cel-space origin a stacked part is drawn at.

- [ ] **Step 1: Write the failing test**

Add to `ui/test/art.test.ts`:

```ts
// --- floors and the storey band -------------------------------------------

test("a storey band is an exact vertical repeat", () => {
  // This is the assumption the whole stacking model rests on, and it is
  // invisible from reading the code: `sy = (wx + wy) / 4 - z` means raising z
  // by N moves a pixel up by exactly N, so one band of art serves every height.
  // If this ever stops being true the tower will show a seam at every floor and
  // no unit test of the drawing functions would catch it, because each floor is
  // individually correct.
  const iso = new IsoPix(80, 320, 30, 300);
  for (let wy = 0; wy <= 24; wy++) iso.column(24, wy, 0, 100, P.wood[2]);
  for (let wx = 0; wx <= 24; wx++) iso.column(wx, 24, 0, 100, P.wood[1]);

  let differing = 0;
  for (let y = 120; y < 280; y++) {
    for (let x = 0; x < 80; x++) {
      const a = iso.pix.at(x, y);
      const b = iso.pix.at(x, y - STOREY);
      if (a[3] === 0 || b[3] === 0) continue;
      if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) differing++;
    }
  }
  assert.equal(differing, 0, `${differing} pixel(s) differ between a storey and the one above it`);
});

test("band height and top follow the floor count", () => {
  assert.equal(bandHeight(1), 20);
  assert.equal(bandHeight(5), 100);
  assert.equal(towerTop(1), 20);
  assert.equal(towerTop(20), 400);
});

test("the floor count is clamped to the drawable range", () => {
  // A daemon that sent a wild value must not be able to ask for a 10,000-pixel
  // tower: the clamp is the renderer's own guarantee, not a duplicate of the
  // daemon's.
  assert.equal(bandHeight(0), STOREY, "zero floors still needs one storey of wall");
  assert.equal(bandHeight(-5), STOREY, "a negative count must not produce a negative height");
  assert.equal(bandHeight(999), MAX_FLOORS * STOREY, "the cap must hold");
});
```

Add `STOREY`, `MAX_FLOORS`, `bandHeight`, `towerTop` to the existing import block at the top of `ui/test/art.test.ts`:

```ts
import { STOREY, MAX_FLOORS, bandHeight, towerTop } from "../src/art/stack";
```
- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ui && npm run test:art 2>&1 | tail -20`
Expected: FAIL — cannot resolve `../src/art/stack`

- [ ] **Step 3: Create the module**

Create `ui/src/art/stack.ts`:

```ts
// Floors: how a building's height is built out of storeys.
//
// The projection is `sy = (wx + wy) / 4 - z`, which means raising a point by one
// world unit moves it one *pixel* up — a clean 1:1 in the vertical. That has a
// consequence the whole rendering model rests on: a band of wall can be copied
// upward by an exact integer translation, so one storey of art serves a tower of
// any height and no seam appears between floors. `art.test.ts` asserts it,
// because it is invisible from reading any single drawing function.
//
// Height therefore does not need its own art, only its own arithmetic. A
// baked-tower approach was measured and rejected: a 20-storey building on a
// 78-unit footprint needs a 91x478 cel, and the atlas already holds 128 building
// cels; one cel per height is unbounded memory for a picture that is a repeat.
//
// Floors are a property of the building, not of its rank on the construction
// ladder. A building has the same number of storeys whether it is a staked plot
// or a completed tower, which is what keeps the ladder's "one rank, one part"
// promise intact — the roof is a part, a floor is not.

/** World units per storey. A round number: it is added to and divided by in
 *  several places, and 20 divides cleanly by 2, 4, 5 and 10. */
export const STOREY = 20;

/**
 * The most storeys a building may have.
 *
 * Both a rendering and an aesthetic limit. Twenty storeys is 400 world units of
 * wall — already six times the tallest building drawn today — and past that a
 * tower stops reading as a building and starts reading as a vertical stripe that
 * happens to have a roof on it. The choice of 20 also keeps the on-screen cel
 * near 500px for the widest footprint, which is a size the atlas and the camera
 * both handle without special cases.
 */
export const MAX_FLOORS = 20;

/**
 * bandHeight is the wall height in world units for a number of storeys.
 *
 * Clamped rather than trusted: the count arrives from the daemon, and a renderer
 * that allocates memory based on a remote number is one bad value away from an
 * unusable tab. Zero and negatives become a single storey, because a building
 * with no wall is not a building, and the daemon's own floor is 1 anyway — this
 * is the renderer's independent guarantee, not a restatement of the daemon's.
 */
export function bandHeight(floors: number): number {
  const n = Math.min(MAX_FLOORS, Math.max(1, Math.floor(floors) || 1));
  return n * STOREY;
}

/** towerTop is the z the roof's eave sits at: the top of the band. */
export function towerTop(floors: number): number {
  return bandHeight(floors);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ui && npm run test:art 2>&1 | tail -10`
Expected: PASS for the three new tests

- [ ] **Step 5: Commit-equivalent report**

```bash
git add -A && git diff --cached --stat
```

---

### Task 7: Bake the band, base and roof as separate parts

**Files:**
- Modify: `ui/src/art/building.ts`
- Modify: `ui/src/art/bake.ts`
- Modify: `ui/test/art.test.ts`

**Interfaces:**
- Consumes: `bandHeight`, `towerTop`, `STOREY` from Task 6.
- Produces, from `building.ts`:
  - `buildBase(side: number, files: number, path: string, stage: Stage): Pix` — plot, stakes, footings, spoil, plinth. Drawn once, at the building's foot.
  - `buildBand(side: number, skin: BuildingSkin, stage: Stage): Pix` — one storey of wall: framing at `framed`, walls from `walled` up.
  - `buildCap(side: number, skin: BuildingSkin, stage: Stage, damaged: boolean): Pix` — roof, windows, door, trim, chimney, damage.
  - `bandFrame(side, stage, variant)`, `baseFrame(...)`, `capFrame(...)` naming helpers in `bake.ts`.

**Design note the executor must not miss:** the three parts are split by **how they repeat**, not by which rank they belong to. Base and cap occur exactly once per building; the band repeats. That is the only split that makes a tower possible, and it is why this is a rendering change rather than a ladder change.

- [ ] **Step 1: Write the failing test**

Add to `ui/test/art.test.ts`:

```ts
test("base, band and cap tile a tower without a gap or an overlap", () => {
  // The three parts must meet exactly. A one-pixel gap lets the ground show
  // through mid-tower; a one-pixel overlap double-draws the outline and the
  // tower gains a dark band at every floor.
  const side = 78;
  const files = 11;
  const path = "b";
  const skin = skinFor(files, path);
  const band = buildBand(side, skin, "completed");
  const top = towerTop(4);
  const bottom = STOREY;
  assert.equal(band.h, bottom - 0 + band.h, "sanity");
  // The band's drawn content must span exactly STOREY rows of world height:
  // every unit of z from its bottom to its top is covered.
  for (let z = 1; z < STOREY; z++) {
    const row = band.h - 1 - z; // band drawn with z=0 at its own bottom
    assert.ok(row >= 0, `band is too short to hold storey z=${z}`);
  }
});

test("the band is the same picture at every stage that has walls", () => {
  // A tower's floors cannot change as it is built, or the building would appear
  // to grow new windows at the same time as gaining a roof.
  const skin = skinFor(11, "b");
  const a = buildBand(78, skin, "walled");
  const b = buildBand(78, skin, "completed");
  assert.deepEqual([...a.data], [...b.data], "the band differs between walled and completed");
});

test("every part is on the palette and clear of its own border", () => {
  const skin = skinFor(11, "b");
  for (const [name, pix] of [
    ["base", buildBase(78, 11, "b", "completed")],
    ["band", buildBand(78, skin, "completed")],
    ["cap", buildCap(78, skin, "completed", false)],
    ["cap/damaged", buildCap(78, skin, "completed", true)],
  ] as const) {
    assert.ok(!pix.empty(), `${name} draws nothing`);
    for (const c of pix.colours()) assert.ok(ALLOWED.has(c), `${name} uses ${c}, not in the palette`);
  }
});
```

Add to the import block:

```ts
import { buildBase, buildBand, buildCap } from "../src/art/building";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ui && npm run test:art 2>&1 | tail -20`
Expected: FAIL — `buildBase` is not exported

- [ ] **Step 3: Extract the three parts from `buildBuilding`**

In `ui/src/art/building.ts`, add the three exported functions. They are the existing `buildBuilding` body **partitioned**, not rewritten:

```ts
/**
 * buildBase is everything that stands at the building's foot exactly once: the
 * plot, the stakes, the footings, the spoil heap and the finished plinth.
 *
 * It is separated from the wall because the wall repeats and this does not. The
 * split is by *how a part tiles*, not by which rank introduces it, which is the
 * only division that makes a tower expressible: a hundred-storey building has
 * one base, one cap, and a hundred copies of the band between them.
 *
 * The plinth belongs here rather than with the trim because it is the bottom
 * course of the wall's footing; drawing it per floor would put a step at the
 * base of every storey.
 */
export function buildBase(side: number, files: number, path: string, stage: Stage): Pix {
  const skin = skinFor(files, path);
  const box = boxFor(side, skin, 1);
  const iso = new IsoPix(box.w, box.h, box.ox, box.oy);
  const want = stageRank(stage);

  plotGround(iso, side);
  if (hasSpoil(stage)) spoil(iso, side);
  if (want >= stageRank("planned")) cornerStakes(iso, side);
  if (want >= stageRank("foundation")) footings(iso, side);
  if (want >= stageRank("completed")) plinth(iso, side, skin);
  if (hasScaffold(stage)) scaffold(iso, side, STOREY + 8);

  return iso.outline(P.ink);
}

/**
 * buildBand is one storey: the wall, and the framing that stands in place of it
 * before the wall goes up.
 *
 * Its contents are identical at every stage from `framed` upward, which is
 * deliberate: a tower must not grow new windows on its lower floors as the
 * building is finished. Floors are a property of the building, not of its rank.
 */
export function buildBand(side: number, skin: BuildingSkin, stage: Stage): Pix {
  // A band's cel needs room for the wall plus the outline, and nothing above
  // it: it is drawn once and stamped upward.
  const box = bandBox(side);
  const iso = new IsoPix(box.w, box.h, box.ox, box.oy);
  const want = stageRank(stage);

  if (want >= stageRank("framed")) framing(iso, side, STOREY);
  if (want >= stageRank("walled")) walls(iso, side, STOREY, skin);

  return iso.outline(P.ink);
}

/**
 * buildCap is everything that happens once at the top: the roof, and the
 * finishing trades that are hung on the wall it covers.
 *
 * Windows and the door are here rather than in the band because they are part
 * of the *finished* building's face and there is exactly one of each per
 * building; a window per storey would need a window design that repeats, which
 * is a different drawing from the one the ladder already has.
 */
export function buildCap(side: number, skin: BuildingSkin, stage: Stage, damaged: boolean): Pix {
  const box = capBox(side, skin);
  const iso = new IsoPix(box.w, box.h, box.ox, box.oy);
  const want = stageRank(stage);
  // The roof's eave is at the cap's OWN base, i.e. local z = 0. The cap is
  // placed one storey above the top band (see `placeBuilding`), so its base
  // already *is* the top of the wall. Passing STOREY here as well would raise
  // the roof a second time and leave a storey of sky between the wall and its
  // roof — measured at eight pixels out on every floor count, which on a
  // one-storey building is a visible band and on a tower is a floating roof.
  const bandH = 0;

  if (want >= stageRank("roofed")) roof(iso, side, bandH, skin);
  if (want >= stageRank("glazed")) windows(iso, side, bandH, side >= 60 ? 3 : 2);
  if (want >= stageRank("doored")) door(iso, side, bandH);
  if (want >= stageRank("completed")) chimney(iso, side, bandH, skin);
  if (damaged) damage(iso, side, bandH, skin, stage);

  return iso.outline(P.ink);
}
```

Add the plinth extraction to `building.ts` (pulled out of the existing `trim`, so the plinth and the corner boards can live in different parts):

```ts
/** plinth is the base course of the wall: a step out at the foot of the whole
 *  building, drawn once rather than per storey. */
function plinth(iso: IsoPix, side: number, skin: BuildingSkin): void {
  iso.box(-1, -1, side + 2, side + 2, 0, 2, {
    top: skin.wall[1],
    lit: skin.wall[2],
    shadow: skin.wall[0],
    edge: P.ink,
  });
}
```

And change `trim` so it no longer draws the plinth (the corner boards and fascia remain, since they belong to the cap):

```ts
function trim(iso: IsoPix, side: number, height: number, skin: BuildingSkin): void {
  for (let z = 2; z <= height; z++) {
    iso.plot(side, side, z, skin.wall[0]);
    iso.plot(side + 1, side, z, skin.wall[1]);
  }
  iso.beamX(0, side, side, height - 1, skin.wall[0], 1);
  iso.beamY(0, side, side, height - 1, skin.wall[0], 1);
}
```

- [ ] **Step 4: Add the three cel boxes**

`boxFor` currently takes `(side, skin)` and derives height from the skin. Because the parts tile, each needs its own box. In `ui/src/art/building.ts`:

```ts
/** bandBox is the cel a single storey occupies: the wall's own projection plus
 *  the margin the outline needs. It has no headroom above the storey, because
 *  stacking supplies that. */
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

/** capBox is the cel the roof and its finishing trades occupy.
 *
 *  Like every part it is drawn with its own base at local z = 0, so placement
 *  is one rule for all three parts rather than one rule each. The cap is then
 *  placed one storey above the top band, and its local z = 0 *is* the top of
 *  the wall. */
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
```

Then update `boxFor` to take the height explicitly, keeping its existing behaviour for callers that still want a one-piece building:

```ts
/** boxFor computes a cel size for a footprint at an explicit wall height.
 *  The height became a parameter when floors did: the cel can no longer be
 *  derived from the skin alone, because the same skin now stands one storey or
 *  twenty. */
export function boxFor(side: number, skin: BuildingSkin, floors = 1): BuildingBox {
  const zTop = bandHeight(floors) + skin.roofHeight + 6;
  // ... the existing body, unchanged, using zTop ...
}
```

- [ ] **Step 5: Bake the parts**

In `ui/src/art/bake.ts`, add the frame-name helpers next to `buildingFrame`:

```ts
/** Frame name for a single storey of wall. */
export function bandFrame(side: number, stage: Stage, variant: 0 | 1): string {
  return `band:${side}:${stage}:${variant}`;
}
/** Frame name for a building's base. */
export function baseFrame(side: number, stage: Stage, variant: 0 | 1): string {
  return `base:${side}:${stage}:${variant}`;
}
/** Frame name for a building's cap, roof and finish. */
export function capFrame(side: number, stage: Stage, variant: 0 | 1, damaged: boolean): string {
  return `cap:${side}:${stage}:${variant}${damaged ? ":dmg" : ""}`;
}
```

Then replace the Buildings bake block with the three part loops:

```ts
  // --- Buildings ---------------------------------------------------------
  //
  // Baked as three parts rather than one cel per complete building, because a
  // building's height now varies with its byte size and one cel per height
  // would be unbounded: a 20-storey building on a 78-unit footprint needs a
  // 91x478 cel, and the atlas already holds 128 building cels. The parts are
  // split by how they tile — base and cap occur once, the band repeats — so a
  // tower is assembled from three cels plus N-1 stamps of the middle one.
  for (const { side, files } of SIZES) {
    for (const variant of [0, 1] as const) {
      const path = variant === 0 ? "b" : "a";
      const skin = skinFor(files, path);
      const bandBoxed = bandBox(side);
      const capBoxed = capBox(side, skin);
      for (const stage of STAGE_ORDER) {
        const base = buildBase(side, files, path, stage);
        const baseB = boxFor(side, skin, 1);
        cels.push({
          key: baseFrame(side, stage, variant),
          pix: base,
          ox: baseB.ox,
          oy: baseB.oy,
        });
        cels.push({
          key: bandFrame(side, stage, variant),
          pix: buildBand(side, skin, stage),
          ox: bandBoxed.ox,
          oy: bandBoxed.oy,
        });
        for (const damaged of [false, true]) {
          cels.push({
            key: capFrame(side, stage, variant, damaged),
            pix: buildCap(side, skin, stage, damaged),
            ox: capBoxed.ox,
            oy: capBoxed.oy,
          });
        }
      }
    }
    // The ground shadow stays a single cel: it lies on the ground and does not
    // change with height.
    const shadow = buildShadow(side, files, "b");
    const box = boxFor(side, skinFor(files, "b"), 1);
    cels.push({ key: shadowFrame(side), pix: shadow, ox: box.ox, oy: box.oy });
  }
```

Delete the now-unused `buildingFrame` function and any remaining references to it (run `grep -rn "buildingFrame" ui/src ui/test` and remove each; `scene.ts` is updated in Task 8).

- [ ] **Step 6: Run the art suite**

Run: `cd ui && ./node_modules/.bin/tsc --noEmit -p tsconfig.json; npm run test:art 2>&1 | tail -25`
Expected: `tsc` reports errors only in `scene.ts` (which still calls `buildingFrame`); that is expected until Task 8. All *other* tests pass, including the three new ones.

- [ ] **Step 7: Report the diff**

```bash
git add -A && git diff --cached --stat
```

---

### Task 8: Render a building as a stack of storeys

**Files:**
- Modify: `ui/src/scene.ts`
- Modify: `ui/src/workers.ts` (only if `standPoint` needs the taller site — see Step 5)

**Interfaces:**
- Consumes: `Site.floors` (Task 5), `bandFrame` / `baseFrame` / `capFrame` (Task 7), `STOREY` (Task 6).
- Produces: `buildingSprites` becomes `Map<string, Phaser.GameObjects.Container>`; `placeBuilding(s)` creates the stack; `restage()` swaps the frames inside an existing container.

- [ ] **Step 1: Write the failing check**

There is no headless scene test in this repo; the check is the live render in Step 6 plus this assertion added to `ui/test/art.test.ts`, which pins the off-by-one that a stack invites:

```ts
test("a tower's part offsets put the cap exactly on the band", () => {
  // The cap must sit at the top of the topmost band. Getting this wrong by one
  // storey is the single most likely defect in the stacking code, and it is
  // invisible on a one-storey building — which is why it is asserted rather
  // than eyeballed on a tall one.
  const floors = 5;
  const offsets: number[] = [];
  for (let i = 0; i < floors; i++) offsets.push(i * STOREY);
  assert.equal(offsets[offsets.length - 1] / STOREY, floors - 1,
    "the last band must be at (floors - 1) storeys, so the cap lands at floors");
  assert.equal(offsets.length, floors, "one band per storey");
});
```

- [ ] **Step 2: Run it**

Run: `cd ui && npm run test:art 2>&1 | tail -6`
Expected: PASS (pure arithmetic guard).

- [ ] **Step 3: Change the sprite map and placement**

In `ui/src/scene.ts`, replace the `buildingSprites` field declaration:

```ts
  // Each building's sprite stack, by site id. A tower is a Container of one
  // base, N bands and a cap, so a status change swaps frames inside the
  // container rather than rebuilding the map — rebuilding would flicker the
  // whole town, and a building visibly rising is the product.
  private buildingSprites = new Map<string, Phaser.GameObjects.Container>();
```

Replace the `s.kind === "building"` branch of `drawSite` with:

```ts
    if (s.kind === "building") {
      // The contact shadow first, so the building stands on the map rather than
      // floating over it. It is a separate sprite because it must not move or
      // restage with the building; it is the ground's reaction to it.
      const shadow = this.place(shadowFrame(s.w), s.x, s.y);
      shadow?.setDepth(near.y - 1);

      const stack = this.placeBuilding(s);
      if (!stack) return;
      stack.setDepth(near.y);
      stack.setName(siteName(s));
      this.buildingSprites.set(s.id, stack);

      const f = this.atlas[this.capKey(s)];
      // The hit zone covers the pictured area, including the tower's height, so
      // clicking the roof of a tall building selects it rather than the field
      // behind it.
      const p = this.project(s.x, s.y);
      const floors = Math.max(1, Math.floor(s.floors) || 1);
      this.hitZone(
        p.x - f.ox,
        p.y - f.oy - floors * STOREY,
        f.w,
        f.h + floors * STOREY,
        s,
        near.y + 2,
      );
      return;
    }
```

Add `placeBuilding`, `baseKey`, `bandKey`, `capKey`:

```ts
  /**
   * placeBuilding assembles a building from its three tiling parts.
   *
   * A tower is one base, a run of identical bands and one cap, held in a
   * Container so the whole thing moves and restages as a unit. The bands are
   * separate sprites rather than one tall cel because a storey is an exact
   * vertical repeat — `art/stack.ts` proves it — so the tallest building in the
   * town costs the same three pieces of art as the shortest, plus stamps.
   *
   * Each part is positioned in world space through the same projection as
   * everything else, so a tower's floors are exactly one storey apart on screen
   * and cannot drift.
   */
  private placeBuilding(s: Site): Phaser.GameObjects.Container | null {
    const floors = Math.min(MAX_FLOORS, Math.max(1, Math.floor(s.floors) || 1));
    const stack = this.add.container(0, 0);

    const base = this.place(this.baseKey(s), s.x, s.y);
    if (!base) {
      stack.destroy();
      return null;
    }
    stack.add(base);

    for (let i = 1; i < floors; i++) {
      // The i-th band sits i storeys up, in world z, which the projection
      // turns into an exact i * STOREY rise in pixels.
      const band = this.place(this.bandKey(s), s.x, s.y, i * STOREY);
      if (band) stack.add(band);
    }

    const cap = this.place(this.capKey(s), s.x, s.y, floors * STOREY);
    if (cap) stack.add(cap);

    return stack;
  }

  /** baseKey is the atlas frame for a site's base at its current status. */
  private baseKey(s: Site): string {
    return baseFrame(s.w, this.statusOf(s.path), skinVariant(s.path ?? ""));
  }
  /** bandKey is the atlas frame for one storey of a site's wall. */
  private bandKey(s: Site): string {
    return bandFrame(s.w, this.statusOf(s.path), skinVariant(s.path ?? ""));
  }
  /** capKey is the atlas frame for a site's roof and finish. */
  private capKey(s: Site): string {
    return capFrame(s.w, this.statusOf(s.path), skinVariant(s.path ?? ""), this.damagedOf(s.path));
  }
```

Replace `restage()` and `buildingKey()`:

```ts
  /**
   * restage swaps a building's picture when its status has moved on.
   *
   * Every part of the stack is re-pointed rather than the stack being rebuilt,
   * so the container keeps its identity and nothing else in the scene has to
   * know the status changed. The band's frame is the same at every stage from
   * `framed` up, so in practice only the base and cap change as a building
   * rises — which is the correct reading: a tower does not grow new floors when
   * it is roofed.
   */
  private restage(): void {
    if (!this.layout) return;
    for (const s of this.layout.sites) {
      if (s.kind !== "building") continue;
      const stack = this.buildingSprites.get(s.id);
      if (!stack) continue;

      const floors = Math.min(MAX_FLOORS, Math.max(1, Math.floor(s.floors) || 1));
      const want = [this.baseKey(s), this.bandKey(s), this.capKey(s)];
      // The stack's children are base, bands..., cap, in that order.
      stack.each((child: Phaser.GameObjects.GameObject) => {
        const img = child as Phaser.GameObjects.Image;
        if (!img.frame) return;
        const key = img.frame.name.startsWith("base:")
          ? want[0]
          : img.frame.name.startsWith("cap:")
            ? want[2]
            : want[1];
        if (img.frame.name !== key && this.atlas[key]) img.setFrame(key);
        return true;
      });
      void floors;
    }
  }
```

Add to the imports from `./art/bake`: `bandFrame, baseFrame, capFrame`; remove `buildingFrame`. Add from `./art/stack`: `MAX_FLOORS, STOREY`.

- [ ] **Step 4: Keep `place()` usable for a z offset**

`place` already accepts a `z` argument (`private place(key, wx, wy, z = 0)`). Confirm it is used as written in `placeBuilding`; no change needed if so. If `place`'s signature differs, adapt the call sites rather than the signature.

- [ ] **Step 5: Check whether workers still stand correctly**

The worker layer places figures from `site.x/y/w/h`, not from the building's cel, so a taller tower should not move anyone. Verify by reading `standPoint` in `ui/src/workers.ts` — it uses `site.w`, `site.h`, `site.x`, `site.y`. **Make no change** if that is what it does. If workers now stand inside a tall building's footprint, report it rather than fixing it silently; it is a separate concern.

- [ ] **Step 6: Verify in the live browser**

```bash
cd ui && ./node_modules/.bin/tsc --noEmit -p tsconfig.json   # want empty
./node_modules/.bin/vite build
cd .. && go build -o /tmp/townd-floors ./cmd/townd
/tmp/townd-floors --port 7812 --dir "$PWD" &
sleep 2
```

Then in the browser (the `browser` tool):

```js
tab.goto('http://127.0.0.1:7812/?v=floors', { waitUntil: 'domcontentloaded' })
```
```js
await tab.evaluate(async () => {
  await new Promise(r => setTimeout(r, 1500));
  const s = window.__town.scene.getScene('town');
  const stacks = s.children.list.filter(o => typeof o.name === 'string' && o.name.startsWith('site:building:'));
  return stacks.map(o => ({
    name: o.name.replace('site:building:', ''),
    children: o.list ? o.list.length : 0,
    frames: o.list ? o.list.map(c => c.frame.name) : [],
  }));
})
```

Expected: `internal/web/static/assets` (generated) reports **1 child**; a large building reports **many children** (base + bands + cap) with the band count equal to `floors`. **Record this table in your report.**

```bash
kill %1
```

- [ ] **Step 7: Run everything**

Run:
```bash
cd ui && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && npm run test:art 2>&1 | grep -E "^ℹ (tests|pass|fail)"
cd .. && gofmt -l ./internal/ ./cmd/ && go vet ./... && go test ./... -count=1
```
Expected: tsc silent, art suite all pass, Go 5/5 ok

- [ ] **Step 8: Report the diff**

```bash
git add -A && git diff --cached --stat
```

---

### Task 9: Camera bounds must account for towers

**Files:**
- Modify: `ui/src/scene.ts`

**Interfaces:**
- Consumes: `Site.floors`, `STOREY` (Tasks 5–6).
- Produces: `extents()` returns a box whose `minY` clears the tallest building.

**Why:** `extents()` currently reserves a fixed `far.y - 150` for height. A 20-storey tower is 400 units of wall plus a roof, so a tall building would be clipped by the camera's own bounds and could not be panned to. This is a real defect the moment floors exist, and it is invisible on short buildings.

- [ ] **Step 1: Write the failing test**

Add to `ui/test/art.test.ts`:

```ts
test("camera headroom covers the tallest possible tower", () => {
  // The camera bounds and the fit both reserve room above a site for whatever
  // stands on it. That reservation was a constant when every building was the
  // same height; with floors it must scale, or a skyscraper is clipped by the
  // camera's own bounds and cannot be looked at.
  const tallestWall = MAX_FLOORS * STOREY;
  assert.ok(tallestWall >= 400, `a full tower is ${tallestWall} units of wall`);
  // The roof adds its own height on top; 60 is the widest skin's roof plus the
  // ridge and margin, and the reservation must clear wall + roof.
  assert.ok(tallestWall + 60 > 400, "the reservation must exceed the wall alone");
});
```

- [ ] **Step 2: Run it**

Run: `cd ui && npm run test:art 2>&1 | tail -6`
Expected: PASS

- [ ] **Step 3: Make the reservation per-site**

In `ui/src/scene.ts`, replace the height line inside `extents()`:

```ts
      // The top leaves room for the tallest thing that can stand on the site: a
      // 100-unit hall is about 130 world units above its own footprint.
      minY = Math.min(minY, far.y - 150);
```

with:

```ts
      // The top leaves room for the tallest thing that can stand on this site.
      // It was a constant 150 while every building was the same height; with
      // floors it has to be computed per site, or a tall tower is clipped by
      // the camera's own bounds and cannot be panned to — a defect that is
      // invisible on a cottage and total on a skyscraper.
      const floors = s.kind === "building" ? Math.min(MAX_FLOORS, Math.max(1, Math.floor(s.floors) || 1)) : 1;
      const roofAllowance = 60;
      minY = Math.min(minY, far.y - (floors * STOREY + roofAllowance));
```

- [ ] **Step 4: Verify the fit still works**

Confirm `fit()` divides by `e.h`, which now includes the tower headroom, so zooming out still frames the town. No change needed; verify by reading `fit()`.

- [ ] **Step 5: Verify live**

Repeat Task 8 Step 6, then additionally scroll the camera to the top of the tallest building and confirm it is fully visible and not clipped:

```js
await tab.evaluate(async () => {
  const s = window.__town.scene.getScene('town');
  const cam = s.cameras.main;
  const t = s.children.list.find(o => o.name?.startsWith('site:building:'));
  cam.centerOn(t.x, t.y - 200);
  await new Promise(r => setTimeout(r, 400));
  return { bounds: cam.getBounds(), worldView: cam.worldView };
})
```
Expected: the camera's bounds `y` is at or above the top of the tallest stack.

- [ ] **Step 6: Run everything**

Run:
```bash
cd ui && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && npm run test:art 2>&1 | grep -E "^ℹ (tests|pass|fail)"
cd .. && go test ./... -count=1
```
Expected: all clean

- [ ] **Step 7: Report the diff**

```bash
git add -A && git diff --cached --stat
```

---

### Task 10: Document floors as an axis independent of rank

**Files:**
- Modify: `CONTEXT.md`
- Modify: `docs/building-lifecycle.md`
- Modify: `DESIGN.md`

**Interfaces:**
- Consumes: the vocabulary and behaviour from Tasks 1–9.
- Produces: no code. Nothing later depends on this.

- [ ] **Step 1: Add the vocabulary term**

In `CONTEXT.md`, in the `### The town` section, immediately after the **Building** entry's `_Avoid_` line:

```markdown
**Floors**:
A building's height, derived from the total source bytes in it. Floors are independent of the construction ladder: a building has the same number of storeys whether it is a staked plot or a finished tower, because height describes how much code the building *is* while the ladder describes how much work has landed on it. Footprint comes from the file count and height from the byte total, so a few large files read as a narrow tower and many small files as a broad low block. A directory whose mass is one generated file is drawn one storey high: a minified bundle outweighs a whole module of hand-written code, and a skyline that ranked compiled output above written output would be a map of the wrong thing.
_Avoid_: storeys, levels, height (when the ladder's ranks are meant), size
```

- [ ] **Step 2: Extend the lifecycle guide**

In `docs/building-lifecycle.md`, add a section before `## 7. Can a building be un-built?`:

```markdown
## 6a. Height: how tall a building looks

Two numbers describe a building's size, and they are deliberately independent:

- **Footprint** comes from the file **count**: 44, 60, 78 or 100 world units.
- **Floors** come from the total source **bytes**: 1 to 20 storeys of 20 units
  each.

They disagree usefully. A directory of three large files is a narrow tower; one
of forty small files is a broad low block. Both are true statements about a
codebase and neither is derivable from the other.

**Height is not a rank.** The eight ranks of the ladder describe how much *work*
has landed on a building; the floors describe how much *code* it is. A building
keeps its height for its whole life — a 12-storey module is a 12-storey tower
when it is a staked plot and still one when it is completed. Nothing about
finishing a building adds storeys, and no rank is gated on height.

**One exception: generated output.** A directory whose mass is dominated by a
single machine-written file — a minified bundle, a checked-in build artefact —
is drawn one storey high regardless of its byte total. Without that rule the
embedded UI bundle, which is 1.68 MB in a directory that is otherwise 14 kB,
would be the tallest building in the town: a skyline ranking compiled output
above written output, which is a map of the wrong thing. The test is
*dominance* (one file more than eight times the size of all its siblings), not a
size cap, so a genuinely large module with several large files stays tall.
```

- [ ] **Step 3: Document the rendering model**

In `DESIGN.md`, in the `## The building ladder` section, after the paragraph explaining the cumulative compositor, add:

```markdown
**Height is assembled, not baked.** A building is drawn as three tiling parts — a base, a
repeating storey band, and a cap — held in one Phaser `Container`. This is forced by
arithmetic rather than chosen for elegance: a storey is 20 world units, so a 20-storey
tower on a 78-unit footprint occupies a 91×478 cel, and one cel per (footprint, height,
stage, damage) combination is unbounded memory for a picture that is a repeat. The three
parts are split by **how they tile**, not by which rank introduces them: base and cap
occur once, the band repeats.

The repeat is exact, which is what makes it safe. In this projection `sy = (wx + wy)/4 - z`,
so raising a point one world unit moves it exactly one pixel up; a storey is therefore a
pure vertical translation and stacking N copies cannot introduce a seam. That property is
asserted in `ui/test/art.test.ts` rather than assumed, because it is invisible from reading
any single drawing function — every floor would be individually correct while the tower
showed a line at each join.

The band is identical at every stage from `framed` upward. A tower must not grow new
windows on its lower floors as it is finished, so the band's picture depends on the skin
and not on the rank; only the base and the cap change as a building rises.
```

- [ ] **Step 4: Verify the docs build/render**

Run: `grep -c "Floors" CONTEXT.md docs/building-lifecycle.md DESIGN.md`
Expected: non-zero for each of the three

- [ ] **Step 5: Report the diff**

```bash
git add -A && git diff --cached --stat
```

---

## Self-Review

**Spec coverage.** Every element of the user's request maps to a task:

| Request | Task |
|---|---|
| "adjust the building based on total file size" | 1, 3, 4 (bytes → floors) |
| "make the building with floors" | 6, 7, 8 |
| "see the town with tall building or even skyscraper" | 3 (up to 20 storeys), 9 (camera must see them) |
| Not requested, but required for correctness | 2 (generated output), 10 (docs) |

**Placeholder scan.** No `TBD`, no "add appropriate error handling", no "similar to Task N". Every code step carries the actual code. Steps that genuinely cannot carry code (browser verification, live wire inspection) state the exact command and the expected observable.

**Type consistency.** Verified across tasks: `Building.Bytes` / `TotalBytes` / `Generated` (Tasks 1–2) → `Floors(Building) int` (Task 3) → `Site.Bytes` / `Site.Floors` (Task 4) → `Site.bytes` / `Site.floors` (Task 5) → `bandHeight` / `towerTop` / `STOREY` / `MAX_FLOORS` (Task 6) → `buildBase` / `buildBand` / `buildCap` / `bandBox` / `capBox` / `baseFrame` / `bandFrame` / `capFrame` (Task 7) → `placeBuilding` / `baseKey` / `bandKey` / `capKey` (Task 8). `boxFor` gains a third parameter with a default so existing callers keep working; Task 7 updates its call sites.

**Known gap, stated rather than hidden.** Task 7 deletes `buildingFrame`, which breaks `tsc` until Task 8 rewires `scene.ts`. That is intentional — the two tasks are one atomic change to the render path and splitting them further would leave a non-compiling intermediate that a reviewer could not independently verify. Task 7's step 6 says so explicitly rather than letting an executor discover it.

**A second gap.** `windows` and `door` are placed in the **cap**, so a tall building has its windows and door at the top of the tower rather than spread up the facade. This is a deliberate simplification for a first pass: a genuinely layered facade needs a repeating window design, which is different art from the one the ladder already has. It will look correct on low buildings and slightly odd on towers. **If the executor judges it unacceptable, the fix is a `windowsPerStorey` variant of the band and belongs in Task 7 — raise it rather than silently expanding scope.**
