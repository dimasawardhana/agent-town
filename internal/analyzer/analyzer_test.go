package analyzer

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// build creates a throwaway tree. Keys are paths; a trailing "/" makes a
// directory, and a "*" prefix marks a file as empty.
func build(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()
	for path, content := range files {
		full := filepath.Join(root, path)
		if content == "" && filepath.Ext(path) == "" {
			if err := os.MkdirAll(full, 0o755); err != nil {
				t.Fatal(err)
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func TestBuildingPerSourceDirectory(t *testing.T) {
	root := build(t, map[string]string{
		"src/auth/service.ts": "export const a = 1",
		"src/auth/token.ts":   "export const b = 2",
		"src/user/user.ts":    "export const c = 3",
	})

	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(town.Buildings) != 2 {
		t.Fatalf("got %d buildings, want 2: %+v", len(town.Buildings), town.Buildings)
	}
	for _, b := range town.Buildings {
		if b.Path == "src/auth" && b.Files != 2 {
			t.Errorf("src/auth has %d files, want 2", b.Files)
		}
	}
}

func TestVendoredNoiseIsExcluded(t *testing.T) {
	// This is the Image-nation shape: a flood of vendored files beside a
	// handful of real ones. If the ignore rules fail, the town becomes
	// thousands of buildings and is unusable.
	files := map[string]string{
		"upscaleai/worker/main.py": "print(1)",
		"upscaleai/api/app.py":     "print(2)",
	}
	for i := 0; i < 50; i++ {
		name := filepath.Join("venv", "lib", "pkg", string(rune('a'+i%26))+".py")
		files[name] = "vendored"
		files[filepath.Join("node_modules", "dep", "index.js")] = "module.exports={}"
		files[filepath.Join("onyx_data", "blob.bin")] = "x"
		files[filepath.Join("build", "out.py")] = "generated"
	}
	root := build(t, files)

	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(town.Buildings) != 2 {
		var paths []string
		for _, b := range town.Buildings {
			paths = append(paths, b.Path)
		}
		t.Fatalf("got %d buildings, want only the 2 real ones: %v", len(town.Buildings), paths)
	}
}

func TestGeneratedFileSuffixesExcluded(t *testing.T) {
	root := build(t, map[string]string{
		"src/app.py":        "print(1)",
		"src/app.pyc":       "bytecode",
		"src/bundle.min.js": "minified",
		"src/types.d.ts":    "export {}",
		"src/real.ts":       "export const x = 1",
		"src/big.o":         "object",
		"src/.hidden.ts":    "hidden",
	})

	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	// Only app.py and real.ts are source. app.pyc is a suffix match,
	// bundle.min.js is a suffix match, types.d.ts is still .ts so it counts,
	// big.o is a suffix match, .hidden.ts is a dotfile.
	// src is one building holding app.py, real.ts and types.d.ts.
	if len(town.Buildings) != 1 {
		t.Fatalf("got %d buildings, want 1: %+v", len(town.Buildings), town.Buildings)
	}
	if got := town.Buildings[0].Files; got != 3 {
		t.Errorf("src holds %d source files, want 3 (app.py, real.ts, types.d.ts)", got)
	}
}

func TestRootIsNotABuilding(t *testing.T) {
	root := build(t, map[string]string{
		"README.md":    "docs",
		"package.json": "{}",
		"src/app.ts":   "export const a = 1",
	})

	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range town.Buildings {
		if b.Path == "." || b.Path == "" {
			t.Fatal("the repo root became a building; root files belong to the Workshop")
		}
	}
	if len(town.Buildings) != 1 || town.Buildings[0].Path != "src" {
		t.Fatalf("expected exactly [src], got %+v", town.Buildings)
	}
}

func TestDistrictIsFirstSegment(t *testing.T) {
	root := build(t, map[string]string{
		"src/a/x.ts": "1",
		"src/b/y.ts": "1",
		"e2e/c/z.ts": "1",
	})

	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]int{}
	for _, d := range town.Districts {
		got[d.Name] = d.Buildings
	}
	if got["src"] != 2 || got["e2e"] != 1 {
		t.Fatalf("districts = %+v, want src:2 e2e:1", got)
	}
}

func TestDeterministic(t *testing.T) {
	// The layout depends on stable ordering, so two runs must agree exactly.
	root := build(t, map[string]string{
		"src/b/y.ts": "1", "src/a/x.ts": "1", "src/c/z.ts": "1",
		"e2e/d/w.ts": "1",
	})

	first, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	second, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Buildings) != len(second.Buildings) {
		t.Fatal("building count differs between runs")
	}
	for i := range first.Buildings {
		if first.Buildings[i].Path != second.Buildings[i].Path {
			t.Fatalf("order differs at %d: %q vs %q",
				i, first.Buildings[i].Path, second.Buildings[i].Path)
		}
	}
}

func TestTotalIncludesSubdirectories(t *testing.T) {
	root := build(t, map[string]string{
		"src/one.ts":        "1",
		"src/auth/two.ts":   "1",
		"src/auth/sub/x.ts": "1",
	})

	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	byPath := map[string]Building{}
	for _, b := range town.Buildings {
		byPath[b.Path] = b
	}
	if got := byPath["src"].Total; got != 3 {
		t.Errorf("src.Total = %d, want 3 (includes subdirectories)", got)
	}
	if got := byPath["src"].Files; got != 1 {
		t.Errorf("src.Files = %d, want 1 (direct only)", got)
	}
}

func TestLargerProjectYieldsLargerTown(t *testing.T) {
	small := build(t, map[string]string{"src/a/x.ts": "1"})
	large := build(t, map[string]string{
		"src/a/x.ts": "1", "src/b/y.ts": "1", "src/c/z.ts": "1",
		"src/d/w.ts": "1", "src/e/v.ts": "1",
	})

	s, err := Analyze(small)
	if err != nil {
		t.Fatal(err)
	}
	l, err := Analyze(large)
	if err != nil {
		t.Fatal(err)
	}
	if len(l.Buildings) <= len(s.Buildings) {
		t.Fatalf("larger project produced %d buildings, not more than %d",
			len(l.Buildings), len(s.Buildings))
	}
}

func TestEmptyRepoIsAnEmptyTown(t *testing.T) {
	root := t.TempDir()
	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(town.Buildings) != 0 || len(town.Districts) != 0 {
		t.Fatalf("empty repo produced %d buildings, %d districts",
			len(town.Buildings), len(town.Districts))
	}
}

func TestNonexistentPathErrors(t *testing.T) {
	if _, err := Analyze("/definitely/not/a/real/path/xyz"); err == nil {
		t.Fatal("expected an error for a nonexistent path")
	}
}

func TestGitignoredDirectoriesExcluded(t *testing.T) {
	// A repo declares what is generated in .gitignore. Reading it beats
	// hardcoding each tool's output directory — the repo already knows.
	root := build(t, map[string]string{
		".gitignore":                   "playwright-report/\ntest-results/\n# a comment\n",
		"src/app.ts":                   "export const a = 1",
		"playwright-report/index.html": "<html>",
		"test-results/junit.json":      "{}",
	})

	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	var paths []string
	for _, b := range town.Buildings {
		paths = append(paths, b.Path)
	}
	if len(town.Buildings) != 1 || town.Buildings[0].Path != "src" {
		t.Fatalf("got %v, want only [src] — gitignored dirs must not become buildings", paths)
	}
}

func TestTopLevelDirectoryIsItsOwnDistrict(t *testing.T) {
	// `scripts` sits at the top level with no slash in its path. It must be
	// its own district, not filed under the Workshop.
	root := build(t, map[string]string{
		"scripts/deploy.sh": "#!/bin/sh",
		"src/app.ts":        "export const a = 1",
	})

	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, d := range town.Districts {
		if d.Name == string(PlaceWorkshop) {
			t.Fatal("a top-level directory was misfiled as the Workshop")
		}
	}
	names := map[string]bool{}
	for _, d := range town.Districts {
		names[d.Name] = true
	}
	if !names["scripts"] || !names["src"] {
		t.Fatalf("districts = %v, want both scripts and src", names)
	}
}

func TestHiddenFilesAreNotSource(t *testing.T) {
	root := build(t, map[string]string{
		"src/.eslintrc.js": "module.exports={}",
		"src/app.ts":       "export const a = 1",
	})

	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(town.Buildings) != 1 {
		t.Fatalf("got %d buildings, want 1", len(town.Buildings))
	}
	if got := town.Buildings[0].Files; got != 1 {
		t.Errorf("Files = %d, want 1 — a dotfile is tooling, not construction", got)
	}
}

func TestTestDistrictsAreMarked(t *testing.T) {
	// A test district can hold many more buildings than the source district
	// while holding fewer files. The layout must be able to tell them apart
	// or the test framework gets more land than the code it tests.
	root := build(t, map[string]string{
		"src/a/x.ts": "1", "src/b/y.ts": "1", "src/c/z.ts": "1",
		"e2e/p/w.ts": "1", "e2e/q/v.ts": "1", "e2e/r/u.ts": "1", "e2e/s/t.ts": "1",
	})

	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	kinds := map[string]Place{}
	for _, d := range town.Districts {
		kinds[d.Name] = d.Kind
	}
	if kinds["e2e"] != DistrictTest {
		t.Errorf("e2e kind = %q, want %q", kinds["e2e"], DistrictTest)
	}
	if kinds["src"] != DistrictSource {
		t.Errorf("src kind = %q, want %q", kinds["src"], DistrictSource)
	}
}

func TestEmptyTownMarshalsAsEmptyNotNull(t *testing.T) {
	// A project with no source is a normal state. Its lists must serialise as
	// [] rather than null, or the UI has to special-case an empty town.
	root := t.TempDir()
	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}

	b, err := json.Marshal(town)
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(b, &raw); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"buildings", "districts"} {
		if string(raw[key]) == "null" {
			t.Errorf("%s marshalled as null, want []", key)
		}
	}

	l := LayoutTown(town)
	lb, err := json.Marshal(l)
	if err != nil {
		t.Fatal(err)
	}
	var lraw map[string]json.RawMessage
	if err := json.Unmarshal(lb, &lraw); err != nil {
		t.Fatal(err)
	}
	// The three special places are always laid out, so sites is never empty —
	// but districts may be.
	if string(lraw["districts"]) == "null" {
		t.Error("layout.districts marshalled as null, want []")
	}
	if string(lraw["sites"]) == "null" {
		t.Error("layout.sites marshalled as null, want []")
	}
}

