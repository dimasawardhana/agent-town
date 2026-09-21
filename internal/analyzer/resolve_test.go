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

// literalTown builds a town from building paths alone. Resolution is pure, so
// these tests need no filesystem and no analysis pass.
func literalTown(buildings ...string) *Town {
	town := &Town{Root: "/town", Buildings: []Building{}, Districts: []District{}}
	for _, b := range buildings {
		town.Buildings = append(town.Buildings, Building{
			Path:     b,
			Name:     lastSegment(b),
			District: districtOf(b),
		})
	}
	return town
}

func TestResolveBracketedDirectoryIsABuilding(t *testing.T) {
	// A Next.js app-router route is a real directory whose name contains
	// brackets, so `src/app/[slug]/page.tsx` is an edit to that building.
	// Treating every `[` as a glob put the worker in the Yard for a file that
	// belongs to one building — the town reporting site-wide work on a
	// building's file.
	r := NewResolver(literalTown(
		"src/app/[slug]",
		"src/app/dashboard/[id]",
		"src/app/[...catchAll]",
		"src/domain",
	))

	cases := map[string]string{
		"src/app/[slug]/page.tsx":         "src/app/[slug]",
		"src/app/dashboard/[id]/page.tsx": "src/app/dashboard/[id]",
		"src/app/[...catchAll]/route.ts":  "src/app/[...catchAll]",
		// Bracketed segment inside an ordinary building: the deepest known
		// building still wins.
		"src/domain/[id]/handler.ts": "src/domain",
	}
	for in, want := range cases {
		kind, place, reason := r.Resolve(in)
		if kind != PlaceBuilding {
			t.Errorf("Resolve(%q) kind = %q, want building (reason %q)", in, kind, reason)
			continue
		}
		if place != want {
			t.Errorf("Resolve(%q) place = %q, want %q", in, place, want)
		}
		if reason != ReasonBuilding {
			t.Errorf("Resolve(%q) reason = %q, want %q", in, reason, ReasonBuilding)
		}
	}
}

func TestResolveBracketedPathWithNoBuildingIsAGlob(t *testing.T) {
	// Brackets are only given the benefit of the doubt until the building
	// lookup fails. A bracketed path matching nothing is the pattern it looks
	// like — a character class — and names no single place.
	r := NewResolver(literalTown("src/app/[slug]"))

	for _, in := range []string{
		"src/pages/[id]/page.tsx",
		"src/[ab]/file.ts",
		"[misc]/file.ts",
	} {
		kind, place, reason := r.Resolve(in)
		if kind != PlaceYard || place != "" {
			t.Errorf("Resolve(%q) = (%q, %q), want yard with no place", in, kind, place)
		}
		if reason != ReasonGlob {
			t.Errorf("Resolve(%q) reason = %q, want %q", in, reason, ReasonGlob)
		}
	}
}

func TestResolveWildcardsStillGoToTheYard(t *testing.T) {
	// `*` and `?` are unambiguous wildcards, so a path carrying either is a
	// pattern. Unchanged from before the bracket rule.
	r := NewResolver(literalTown("src/app/[slug]", "src/domain"))

	for _, in := range []string{"src/**/*.ts", "*.go", "src/*.ts", "src/?.ts"} {
		kind, place, reason := r.Resolve(in)
		if kind != PlaceYard {
			t.Errorf("Resolve(%q) kind = %q, want yard — a glob names no single place", in, kind)
		}
		if place != "" {
			t.Errorf("Resolve(%q) place = %q, want none", in, place)
		}
		if reason != ReasonGlob {
			t.Errorf("Resolve(%q) reason = %q, want %q", in, reason, ReasonGlob)
		}
	}
}
