package analyzer

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// tree builds a throwaway project where each district holds n buildings of a
// given file count.
func tree(t *testing.T, districts map[string][2]int) string {
	t.Helper()
	root := t.TempDir()
	for name, spec := range districts {
		nb, files := spec[0], spec[1]
		for i := 0; i < nb; i++ {
			d := filepath.Join(root, name, "b"+itoa(i))
			if err := os.MkdirAll(d, 0o755); err != nil {
				t.Fatal(err)
			}
			for f := 0; f < files; f++ {
				if err := os.WriteFile(filepath.Join(d, "f"+itoa(f)+".ts"), []byte("x"), 0o644); err != nil {
					t.Fatal(err)
				}
			}
		}
	}
	return root
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var b []byte
	for i > 0 {
		b = append([]byte{byte('0' + i%10)}, b...)
		i /= 10
	}
	return string(b)
}

func layoutOf(t *testing.T, root string) Layout {
	t.Helper()
	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	return LayoutTown(town)
}

// Regression: every site must lie inside the declared canvas.
//
// The first implementation tested whether a district row overflowed AFTER
// emitting the block, so a straddling block sat past the row edge. Width was
// also hardcoded, so camera bounds derived from it clipped the content. Both
// are caught by this invariant, which is cheaper to assert than to reason
// about.
func TestEverySiteIsInsideTheCanvas(t *testing.T) {
	cases := map[string]map[string][2]int{
		"single":      {"src": {4, 6}},
		"many":        {"a": {3, 2}, "b": {12, 4}, "c": {5, 8}, "d": {9, 1}, "e": {2, 3}},
		"oversized":   {"huge": {400, 15}},
		"two-huge":    {"huge": {400, 15}, "bigger": {400, 15}},
		"wide-many":   {"a": {20, 5}, "b": {20, 5}, "c": {20, 5}},
		"tiny":        {"a": {1, 1}},
		"mixed-sizes": {"a": {2, 1}, "b": {2, 30}, "c": {2, 12}},
	}

	for name, spec := range cases {
		t.Run(name, func(t *testing.T) {
			l := layoutOf(t, tree(t, spec))

			for _, s := range l.Sites {
				if s.X < 0 || s.Y < 0 {
					t.Errorf("site %s at negative position (%.0f,%.0f)", s.ID, s.X, s.Y)
				}
				if s.X+s.W > l.Width {
					t.Errorf("site %s right edge %.0f exceeds canvas width %.0f",
						s.ID, s.X+s.W, l.Width)
				}
				if s.Y+s.H > l.Height {
					t.Errorf("site %s bottom edge %.0f exceeds canvas height %.0f",
						s.ID, s.Y+s.H, l.Height)
				}
			}
			for _, d := range l.Districts {
				if d.X+d.W > l.Width {
					t.Errorf("district %s right edge %.0f exceeds canvas width %.0f",
						d.Name, d.X+d.W, l.Width)
				}
				if d.Y+d.H > l.Height {
					t.Errorf("district %s bottom edge %.0f exceeds canvas height %.0f",
						d.Name, d.Y+d.H, l.Height)
				}
			}
		})
	}
}

func TestDistrictsNeverOverlap(t *testing.T) {
	l := layoutOf(t, tree(t, map[string][2]int{
		"a": {3, 2}, "b": {12, 4}, "c": {5, 8}, "d": {9, 1}, "e": {2, 3}, "f": {7, 6},
	}))

	for i, a := range l.Districts {
		for _, b := range l.Districts[i+1:] {
			if a.X+a.W <= b.X || b.X+b.W <= a.X || a.Y+a.H <= b.Y || b.Y+b.H <= a.Y {
				continue // disjoint
			}
			t.Errorf("districts %s and %s overlap", a.Name, b.Name)
		}
	}
}

