package registry

import (
	"os"
	"path/filepath"
	"testing"
)

func writeConfig(t *testing.T, path string, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func paths(t *testing.T, r *Registry) []string {
	t.Helper()
	return r.Paths()
}

// TestSyncAddsNewProjects is the whole point: after `townd add`, a running
// daemon must start serving the project without a restart.
func TestSyncAddsNewProjects(t *testing.T) {
	base := t.TempDir()
	alpha := project(t, filepath.Join(base, "alpha"))
	bravo := project(t, filepath.Join(base, "bravo"))

	r := New()
	if _, err := r.Register(alpha); err != nil {
		t.Fatal(err)
	}

	added, removed, err := r.Sync([]string{alpha, bravo}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(added) != 1 || added[0] != bravo {
		t.Errorf("added = %v, want just %q", added, bravo)
	}
	if len(removed) != 0 {
		t.Errorf("removed = %v, want nothing", removed)
	}
	if r.Get(bravo) == nil {
		t.Error("the new project is not registered after Sync")
	}
	if got := paths(t, r); len(got) != 2 {
		t.Errorf("registry holds %v, want two projects", got)
	}
}

// TestSyncRemovesDepartedProjects covers `townd rm` on a running daemon.
func TestSyncRemovesDepartedProjects(t *testing.T) {
	base := t.TempDir()
	alpha := project(t, filepath.Join(base, "alpha"))
	bravo := project(t, filepath.Join(base, "bravo"))

	r := New()
	for _, d := range []string{alpha, bravo} {
		if _, err := r.Register(d); err != nil {
			t.Fatal(err)
		}
	}

	added, removed, err := r.Sync([]string{alpha}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(added) != 0 {
		t.Errorf("added = %v, want nothing", added)
	}
	if len(removed) != 1 || removed[0] != bravo {
		t.Errorf("removed = %v, want just %q", removed, bravo)
	}
	if r.Get(bravo) != nil {
		t.Error("the removed project is still registered")
	}
}

// TestSyncKeepsProjectsPassedAsKeep is the --dir hazard. Projects given on the
// command line are served for one run and are absent from the config, so a
// sync that only looked at the file would drop them — and their agents would
// begin being refused frames while their daemon was still running.
func TestSyncKeepsProjectsPassedAsKeep(t *testing.T) {
	base := t.TempDir()
	fromConfig := project(t, filepath.Join(base, "from-config"))
	fromFlag := project(t, filepath.Join(base, "from-flag"))

	r := New()
	for _, d := range []string{fromConfig, fromFlag} {
		if _, err := r.Register(d); err != nil {
			t.Fatal(err)
		}
	}

	// The config names only one of them.
	_, removed, err := r.Sync([]string{fromConfig}, []string{fromFlag})
	if err != nil {
		t.Fatal(err)
	}
	if len(removed) != 0 {
		t.Errorf("removed = %v; a project passed with --dir must survive a sync", removed)
	}
	if r.Get(fromFlag) == nil {
		t.Error("the --dir project was dropped by Sync")
	}
}

// TestSyncAddsBeforeRemoving checks the ordering guarantee: a project moving
// between the config and the command line must never be briefly absent, because
// a frame arriving in that gap would be refused.
func TestSyncAddsBeforeRemoving(t *testing.T) {
	base := t.TempDir()
	inBoth := project(t, filepath.Join(base, "in-both"))

	r := New()
	if _, err := r.Register(inBoth); err != nil {
		t.Fatal(err)
	}

	// Present in keep but absent from the config: it must stay registered
	// throughout, not be removed and re-added.
	added, removed, err := r.Sync(nil, []string{inBoth})
	if err != nil {
		t.Fatal(err)
	}
	if len(added) != 0 || len(removed) != 0 {
		t.Errorf("added=%v removed=%v, want no change for a project in both sets", added, removed)
	}
	if r.Get(inBoth) == nil {
		t.Error("the project was dropped by Sync")
	}
}

// TestSyncIsIdempotent keeps a daemon that polls from re-registering, and so
// re-analyzing, every project on every tick.
func TestSyncIsIdempotent(t *testing.T) {
	base := t.TempDir()
	alpha := project(t, filepath.Join(base, "alpha"))

	r := New()
	if _, err := r.Register(alpha); err != nil {
		t.Fatal(err)
	}
	first, _ := r.Get(alpha), 0

	for range 5 {
		added, removed, err := r.Sync([]string{alpha}, nil)
		if err != nil {
			t.Fatal(err)
		}
		if len(added) != 0 || len(removed) != 0 {
			t.Fatalf("a repeated Sync reported added=%v removed=%v; it must be a no-op", added, removed)
		}
	}
	if r.Get(alpha) != first {
		t.Error("Sync replaced an existing project with a new one; its in-memory town would be lost")
	}
}

// TestReadConfigStrictRejectsCorruption is the hazard that makes a strict read
// necessary: the lenient loadConfig reports a corrupt file as *no projects*,
// which while running would empty the registry and start refusing every
// agent's frames.
func TestReadConfigStrictRejectsCorruption(t *testing.T) {
	base := t.TempDir()
	path := filepath.Join(base, "config.json")
	writeConfig(t, path, "this is not json at all")

	if _, err := ReadConfigStrict(path); err == nil {
		t.Fatal("a corrupt config was accepted; on reload that would empty the registry")
	}

	// The lenient reader, by contrast, deliberately returns empty rather than
	// failing — which is correct at startup and destructive at reload.
	got, err := loadConfig(path)
	if err != nil {
		t.Errorf("loadConfig returned an error for a corrupt file: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("loadConfig returned %v, want empty", got)
	}
}

func TestReadConfigStrictRejectsFutureVersion(t *testing.T) {
	base := t.TempDir()
	path := filepath.Join(base, "config.json")
	writeConfig(t, path, `{"version": 99, "projects": ["/somewhere"]}`)

	if _, err := ReadConfigStrict(path); err == nil {
		t.Error("a config from a newer build was accepted; it may use fields this build would drop")
	}
}

func TestReadConfigStrictReadsAValidFile(t *testing.T) {
	base := t.TempDir()
	path := filepath.Join(base, "config.json")
	alpha := project(t, filepath.Join(base, "alpha"))
	writeConfig(t, path, `{"version":1,"projects":["`+alpha+`"]}`)

	got, err := ReadConfigStrict(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0] != alpha {
		t.Errorf("got %v, want [%q]", got, alpha)
	}
}

func TestReadConfigStrictReportsAMissingFile(t *testing.T) {
	if _, err := ReadConfigStrict(filepath.Join(t.TempDir(), "absent.json")); err == nil {
		t.Error("a missing config was not reported; a reload must be able to tell absence from emptiness")
	}
}

// TestStampDetectsChange covers the cheap fingerprint the poll loop relies on.
func TestStampDetectsChange(t *testing.T) {
	base := t.TempDir()
	path := filepath.Join(base, "config.json")
	writeConfig(t, path, `{"version":1,"projects":[]}`)

	before := stamp(path)
	if !before.exists {
		t.Fatal("stamp reports a file that exists as absent")
	}
	if before.Changed(before) {
		t.Error("a stamp differs from itself")
	}

	// A rewrite of the same size must still be noticed; this is why the
	// fingerprint includes the modification time and not only the size.
	writeConfig(t, path, `{"version":1,"projects":[a]}`)
	after := stamp(path)
	if !before.Changed(after) {
		t.Error("a same-size rewrite went unnoticed; the poll would never reload")
	}

	missing := stamp(filepath.Join(base, "never"))
	if missing.exists {
		t.Error("a missing file reported itself present")
	}
}

// TestSyncSurvivesAProjectItCannotAnalyze checks one bad path cannot stop the
// others being reconciled.
func TestSyncSurvivesAProjectItCannotAnalyze(t *testing.T) {
	base := t.TempDir()
	good := project(t, filepath.Join(base, "good"))
	missing := filepath.Join(base, "missing")

	r := New()
	added, _, err := r.Sync([]string{good, missing}, nil)
	if err != nil {
		t.Fatalf("Sync failed over a missing directory: %v", err)
	}
	if len(added) != 2 {
		t.Errorf("added = %v, want both paths registered", added)
	}
	if p := r.Get(missing); p == nil || p.Analyzed() {
		t.Error("the missing project should be registered and report itself unanalyzed")
	}
	if p := r.Get(good); p == nil {
		t.Error("the readable project was not registered")
	}
}
