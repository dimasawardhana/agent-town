package registry

import (
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/dimasajiwardhana/agent-town/internal/agent"
)

// newSourceTree writes a directory with source in a named subdirectory, so an
// analysis produces a building to place a worker on.
func newSourceTree(t *testing.T, dir string) string {
	t.Helper()
	sub := filepath.Join(dir, "src", "auth")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sub, "service.go"), []byte("package auth\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

// event builds a normalized event naming a file inside the tree.
func event(id, path string) agent.UnifiedAgentEvent {
	return agent.UnifiedAgentEvent{
		ID: id, SessionID: "s1", Agent: "omp",
		Type: "FILE_EDITED", Tool: "edit", Result: "success",
		Target: agent.UnifiedTarget{Path: path},
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}

// TestEventsBeforeAnalysisAreKeptAndReplayed is the contract that makes
// Registered a real state: an agent working in a project the developer has not
// opened yet must not have its early work discarded.
func TestEventsBeforeAnalysisAreKeptAndReplayed(t *testing.T) {
	base := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(base, "data"))
	dir := newSourceTree(t, filepath.Join(base, "work"))

	p := &Project{path: dir}
	if p.Analyzed() {
		t.Fatal("a bare project should not be analyzed")
	}
	if got := p.State(); got != StateAnalyzing {
		t.Errorf("State() = %q, want %q before analysis", got, StateAnalyzing)
	}

	// Work arrives while there is no map.
	for i, id := range []string{"e1", "e2", "e3"} {
		if _, placed := p.Apply(event(id, "src/auth/service.go")); placed {
			t.Errorf("event %d was placed before there was a map", i)
		}
	}
	if p.Pending() != 3 {
		t.Fatalf("Pending() = %d, want 3 — events must be kept, not dropped", p.Pending())
	}

	snap, ok, dropped := p.Analyze(2000)
	if !ok {
		t.Fatal("Analyze produced no map for a directory with source")
	}
	if dropped != 0 {
		t.Errorf("dropped = %d, want 0", dropped)
	}
	if p.Pending() != 0 {
		t.Errorf("Pending() = %d after replay, want 0", p.Pending())
	}
	if got := p.State(); got != StateReady {
		t.Errorf("State() = %q after analysis, want %q", got, StateReady)
	}

	if len(snap.Workers) == 0 {
		t.Error("no workers after replay; the buffered events did not reach the town")
	}
	found := false
	for _, b := range snap.Buildings {
		if b.Path == "src/auth" {
			found = true
		}
	}
	if !found {
		t.Errorf("the building the events named is absent from the town: %+v", snap.Buildings)
	}
}

// TestReplayReachesTheTown checks both buffered events arrive, neither applied
// twice or skipped. The feed is newest-first, so the last event applied
// appears first.
func TestReplayReachesTheTown(t *testing.T) {
	base := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(base, "data"))
	dir := newSourceTree(t, filepath.Join(base, "work"))

	p := &Project{path: dir}
	p.Apply(event("e1", "src/auth/service.go"))
	p.Apply(event("e2", "src/auth/service.go"))

	snap, _, _ := p.Analyze(2000)
	if len(snap.Events) != 2 {
		t.Fatalf("got %d events in the snapshot, want 2", len(snap.Events))
	}
	if snap.Events[0].ID != "e2" || snap.Events[1].ID != "e1" {
		t.Errorf("replay produced %s then %s; want newest-first e2 then e1",
			snap.Events[0].ID, snap.Events[1].ID)
	}
}

// TestPendingIsBounded keeps a never-opened project from growing without limit
// while an agent works in it.
func TestPendingIsBounded(t *testing.T) {
	base := t.TempDir()
	dir := newSourceTree(t, filepath.Join(base, "work"))

	p := &Project{path: dir}
	for i := range maxPending + 50 {
		p.Apply(event("e"+itoa(i), "src/auth/service.go"))
	}

	if p.Pending() != maxPending {
		t.Errorf("Pending() = %d, want the buffer capped at %d", p.Pending(), maxPending)
	}
	if p.Dropped() != 50 {
		t.Errorf("Dropped() = %d, want 50 — overflow must be counted, not silent", p.Dropped())
	}
}

// TestOverflowIsReportedThroughAnalyze checks the loss survives into the
// result, so the UI can say the town is missing history.
func TestOverflowIsReportedThroughAnalyze(t *testing.T) {
	base := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(base, "data"))
	dir := newSourceTree(t, filepath.Join(base, "work"))

	p := &Project{path: dir}
	for i := range maxPending + 1 {
		p.Apply(event("e"+itoa(i), "src/auth/service.go"))
	}

	_, _, dropped := p.Analyze(2000)
	if dropped != 1 {
		t.Errorf("dropped = %d, want 1", dropped)
	}
}