// Regression: the layout must be a pure function of the analysis.
//
// ADR-0012 rests on determinism — the same repo always produces the same map,
// so a developer keeps their spatial memory of it. Analyze was covered by a
// test; the layout was not.
func TestLayoutIsDeterministic(t *testing.T) {
	root := tree(t, map[string][2]int{"src": {9, 7}, "e2e": {4, 2}, "scripts": {2, 3}})

	first, err := json.Marshal(layoutOf(t, root))
	if err != nil {
		t.Fatal(err)
	}
	// Run repeatedly: a map iteration leaking into the ordering would show up
	// as a difference between runs rather than within one.
	for i := 0; i < 5; i++ {
		next, err := json.Marshal(layoutOf(t, root))
		if err != nil {
			t.Fatal(err)
		}
		if string(first) != string(next) {
			t.Fatalf("layout differed on run %d", i+1)
		}
	}
}

// Every building the analyzer found must appear on the map. A building that
// is analysed but never placed is invisible to the developer, which defeats
// the point of the town.
func TestEveryBuildingIsPlaced(t *testing.T) {
	root := tree(t, map[string][2]int{"src": {9, 7}, "e2e": {6, 2}})
	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	l := LayoutTown(town)

	placed := map[string]bool{}
	for _, s := range l.Sites {
		if s.Kind == PlaceBuilding {
			placed[s.Path] = true
		}
	}

	// Every building with source resolves to a site. The root itself is not a
	// building, so "src" and "e2e" appear while "." does not.
	for _, b := range town.Buildings {
		if !placed[b.Path] {
			t.Errorf("building %q was analysed but never placed on the map", b.Path)
		}
	}
	if len(placed) == 0 {
		t.Fatal("no buildings placed at all")
	}
}

func TestSpecialPlacesAlwaysPresent(t *testing.T) {
	// Even a project with no source needs somewhere for an event to land.
	l := layoutOf(t, t.TempDir())

	want := map[Place]bool{PlaceYard: false, PlaceWorkshop: false, PlaceDepot: false}
	for _, s := range l.Sites {
		if _, ok := want[s.Kind]; ok {
			want[s.Kind] = true
		}
	}
	for kind, found := range want {
		if !found {
			t.Errorf("%s is missing from the layout", kind)
		}
	}
}

func TestSpecialPlacesAreReservedSpace(t *testing.T) {
	// They must not merely exist — they need non-zero size at a real position,
	// or ticket 05 has nothing to walk to.
	l := layoutOf(t, tree(t, map[string][2]int{"src": {3, 4}}))

	for _, s := range l.Sites {
		if s.Kind == PlaceBuilding {
			continue
		}
		if s.W <= 0 || s.H <= 0 {
			t.Errorf("%s has no area (%.0fx%.0f)", s.Kind, s.W, s.H)
		}
		if s.Label == "" {
			t.Errorf("%s has no label", s.Kind)
		}
	}
}

// Building footprint must follow file count, since size is how the town
// communicates which parts of a project are big.
func TestBuildingSizeGrowsWithFiles(t *testing.T) {
	small := layoutOf(t, tree(t, map[string][2]int{"a": {1, 1}}))
	large := layoutOf(t, tree(t, map[string][2]int{"a": {1, 40}}))

	areaOf := func(l Layout) float64 {
		for _, s := range l.Sites {
			if s.Kind == PlaceBuilding {
				return s.W * s.H
			}
		}
		return 0
	}
	if areaOf(large) <= areaOf(small) {
		t.Errorf("a 40-file building (%.0f) is not larger than a 1-file one (%.0f)",
			areaOf(large), areaOf(small))
	}
}

func TestDistrictKindReachesSites(t *testing.T) {
	// The renderer colours test territory differently, and must read that
	// from the layout rather than re-deriving it from geometry.
	l := layoutOf(t, tree(t, map[string][2]int{"src": {3, 5}, "e2e": {3, 5}}))

	for _, s := range l.Sites {
		if s.Kind != PlaceBuilding {
			continue
		}
		if s.DistrictKind == "" {
			t.Errorf("building %s carries no districtKind", s.Path)
		}
		if s.DistrictKind != DistrictTest && s.DistrictKind != DistrictSource {
			t.Errorf("building %s has unexpected districtKind %q", s.Path, s.DistrictKind)
		}
	}
}

