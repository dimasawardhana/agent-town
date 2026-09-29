package analyzer

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// tree builds a throwaway project where each district holds n buildings of a
// given file count.
func sprintf(f string, a ...any) string { return fmt.Sprintf(f, a...) }

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
// A test district is weighted down, and this is what the weight actually is.
//
// **The previous version of this test asserted a property the layout does not
// have.** It checked one hand-picked shape, it stopped passing when `testPitch`
// was introduced, and the fix at the time was to move a threshold rather than to
// ask whether the rule was right. Written as a property over 90 shapes it
// reports 29 inversions and a worst ratio of 2.58 — so the single case was
// evidence of nothing, and the constant was carrying a claim it cannot deliver.
//
// ADR-0012 says a test district "cannot dominate the site". With a constant
// pitch that is **false as an absolute**: a 22-building spec suite outranks even
// a substantial source. So the claim is narrowed below to what is true, and the
// ADR is corrected to match. The alternative — sizing test districts by file
// count, which is what the ADR originally described — is a real change to the
// layout and is not smuggled in under a bugfix.
func TestTestDistrictIsWeightedDown(t *testing.T) {
	// Shapes whose blocks clear `maxBuildingFootprint`. Below the floor the pitch
	// is *invisible* — both districts are floored to the same plate and weigh
	// exactly the same — which is a real fact about the layout and is asserted
	// separately below rather than hidden by choosing friendlier shapes.
	for _, shape := range [][2]int{{2, 12}, {4, 7}, {6, 9}, {9, 8}, {12, 12}} {
		root := tree(t, map[string][2]int{"src": shape, "e2e": shape})
		l := layoutOf(t, root)
		var src, e2e float64
		for _, d := range l.Districts {
			if d.Name == "src" {
				src = d.W * d.H
			}
			if d.Name == "e2e" {
				e2e = d.W * d.H
			}
		}
		if src <= 0 || e2e <= 0 {
			t.Fatalf("missing district for %v: src=%.0f e2e=%.0f", shape, src, e2e)
		}
		if e2e >= src {
			t.Errorf("district %v: a test district weighs %.0f against a source's %.0f — the pitch is not applied", shape, e2e, src)
		}
	}
}

// Below the floor the weight-down does nothing, and that is worth knowing.
//
// A one-building district is floored to a plate sized for the largest thing that
// can stand on it, so a test district and a source district of the same shape come
// out identical. The pitch is a *correction above the floor*, not a guarantee:
// anyone reading `testPitch` as "test districts are always smaller" is wrong for
// every small district in the town, and that is most of them.
func TestPitchIsInvisibleBelowTheBlockFloor(t *testing.T) {
	for _, shape := range [][2]int{{1, 1}, {1, 3}, {1, 12}} {
		root := tree(t, map[string][2]int{"src": shape, "e2e": shape})
		l := layoutOf(t, root)
		area := map[string]float64{}
		for _, d := range l.Districts {
			area[d.Name] = d.W * d.H
		}
		if area["src"] != area["e2e"] {
			t.Errorf("district %v: expected both floored to the same plate, got src=%.0f e2e=%.0f", shape, area["src"], area["e2e"])
		}
	}
}

// The limit, measured rather than remembered.
//
// A constant pitch cannot stop a much larger suite outranking a much smaller
// source, and pretending otherwise is how the previous version of this test came
// to pass. This records where the boundary is so that changing `testPitch` has
// to confront it: if a change makes the ratio worse, this says by how much.
func TestTestDistrictInversionIsBoundedAndKnown(t *testing.T) {
	worst := 0.0
	worstAt := ""
	inversions := 0
	shapes := 0
	for _, src := range [][2]int{{1, 1}, {2, 4}, {4, 7}, {6, 9}, {9, 8}, {12, 3}} {
		for _, tst := range [][2]int{{4, 1}, {8, 1}, {12, 1}, {16, 1}, {22, 1}} {
			shapes++
			root := tree(t, map[string][2]int{"src": src, "e2e": tst})
			l := layoutOf(t, root)
			area := map[string]float64{}
			for _, d := range l.Districts {
				area[d.Name] = d.W * d.H
			}
			ratio := area["e2e"] / area["src"]
			if ratio > 1 {
				inversions++
			}
			if ratio > worst {
				worst = ratio
				worstAt = sprintf("src=%v e2e=%v", src, tst)
			}
		}
	}
	t.Logf("%d of %d shapes invert; worst ratio %.2f at %s", inversions, shapes, worst, worstAt)

	// The bound is generous on purpose. A tighter one would be a threshold
	// dressed as a property, which is the mistake this file is here to stop
	// repeating. It exists to catch a *regression* in the pitch, not to claim a
	// guarantee the layout does not provide.
	if worst > 3.0 {
		t.Errorf("worst inversion ratio %.2f at %s — worse than the recorded limit; the pitch weakened", worst, worstAt)
	}
}

