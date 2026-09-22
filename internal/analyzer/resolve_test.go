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

// TestResolveHarnessBracketHeader is the regression for the defect that left
// every building unfinishable.
//
// The edit tool's payload names its target on the first line, and the harness
// writes that line as `[path#tag]` rather than as `§path`. Unrecognised, the
// header was treated as an ordinary path, so the wildcard test scanned the
// whole payload — and any edit whose *body* contained a `*` was classified as a
// glob and filed in the Yard. Real work therefore never landed on its building,
// which is why no building could rise: the town was not dropping the work, it
// was misfiling it as site-wide.
func TestResolveHarnessBracketHeader(t *testing.T) {
	root := build(t, map[string]string{"internal/analyzer/resolve.go": "1"})
	r := resolverFor(t, root)

	cases := []struct {
		name string
		in   string
	}{
		{"header alone", "[internal/analyzer/resolve.go#A920]"},
		{"header with a body", "[internal/analyzer/resolve.go#A920]\nPUT 1.=1:\n+\tx := a * b"},
		// The body is what actually triggered the misroute: a `*` anywhere in
		// the patch made the whole edit look like a pattern.
		{"a glob inside the body", "[internal/analyzer/resolve.go#A920]\n+\t// see src/**/*.ts"},
		{"a comment mentioning a wildcard", "[internal/analyzer/resolve.go#A920]\n+\t// hide the * thing"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			kind, place, reason := r.Resolve(c.in)
			if kind != PlaceBuilding {
				t.Fatalf("kind = %q (reason %q), want building — a bracket header names a file, not a pattern", kind, reason)
			}
			if place != "internal/analyzer" {
				t.Errorf("place = %q, want internal/analyzer", place)
			}
		})
	}
}

// TestResolveHeaderStripsTheHashTag pins the tag's removal on its own, because
// a stray `#D006` left on the path would put the edit in whatever directory
// happened to match a prefix — or in none at all.
func TestResolveHeaderStripsTheHashTag(t *testing.T) {
	root := build(t, map[string]string{"src/auth/service.ts": "1"})
	r := resolverFor(t, root)

	for _, in := range []string{
		"[src/auth/service.ts#D006]",
		"§src/auth/service.ts#D006",
		"[src/auth/service.ts#D006]\nPUT >1:",
	} {
		kind, place, reason := r.Resolve(in)
		if kind != PlaceBuilding || place != "src/auth" {
			t.Errorf("Resolve(%q) = (%s,%q,%s), want building src/auth", in, kind, place, reason)
		}
	}
}

// TestResolveBracketInsideAPathIsNotAHeader guards the other direction: the
// bracket form must not start swallowing `[slug]` route directories, which are
// real paths whose bracket sits in the middle rather than at the head.
func TestResolveBracketInsideAPathIsNotAHeader(t *testing.T) {
	root := build(t, map[string]string{"app/[slug]/page.tsx": "1"})
	r := resolverFor(t, root)

	kind, place, reason := r.Resolve("app/[slug]/page.tsx")
	if kind != PlaceBuilding || place != "app/[slug]" {
		t.Errorf("Resolve(app/[slug]/page.tsx) = (%s,%q,%s), want building app/[slug]", kind, place, reason)
	}
}

// TestResolveRealGlobsStillGlob makes sure the header work did not blunt the
// glob rule: a pattern with no header must still be refused a building.
func TestResolveRealGlobsStillGlob(t *testing.T) {
	root := build(t, map[string]string{"src/a.ts": "1"})
	r := resolverFor(t, root)

	for _, in := range []string{"src/**/*.ts", "internal/*/x.go", "*.go"} {
		kind, _, reason := r.Resolve(in)
		if kind != PlaceYard || reason != ReasonGlob {
			t.Errorf("Resolve(%q) = (%s,%s), want yard/glob", in, kind, reason)
		}
	}
}