// Regression: a test district must not outrank the code it tests.
//
// ADR-0012 records the correction: sized by building count alone, a sprawl of
// one-file spec directories claims more land than the source it covers.
// Measured before the fix: e2e 59340 against src 50400 — the inversion the
// ADR says was corrected, still present because the layout ignored d.Kind.
func TestTestDistrictDoesNotDominateSource(t *testing.T) {
	// src holds many files in few buildings; e2e holds few files in many.
	root := tree(t, map[string][2]int{
		"src": {4, 7},  // 28 files, 4 buildings
		"e2e": {12, 1}, // 12 files, 12 buildings
	})
	l := layoutOf(t, root)

	area := map[string]float64{}
	for _, d := range l.Districts {
		area[d.Name] = d.W * d.H
	}
	if area["src"] == 0 || area["e2e"] == 0 {
		t.Fatalf("missing district: %v", area)
	}
	if area["e2e"] > area["src"] {
		t.Errorf("test district (%.0f) is larger than the source it covers (%.0f) — the inversion ADR-0012 records is present",
			area["e2e"], area["src"])
	}
}

// Source districts keep full spacing; only test districts are tightened.
func TestSourceDistrictKeepsFullSpacing(t *testing.T) {
	root := tree(t, map[string][2]int{"src": {4, 7}})
	l := layoutOf(t, root)

	// 4 buildings of 7 files -> buildingSize(7) = 78
	// cols = ceil(sqrt(4)) = 2, rows = 2
	// blockW = 2*(78+14) - 14 + 2*20 = 210
	const wantW = 2*(78+cellGap) - cellGap + 2*cellPad
	if d := l.Districts[0]; d.W != wantW {
		t.Errorf("source district width = %.0f, want %.0f (full pitch)", d.W, wantW)
	}
}