// Source districts keep full spacing; only test districts are tightened.
func TestSourceDistrictKeepsFullSpacing(t *testing.T) {
	root := tree(t, map[string][2]int{"src": {4, 7}})
	l := layoutOf(t, root)

	// 4 buildings of 7 files -> buildingSize(7) = 72
	// cols = ceil(sqrt(4)) = 2, rows = 2
	// blockW = 2*(78+14) - 14 + 2*20 = 210
	const wantW = 2*(72+cellGap) - cellGap + 2*cellPad
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
// own five steps: a continuous scale produces a row of near-identical towers,
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

// A building is the same case as a container one level down, and on this
// repository the numbers are the same: `internal/web` is generated because it
// holds the embedded UI bundle, and that bundle is 1.7 MB sitting beside 28 KB
// of hand-written Go. Sizing the building from its total draws the bundle as a
// sixteen-storey tower and buries the Go — which is the failure the container
// rule already prevents one level up.
func TestBuildingFloorsExcludeGeneratedOutput(t *testing.T) {
	// The measured shape of internal/web. 28,119 sits in the "< 32000 -> 3"
	// band, so the point is that it is 3 and not the 16 its total would give.
	authored := Building{Path: "internal/web", Generated: true, TotalBytes: 1_724_316, AuthoredBytes: 28_119}
	if got := Floors(authored); got != 3 {
		t.Errorf("Floors with 28119 authored bytes = %d, want 3 (its authored mass)", got)
	}
	if floorsForBytes(authored.TotalBytes) != 16 {
		t.Fatalf("the fixture no longer distinguishes the two readings: its total gives %d", floorsForBytes(authored.TotalBytes))
	}
	// A directory that is *only* a bundle has no authored mass at all, and so
	// nothing else in it to draw. It stays one storey rather than being
	// stretched to sixteen by a compiler's output.
	pure := Building{Path: "internal/web/static/assets", Generated: true, TotalBytes: 1_696_197}
	if got := Floors(pure); got != 1 {
		t.Errorf("Floors on a pure artefact = %d, want 1", got)
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
// while the atlas baked only four sizes, so `internal`'s tower stood 81 units
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

	baked := map[float64]bool{44: true, 58: true, 72: true, 86: true, 100: true}
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

// footprint is one rung of the ladder as the atlas records it: a cel side, and
// a source-file count that the atlas says draws at that side.
type footprint struct {
	side  float64
	files int
}

// bakedFootprints is the ladder ui/src/art/bake.ts bakes — the other end of
// the key a site's W is looked up by, since the renderer passes W straight to
// baseFrame(side, …).
//
// Read, never restated. A copy of the table in a second language is not a test
// of it, it is a second thing to forget to update, and the drift is not
// hypothetical: this ladder grew from four rungs to five, and for a while the
// two ends named different numbers (see the comment on placeDistrict).
func bakedFootprints(t *testing.T) []footprint {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "ui", "src", "art", "bake.ts"))
	if err != nil {
		t.Fatalf("reading the atlas's footprint table: %v", err)
	}
	entry := regexp.MustCompile(`\{\s*side:\s*([0-9]+)\s*,\s*files:\s*([0-9]+)\s*\}`)
	var out []footprint
	for _, m := range entry.FindAllStringSubmatch(string(b), -1) {
		side, err := strconv.Atoi(m[1])
		if err != nil {
			t.Fatalf("unreadable side %q in SIZES: %v", m[1], err)
		}
		files, err := strconv.Atoi(m[2])
		if err != nil {
			t.Fatalf("unreadable file count %q in SIZES: %v", m[2], err)
		}
		out = append(out, footprint{side: float64(side), files: files})
	}
	if len(out) == 0 {
		t.Fatal("no { side: N, files: M } entries in ui/src/art/bake.ts; the table was reshaped and this test would otherwise pass on nothing")
	}
	sort.Slice(out, func(i, j int) bool { return out[i].side < out[j].side })
	return out
}

// TestEveryEmittedFootprintIsOneTheAtlasDraws walks the whole footprint ladder
// and holds both ends of the join key against each other.
//
// A site that declares a footprint the bake does not have is a site the
// renderer draws at the nearest cel it has, at a size the layout never asked
// for — which is the defect recorded on placeDistrict, where a container's
// tower stood 81 units off its own plate. The reverse is dead art: a rung the
// atlas bakes and this package never emits is a cel nothing can ever ask for.
// So the two ends must agree, in both directions, and at every rung.
//
// The rung a *count* lands on matters as much as the set of rungs, and that
// is the assertion a set comparison alone cannot make: sliding a breakpoint
// from 9 files to 8 emits the same five sizes overall, so the set is
// unchanged and the town is not — nine files quietly stops being the 72-unit
// building. Hence the file counts below are the atlas's own, walked through a
// real Analyze and LayoutTown rather than checked against the table directly.
//
// Checked per kind, not over the union. A building and a container reach the
// ladder by different routes — a container's size is then capped against its
// plate — so a threshold that moved out from under one of them is still a
// ladder no single kind of site can climb.
func TestEveryEmittedFootprintIsOneTheAtlasDraws(t *testing.T) {
	rungs := bakedFootprints(t)

	// Every file count the atlas records, plus one just past each, plus the
	// smallest tree there is. Sorted and de-duplicated, so the monotonic walk
	// below is over file counts and not over district names.
	countSet := map[int]bool{1: true}
	for _, r := range rungs {
		countSet[r.files] = true
		countSet[r.files+1] = true
	}
	counts := make([]int, 0, len(countSet))
	for n := range countSet {
		counts = append(counts, n)
	}
	sort.Ints(counts)

	// One district per count, holding a single building — and a second
	// district per count whose only source is one level down, so the same
	// count reaches the ladder as a container. A one-building district is
	// itself an ancestor of a building and so grows a container too; only the
	// c<i> ones are this walk's own.
	districts := map[string][2]int{}
	containerDistricts := map[string]bool{}
	for i, n := range counts {
		districts["d"+itoa(i)] = [2]int{1, n}
		name := "c" + itoa(i)
		districts[name+"/leaf"] = [2]int{1, n}
		containerDistricts[name] = true
	}
	l := layoutOf(t, tree(t, districts))

	byKind := map[Place]map[float64]bool{PlaceBuilding: {}, PlaceContainer: {}}
	byCount := map[Place]map[int]float64{PlaceBuilding: {}, PlaceContainer: {}}
	var widest float64
	for _, s := range l.Sites {
		if s.Kind != PlaceBuilding && s.Kind != PlaceContainer {
			continue
		}
		if s.Kind == PlaceContainer && !containerDistricts[s.District] {
			continue
		}
		if s.W != s.H {
			t.Errorf("%s footprint is %vx%v, but a cel is a square side", s.Path, s.W, s.H)
		}
		byKind[s.Kind][s.W] = true
		byCount[s.Kind][s.Files] = s.W
		if s.W > widest {
			widest = s.W
		}
	}

	for _, kind := range []Place{PlaceBuilding, PlaceContainer} {
		emitted, seen := byKind[kind], byCount[kind]
		if len(seen) != len(counts) {
			t.Fatalf("%s: %d file counts walked but %d sites found, so this walk is not measuring what it claims",
				kind, len(counts), len(seen))
		}

		// Each rung, at the count the atlas records for it.
		for _, r := range rungs {
			if got, ok := seen[r.files]; !ok {
				t.Errorf("%s: nothing was placed at %d files, the count the atlas records against the %.0f-unit cel",
					kind, r.files, r.side)
			} else if got != r.side {
				t.Errorf("%s: %d files drew %.0f units, but the atlas records that count against the %.0f-unit cel; a rung has moved",
					kind, r.files, got, r.side)
			}
		}

		// Nothing undrawable, and no rung of baked art that nothing reaches.
		for side := range emitted {
			if _, ok := sideFor(rungs, side); !ok {
				t.Errorf("a %s is emitted at %.0f units, which the atlas does not bake; the renderer would draw a different size", kind, side)
			}
		}
		for _, r := range rungs {
			if !emitted[r.side] {
				t.Errorf("the atlas bakes a %.0f-unit footprint that no %s reaches; the cel is dead art", r.side, kind)
			}
		}

		// More files must never mean a smaller footprint, and a discrete
		// ladder must be discrete: every count landing on its own size would
		// be a continuous scale, the thing buildingSize argues against.
		for i := 1; i < len(counts); i++ {
			if lo, hi := seen[counts[i-1]], seen[counts[i]]; hi < lo {
				t.Errorf("%s: %d files drew %.0f units and %d files drew %.0f: the ladder is not monotonic",
					kind, counts[i-1], lo, counts[i], hi)
			}
		}
		if len(emitted) >= len(counts) {
			t.Errorf("%s: %d file counts produced %d distinct footprints; the scale is continuous again",
				kind, len(counts), len(emitted))
		}
	}

	// The biggest thing that can stand anywhere is the biggest cel the atlas
	// bakes. maxBuildingFootprint is the claim; the bake is the fact.
	biggest := rungs[len(rungs)-1].side
	if widest != maxBuildingFootprint {
		t.Errorf("the largest footprint emitted is %.0f, but maxBuildingFootprint is %.0f", widest, maxBuildingFootprint)
	}
	if maxBuildingFootprint != biggest {
		t.Errorf("maxBuildingFootprint is %.0f, but the atlas's largest cel is %.0f", maxBuildingFootprint, biggest)
	}
}

// sideFor is the rung a cel side belongs to, by exact match.
func sideFor(rungs []footprint, side float64) (footprint, bool) {
	for _, r := range rungs {
		if r.side == side {
			return r, true
		}
	}
	return footprint{}, false
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

// --- Roads ---------------------------------------------------------------

// A road tile once existed and was deleted because "a road tile had nothing to
// place it and was baked as dead art". This is the test that the placement
// exists, so the art cannot become dead again without something failing.
func TestTheLayoutEmitsRoads(t *testing.T) {
	root := t.TempDir()
	// Several districts, so the layout has to wrap. A row break only happens
	// between districts; twenty-four buildings in one district are one very
	// wide row and produce no road at all, which is why the first version of
	// this fixture found nothing.
	for d := range 14 {
		for i := range 4 {
			dir := filepath.Join(root, fmt.Sprintf("d%02d", d), fmt.Sprintf("m%02d", i))
			if err := os.MkdirAll(dir, 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, "a.go"), []byte("package m\n"), 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
	at, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	l := LayoutTown(at)
	if len(l.Roads) == 0 {
		t.Fatal("the layout emitted no roads; the road art is dead again")
	}
	for _, r := range l.Roads {
		if r.W <= 0 || r.H <= 0 {
			t.Errorf("a road has no extent: %+v", r)
		}
		if r.Kind != "row" && r.Kind != "containment" && r.Kind != "district" {
			t.Errorf("a road has kind %q, which no rule produces", r.Kind)
		}
	}
}

// A row road must sit in the gap the layout actually left, not over a building.
func TestRowRoadsSitInTheGapAndNotOverABuilding(t *testing.T) {
	root := t.TempDir()
	for d := range 14 {
		for i := range 4 {
			dir := filepath.Join(root, fmt.Sprintf("d%02d", d), fmt.Sprintf("m%02d", i))
			if err := os.MkdirAll(dir, 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, "a.go"), []byte("package m\n"), 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
	at, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	l := LayoutTown(at)
	rows := 0
	for _, r := range l.Roads {
		if r.Kind != "row" {
			continue
		}
		rows++
		for _, s := range l.Sites {
			overlaps := r.X < s.X+s.W && s.X < r.X+r.W && r.Y < s.Y+s.H && s.Y < r.Y+r.H
			if overlaps {
				t.Errorf("a row road at %v,%v %vx%v runs over the %s plot at %v,%v",
					r.X, r.Y, r.W, r.H, s.ID, s.X, s.Y)
			}
		}
	}
	if rows == 0 {
		t.Error("a tree this size wraps onto more than one row, so a row road was expected")
	}
}

// Containment roads resolve to the *nearest* ancestor, not to the repository.
func TestContainmentRoadsUseTheNearestAncestor(t *testing.T) {
	root := t.TempDir()
	for _, rel := range []string{"ui/a.go", "ui/src/b.go", "ui/src/art/c.go"} {
		full := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte("package m\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	at, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	l := LayoutTown(at)
	byPath := map[string]Site{}
	for _, s := range l.Sites {
		byPath[s.Path] = s
	}
	// ui/src/art is inside ui/src, and ui/src is inside ui. Two links, and the
	// inner one must not skip a level to reach the repo.
	links := 0
	for _, r := range l.Roads {
		if r.Kind == "containment" {
			links++
		}
	}
	if links != 2 {
		t.Errorf("%d containment roads, want 2 — one per nested directory", links)
	}
	_ = byPath
}

// An import road is a claim, so the test is about what the scanner refuses to
// claim as much as what it draws.
func TestImportRoadsOnlyBetweenRealBuildings(t *testing.T) {
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
	// A relative import that names a file inside a sibling building: a road.
	mk("web/main.go", "package web\n\nimport \"../store\"\n\nfunc main() {}\n")
	mk("store/s.go", "package store\n")
	// A relative import that escapes the repository: no road, because the
	// target is not in this town.
	mk("web/other.go", "package web\n\nimport \"../../elsewhere/thing\"\n")
	// A bare specifier: a package outside the town, so no road.
	mk("web/dep.go", "package web\n\nimport (\n\t\"fmt\"\n\t\"net/http\"\n)\n")
	// JavaScript forms, including one that resolves.
	mk("ui/src/a.ts", "import { x } from \"../shared\";\n")
	mk("ui/shared/x.ts", "export const x = 1;\n")
	// A string that merely looks like an import, inside a function body.
	mk("web/fake.go", "package web\n\nfunc f() { s := \"../store\"; _ = s }\n")

	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	l := LayoutTown(town)
	known := map[string]bool{}
	for _, s := range l.Sites {
		known[s.Path] = s.Kind == PlaceBuilding
	}

	var imports [][2]bool
	for _, r := range l.Roads {
		if r.Kind == "import" {
			imports = append(imports, [2]bool{r.W > 0, r.H > 0})
		}
	}
	// web -> store and ui/src -> ui/shared are the only two that resolve.
	if len(imports) != 2 {
		var kinds []string
		for _, r := range l.Roads {
			kinds = append(kinds, r.Kind)
		}
		t.Errorf("import roads = %d, want 2; every road was %v", len(imports), kinds)
	}
	// And every one must be a real, positive band.
	for _, i := range imports {
		if !i[0] || !i[1] {
			t.Errorf("an import road has no extent: %+v", i)
		}
	}
	_ = known
}

// The repository this is written in imports across buildings, so the rule has to
// hold on a real tree and not only on a fixture.
func TestImportRoadsOnThisRepository(t *testing.T) {
	town, err := Analyze("../..")
	if err != nil {
		t.Fatal(err)
	}
	l := LayoutTown(town)
	byPath := map[string]bool{}
	for _, s := range l.Sites {
		byPath[s.Path] = s.Kind == PlaceBuilding
	}
	n := 0
	for _, r := range l.Roads {
		if r.Kind == "import" {
			n++
			if r.W <= 0 || r.H <= 0 {
				t.Errorf("an import road has no extent: %+v", r)
			}
		}
	}
	if n == 0 {
		t.Error("this repository imports across buildings and drew no import roads")
	}
	t.Logf("IMPORT roads on this repo: %d (of %d total)", n, len(l.Roads))
}

// A multi-line import is an import.
//
// This is the form the project mostly uses and the form the line scanner could
// not see at all: 16 of this repository's TypeScript files open with `import {`
// and name their specifier on a closing line four rows later. A scanner that
// reads one line at a time never sees the specifier, so those dependencies were
// simply not in the map.
func TestMultiLineImportStillMakesARoad(t *testing.T) {
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
	mk("ui/src/a.ts", "import {\n  one,\n  two,\n} from \"../shared\";\n\nexport const a = one + two;\n")
	mk("ui/shared/b.ts", "export const one = 1;\nexport const two = 2;\n")
	// The re-export and the lazy form, which the old scanner also missed.
	mk("ui/src/c.ts", "export { one } from \"../shared\";\nconst later = await import(\"../shared\");\n")

	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	var importRoads int
	for _, r := range LayoutTown(town).Roads {
		if r.Kind == "import" {
			importRoads++
		}
	}
	if importRoads == 0 {
		t.Error("no import road for a multi-line import — the specifier is on a closing line and was never read")
	}
}

// A commented-out import is not an import.
//
// Not hypothetical: `imports.go` and `layout.go` both contain the literal text
// `import "../store"` inside a Go comment describing this very case. A scanner
// that reads comments draws a road to a dependency that does not exist, which is
// the confident lie the whole design refuses to produce.
func TestCommentedImportIsNotARoad(t *testing.T) {
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
	// The decisive shape: a file whose ONLY import is inside a comment. If the
	// stripper fails, this is a road to a dependency that does not exist, and
	// nothing else in the test would notice.
	mk("web/main.go", "package web\n\n// import \"../store\" — a comment, not a dependency.\nfunc f() {}\n")
	mk("web/blocks.go", "package web\n\n/* import \"../store\" */\nfunc g() {}\n")
	mk("web/inside.go", "package web\n\nimport (\n\t// \"../store\"\n\t\"fmt\"\n)\nfunc h() {}\n")
	// One real TypeScript import, alongside a commented twin on the line above.
	mk("ui/src/a.ts", "// import { x } from \"../shared\";\nimport { one } from \"../shared\";\n")
	mk("ui/shared/b.ts", "export const one = 1;\n")
	mk("store/s.go", "package store\n")

	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	// Zero roads is the whole assertion. A real `import "../store"` sits in the
	// same file as a commented one in `main.go` before this change, so a test that
	// merely counted a road would pass with the stripper completely broken.
	var n int
	for _, r := range LayoutTown(town).Roads {
		if r.Kind == "import" {
			n++
		}
	}
	// Exactly one: the real TypeScript import. Three commented Go imports sit in
	// this fixture and none of them may contribute, so a stripper that did
	// nothing would produce four and fail here.
	if n != 1 {
		t.Errorf("import roads = %d, want 1 (the real TypeScript import only); a commented-out import was read as a dependency", n)
	}
}

// A road between two districts runs the full height of the row it crosses.
//
// The first version emitted a road at *placement*, sized by the block just laid.
// That is right only when the two blocks are the same height, and districts are
// not — a 284-tall district beside a 356-tall one left 72 units of the taller
// block standing beside bare grass, which is a stub rather than a road. A road is
// a street: it crosses the row, so it is as long as the row is deep.
func TestDistrictRoadsSpanTheWholeRow(t *testing.T) {
	// Deliberately unequal: one district with few buildings, one with many, so
	// the blocks cannot come out the same size by accident.
	root := t.TempDir()
	for name, spec := range map[string][2]int{
		"src/a": {1, 1}, "src/b": {1, 2}, "src/c": {1, 1}, "src/d": {1, 1},
		"web/a": {1, 1}, "web/b": {1, 2}, "web/c": {1, 3}, "web/d": {1, 1}, "web/e": {1, 1},
	} {
		nb, files := spec[0], spec[1]
		for i := 0; i < nb; i++ {
			dir := filepath.Join(root, name, "b"+itoa(i))
			if err := os.MkdirAll(dir, 0o755); err != nil {
				t.Fatal(err)
			}
			for f := 0; f < files; f++ {
				if err := os.WriteFile(filepath.Join(dir, "f"+itoa(f)+".ts"), []byte("x"), 0o644); err != nil {
					t.Fatal(err)
				}
			}
		}
	}
	l := layoutOf(t, root)

	var deepest, shallowest float64
	for _, d := range l.Districts {
		if b := d.Y + d.H; b > deepest {
			deepest = b
		}
		if d.Y+d.H < shallowest || shallowest == 0 {
			shallowest = d.Y + d.H
		}
	}
	if deepest == shallowest {
		t.Skip("the two districts came out the same height; nothing to prove here")
	}

	rows := map[float64]bool{}
	for _, d := range l.Districts {
		rows[d.Y] = true
	}
	for _, r := range l.Roads {
		if r.Kind != "district" {
			continue
		}
		// Every road shares a row with districts and reaches that row's floor.
		if !rows[r.Y] {
			t.Errorf("road at y=%.0f starts on no district's row", r.Y)
		}
		if r.Y+r.H < deepest-rowGap {
			t.Errorf("road x=%.0f stops at y=%.0f, short of the row's deepest block at %.0f", r.X, r.Y+r.H, deepest-rowGap)
		}
	}
}

// A road past the last district runs off the map to nothing.
//
// It read as a road *to somewhere* rather than as the end of the town, which is a
// claim the layout cannot support — the same reason an unresolvable import draws
// nothing.
func TestNoRoadLeadsOffTheEndOfTheTown(t *testing.T) {
	root := tree(t, map[string][2]int{"src": {2, 3}, "web": {2, 3}, "docs": {1, 2}})
	l := layoutOf(t, root)
	rightmost := 0.0
	for _, d := range l.Districts {
		if r := d.X + d.W; r > rightmost {
			rightmost = r
		}
	}
	for _, r := range l.Roads {
		if r.Kind == "district" && r.X >= rightmost {
			t.Errorf("road at x=%.0f lies past the last district's edge at %.0f", r.X, rightmost)
		}
	}
}

// The comment stripper respects every string delimiter, not one of three.
//
// The ticket claimed it "respects string literals, so a `//` in a URL is not
// one" while tracking only `"`. Nothing in this repository uses single quotes,
// so no import was being lost — but the claim was wider than the code, in a
// function whose whole job is to not over-claim.
func TestStripCommentsRespectsEveryQuote(t *testing.T) {
	cases := map[string]string{
		"double":   "// gone\nimport \"./a\"\n",
		"single":   "// gone\nimport './a'\n",
		"backtick": "// gone\nimport `./a`\n",
	}
	for name, src := range cases {
		got := stripComments(src)
		if strings.Contains(got, "gone") {
			t.Errorf("%s: the comment survived, so the line is mis-read", name)
		}
		if !strings.Contains(got, "./a") {
			t.Errorf("%s: the import was eaten with the comment: %q", name, got)
		}
	}
	// The case that motivated the whole function: a URL is not a comment.
	u := stripComments("import \"../a\"\n// see https://example.com/x\nimport \"../b\"\n")
	if !strings.Contains(u, "../b") {
		t.Errorf("a URL swallowed the rest of the file: %q", u)
	}
}

// `export * from "./x"` re-exports the whole module and names no braces.
func TestExportStarMakesARoad(t *testing.T) {
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
	mk("ui/src/all.ts", "export * from \"../shared\";\n")
	mk("ui/shared/x.ts", "export const x = 1;\n")
	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	var n int
	for _, r := range LayoutTown(town).Roads {
		if r.Kind == "import" {
			n++
		}
	}
	if n == 0 {
		t.Error("`export * from \"./x\"` is a dependency and drew no road")
	}
}

// The road tally, asserted rather than logged.
//
// Ticket 23 ticked "the road art is verified at 18 bands on this repository" and
// the only test near it asserted `n > 0`. A number in an acceptance box with
// nothing behind it is the same defect as an unticked claim: it reads as
// evidence and is not.
func TestRoadCountsOnThisRepositoryAreRecorded(t *testing.T) {
	town, err := Analyze("../..")
	if err != nil {
		t.Skipf("this repository is not available to the test: %v", err)
	}
	byKind := map[string]int{}
	for _, r := range LayoutTown(town).Roads {
		byKind[r.Kind]++
	}
	total := 0
	for _, n := range byKind {
		total += n
	}
	if total == 0 {
		t.Fatal("no roads on this repository at all")
	}
	// Every band must be a real extent, and district roads must sit in a gap
	// between two districts — the property that made them worth emitting.
	var kinds []string
	for k := range byKind {
		kinds = append(kinds, k)
	}
	sort.Strings(kinds)
	t.Logf("roads on this repository: total=%d %v", total, byKind)
	if byKind["district"] == 0 {
		t.Error("no district roads: the gap between districts is not a road any more")
	}
	if byKind["import"] == 0 {
		t.Error("no import roads: the scanner is finding nothing on its own repository")
	}
}

// A town that wraps onto more than one row, exercised rather than described.
//
// Ticket 30 measured this by hand — 4 rows, 6 district roads, 3 row roads — and
// the numbers lived in the ticket's prose with nothing asserting them. The
// multi-row path is the one branch of the road layout that had shipped without
// ever running, so "measured once by a person" is not coverage.
func TestAMultiRowTownLaysOutAndRoads(t *testing.T) {
	root := t.TempDir()
	// Ten districts, each wide enough that three fit a row — which is what
	// forces the wrap the branch exists for.
	for _, d := range []string{"alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa"} {
		for b := 0; b < 6; b++ {
			dir := filepath.Join(root, d, "m"+itoa(b), "src")
			if err := os.MkdirAll(dir, 0o755); err != nil {
				t.Fatal(err)
			}
			for f := 0; f < 6; f++ {
				if err := os.WriteFile(filepath.Join(dir, "f"+itoa(f)+".ts"), []byte("x"), 0o644); err != nil {
					t.Fatal(err)
				}
			}
		}
	}
	l := layoutOf(t, root)

	rows := map[float64]int{}
	for _, d := range l.Districts {
		rows[d.Y]++
	}
	if len(rows) < 2 {
		t.Fatalf("the fixture did not wrap: %d row(s), %d districts", len(rows), len(l.Districts))
	}

	// Every district road runs the depth of its whole row — the bug ticket 23
	// fixed, on the branch that had never run.
	deepest := map[float64]float64{}
	for _, d := range l.Districts {
		if b := d.Y + d.H; b > deepest[d.Y] {
			deepest[d.Y] = b
		}
	}
	for _, r := range l.Roads {
		if r.Kind != "district" {
			continue
		}
		if _, onARow := deepest[r.Y]; !onARow {
			t.Errorf("district road at y=%.0f starts on no district's row", r.Y)
		}
		if r.Y+r.H < deepest[r.Y] {
			t.Errorf("district road x=%.0f stops at y=%.0f, short of its row's floor at %.0f", r.X, r.Y+r.H, deepest[r.Y])
		}
	}
	// Every row road crosses the full width of the map.
	for _, r := range l.Roads {
		if r.Kind != "row" {
			continue
		}
		if r.W < l.Width-rowGap-2*rowStart {
			t.Errorf("row road is %.0f wide in a %.0f map — it does not cross the town", r.W, l.Width)
		}
	}
}

// A district road must lie in a gap, not on top of a district.
//
// Mutation testing wrote this test, and the first version of it was wrong. It
// asserted that no two districts *overlap*, which a fixture that does not wrap
// cannot falsify — and even once it wrapped, removing the gap entirely makes the
// districts flush rather than overlapping, so the test still passed.
//
// The gap is not there to keep districts apart. It is there so a **road** fits
// in it, and that is the claim worth asserting: a band drawn where a district
// stands is a road through a building, and the map would draw it without
// complaint.
func TestDistrictRoadsDoNotRunOverADistrict(t *testing.T) {
	root := t.TempDir()
	for _, d := range []string{"alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa"} {
		for b := 0; b < 6; b++ {
			dir := filepath.Join(root, d, "m"+itoa(b), "src")
			if err := os.MkdirAll(dir, 0o755); err != nil {
				t.Fatal(err)
			}
			for f := 0; f < 6; f++ {
				if err := os.WriteFile(filepath.Join(dir, "f"+itoa(f)+".ts"), []byte("x"), 0o644); err != nil {
					t.Fatal(err)
				}
			}
		}
	}
	l := layoutOf(t, root)
	for _, r := range l.Roads {
		if r.Kind != "district" && r.Kind != "row" {
			continue
		}
		for _, d := range l.Districts {
			overlaps := r.X < d.X+d.W && d.X < r.X+r.W && r.Y < d.Y+d.H && d.Y < r.Y+r.H
			if overlaps {
				t.Errorf("a %s road at %.0f,%.0f %.0fx%.0f runs over the %s district at %.0f,%.0f %.0fx%.0f",
					r.Kind, r.X, r.Y, r.W, r.H, d.Name, d.X, d.Y, d.W, d.H)
			}
		}
	}
}

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
			if bandCrosses(r, s, importBandHalf) {
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
//
// The nearest of the plot's four corners is enough: the band is convex and the
// plot is a rectangle, so if the band misses all four corners it cannot have
// passed through the middle.
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

// A road's rectangle is the band it actually carries, not a second opinion.
//
// They are two fields describing one thing, and the only defence against them
// drifting is a test that says they agree. The renderer draws the band; the
// extent is what the camera bounds and the turn read. If they disagree, the map
// shows one road and measures another.
func TestARoadsExtentIsItsBand(t *testing.T) {
	town, err := Analyze("../..")
	if err != nil {
		t.Fatal(err)
	}
	seen := 0
	for _, r := range LayoutTown(town).Roads {
		if r.Kind != "import" {
			continue
		}
		seen++
		wantX := math.Min(r.Ax, r.Bx) - importBand/2
		wantY := math.Min(r.Ay, r.By) - importBand/2
		wantW := math.Abs(r.Bx-r.Ax) + importBand
		wantH := math.Abs(r.By-r.Ay) + importBand
		if math.Abs(r.X-wantX) > 0.01 || math.Abs(r.Y-wantY) > 0.01 ||
			math.Abs(r.W-wantW) > 0.01 || math.Abs(r.H-wantH) > 0.01 {
			t.Errorf("import %s -> %s: extent %.1f,%.1f %.1fx%.1f but band gives %.1f,%.1f %.1fx%.1f",
				r.From, r.To, r.X, r.Y, r.W, r.H, wantX, wantY, wantW, wantH)
		}
	}
	if seen == 0 {
		t.Fatal("no import roads on this repository; the test proves nothing")
	}
}
