package registry

import (
	"os"
	"path/filepath"
	"testing"
)

// project creates a real directory with one source file, so Open can analyze
// it. A registry test that used a fake path would not exercise analysis.
func project(t *testing.T, dir string) string {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "main.go"), []byte("package main\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestAddIsIdempotent(t *testing.T) {
	dir := project(t, filepath.Join(t.TempDir(), "alpha"))
	r := New()

	first, err := r.Add(dir)
	if err != nil {
		t.Fatal(err)
	}
	second, err := r.Add(dir)
	if err != nil {
		t.Fatal(err)
	}

	if first != second {
		t.Error("adding the same path twice produced two projects; a repeated add must return the existing one")
	}
	if r.Len() != 1 {
		t.Errorf("Len() = %d, want 1", r.Len())
	}
}

func TestRemoveReportsWhetherPresent(t *testing.T) {
	dir := project(t, filepath.Join(t.TempDir(), "alpha"))
	r := New()
	if _, err := r.Add(dir); err != nil {
		t.Fatal(err)
	}

	if !r.Remove(dir) {
		t.Error("Remove returned false for a registered project")
	}
	if r.Remove(dir) {
		t.Error("Remove returned true for a project that is no longer registered")
	}
	if r.Len() != 0 {
		t.Errorf("Len() = %d after removing the only project, want 0", r.Len())
	}
}

// TestOwnerUsesSegments is the test that matters most: a naive prefix test
// passes the child case and silently routes a sibling's events into the wrong
// town.
func TestOwnerUsesSegments(t *testing.T) {
	base := t.TempDir()
	root := project(t, filepath.Join(base, "repo"))
	sibling := project(t, filepath.Join(base, "repo-other"))
	nested := project(t, filepath.Join(base, "repo", "pkg"))

	r := New()
	for _, d := range []string{root, sibling, nested} {
		if _, err := r.Add(d); err != nil {
			t.Fatal(err)
		}
	}

	cases := []struct {
		name string
		dir  string
		want string
	}{
		{"the root itself", root, root},
		{"a subdirectory of the root", filepath.Join(root, "internal"), root},
		{"a deeply nested subdirectory", filepath.Join(root, "a", "b", "c"), root},
		{"a registered nested project", nested, nested},
		{"deeper inside a registered nested project", filepath.Join(nested, "x"), nested},
		{"a sibling sharing a prefix", sibling, sibling},
		{"deeper inside the sibling", filepath.Join(sibling, "src"), sibling},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := r.Owner(c.dir)
			if got == nil {
				t.Fatalf("Owner(%q) = nil, want %q", c.dir, c.want)
			}
			if got.Path() != c.want {
				t.Errorf("Owner(%q) = %q, want %q", c.dir, got.Path(), c.want)
			}
		})
	}
}

// TestOwnerRejectsPrefixSiblingNotRegistered covers the case where the sibling
// is NOT registered. A prefix test would wrongly hand it to the root.
func TestOwnerRejectsPrefixSibling(t *testing.T) {
	base := t.TempDir()
	root := project(t, filepath.Join(base, "repo"))
	sibling := project(t, filepath.Join(base, "repo-other"))

	r := New()
	if _, err := r.Add(root); err != nil {
		t.Fatal(err)
	}

	if got := r.Owner(sibling); got != nil {
		t.Errorf("Owner(%q) = %q, want nil — a sibling sharing a prefix is not a child", sibling, got.Path())
	}
	if got := r.Owner(filepath.Join(sibling, "src")); got != nil {
		t.Errorf("Owner returned %q for a path in an unregistered sibling", got.Path())
	}
}

func TestOwnerReturnsNilWhenNothingMatches(t *testing.T) {
	base := t.TempDir()
	r := New()
	if _, err := r.Add(project(t, filepath.Join(base, "repo"))); err != nil {
		t.Fatal(err)
	}
	if got := r.Owner(filepath.Join(base, "elsewhere")); got != nil {
		t.Errorf("Owner = %q, want nil for an unrelated directory", got.Path())
	}
}

func TestProjectsAreOrderedByPath(t *testing.T) {
	base := t.TempDir()
	r := New()
	for _, name := range []string{"charlie", "alpha", "bravo"} {
		if _, err := r.Add(project(t, filepath.Join(base, name))); err != nil {
			t.Fatal(err)
		}
	}

	got := r.Projects()
	if len(got) != 3 {
		t.Fatalf("got %d projects, want 3", len(got))
	}
	for i := 1; i < len(got); i++ {
		if got[i-1].Path() > got[i].Path() {
			t.Errorf("projects out of order: %q before %q", got[i-1].Path(), got[i].Path())
		}
	}
}

