package town

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/dimasajiwardhana/agent-town/internal/analyzer"
)

// project builds a throwaway repo and its resolver.
func project(t *testing.T, files ...string) *analyzer.Resolver {
	t.Helper()
	root := t.TempDir()
	for _, f := range files {
		full := filepath.Join(root, f)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	town, err := analyzer.Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	return analyzer.NewResolver(town)
}

func TestFileInsideBuildingLandsOnThatBuilding(t *testing.T) {
	r := project(t, "src/auth/service.ts", "src/auth/token.ts")

	c := Classify("edit", map[string]any{"path": "src/auth/service.ts"}, r)
	if c.Place != analyzer.PlaceBuilding {
		t.Fatalf("place = %q, want building (reason %q)", c.Place, c.Reason)
	}
	if c.Path != "src/auth" {
		t.Errorf("path = %q, want src/auth", c.Path)
	}
	if c.Action != ActionHammer {
		t.Errorf("action = %q, want hammering", c.Action)
	}
}

func TestRootFileLandsInWorkshop(t *testing.T) {
	r := project(t, "src/a.ts")

	c := Classify("read", map[string]any{"path": "package.json"}, r)
	if c.Place != analyzer.PlaceWorkshop {
		t.Errorf("place = %q, want workshop", c.Place)
	}
	if c.Action != ActionInspect {
		t.Errorf("action = %q, want inspecting", c.Action)
	}
}

// The claim the ticket rests on: site-wide work must be visible, not dropped.
func TestSiteWideWorkLandsInTheYard(t *testing.T) {
	r := project(t, "src/a.ts")

	cases := map[string]map[string]any{
		"bash with no path": {"command": "git log --oneline"},
		"npm install":       {"command": "npm install"},
		"a build":           {"command": "go build ./..."},
		"grep with no path": {"pattern": "foo"},
		"a glob":            {"path": "src/**/*.ts"},
	}
	for name, args := range cases {
		t.Run(name, func(t *testing.T) {
			tool := "bash"
			if args["pattern"] != nil || args["path"] != nil {
				tool = "grep"
			}
			c := Classify(tool, args, r)
			if c.Place != analyzer.PlaceYard {
				t.Errorf("place = %q, want yard (reason %q)", c.Place, c.Reason)
			}
		})
	}
}

func TestTestCommandGetsItsOwnAction(t *testing.T) {
	r := project(t, "src/a.ts")

	for _, cmd := range []string{
		"npx vitest run", "go test ./...", "pytest -q",
		"npx playwright test", "npm test", "npx tsc --noEmit",
	} {
		c := Classify("bash", map[string]any{"command": cmd}, r)
		if c.Action != ActionTest {
			t.Errorf("%q -> action %q, want testing", cmd, c.Action)
		}
		if c.Place != analyzer.PlaceYard {
			t.Errorf("%q -> place %q, want yard", cmd, c.Place)
		}
	}
}

// Roughly a third of a real session is meta work. Without the Depot it would
// render as a worker standing still.
func TestMetaToolsLandInTheDepot(t *testing.T) {
	r := project(t, "src/a.ts")

	for _, tool := range []string{"hub", "todo", "task", "eval", "ask", "reflect"} {
		c := Classify(tool, map[string]any{}, r)
		if c.Place != analyzer.PlaceDepot {
			t.Errorf("%s -> place %q, want depot", tool, c.Place)
		}
		if c.Action != ActionPlan {
			t.Errorf("%s -> action %q, want planning", tool, c.Action)
		}
	}
}

func TestCreateAndDeleteMapToBuildAndDemolish(t *testing.T) {
	r := project(t, "src/a.ts")

	if c := Classify("write", map[string]any{"path": "src/new.ts"}, r); c.Action != ActionBuild {
		t.Errorf("write -> %q, want building", c.Action)
	}
	if c := Classify("delete", map[string]any{"path": "src/old.ts"}, r); c.Action != ActionDemolish {
		t.Errorf("delete -> %q, want demolishing", c.Action)
	}
}

// The criterion that matters most: no action is ever left without a place.
func TestEveryActionGetsAPlace(t *testing.T) {
	r := project(t, "src/a.ts")

	validPlaces := map[analyzer.Place]bool{
		analyzer.PlaceBuilding: true, analyzer.PlaceWorkshop: true,
		analyzer.PlaceYard: true, analyzer.PlaceDepot: true,
	}

	// The real tool distribution from a measured omp session, plus the edge
	// cases a naive implementation drops.
	tools := []struct {
		name string
		args map[string]any
	}{
		{"bash", map[string]any{"command": "echo hi"}},
		{"hub", map[string]any{}},
		{"read", map[string]any{"path": "src/a.ts"}},
		{"write", map[string]any{"path": "src/b.ts"}},
		{"edit", map[string]any{"path": "src/a.ts"}},
		{"todo", map[string]any{}},
		{"task", map[string]any{}},
		{"eval", map[string]any{}},
		{"grep", map[string]any{"pattern": "x"}},
		{"read", map[string]any{"path": "skill://using-superpowers"}},
		{"read", map[string]any{"path": "/etc/passwd"}},
		{"read", map[string]any{"path": "sub/*.txt"}},
		{"read", map[string]any{}},
		{"edit", map[string]any{"input": "§src/a.ts\nold\nnew"}},
		{"some_unknown_tool", map[string]any{}},
		{"some_unknown_tool", map[string]any{"path": "src/a.ts"}},
		{"", map[string]any{}},
	}

	for _, tc := range tools {
		c := Classify(tc.name, tc.args, r)
		if !validPlaces[c.Place] {
			t.Errorf("tool %q args %v -> invalid place %q", tc.name, tc.args, c.Place)
		}
		if c.Reason == "" {
			t.Errorf("tool %q produced no reason", tc.name)
		}
	}
}

// omp's edit carries the path as a § prefix on a hashline string, not as a
// path field. Missing this made every edit arrive pathless.
func TestOmpEditHashlineResolves(t *testing.T) {
	r := project(t, "src/auth/service.ts")

	c := Classify("edit", map[string]any{"input": "§src/auth/service.ts\nold\n⟪a│b⟫"}, r)
	if c.Place != analyzer.PlaceBuilding || c.Path != "src/auth" {
		t.Errorf("got place=%q path=%q, want building src/auth", c.Place, c.Path)
	}
}

// Every tool name observed in a real omp session must classify.
func TestRealSessionToolDistribution(t *testing.T) {
	r := project(t, "src/a.ts")
	// Measured from a real session, in descending frequency.
	observed := []string{
		"bash", "hub", "read", "write", "edit", "todo", "task", "eval", "ask", "grep",
	}
	for _, tool := range observed {
		c := Classify(tool, map[string]any{"command": "echo x", "path": "src/a.ts"}, r)
		if c.Place == "" {
			t.Errorf("real tool %q classified to nothing", tool)
		}
	}
}