// TestBuildingByteTotals covers Task 1: a building's height comes from its
// source *mass*, not its file count. The two are genuinely different readings —
// a directory of two vendored blobs and one of forty small modules can hold the
// same count and wildly different weight — and the map needs both, because the
// count drives the footprint and the bytes drive the storeys.
func TestBuildingByteTotals(t *testing.T) {
	root := t.TempDir()
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
	// A non-source file must not count toward a building's mass, however large.
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
		t.Errorf("parent.Bytes = %d, want 300 (100+200, direct source only)", parent.Bytes)
	}
	if parent.TotalBytes != 600 {
		t.Errorf("parent.TotalBytes = %d, want 600 (100+200+300)", parent.TotalBytes)
	}
	child := byPath["parent/child"]
	if child.Bytes != 300 || child.TotalBytes != 300 {
		t.Errorf("child = (%d,%d), want (300,300)", child.Bytes, child.TotalBytes)
	}
}

// TestGeneratedOutputIsNotATower is the regression for a rule that was wrong.
//
// The first attempt flagged a directory when one file exceeded all its siblings
// combined by 8x. The case it existed to catch — `internal/web/static/assets`,
// which holds the embedded UI bundle — contains exactly ONE source file, so
// "larger than the rest of its directory" was never true and the minified bundle
// would have been the tallest building in the town.
//
// The directory is no longer a building at all (ADR-0004 §4), so the assertion
// is now the stronger one: it is absent from the map, not merely short. `src`
// beside it must survive, which is what the flag was there to protect.
func TestGeneratedOutputIsNotATower(t *testing.T) {
	root := t.TempDir()
	// One enormous single-line file, alone among non-source neighbours, exactly
	// as a bundle sits beside its fonts.
	mk := func(rel string, body string) {
		full := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	mk("assets/index.js", strings.Repeat("var a=1;", 20_000)) // one line, ~160 kB
	mk("assets/font.woff2", strings.Repeat("x", 50_000))      // not source
	// A real building: several short-lined hand-written files.
	mk("src/a.go", "package src\n\nfunc a() {}\n"+strings.Repeat("// filler\n", 500))
	mk("src/b.go", "package src\n\nfunc b() {}\n")

	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	byPath := map[string]Building{}
	for _, b := range town.Buildings {
		byPath[b.Path] = b
	}

	if _, present := byPath["assets"]; present {
		t.Errorf("assets is one single-line file with no authored bytes; it must not be a building at all")
	}
	if byPath["src"].Generated {
		t.Errorf("src holds ordinary multi-line Go; it must NOT be flagged Generated")
	}
	if byPath["src"].AuthoredBytes == 0 {
		t.Errorf("src holds hand-written Go; it must carry authored mass")
	}
}

// TestGeneratedPropagatesUpward covers the parent of a generated directory.
//
// `internal/web/static` contains `assets`, which contains the bundle. Its byte
// total is dominated by output it did not write, so drawing it as a tower would
// repeat the same wrong claim one level up.
//
// The pure-output child is now absent from the map entirely, so the claim this
// test protects is the parent's: it still exists, and it is still marked
// generated, so its height is not read off a compiler's arithmetic.
func TestGeneratedPropagatesUpward(t *testing.T) {
	root := t.TempDir()
	full := filepath.Join(root, "web", "assets")
	if err := os.MkdirAll(full, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(full, "index.js"), []byte(strings.Repeat("var a=1;", 20_000)), 0o644); err != nil {
		t.Fatal(err)
	}
	// A real source file directly in the parent, so the parent is a building.
	if err := os.WriteFile(filepath.Join(root, "web", "main.go"), []byte("package web\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	byPath := map[string]Building{}
	for _, b := range town.Buildings {
		byPath[b.Path] = b
	}
	if _, present := byPath["web/assets"]; present {
		t.Errorf("web/assets holds one single-line file with no authored bytes; it must not be a building")
	}
	if !byPath["web"].Generated {
		t.Errorf("web contains a generated child; it must be marked generated too")
	}
	if byPath["web"].AuthoredBytes == 0 {
		t.Errorf("web/main.go is hand-written; web must keep its building and its authored mass")
	}
}

// A directory holding nothing but a compiler's output is not a place, and
// ADR-0004 §4 says so: generated output "shouldn't create buildings… may
// appear as infrastructure but not as buildings." The analyzer marked such a
// directory generated and sized it at one storey, but it still drew one — which
// is dull while it is an anonymous plot and a false claim the moment buildings
// are named, because a compiled bundle would render as a residence.
func TestADirectoryWithNoAuthoredBytesIsNotABuilding(t *testing.T) {
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
	// A pure artefact, shaped exactly as the embedded UI bundle sits on disk:
	// one enormous single-line file and one binary neighbour.
	mk("assets/index.js", strings.Repeat("var a=1;", 20_000))
	mk("assets/font.woff2", strings.Repeat("x", 50_000))
	// A real building beside it, which must survive.
	mk("src/a.go", "package src\n\nfunc a() {}\n"+strings.Repeat("// filler\n", 500))

	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range town.Buildings {
		if b.Path == "assets" {
			t.Errorf("assets holds no authored bytes but is still a building; it is a compiler's output, not a place")
		}
	}
	if len(town.Buildings) != 1 || town.Buildings[0].Path != "src" {
		var got []string
		for _, b := range town.Buildings {
			got = append(got, b.Path)
		}
		t.Errorf("buildings = %v, want exactly [src]", got)
	}
}

// The rule is "no authored bytes", not "generated": a directory holding a
// bundle *and* hand-written source is a real place that happens to contain
// output, and the earlier rule must not swallow it.
func TestAGeneratedDirectoryWithAuthoredSourceIsStillABuilding(t *testing.T) {
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
	mk("web/assets/index.js", strings.Repeat("var a=1;", 20_000))
	mk("web/handler.go", "package web\n\nfunc Serve() {}\n"+strings.Repeat("// filler\n", 400))

	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, b := range town.Buildings {
		if b.Path == "web" {
			found = true
		}
	}
	if !found {
		t.Errorf("web holds 400 lines of hand-written Go; a generated child must not remove it")
	}
}

// A repository that is nothing but build output produces no buildings, and does
// not fail. An empty town is a correct description of it.
func TestARepositoryOfOnlyGeneratedOutputYieldsNoBuildings(t *testing.T) {
	root := t.TempDir()
	full := filepath.Join(root, "dist", "bundle.js")
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(strings.Repeat("var a=1;", 20_000)), 0o644); err != nil {
		t.Fatal(err)
	}

	town, err := Analyze(root)
	if err != nil {
		t.Fatalf("a repository of pure output must analyze cleanly, got %v", err)
	}
	if len(town.Buildings) != 0 {
		var got []string
		for _, b := range town.Buildings {
			got = append(got, b.Path)
		}
		t.Errorf("buildings = %v, want none", got)
	}
}

// The filter's real effect, on this repository rather than on a synthetic tree.
// A synthetic fixture proves the rule; this proves the rule removes what it is
// meant to remove and nothing else, on a tree nobody curated for the purpose.
func TestTheRuleRemovesExactlyTheArtefactDirectoryFromThisRepo(t *testing.T) {
	town, err := Analyze("../..")
	if err != nil {
		t.Fatal(err)
	}
	paths := map[string]bool{}
	for _, b := range town.Buildings {
		paths[b.Path] = true
	}
	// The embedded UI bundle sits alone in this directory with no hand-written
	// bytes at all. It is the one building that was here only because something
	// wrote it.
	if paths["internal/web/static/assets"] {
		t.Errorf("internal/web/static/assets is the bundle directory; it is not a place and must not be a building")
	}
	// Everything with authored source survives, including the two directories
	// beside it that also contain output.
	for _, want := range []string{
		"internal/web", "internal/web/static", "internal/analyzer",
		"internal/town", "ui", "ui/src", "ui/src/art", "ui/test", "cmd/townd",
	} {
		if !paths[want] {
			t.Errorf("%s holds hand-written source and must still be a building", want)
		}
	}
	// Measured on this tree, so a change in what the analyzer counts is visible
	// rather than silent: 16 directories, 15 buildings, one dropped. Last moved
	// when the solid town's `ui/src/solid` became a directory of hand-written
	// source (574393e); the count moves when the tree does, and that is the point
	// of recording it.
	if len(town.Buildings) != 15 {
		var got []string
		for _, b := range town.Buildings {
			got = append(got, b.Path)
		}
		t.Errorf("buildings = %d (%v), want 15 — re-record what this repository measures", len(town.Buildings), got)
	}
}

// --- Declared archetypes -------------------------------------------------

// writeManifest puts a declaration file in a throwaway repo.
func writeManifest(t *testing.T, root, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(root, "ai-town.json"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

// A repository may declare what a directory is, and the declaration travels.
// This is the repository asserting something about itself, which is the whole
// difference from the path hash: a wrong claim here is a lie somebody chose,
// where the hash is arbitrary and nobody minds.
func TestADeclaredArchetypeTravelsOnTheWire(t *testing.T) {
	root := build(t, map[string]string{
		"src/auth/service.ts": "export const a = 1\n",
		"src/auth/token.ts":   "export const b = 2\n",
	})
	writeManifest(t, root, `{"archetypes": {"src/auth": "stadium"}}`)

	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, b := range town.Buildings {
		if b.Path == "src/auth" && b.Archetype == "stadium" {
			found = true
		}
	}
	if !found {
		t.Errorf("src/auth was declared a stadium but the declaration did not reach the building")
	}

	// And it must reach the *layout*, because the layout is what the browser
	// reads. A declaration that stops at the analyzer is a declaration the
	// renderer never sees.
	l := LayoutTown(town)
	for _, s := range l.Sites {
		if s.Path == "src/auth" {
			if s.Archetype != "stadium" {
				t.Errorf("layout site archetype = %q, want stadium", s.Archetype)
			}
			return
		}
	}
	t.Error("src/auth has no layout site")
}

// Everything not declared falls back to the hash, so a repo with no manifest
// behaves exactly as it did before this existed.
func TestUndeclaredPathsCarryNoDeclaration(t *testing.T) {
	root := build(t, map[string]string{
		"src/a.ts":      "export const a = 1\n",
		"src/deep/b.ts": "export const b = 2\n",
	})
	writeManifest(t, root, `{"archetypes": {"src": "hospital"}}`)

	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range town.Buildings {
		want := ""
		if b.Path == "src" {
			want = "hospital"
		}
		if b.Archetype != want {
			t.Errorf("%q archetype = %q, want %q — an undeclared path must fall back to the hash", b.Path, b.Archetype, want)
		}
	}
}

// A manifest is author input and author input is wrong. None of these may fail
// the analysis: the town must still draw, because a broken declaration is the
// author's problem and a town that refuses to render is ours.
func TestABrokenManifestIsIgnoredNotFatal(t *testing.T) {
	for name, body := range map[string]string{
		"not json":      `this is not json`,
		"no archetypes": `{"somethingElse": 1}`,
		"empty object":  `{}`,
		"wrong value":   `{"archetypes": {"src": 42}}`,
		"not an object": `["src"]`,
	} {
		t.Run(name, func(t *testing.T) {
			root := build(t, map[string]string{"src/a.ts": "export const a = 1\n"})
			writeManifest(t, root, body)
			town, err := Analyze(root)
			if err != nil {
				t.Fatalf("a broken manifest must not fail analysis: %v", err)
			}
			if len(town.Buildings) == 0 {
				t.Fatal("the town lost its buildings over a broken manifest")
			}
			for _, b := range town.Buildings {
				if b.Archetype != "" {
					t.Errorf("%q took archetype %q from a manifest that does not say it", b.Path, b.Archetype)
				}
			}
		})
	}
}

// A path that no longer exists must not be resurrected by a declaration. The
// town is a map of what is there.
func TestAManifestCannotResurrectAVanishedPath(t *testing.T) {
	root := build(t, map[string]string{"src/a.ts": "export const a = 1\n"})
	writeManifest(t, root, `{"archetypes": {"src": "hospital", "src/deleted": "stadium"}}`)

	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range town.Buildings {
		if b.Path == "src/deleted" {
			t.Error("a manifest entry invented a building for a directory that does not exist")
		}
	}
}

// A repo with no manifest at all is the normal case and must be silent.
func TestNoManifestIsNotAnError(t *testing.T) {
	root := build(t, map[string]string{"src/a.ts": "export const a = 1\n"})
	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range town.Buildings {
		if b.Archetype != "" {
			t.Errorf("%q has an archetype without a manifest", b.Path)
		}
	}
}

// An archetype name the renderer has never heard of **travels anyway** and is
// ignored there.
//
// This is the one case that looks like a bug and is not. The analyzer has no
// vocabulary — the renderer owns the set — so validating a name here would mean
// keeping the list in two languages and letting them drift, which is the exact
// failure the archetype axis was built to avoid. Dropping unknown names early
// would also make a *renamed* archetype silently break every repo that declared
// the old one, with nothing to say so.
func TestAnUnknownArchetypeNameTravelsForTheRendererToIgnore(t *testing.T) {
	root := build(t, map[string]string{"src/a.ts": "export const a = 1\n"})
	writeManifest(t, root, `{"archetypes": {"src": "bakery"}}`)

	town, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range town.Buildings {
		if b.Path == "src" {
			if b.Archetype != "bakery" {
				t.Errorf("archetype = %q, want the declaration carried through verbatim", b.Archetype)
			}
			return
		}
	}
	t.Error("no building for src")
}