// TestSiteCarriesDepth is ticket 09's first requirement: the renderer cannot
// limit detail by depth unless it is told each site's depth.
//
// Depth is the number of path segments below the root, so `a` is 1 and `a/b` is
// 2. The layout already receives it on analyzer.Building; it simply was not
// forwarded, which is why no display control could be built.
func TestSiteCarriesDepth(t *testing.T) {
	root := t.TempDir()
	mk := func(rel string) {
		full := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	mk("a/x.go")     // depth 1
	mk("a/b/y.go")   // depth 2
	mk("a/b/c/z.go") // depth 3

	l := layoutOf(t, root)
	got := map[string]int{}
	for _, s := range l.Sites {
		if s.Kind == PlaceBuilding {
			got[s.Path] = s.Depth
		}
	}

	want := map[string]int{"a": 1, "a/b": 2, "a/b/c": 3}
	for path, w := range want {
		if got[path] != w {
			t.Errorf("%s depth = %d, want %d", path, got[path], w)
		}
	}
}

// TestPlacesHaveDepthZero pins that the three special places are always
// visible: a depth filter must never be able to hide the Yard, the Workshop or
// the Depot, because most of a session happens in them. They are not part of
// the directory hierarchy, so they carry depth 0 and any real building is
// deeper than that.
func TestPlacesHaveDepthZero(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "a"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "a", "x.go"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	l := layoutOf(t, root)
	for _, s := range l.Sites {
		if s.Kind == PlaceBuilding {
			continue
		}
		if s.Depth != 0 {
			t.Errorf("place %s has depth %d, want 0 so no depth filter can hide it", s.ID, s.Depth)
		}
	}
}

// TestFloorsFromBytes covers the floors table.
//
// A table rather than a formula, for the reason `buildingSize` gives about its
// own four steps: a continuous scale produces a row of near-identical towers,
// while a table can be argued about row by row and tuned without touching logic.
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
		{"medium", 64_440, false, 5}, // just over the 64 kB step, so 5 not 4
		{"big", 128_342, false, 7},
		{"very big", 487_067, false, 9},
		{"huge", 900_000, false, 12},
		{"enormous", 1_900_000, false, 16},
		{"absurd", 9_000_000, false, 20},
		// The generated rule wins over size, which is the whole point: a
		// compiled bundle is not a tall building however large it is.
		{"generated bundle", 1_682_455, true, 1},
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

// TestFloorsIsMonotonicInBytes pins that more code never means fewer storeys, so
// the map's skyline cannot invert. A town where a larger module drew shorter
// than a smaller one would be worse than having no height at all.
func TestFloorsIsMonotonicInBytes(t *testing.T) {
	prev := 0
	for b := 0; b < 4_000_000; b += 997 {
		f := Floors(Building{Path: "x", TotalBytes: b})
		if f < prev {
			t.Fatalf("bytes %d gave %d floors, fewer than %d at a smaller size", b, f, prev)
		}
		prev = f
	}
}

// TestSiteCarriesFloors is Task 4: the renderer cannot draw a tower unless the
// height reaches it.
//
// The two buildings here have the SAME file count and very different mass, which
// is the whole reason height is a separate reading from footprint. If this ever
// collapses — floors derived from the count again — these two become the same
// building and the map loses the distinction.
func TestSiteCarriesFloors(t *testing.T) {
	root := t.TempDir()
	mk := func(rel string, n int) {
		full := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, bytes.Repeat([]byte("x\n"), n), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// One fat file vs one thin file: same count of one, different mass.
	mk("tall/one.go", 60_000)
	mk("low/one.go", 50)

	l := layoutOf(t, root)
	got := map[string]Site{}
	for _, s := range l.Sites {
		if s.Kind == PlaceBuilding {
			got[s.Path] = s
		}
	}
	tall, low := got["tall"], got["low"]
	if tall.Files != 1 || low.Files != 1 {
		t.Fatalf("file counts = %d and %d, want 1 and 1", tall.Files, low.Files)
	}
	if tall.Floors <= low.Floors {
		t.Errorf("tall=%d floors (%d B) must exceed low=%d floors (%d B) at equal file count",
			tall.Floors, tall.Bytes, low.Floors, low.Bytes)
	}
	if tall.Bytes != 120_000 {
		t.Errorf("tall.Bytes = %d, want 120000 (60000 lines of 2 bytes)", tall.Bytes)
	}
	// Footprint must still follow the COUNT, not the mass.
	if tall.W != low.W {
		t.Errorf("footprints differ (%v vs %v) though both hold one file; bytes leaked into size", tall.W, low.W)
	}
}

// TestPlacesCarryOneFloor pins that the Yard, Workshop and Depot are not
// measured: they are furnished ground, not buildings, and a place with twenty
// storeys would be nonsense.
func TestPlacesCarryOneFloor(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "a"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "a", "x.go"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	l := layoutOf(t, root)
	for _, s := range l.Sites {
		if s.Kind == PlaceBuilding {
			continue
		}
		if s.Floors != 1 {
			t.Errorf("place %s has %d floors, want 1", s.ID, s.Floors)
		}
	}
}

// --- containers: the shallowest view of a repository -----------------------

// TestContainerCoversWhatTheDepthFilterHides is the contract the display filter
// rests on.
//
// A directory is a building only if it holds source directly, so on a project
// laid out as `internal/<pkg>/` the top level is almost empty: the mass is all
// one or two levels down, and once the filter hides those, nothing on the map
// stands for it. Measured before this existed, "top level only" drew one
// building holding 7.9% of the source.
//
// The assertion is the invariant rather than a count, because a count would need
// editing every time this repository grows: whatever the filter hides, some
// visible site must account for its bytes.
func TestContainerCoversWhatTheDepthFilterHides(t *testing.T) {
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
	// A container whose own directory holds nothing: exactly the shape that
	// leaves a hole in the shallowest view.
	mk("svc/alpha/one.go", strings.Repeat("package alpha\n", 400))
	mk("svc/beta/two.go", strings.Repeat("package beta\n", 400))

	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	var found *Container
	for i := range town.Containers {
		if town.Containers[i].Path == "svc" {
			found = &town.Containers[i]
		}
	}
	if found == nil {
		t.Fatalf("no container derived for `svc`, though it holds source only in its children; containers=%v", town.Containers)
	}
	if found.Files != 2 {
		t.Errorf("container svc files = %d, want 2 (its whole subtree)", found.Files)
	}
	if found.Depth != 1 {
		t.Errorf("container svc depth = %d, want 1", found.Depth)
	}
	// It must step aside the moment its children are drawn, or the map shows a
	// tower standing on the same plate as the things it stands for.
	if found.MinChildDepth != 2 {
		t.Errorf("container svc minChildDepth = %d, want 2 (its shallowest child)", found.MinChildDepth)
	}

	l := LayoutTown(town)
	var site *Site
	for i := range l.Sites {
		if l.Sites[i].Path == "svc" && l.Sites[i].Kind == PlaceContainer {
			site = &l.Sites[i]
		}
	}
	if site == nil {
		t.Fatalf("no container site placed for `svc`")
	}
	if site.Floors < 2 {
		t.Errorf("container svc floors = %d, want >= 2: its mass is real work, not an empty plate", site.Floors)
	}
	// The filter must never show the container and its children together.
	for _, f := range []int{1, 2, 3, 4} {
		visContainer := site.Depth <= f && f < site.MinChildDepth
		var visChild bool
		for _, s := range l.Sites {
			if s.Kind == PlaceBuilding && strings.HasPrefix(s.Path, "svc/") && s.Depth <= f {
				visChild = true
			}
		}
		if visContainer && visChild {
			t.Errorf("filter=%d draws `svc` and its children together", f)
		}
	}
}

// TestContainerFloorsExcludeGeneratedOutput is the reason AuthoredBytes exists.
//
// The common case for a Go module is to embed a built UI, so a container's total
// is mostly a compiler's output. Sizing a tower from that total collapses it to
// one storey and hides the authored code — the exact failure the generated rule
// already prevents one level down.
func TestContainerFloorsExcludeGeneratedOutput(t *testing.T) {
	authored := Container{Path: "svc", AuthoredBytes: 323_000, Bytes: 1_500_000, Generated: true}
	// 323 kB sits in the "< 512000 -> 9" band. The point is that it is 9 and not
	// the 16 the total would give.
	if got := ContainerFloors(authored); got != 9 {
		t.Errorf("ContainerFloors with 323000 authored bytes = %d, want 9 (its authored mass)", got)
	}
	if floorsForBytes(authored.Bytes) != 16 {
		t.Fatalf("the fixture no longer distinguishes the two readings: its total gives %d", floorsForBytes(authored.Bytes))
	}
	// The total is deliberately large enough to be 16 storeys: if the rule ever
	// reverts to Bytes this assertion fails rather than quietly drawing a tower.
	thin := Container{Path: "svc", AuthoredBytes: 2_000, Bytes: 2_000_000}
	if got := ContainerFloors(thin); got != 1 {
		t.Errorf("ContainerFloors with 2000 authored bytes = %d, want 1", got)
	}
}

// TestContainersAreDeterministic pins ADR-0012 for the new list.
func TestContainersAreDeterministic(t *testing.T) {
	root := t.TempDir()
	for _, rel := range []string{"a/x/one.go", "a/y/two.go", "b/z/three.go"} {
		full := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte("package p\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	first, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		again, err := Analyze(root)
		if err != nil {
			t.Fatal(err)
		}
		if len(again.Containers) != len(first.Containers) {
			t.Fatalf("run %d: %d containers, first had %d", i, len(again.Containers), len(first.Containers))
		}
		for j := range first.Containers {
			if again.Containers[j] != first.Containers[j] {
				t.Fatalf("run %d container %d differs: %+v vs %+v", i, j, again.Containers[j], first.Containers[j])
			}
		}
	}
}

// TestContainerFootprintIsABakedSizeAndSitsInsideItsPlate pins the defect that
// put a container out of its own neighbourhood.
//
// The daemon sends a site's footprint and the renderer draws that footprint's
// art, so the two have to agree. The first version sent the *plate's* extent
// while the atlas bakes only four sizes, so `internal`'s tower stood 81 units
// left and 66 units up of its plate and `cmd`'s art overflowed its plate by 43
// units vertically. Both were invisible in the code, because each side was
// individually consistent.
func TestContainerFootprintIsABakedSizeAndSitsInsideItsPlate(t *testing.T) {
	root := t.TempDir()
	// A container holding several packages, so its block is comfortably larger
	// than any single building and the mismatch would show.
	for _, rel := range []string{"svc/a/one.go", "svc/b/two.go", "svc/c/three.go", "svc/d/four.go"} {
		full := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(strings.Repeat("package p\n", 200)), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	l := LayoutTown(town)

	baked := map[float64]bool{44: true, 60: true, 78: true, 100: true}
	var checked int
	for _, s := range l.Sites {
		if s.Kind != PlaceContainer {
			continue
		}
		checked++
		if !baked[s.W] || !baked[s.H] {
			t.Errorf("container %s footprint is %vx%v, which the atlas does not bake; the renderer would draw a different size",
				s.Path, s.W, s.H)
		}
		// It must also lie inside its district plate, or the tower stands in the
		// street beside its own neighbourhood.
		var plate *PlacedDistrict
		for i := range l.Districts {
			if l.Districts[i].Name == s.District {
				plate = &l.Districts[i]
			}
		}
		if plate == nil {
			t.Fatalf("container %s has no plate", s.Path)
		}
		if s.X < plate.X || s.Y < plate.Y || s.X+s.W > plate.X+plate.W || s.Y+s.H > plate.Y+plate.H {
			t.Errorf("container %s at (%v,%v %vx%v) is outside its plate (%v,%v %vx%v)",
				s.Path, s.X, s.Y, s.W, s.H, plate.X, plate.Y, plate.W, plate.H)
		}
	}
	if checked == 0 {
		t.Fatal("no container site placed for a tree whose only source is one level down")
	}
}

// TestContainerFitsATightPlate covers the case the cap exists for.
//
// A container's preferred size comes from its file count, and a district's plate
// comes from its *buildings*. Those disagree in size, and a test district is
// where it bites: `testPitch` tightens the cell pitch to 0.7, so a single 44-unit
// spec directory leaves an inner area of 30.8 units while the container standing
// for the whole tree wants a 44-unit cel. Reachable, and it drove the tower
// through its own neighbourhood's kerb.
func TestContainerFitsATightPlate(t *testing.T) {
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
	// `e2e` is a test district, so its cell pitch is tightened. One two-file spec
	// directory is the smallest plate the town can build.
	mk("e2e/one/spec.go", "package spec\n")

	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	l := LayoutTown(town)
	for _, s := range l.Sites {
		if s.Kind != PlaceContainer {
			continue
		}
		var plate PlacedDistrict
		for _, pd := range l.Districts {
			if pd.Name == s.District {
				plate = pd
			}
		}
		if plate.Name == "" {
			t.Fatalf("container %s has no plate", s.Path)
		}
		// The footprint must fit the plate's INNER area, not merely the plate.
		// Asserting against the plate is what let the first version of this test
		// pass while the tower ate the pad: a 44-unit cel does fit inside a
		// 70.8-unit plate, but the inner area is only 30.8 (the plate less
		// `cellPad` on each side), so the art overflowed the ground it was
		// supposed to stand on by 13.2 units.
		if s.X < plate.X+cellPad || s.Y < plate.Y+labelSpace+cellPad ||
			s.X+s.W > plate.X+plate.W-cellPad || s.Y+s.H > plate.Y+plate.H-cellPad {
			t.Errorf("container %s (%vx%v at %v,%v) does not fit the inner area of its plate (%vx%v at %v,%v)",
				s.Path, s.W, s.H, s.X, s.Y, plate.W, plate.H, plate.X, plate.Y)
		}
		// The renderer draws art for exactly this number, so it must be one of
		// the baked sizes.
		switch s.W {
		case 44, 60, 78, 100:
		default:
			t.Errorf("container %s has unbaked width %v", s.Path, s.W)
		}
		if s.W <= 0 || s.H <= 0 {
			t.Errorf("container %s has an empty footprint %vx%v", s.Path, s.W, s.H)
		}
	}
}
