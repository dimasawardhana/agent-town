package analyzer

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The import-road claim, checked against more than one repository.
//
// A previous version of this asserted that a low road count was *structural* —
// "this repository has two TypeScript buildings, so most imports resolve within
// one". It was wrong: on this repository 111 of 176 import statements are
// cross-building, and the count is low because the edge set is deduplicated.
//
// But "wrong on one sample" is not "right on three", so the explanation is now
// measured wherever a repository happens to be. **Measured, on three real
// repositories, all of them present on this machine at the time of writing:
//
//	repo                buildings  roads  same  cross  unresolvable  collapse
//	team-builder              32     60    87    214             6      3.6x
//	wedding-invitation        19      0    32      0             1        —
//	agent-town                14      9    65    111             0     12.3x
//
// Two things fall out of that, and neither is visible from any single row:
//
// **The collapse ratio is a property of how coupled a repository is, not a
// constant.** 3.6x here, 12.3x on this repository, where `ui/src` and
// `ui/src/art` import each other constantly. Reporting "imports collapse to
// roads" without the ratio is as uninformative as reporting the road count.
//
// **`wedding-invitation` has 19 buildings, 32 imports and zero roads.** Every
// one of those imports is internal to its own building. That is the case the old
// explanation was reaching for and it is real — it is just not *this*
// repository, which is how a true fact became a false one applied too broadly.
func TestImportRoadCollapseIsAMeasurementNotAnAssumption(t *testing.T) {
	if testing.Short() {
		t.Skip("walks repositories outside this module")
	}
	for _, root := range []string{
		"/home/dimasajiwardhana/Documents/code/team-builder",
		"/home/dimasajiwardhana/Documents/code/wedding-invitation",
		"../..",
	} {
		town, err := Analyze(root)
		if err != nil {
			t.Logf("%-20s unavailable: %v", filepath.Base(root), err)
			continue
		}
		buildings := map[string]bool{}
		for _, b := range town.Buildings {
			buildings[filepath.ToSlash(b.Path)] = true
		}
		edges := importEdges(root, buildings)
		same, cross, unresolvable := 0, 0, 0
		_ = filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
			if err != nil || info.IsDir() {
				return nil
			}
			ext := filepath.Ext(p)
			if (ext != ".ts" && ext != ".tsx" && ext != ".go") || strings.Contains(p, "node_modules") {
				return nil
			}
			rel, _ := filepath.Rel(root, p)
			from := buildingOf(filepath.ToSlash(rel), buildings)
			for _, spec := range importSpecifiers(p) {
				if !strings.HasPrefix(spec, ".") && !strings.HasPrefix(spec, "/") {
					continue
				}
				switch to := resolveImport(root, p, spec, buildings); {
				case to == "":
					unresolvable++
				case from == to || from == "":
					same++
				default:
					cross++
				}
			}
			return nil
		})
		// The invariant, and the one the old claim would have failed: wherever
		// there are cross-building imports there is at least one road, and never
		// more roads than edges.
		if cross > 0 && len(edges) == 0 {
			t.Errorf("%s: %d cross-building imports produced no road", filepath.Base(root), cross)
		}
		if len(edges) > cross {
			t.Errorf("%s: %d roads from %d cross-building imports — the map is drawing edges that do not exist", filepath.Base(root), len(edges), cross)
		}
		t.Logf("%-20s buildings=%3d roads=%3d same=%3d cross=%3d unres=%3d",
			filepath.Base(root), len(town.Buildings), len(edges), same, cross, unresolvable)
	}
}