// TestUnreadableProjectReportsItself checks a project whose path is gone does
// not crash the daemon or pretend to have a map.
func TestUnreadableProjectReportsItself(t *testing.T) {
	base := t.TempDir()
	missing := filepath.Join(base, "gone")
	p, err := Open(missing)
	if err != nil {
		t.Fatalf("Open returned %v", err)
	}
	if p.State() != StateUnreadable {
		t.Errorf("State() = %q, want %q", p.State(), StateUnreadable)
	}
	if p.Analyzed() {
		t.Error("a missing directory reported itself analyzed")
	}
	// It still accepts events rather than panicking.
	p.Apply(event("e1", "src/a.go"))
}

// TestTruncatedAnalysisIsPartial ties the file budget to the project state.
func TestTruncatedAnalysisIsPartial(t *testing.T) {
	base := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(base, "data"))
	dir := filepath.Join(base, "work")
	for i := range 30 {
		sub := filepath.Join(dir, "pkg", "d"+itoa(i))
		if err := os.MkdirAll(sub, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(sub, "f.go"), []byte("package x\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	p, err := OpenBounded(dir, 5)
	if err != nil {
		t.Fatal(err)
	}
	if p.State() != StatePartial {
		t.Errorf("State() = %q, want %q for a truncated analysis", p.State(), StatePartial)
	}
	if !p.Static().Partial {
		t.Error("the town is not marked Partial")
	}
}

// TestAnalyzeIsIdempotent guards against re-walking or double-replaying.
func TestAnalyzeIsIdempotent(t *testing.T) {
	base := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(base, "data"))
	dir := newSourceTree(t, filepath.Join(base, "work"))

	p := &Project{path: dir}
	p.Apply(event("e1", "src/auth/service.go"))
	if _, ok, _ := p.Analyze(2000); !ok {
		t.Fatal("first Analyze produced no map")
	}

	snap, ok, dropped := p.Analyze(2000)
	if !ok {
		t.Fatal("second Analyze lost the map")
	}
	if dropped != 0 {
		t.Errorf("dropped = %d on a second call, want 0", dropped)
	}
	if len(snap.Events) != 1 {
		t.Errorf("got %d events after a second Analyze, want 1 — replay must not repeat", len(snap.Events))
	}
}

// TestConcurrentViewAndApply is a regression test for a race that shipped
// briefly: a client opening a project (which analyzes it) while an agent's
// frames arrive for the same project. Both touch the project's state, and
// without a mutex the pending buffer is corrupted. This test is meaningful
// under -race, which is how it was found.
func TestConcurrentViewAndApply(t *testing.T) {
	base := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(base, "data"))
	dir := newSourceTree(t, filepath.Join(base, "work"))

	r := New()
	p, err := r.Register(dir)
	if err != nil {
		t.Fatal(err)
	}

	var wg sync.WaitGroup
	// One goroutine views the project, which analyzes it on first view.
	wg.Add(1)
	go func() {
		defer wg.Done()
		p.Analyze(2000)
	}()
	// Others apply frames, exactly as the HTTP handler does.
	for i := range 20 {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			p.Apply(event("e"+itoa(i), "src/auth/service.go"))
		}(i)
	}
	wg.Wait()

	// Whatever the interleaving, the project ends up usable rather than in a
	// half-built state.
	if !p.Analyzed() {
		t.Error("the project never finished analyzing")
	}
	if _, ok := p.Snapshot(); !ok {
		t.Error("no snapshot after analysis completed")
	}
}

// TestDroppedCountSurvivesAnalyze is a regression test for a bug that shipped:
// Analyze drained the buffer and reset the drop count with it, so a loss that
// happened before the project was opened became invisible to the UI — the town
// silently omitting history, which the product principle forbids.
func TestDroppedCountSurvivesAnalyze(t *testing.T) {
	base := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(base, "data"))
	dir := newSourceTree(t, filepath.Join(base, "work"))

	p := &Project{path: dir}
	for i := range maxPending + 7 {
		p.Apply(event("e"+itoa(i), "src/auth/service.go"))
	}
	if got := p.Dropped(); got != 7 {
		t.Fatalf("Dropped() = %d before analysis, want 7", got)
	}

	_, _, reported := p.Analyze(2000)
	if reported != 7 {
		t.Errorf("Analyze reported %d dropped, want 7", reported)
	}
	if got := p.Dropped(); got != reported {
		t.Errorf("Dropped() = %d after Analyze which reported %d; the count must survive so the UI can report the loss",
			got, reported)
	}
}