// TestResolveTruncatedHeaderStillFindsItsFile covers the malformed shape of the
// same defect: a header whose closing bracket never arrived — a log line cut
// mid-write, a client that dropped the tail.
//
// It matters for the same reason the well-formed case does. Left whole, the
// payload would put its edit body in front of the wildcard test, so a `*` in
// the body would misfile the edit as a glob. The payload shape is untrusted
// input; a missing bracket must not be able to route work to the wrong place.
func TestResolveTruncatedHeaderStillFindsItsFile(t *testing.T) {
	root := build(t, map[string]string{"internal/analyzer/resolve.go": "1"})
	r := resolverFor(t, root)

	kind, place, reason := r.Resolve("[internal/analyzer/resolve.go\nPUT 1.=1:\n+\t// a * star")
	if kind != PlaceBuilding || place != "internal/analyzer" {
		t.Errorf("truncated header = (%s,%q,%s), want building internal/analyzer", kind, place, reason)
	}
}

// TestResolveHeaderIsOnlyTheFirstLine is the invariant underneath all of the
// above: nothing below the header line may influence where the edit lands.
func TestResolveHeaderIsOnlyTheFirstLine(t *testing.T) {
	root := build(t, map[string]string{"src/auth/service.ts": "1"})
	r := resolverFor(t, root)

	// A body naming a *different* building must not move the edit. The payload
	// names one file; the body is content.
	bodies := []string{
		"+\t// see ui/src/art/building.ts",
		"+\timport { X } from '../town/town'",
		"+\tsrc/**/*.ts",
		"",
	}
	for _, body := range bodies {
		in := "[src/auth/service.ts#B4F0]\nPUT 1.=1:\n" + body
		kind, place, reason := r.Resolve(in)
		if kind != PlaceBuilding || place != "src/auth" {
			t.Errorf("Resolve with body %q = (%s,%q,%s), want building src/auth", body, kind, place, reason)
		}
	}
}

// TestResolvePathSpellings covers the ways a tool writes the same file.
//
// Each spelling here arrives from a real tool, and each silently misrouted work
// before it was normalised — the path matched no building, fell through to the
// Yard, and the building it belonged to stayed unbuilt while the agent worked
// on it. A miss here is not a cosmetic difference: it is work landing in the
// wrong place.
func TestResolvePathSpellings(t *testing.T) {
	root := build(t, map[string]string{"internal/analyzer/resolve.go": "1"})
	r := resolverFor(t, root)

	for _, in := range []string{
		"internal/analyzer/resolve.go",   // plain
		"./internal/analyzer/resolve.go", // a shell tool's spelling
		"././internal/analyzer/resolve.go",
		`internal\analyzer\resolve.go`, // Windows separators
		`.\internal\analyzer\resolve.go`,
		`"internal/analyzer/resolve.go"`, // quoted
		`'internal/analyzer/resolve.go'`,
		"internal/analyzer/resolve.go:104-141",             // omp's read carries a line range
		"[./internal/analyzer/resolve.go#A920]\nPUT 1.=1:", // header, normalised
	} {
		kind, place, reason := r.Resolve(in)
		if kind != PlaceBuilding || place != "internal/analyzer" {
			t.Errorf("Resolve(%q) = (%s,%q,%s), want building internal/analyzer", in, kind, place, reason)
		}
	}
}

// TestResolveQuotesDoNotMakeAGlob is the same class again: quoting is how a
// shell protects a path, and a quoted glob must still be refused.
func TestResolveQuotesDoNotMakeAGlob(t *testing.T) {
	root := build(t, map[string]string{"src/a.ts": "1"})
	r := resolverFor(t, root)

	kind, _, reason := r.Resolve(`"src/**/*.ts"`)
	if kind != PlaceYard || reason != ReasonGlob {
		t.Errorf("quoted glob = (%s,%s), want yard/glob — quoting must not turn a pattern into a path", kind, reason)
	}
}

