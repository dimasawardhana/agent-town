package analyzer

import "testing"

func resolverFor(t *testing.T, root string) *Resolver {
	t.Helper()
	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	return NewResolver(town)
}

func TestResolveNestedFileToDeepestBuilding(t *testing.T) {
	// A file three directories inside a building must land on that building,
	// not on its parent — the deepest match wins.
	root := build(t, map[string]string{"src/domain/tournament/service.ts": "1"})
	r := resolverFor(t, root)

	kind, place, reason := r.Resolve(root + "/src/domain/tournament/service.ts")
	if kind != PlaceBuilding {
		t.Fatalf("kind = %q, want building (reason %q)", kind, reason)
	}
	if place != "src/domain/tournament" {
		t.Errorf("place = %q, want the deepest building", place)
	}
}

func TestResolvePrefersDeeperBuildingOverParent(t *testing.T) {
	root := build(t, map[string]string{
		"src/a.ts":        "1",
		"src/domain/x.ts": "1",
	})

	r := resolverFor(t, root)
	_, place, _ := r.Resolve("src/domain/x.ts")
	if place != "src/domain" {
		t.Errorf("place = %q, want src/domain rather than the shallower src", place)
	}
}

func TestResolveRootFileToWorkshop(t *testing.T) {
	root := build(t, map[string]string{"src/a.ts": "1"})
	r := resolverFor(t, root)

	kind, _, reason := r.Resolve("README.md")
	if kind != PlaceWorkshop {
		t.Errorf("kind = %q, want workshop for a root file (reason %q)", kind, reason)
	}
	if reason != ReasonWorkshop {
		t.Errorf("reason = %q, want %q", reason, ReasonWorkshop)
	}
}

func TestResolveRelativePath(t *testing.T) {
	root := build(t, map[string]string{"src/a/x.ts": "1"})
	r := resolverFor(t, root)

	kind, place, _ := r.Resolve("src/a/x.ts")
	if kind != PlaceBuilding || place != "src/a" {
		t.Fatalf("got (%q, %q), want (building, src/a)", kind, place)
	}
}

func TestResolveOutsideRepoGoesToYard(t *testing.T) {
	root := build(t, map[string]string{"src/a.ts": "1"})
	r := resolverFor(t, root)

	kind, _, reason := r.Resolve("/tmp/somewhere/else/file.ts")
	if kind != PlaceYard {
		t.Errorf("kind = %q, want yard", kind)
	}
	if reason != ReasonOutsideRepo {
		t.Errorf("reason = %q, want %q", reason, ReasonOutsideRepo)
	}
}

func TestResolveInternalURIGoesToDepot(t *testing.T) {
	// omp's read tool accepts skill:// and similar. They are not files.
	root := build(t, map[string]string{"src/a.ts": "1"})
	r := resolverFor(t, root)

	kind, _, reason := r.Resolve("skill://using-superpowers")
	if kind != PlaceDepot {
		t.Errorf("kind = %q, want depot", kind)
	}
	if reason != ReasonInternalURI {
		t.Errorf("reason = %q, want %q", reason, ReasonInternalURI)
	}
}

func TestResolveGlobGoesToYard(t *testing.T) {
	root := build(t, map[string]string{"src/a.ts": "1"})
	r := resolverFor(t, root)

	kind, _, reason := r.Resolve("src/**/*.test.ts")
	if kind != PlaceYard {
		t.Errorf("kind = %q, want yard — a glob names no single place", kind)
	}
	if reason != ReasonGlob {
		t.Errorf("reason = %q, want %q", reason, ReasonGlob)
	}
}

func TestResolveOmpEditHashline(t *testing.T) {
	// omp's edit tool carries the path as a `§<path>` prefix, not as
	// `args.path`. Missing this made every edit arrive pathless.
	root := build(t, map[string]string{"src/domain/tournament/service.ts": "1"})
	r := resolverFor(t, root)

	kind, place, _ := r.Resolve("§src/domain/tournament/service.ts\naaa\n⟪bbb│zzz⟫")
	if kind != PlaceBuilding {
		t.Fatalf("kind = %q, want building", kind)
	}
	if place != "src/domain/tournament" {
		t.Errorf("place = %q, want src/domain/tournament", place)
	}
}

func TestResolveAlwaysReturnsAPlace(t *testing.T) {
	// The contract that matters most: an event never vanishes for want of
	// somewhere to stand.
	root := build(t, map[string]string{"src/a.ts": "1"})
	r := resolverFor(t, root)

	inputs := []string{
		"", "   ", "README.md", "src/a.ts", "/etc/passwd",
		"skill://x", "memory://y", "src/**/*.ts", "§hashline\nbody",
		"../escape.ts", "node_modules/dep/index.js", "////",
	}
	validKinds := map[Place]bool{
		PlaceBuilding: true, PlaceWorkshop: true, PlaceYard: true, PlaceDepot: true,
	}
	for _, in := range inputs {
		kind, _, reason := r.Resolve(in)
		if !validKinds[kind] {
			t.Errorf("Resolve(%q) returned invalid kind %q", in, kind)
		}
		if reason == "" {
			t.Errorf("Resolve(%q) returned no reason", in)
		}
	}
}

func TestResolveUnmappedRealPathGoesToYard(t *testing.T) {
	root := build(t, map[string]string{"src/a.ts": "1"})
	r := resolverFor(t, root)

	// Inside the repo, but under a directory that holds no source.
	kind, _, reason := r.Resolve("assets/logo.svg")
	if kind != PlaceYard {
		t.Errorf("kind = %q, want yard for an in-repo path with no building", kind)
	}
	if reason != ReasonUnmapped {
		t.Errorf("reason = %q, want %q", reason, ReasonUnmapped)
	}
}
