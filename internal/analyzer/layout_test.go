package analyzer

import (
	"encoding/json"
	"os"
	"path/filepath"
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
