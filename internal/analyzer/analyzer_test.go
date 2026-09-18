package analyzer

import (
	"os"
	"path/filepath"
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
		if d.Name == PlaceWorkshop {
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
	kinds := map[string]string{}
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