// TestAddRefusesAMissingDirectory is the contract `townd add` depends on: a
// path that cannot be a town is rejected at the command line rather than
// entering the registry and failing later in the browser.
func TestAddRefusesAMissingDirectory(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "does-not-exist")
	r := New()

	if _, err := r.Add(missing); err == nil {
		t.Error("Add accepted a directory that does not exist")
	}
	if r.Len() != 0 {
		t.Errorf("Len() = %d, want 0 — a rejected path must not be registered", r.Len())
	}
}

// TestRegisterKeepsAnUnreadableProject covers the daemon's path instead: a
// project already in the developer's config must not vanish because its
// directory is temporarily unavailable.
func TestRegisterKeepsAnUnreadableProject(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "does-not-exist")
	r := New()

	p, err := r.Register(missing)
	if err != nil {
		t.Fatalf("Register returned an error for a missing directory: %v", err)
	}
	if r.Len() != 1 {
		t.Errorf("Len() = %d, want 1 — a missing directory is still a registered project", r.Len())
	}
	if p.Analyzed() {
		t.Error("Analyzed() = true for a directory that does not exist")
	}

	// Opening it records why there is no map, rather than leaving it
	// indistinguishable from one that simply has not been opened yet.
	p.Analyze(2000)
	if p.AnalysisError() == nil {
		t.Error("AnalysisError() = nil after a failed analysis")
	}
	if p.State() != StateUnreadable {
		t.Errorf("State() = %q, want %q", p.State(), StateUnreadable)
	}
}

func TestConfigRoundTrip(t *testing.T) {
	base := t.TempDir()
	path := filepath.Join(base, "config.json")

	alpha := project(t, filepath.Join(base, "alpha"))
	bravo := project(t, filepath.Join(base, "bravo"))

	r := New()
	for _, d := range []string{alpha, bravo} {
		if _, err := r.Add(d); err != nil {
			t.Fatal(err)
		}
	}
	if err := r.Save(path); err != nil {
		t.Fatal(err)
	}

	reloaded, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.Len() != 2 {
		t.Fatalf("reloaded %d projects, want 2", reloaded.Len())
	}
	if reloaded.Get(alpha) == nil || reloaded.Get(bravo) == nil {
		t.Error("a saved project did not survive the round trip")
	}
}

func TestMissingConfigIsNotAnError(t *testing.T) {
	r, err := Load(filepath.Join(t.TempDir(), "absent.json"))
	if err != nil {
		t.Fatalf("Load on a missing config returned %v; a first run has no config", err)
	}
	if r.Len() != 0 {
		t.Errorf("Len() = %d, want 0", r.Len())
	}
}

func TestCorruptConfigIsTreatedAsEmpty(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte("this is not json"), 0o644); err != nil {
		t.Fatal(err)
	}

	r, err := Load(path)
	if err != nil {
		t.Fatalf("Load on a corrupt config returned %v; refusing to start would make the daemon unusable", err)
	}
	if r.Len() != 0 {
		t.Errorf("Len() = %d, want 0", r.Len())
	}
}

func TestFutureConfigVersionIsRefused(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte(`{"version": 99, "projects": ["/somewhere"]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	r, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if r.Len() != 0 {
		t.Error("a config from a newer build was read; it must be refused rather than partially understood")
	}
}

// TestLoadKeepsUnopenableProjects checks the outcome rather than the count: a
// project whose directory has disappeared must still be reachable and must
// explain itself, rather than vanishing from the daemon's list.
func TestLoadKeepsUnopenableProjects(t *testing.T) {
	base := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(base, "data"))
	path := filepath.Join(base, "config.json")
	good := project(t, filepath.Join(base, "good"))
	gone := filepath.Join(base, "gone")

	if err := os.WriteFile(path, []byte(`{"version":1,"projects":["`+good+`","`+gone+`"]}`), 0o644); err != nil {
		t.Fatal(err)
	}

	r, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}

	// Reachable: the switcher must still list it, so the developer can see
	// what happened to it rather than finding it silently gone.
	p := r.Get(gone)
	if p == nil {
		t.Fatal("the unavailable project is absent from the registry; it must not vanish")
	}

	// It reports its state rather than looking like a project that simply has
	// not been opened yet.
	if got := p.State(); got != StateAnalyzing {
		t.Errorf("State() = %q before any analysis, want %q", got, StateAnalyzing)
	}
	p.Analyze(2000)
	if got := p.State(); got != StateUnreadable {
		t.Errorf("State() = %q after a failed analysis, want %q", got, StateUnreadable)
	}
	if p.AnalysisError() == nil {
		t.Error("AnalysisError() = nil; the reason it is unusable must be recorded")
	}

	// And it does not take the working project down with it.
	working := r.Get(good)
	if working == nil {
		t.Fatal("the readable project is absent")
	}
	if _, _, _ = working.Analyze(2000); working.State() != StateReady {
		t.Errorf("the readable project is %q, want %q — one bad project must not affect another",
			working.State(), StateReady)
	}
}
