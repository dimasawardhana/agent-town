package town

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/dimasajiwardhana/agent-town/internal/agent"
	"github.com/dimasajiwardhana/agent-town/internal/analyzer"
)

func liveTown(t *testing.T, files ...string) *Town {
	t.Helper()
	root := t.TempDir()
	for _, rel := range files {
		full := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	at, err := analyzer.Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	return New(at)
}

func ev(session, tool, path, result string) agent.UnifiedAgentEvent {
	return agent.UnifiedAgentEvent{
		ID: "e1", SessionID: session, Agent: "omp", Type: typeFor(tool),
		Tool:   tool,
		Target: agent.UnifiedTarget{Path: path},
		Result: result, Timestamp: 1000,
	}
}

func TestSessionSpawnsOneWorker(t *testing.T) {
	tw := liveTown(t, "src/a.ts")

	tw.Apply(ev("s1", "read", "src/a.ts", "success"))
	tw.Apply(ev("s1", "edit", "src/a.ts", "success"))
	tw.Apply(ev("s1", "bash", "", "success"))

	snap := tw.Snapshot()
	chiefs := 0
	for _, w := range snap.Workers {
		if w.Tier == "chief" {
			chiefs++
		}
	}
	if chiefs != 1 {
		t.Fatalf("got %d chief workers, want 1 — one session is one crew", chiefs)
	}
}

// Two sessions on one repo are two crews, attributed by session id.
func TestTwoSessionsAreTwoCrews(t *testing.T) {
	tw := liveTown(t, "src/a.ts")

	tw.Apply(ev("s1", "read", "src/a.ts", "success"))
	tw.Apply(ev("s2", "edit", "src/a.ts", "success"))

	snap := tw.Snapshot()
	sessions := map[string]bool{}
	for _, w := range snap.Workers {
		sessions[w.Session] = true
	}
	if len(sessions) != 2 {
		t.Fatalf("got %d sessions %v, want 2", len(sessions), sessions)
	}
}

// A failed tool damages the place rather than advancing it.
func TestFailureLeavesAConstructionProblem(t *testing.T) {
	tw := liveTown(t, "src/a.ts")

	tw.Apply(ev("s1", "edit", "src/a.ts", "success"))
	tw.Apply(ev("s1", "edit", "src/a.ts", "error"))

	snap := tw.Snapshot()
	if len(snap.Buildings) != 1 {
		t.Fatalf("got %d buildings, want 1", len(snap.Buildings))
	}
	b := snap.Buildings[0]
	if b.Problems != 1 {
		t.Errorf("problems = %d, want 1", b.Problems)
	}
	if b.Status != StatusBroken {
		t.Errorf("status = %q, want broken", b.Status)
	}
}

// The worker must move to where the work is, which is the whole point.
func TestWorkerMovesToThePlaceOfWork(t *testing.T) {
	tw := liveTown(t, "src/auth/a.ts", "src/pay/b.ts")

	tw.Apply(ev("s1", "read", "src/auth/a.ts", "success"))
	if w := tw.Snapshot().Workers[0]; w.Place != "building:src/auth" {
		t.Errorf("place = %q, want building:src/auth", w.Place)
	}

	tw.Apply(ev("s1", "bash", "", "success"))
	if w := tw.Snapshot().Workers[0]; w.Place != string(analyzer.PlaceYard) {
		t.Errorf("after bash, place = %q, want yard", w.Place)
	}

	tw.Apply(ev("s1", "todo", "", "success"))
	if w := tw.Snapshot().Workers[0]; w.Place != string(analyzer.PlaceDepot) {
		t.Errorf("after todo, place = %q, want depot", w.Place)
	}
}

// An agent whose handshake was lost is still working; showing nothing would
// be the town lying about it.
func TestWorkerIsCreatedWithoutAHandshake(t *testing.T) {
	tw := liveTown(t, "src/a.ts")

	tw.Apply(ev("never-announced", "read", "src/a.ts", "success"))

	snap := tw.Snapshot()
	if len(snap.Workers) != 1 {
		t.Fatalf("got %d workers, want 1", len(snap.Workers))
	}
	if snap.Workers[0].Session != "never-announced" {
		t.Errorf("session = %q", snap.Workers[0].Session)
	}
}

func TestStartAndEndSession(t *testing.T) {
	tw := liveTown(t, "src/a.ts")

	tw.StartSession("s1", "omp")
	if w := tw.Snapshot().Workers[0]; w.Action != ActionPlan {
		t.Errorf("on start, action = %q, want planning", w.Action)
	}

	tw.Apply(ev("s1", "edit", "src/a.ts", "success"))
	tw.EndSession("s1")

	// The building survives the session. The town is the result, and clearing
	// it on exit would discard the only persistent thing the product makes.
	snap := tw.Snapshot()
	if len(snap.Buildings) != 1 {
		t.Errorf("building list emptied on session end; the town must persist")
	}
	if snap.Buildings[0].Touches != 1 {
		t.Errorf("touches = %d, want 1", snap.Buildings[0].Touches)
	}
}

func TestEventsAreRecordedNewestFirst(t *testing.T) {
	tw := liveTown(t, "src/a.ts")

	tw.Apply(agent.UnifiedAgentEvent{ID: "first", SessionID: "s1", Tool: "read", Timestamp: 1})
	tw.Apply(agent.UnifiedAgentEvent{ID: "second", SessionID: "s1", Tool: "edit", Timestamp: 2})

	snap := tw.Snapshot()
	if len(snap.Events) != 2 {
		t.Fatalf("got %d events, want 2", len(snap.Events))
	}
	if snap.Events[0].ID != "second" {
		t.Errorf("newest event is %q, want second", snap.Events[0].ID)
	}
}

func TestEventLogIsBounded(t *testing.T) {
	tw := liveTown(t, "src/a.ts")
	for i := 0; i < 300; i++ {
		tw.Apply(agent.UnifiedAgentEvent{ID: "e", SessionID: "s1", Tool: "read", Timestamp: int64(i)})
	}
	if got := len(tw.Snapshot().Events); got > 200 {
		t.Errorf("event log holds %d, want it bounded at 200", got)
	}
}

func TestSiteWideWorkTouchesNoBuilding(t *testing.T) {
	tw := liveTown(t, "src/a.ts")

	tw.Apply(ev("s1", "bash", "", "success"))
	tw.Apply(ev("s1", "hub", "", "success"))

	// Neither a shell command nor meta work is building-specific, so nothing
	// should have been recorded as a building touch.
	if got := len(tw.Snapshot().Buildings); got != 0 {
		t.Errorf("got %d building states, want 0 — the Yard and Depot are not buildings", got)
	}
}

// Every event in a realistic session must produce a worker action, since a
// worker with no action is a worker standing still while the agent works.
func TestEveryRealisticActionClassifies(t *testing.T) {
	r := project(t, "src/a.ts")

	realistic := []struct {
		tool string
		args map[string]any
	}{
		{"bash", map[string]any{"command": "git log"}},
		{"bash", map[string]any{"command": "npx vitest run"}},
		{"hub", map[string]any{}},
		{"read", map[string]any{"path": "src/a.ts"}},
		{"write", map[string]any{"path": "src/b.ts"}},
		{"edit", map[string]any{"path": "src/a.ts"}},
		{"todo", map[string]any{}},
		{"task", map[string]any{}},
		{"grep", map[string]any{"pattern": "x"}},
	}

	for _, tc := range realistic {
		c := classify(tc.tool, tc.args, r)
		if c.Action == "" {
			t.Errorf("%s produced no action", tc.tool)
		}
		if c.Place == "" {
			t.Errorf("%s produced no place", tc.tool)
		}
	}
}

// Regression: a session ending must stand its crew down.
//
// StartSession and EndSession existed but nothing called them, so a real
// session left its worker frozen mid-action forever — the town claiming work
// was happening when the agent had long gone.
func TestEndSessionStandsTheCrewDown(t *testing.T) {
	tw := liveTown(t, "src/a.ts")

	tw.Apply(ev("s1", "edit", "src/a.ts", "success"))
	if got := tw.Snapshot().Workers[0].Action; got != ActionHammer {
		t.Fatalf("action = %q, want hammering while working", got)
	}

	tw.EndSession("s1")
	if got := tw.Snapshot().Workers[0].Action; got != ActionCelebrate {
		t.Errorf("after session end, action = %q, want celebrating", got)
	}
}

// The buildings survive the session. The town is the result of the work;
// clearing it on exit would discard the only persistent thing the product
// makes.
func TestEndSessionKeepsWhatWasBuilt(t *testing.T) {
	tw := liveTown(t, "src/a.ts")
	tw.Apply(ev("s1", "edit", "src/a.ts", "success"))
	tw.EndSession("s1")

	snap := tw.Snapshot()
	if len(snap.Buildings) != 1 || snap.Buildings[0].Touches != 1 {
		t.Fatalf("buildings after end = %+v, want one with one touch", snap.Buildings)
	}
}

func TestStateSurvivesARestart(t *testing.T) {
	root := t.TempDir()
	full := filepath.Join(root, "src", "a.ts")
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	at, err := analyzer.Analyze(root)
	if err != nil {
		t.Fatal(err)
	}

	path := filepath.Join(t.TempDir(), "state.json")

	first := New(at)
	first.Apply(ev("s1", "edit", "src/a.ts", "success"))
	first.Apply(ev("s1", "edit", "src/a.ts", "error"))
	if err := first.Save(path); err != nil {
		t.Fatal(err)
	}

	// A fresh town, as a restarted daemon would build.
	second := New(at)
	if err := second.Load(path); err != nil {
		t.Fatal(err)
	}

	snap := second.Snapshot()
	if len(snap.Buildings) != 1 {
		t.Fatalf("after restart, %d buildings, want 1", len(snap.Buildings))
	}
	b := snap.Buildings[0]
	if b.Touches != 2 || b.Problems != 1 {
		t.Errorf("after restart: touches=%d problems=%d, want 2 and 1", b.Touches, b.Problems)
	}
}

func TestMissingStateFileIsNotAnError(t *testing.T) {
	tw := liveTown(t, "src/a.ts")
	if err := tw.Load(filepath.Join(t.TempDir(), "absent.json")); err != nil {
		t.Errorf("loading absent state returned %v, want nil — a first run has nothing to restore", err)
	}
}

func TestCorruptStateIsDiscarded(t *testing.T) {
	tw := liveTown(t, "src/a.ts")
	path := filepath.Join(t.TempDir(), "bad.json")
	if err := os.WriteFile(path, []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := tw.Load(path); err != nil {
		t.Errorf("corrupt state returned %v, want nil — losing history beats rendering something untrue", err)
	}
	if len(tw.Snapshot().Buildings) != 0 {
		t.Error("corrupt state produced buildings")
	}
}

func TestStatePathIsStableAndProjectSpecific(t *testing.T) {
	a := StatePath("/home/dev/projects/alpha")
	b := StatePath("/home/dev/projects/alpha")
	c := StatePath("/home/dev/projects/beta")

	if a == "" {
		t.Fatal("StatePath returned empty")
	}
	if a != b {
		t.Errorf("same project gave different paths: %q vs %q", a, b)
	}
	if a == c {
		t.Errorf("two projects share a state path %q", a)
	}
}

func TestStatusDoesNotRegress(t *testing.T) {
	tw := liveTown(t, "src/a.ts")
	tw.Apply(ev("s1", "edit", "src/a.ts", "success"))
	if got := tw.Snapshot().Buildings[0].Status; got != StatusConstructing {
		t.Fatalf("after edit status = %q, want constructing", got)
	}
	// A later read must not un-build the building.
	tw.Apply(ev("s1", "read", "src/a.ts", "success"))
	if got := tw.Snapshot().Buildings[0].Status; got != StatusConstructing {
		t.Errorf("a read regressed status to %q; a building that was built does not become unbuilt by being looked at", got)
	}
}