// TestNormalisePathLeavesMeaningAlone pins the boundary of the normaliser: it
// may change characters, never meaning. Two paths that name different files
// must stay different.
func TestNormalisePathLeavesMeaningAlone(t *testing.T) {
	cases := map[string]string{
		"a/b":      "a/b",
		"./a/b":    "a/b",
		"a/b/":     "a/b",
		"a/b//":    "a/b",
		`a\b`:      "a/b",
		`"a/b"`:    "a/b",
		"":         "",
		"   ":      "",
		"..":       "..",
		"../a":     "../a",
		"./../a":   "../a",
		"a b/c d":  "a b/c d",
		"[slug]/x": "[slug]/x",
		"a/b.ts#X": "a/b.ts#X",
		"./././a":  "a",
	}
	for in, want := range cases {
		if got := normalisePath(in); got != want {
			t.Errorf("normalisePath(%q) = %q, want %q", in, got, want)
		}
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

// A test command names a directory, not a file. Resolving it through Resolve
// would take the *parent* of the directory and credit the test to the wrong
// building — which is exactly what happened, and why the ladder's finishing
// ranks could never be reached.
func TestResolveDirMapsADirectoryToItsBuilding(t *testing.T) {
	root := build(t, map[string]string{"internal/town/a.go": "1"})
	r := resolverFor(t, root)

	kind, place, reason := r.ResolveDir("internal/town")
	if kind != PlaceBuilding {
		t.Fatalf("kind = %q, want building (reason %q)", kind, reason)
	}
	if place != "internal/town" {
		t.Errorf("place = %q, want internal/town", place)
	}
}

// The deepest match wins for a directory too, so a test of a nested package
// lands on that package rather than on its parent.
func TestResolveDirPrefersTheDeepestBuilding(t *testing.T) {
	root := build(t, map[string]string{
		"internal/a.go":      "1",
		"internal/town/b.go": "1",
	})
	r := resolverFor(t, root)

	// The directory given is the nested one, so it must resolve to itself.
	if _, place, _ := r.ResolveDir("internal/town"); place != "internal/town" {
		t.Errorf("place = %q, want internal/town", place)
	}
	// A path *inside* the nested building resolves to it as well.
	if _, place, _ := r.ResolveDir("internal/town/sub"); place != "internal/town" {
		t.Errorf("place = %q, want the deepest building internal/town", place)
	}
	// And the parent still resolves to itself when named directly.
	if _, place, _ := r.ResolveDir("internal"); place != "internal" {
		t.Errorf("place = %q, want internal", place)
	}
}

func TestResolveDirNormalisesTheFormsThatMeanTheSamePlace(t *testing.T) {
	root := build(t, map[string]string{"src/a.ts": "1"})
	r := resolverFor(t, root)

	for _, in := range []string{"src", "./src", "src/", root + "/src"} {
		_, place, reason := r.ResolveDir(in)
		if place != "src" {
			t.Errorf("ResolveDir(%q) = %q (reason %q), want src", in, place, reason)
		}
	}
}

// A directory that holds no source of its own belongs to no building, and the
// repo root is not a building.
func TestResolveDirFallsBackToTheYard(t *testing.T) {
	root := build(t, map[string]string{"src/a.ts": "1"})
	r := resolverFor(t, root)

	for _, in := range []string{"", ".", "assets", "scripts/tools"} {
		kind, place, reason := r.ResolveDir(in)
		if kind != PlaceYard {
			t.Errorf("ResolveDir(%q) kind = %q, want yard", in, kind)
		}
		if place != "" {
			t.Errorf("ResolveDir(%q) place = %q, want empty", in, place)
		}
		if reason == "" {
			t.Errorf("ResolveDir(%q) returned no reason; a miss must never be silent", in)
		}
	}
}

// The same refusals Resolve makes apply to a directory, for the same reasons.
func TestResolveDirRefusesWhatIsNotADirectory(t *testing.T) {
	root := build(t, map[string]string{"src/a.ts": "1"})
	r := resolverFor(t, root)

	if kind, _, reason := r.ResolveDir("skill://foo"); kind != PlaceDepot {
		t.Errorf("kind = %q (reason %q), want depot for an internal URI", kind, reason)
	}
	if kind, _, reason := r.ResolveDir("src/*"); kind != PlaceYard {
		t.Errorf("kind = %q (reason %q), want yard for a pattern", kind, reason)
	}
	if kind, _, reason := r.ResolveDir("../../elsewhere"); kind != PlaceYard {
		t.Errorf("kind = %q (reason %q), want yard outside the repo", kind, reason)
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