// TestUnanalyzedProjectDoesNotCrashReaders is a regression test for a panic in
// `townd ls`. Registration defers analysis (see Register), so a freshly
// registered project has no map — but AnalysisError() returned nil anyway,
// which invited callers to guard a Static() dereference with it and then
// dereference a nil pointer. The states must be distinguishable.
func TestUnanalyzedProjectDoesNotCrashReaders(t *testing.T) {
	p := &Project{path: "/tmp/whatever"}

	if p.Analyzed() {
		t.Fatal("a bare project claims to be analyzed")
	}

	// The guard callers actually write. It must not report "fine" while the
	// map is absent, or the dereference that follows segfaults.
	if err := p.AnalysisError(); err == nil {
		t.Fatal("AnalysisError() is nil for a project with no map; a caller guarding on it will dereference nil")
	} else if !errors.Is(err, ErrNotAnalyzed) {
		t.Errorf("AnalysisError() = %v, want ErrNotAnalyzed so callers can tell 'not yet' from 'failed'", err)
	}

	if p.Static() != nil {
		t.Error("Static() should be nil before analysis")
	}
	if p.Layout() != nil {
		t.Error("Layout() should be nil before analysis")
	}
	if p.State() != StateAnalyzing {
		t.Errorf("State() = %q, want %q", p.State(), StateAnalyzing)
	}
	if _, ok := p.Snapshot(); ok {
		t.Error("Snapshot() reported a map before analysis")
	}
}

// TestNotAnalyzedIsDistinctFromFailure keeps the two remedies apart: one is
// waited for, the other is fixed or removed.
func TestNotAnalyzedIsDistinctFromFailure(t *testing.T) {
	// Never attempted: a deferral, which a caller waits for.
	pending := &Project{path: filepath.Join(t.TempDir(), "later")}
	if !errors.Is(pending.AnalysisError(), ErrNotAnalyzed) {
		t.Errorf("before analysis, AnalysisError() = %v, want ErrNotAnalyzed", pending.AnalysisError())
	}

	// Attempted and impossible: a failure, which a caller fixes or removes.
	// A missing directory is this case, not a deferral.
	failed := &Project{path: filepath.Join(t.TempDir(), "absent")}
	failed.Analyze(2000)
	err := failed.AnalysisError()
	if err == nil {
		t.Fatal("analysis of a missing directory reported no error")
	}
	if errors.Is(err, ErrNotAnalyzed) {
		t.Error("a failed analysis reported ErrNotAnalyzed; the two states must differ")
	}
	if failed.State() != StateUnreadable {
		t.Errorf("State() = %q, want %q", failed.State(), StateUnreadable)
	}
}

// TestRegisteredProjectReadsSafelyBeforeView covers the daemon's path: every
// project loaded from config is unanalyzed until someone views it, and reading
// its description must not panic.
func TestRegisteredProjectReadsSafelyBeforeView(t *testing.T) {
	base := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(base, "data"))
	path := filepath.Join(base, "config.json")
	dir := newSourceTree(t, filepath.Join(base, "work"))
	if err := os.WriteFile(path, []byte(`{"version":1,"projects":["`+dir+`"]}`), 0o644); err != nil {
		t.Fatal(err)
	}

	r, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range r.Projects() {
		// Everything a renderer or a list command reads before analyzing.
		_ = p.Analyzed()
		_ = p.State()
		_ = p.Static()
		_ = p.Layout()
		_ = p.Pending()
		_ = p.Dropped()
		_ = p.AnalysisError()
		_, _ = p.Snapshot()
	}
}

// TestProjectBudgetIsTheCallersChoice checks that a project's truncation
// depends on the budget it was analyzed with, not a fixed default.
//
// `townd ls` reported a project as whole while the daemon, started with a
// lower --max-files, drew it as PARTIAL. The list was using its own default
// rather than the budget in play, so the two disagreed about the same project.
func TestProjectBudgetIsTheCallersChoice(t *testing.T) {
	base := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(base, "data"))
	dir := filepath.Join(base, "work")
	for i := range 30 {
		sub := filepath.Join(dir, "pkg", "d"+itoa(i))
		if err := os.MkdirAll(sub, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(sub, "f.go"), []byte("package x\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	generous := &Project{path: dir}
	generous.Analyze(2000)
	if generous.State() != StateReady {
		t.Errorf("with a generous budget the project is %q, want %q", generous.State(), StateReady)
	}

	tight := &Project{path: dir}
	tight.Analyze(5)
	if tight.State() != StatePartial {
		t.Errorf("with a tight budget the project is %q, want %q", tight.State(), StatePartial)
	}
	if tight.Static() == nil || !tight.Static().Partial {
		t.Error("the town is not marked Partial despite a truncated analysis")
	}
}
