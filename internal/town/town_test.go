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

// testEvent is a shell event running a test command. It carries a command
// rather than a path, which is the whole reason `Classify` has to read the
// command string to find out which building a test is about.
func testEvent(session, cmd, result string) agent.UnifiedAgentEvent {
	e := ev(session, "bash", "", result)
	e.Type = "COMMAND_COMPLETED"
	e.Target.Command = cmd
	return e
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

// A failed tool damages the place rather than advancing it, and does not undo
// the progress it had. Damage and progress are separate facts: a building can
// be half-built and broken at once, which the earlier single-status shape could
// not express.
func TestFailureDamagesWithoutRollingBackProgress(t *testing.T) {
	tw := liveTown(t, "src/a.ts")

	tw.Apply(ev("s1", "edit", "src/a.ts", "success"))
	built := tw.Snapshot().Buildings[0].Status

	tw.Apply(ev("s1", "edit", "src/a.ts", "error"))

	snap := tw.Snapshot()
	if len(snap.Buildings) != 1 {
		t.Fatalf("got %d buildings, want 1", len(snap.Buildings))
	}
	b := snap.Buildings[0]
	if b.Problems != 1 {
		t.Errorf("problems = %d, want 1", b.Problems)
	}
	if !b.Damaged {
		t.Error("a failed tool must leave the building damaged")
	}
	if b.Status != built {
		t.Errorf("status = %q after a failure, want it unchanged at %q; a failure is damage, not a stage", b.Status, built)
	}

	// A later success repairs it, without undoing the climb.
	tw.Apply(ev("s1", "edit", "src/a.ts", "success"))
	b = tw.Snapshot().Buildings[0]
	if b.Damaged {
		t.Error("a successful change must clear the damage")
	}
	if b.Problems != 1 {
		t.Errorf("problems = %d, want the historical count 1", b.Problems)
	}
	if rank(b.Status) <= rank(built) {
		t.Errorf("status = %q, want to have advanced past %q", b.Status, built)
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

// A read must not un-build a building: looking at work is not doing it.
func TestStatusDoesNotRegress(t *testing.T) {
	tw := liveTown(t, "src/a.ts")
	tw.Apply(ev("s1", "edit", "src/a.ts", "success"))
	afterEdit := tw.Snapshot().Buildings[0].Status
	if afterEdit != StatusFoundation {
		t.Fatalf("after one edit status = %q, want foundation", afterEdit)
	}

	// A read changes nothing, however many times it happens.
	for range 5 {
		tw.Apply(ev("s1", "read", "src/a.ts", "success"))
	}
	if got := tw.Snapshot().Buildings[0].Status; got != afterEdit {
		t.Errorf("reads moved status to %q, want it unchanged at %q", got, afterEdit)
	}
}

// Every rank must be reachable, and reached one part at a time.
//
// This is the test that would have caught the original defect. The ladder
// declared `completed`, ranked it highest, and nothing could ever set it —
// because tests were classified to the Yard and so never reached a building,
// and because the ranks were ordered so that `constructing` sat above
// `testing`. A ladder with an unreachable top is not a ladder.
func TestEveryRankIsReachableOnePartAtATime(t *testing.T) {
	tw := liveTown(t, "src/a.ts")
	ladder := AllStatuses()

	// A new building starts at the bottom.
	tw.Apply(ev("s1", "read", "src/a.ts", "success"))
	if got := tw.Snapshot().Buildings[0].Status; got != StatusPlanned {
		t.Fatalf("a building that only has been read is %q, want planned", got)
	}

	// Climb with changes alone: that reaches the roofed rank and stops there.
	for range ladder {
		tw.Apply(ev("s1", "edit", "src/a.ts", "success"))
	}
	if got := tw.Snapshot().Buildings[0].Status; got != StatusRoofed {
		t.Fatalf("after %d edits status = %q, want roofed; a change makes structure, not finish", len(ladder), got)
	}

	// The finish ranks need passing tests.
	for range ladder {
		tw.Apply(testEvent("s1", "go test ./src", "success"))
	}
	got := tw.Snapshot().Buildings[0].Status
	if got != StatusCompleted {
		t.Fatalf("after tests status = %q, want completed; the top of the ladder must be reachable", got)
	}

	// And no single event may skip a rank.
	tw2 := liveTown(t, "src/a.ts")
	prev := StatusPlanned
	for i := 1; i < len(ladder); i++ {
		if i <= rank(StatusRoofed) {
			tw2.Apply(ev("s1", "edit", "src/a.ts", "success"))
		} else {
			tw2.Apply(testEvent("s1", "go test ./src", "success"))
		}
		now := tw2.Snapshot().Buildings[0].Status
		if rank(now) != rank(prev)+1 {
			t.Fatalf("step %d went from %q to %q, want exactly one rank up", i, prev, now)
		}
		prev = now
	}
}

// A test cannot finish a building that has no roof on it.
func TestTestsDoNotFinishAnUnbuiltBuilding(t *testing.T) {
	tw := liveTown(t, "src/a.ts")
	tw.Apply(ev("s1", "edit", "src/a.ts", "success"))
	early := tw.Snapshot().Buildings[0].Status

	for range 10 {
		tw.Apply(testEvent("s1", "go test ./src", "success"))
	}
	if got := tw.Snapshot().Buildings[0].Status; got != early {
		t.Errorf("tests advanced a roofless building from %q to %q; a test verifies work, it does not raise a roof", early, got)
	}
}

// The ladder itself must be ordered, unique and complete.
func TestStatusLadderIsStrictlyIncreasing(t *testing.T) {
	ladder := AllStatuses()
	if len(ladder) != 8 {
		t.Errorf("ladder has %d ranks, want 8: %v", len(ladder), ladder)
	}
	seen := map[Status]bool{}
	for i, s := range ladder {
		if s == "" {
			t.Error("an empty status is on the ladder")
		}
		if seen[s] {
			t.Errorf("duplicate status %q", s)
		}
		seen[s] = true
		if rank(s) != i {
			t.Errorf("rank(%q) = %d, want its index %d", s, rank(s), i)
		}
	}
	if rank(Status("not-a-real-status")) != 0 {
		t.Error("an unknown status must rank 0, so it can never claim progress")
	}
	if nextAfter(StatusCompleted) != StatusCompleted {
		t.Error("the top of the ladder must be a fixed point")
	}
}

// A state file written by the previous vocabulary must be discarded, not
// misread. The old `broken` is not a rank on the ladder, so loading one would
// seat a value no stage matches and the building would draw as the fallback.
func TestLoadDiscardsAStateFileFromTheOldVocabulary(t *testing.T) {
	root := t.TempDir()
	writeSource(t, root, "src/a.ts")
	at, err := analyzer.Analyze(root)
	if err != nil {
		t.Fatal(err)
	}

	// A version-1 file, exactly as the previous build wrote it, carrying the
	// old statuses.
	legacy := `{"version":1,"updated":1,"buildings":[{"path":"src","touches":9,"problems":1,"lastAgent":"omp","status":"broken","updated":1}]}`
	path := filepath.Join(root, "state.json")
	if err := os.WriteFile(path, []byte(legacy), 0o644); err != nil {
		t.Fatal(err)
	}

	tw := New(at)
	if err := tw.Load(path); err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got := tw.Snapshot().Buildings; len(got) != 0 {
		t.Errorf("loaded %d building(s) from a stale file, want none: %+v", len(got), got)
	}
}

// The current shape round-trips, including the damage flag.
func TestSaveAndLoadRoundTripTheLadder(t *testing.T) {
	root := t.TempDir()
	writeSource(t, root, "src/a.ts")
	at, err := analyzer.Analyze(root)
	if err != nil {
		t.Fatal(err)
	}

	tw := New(at)
	tw.Apply(ev("s1", "edit", "src/a.ts", "success"))
	tw.Apply(ev("s1", "edit", "src/a.ts", "error")) // damages it
	want := tw.Snapshot().Buildings[0]

	path := filepath.Join(root, "state.json")
	if err := tw.Save(path); err != nil {
		t.Fatalf("Save: %v", err)
	}

	restored := New(at)
	if err := restored.Load(path); err != nil {
		t.Fatalf("Load: %v", err)
	}
	got := restored.Snapshot().Buildings
	if len(got) != 1 {
		t.Fatalf("got %d buildings, want 1", len(got))
	}
	if got[0].Status != want.Status {
		t.Errorf("status = %q, want %q", got[0].Status, want.Status)
	}
	if got[0].Damaged != want.Damaged {
		t.Errorf("damaged = %v, want %v", got[0].Damaged, want.Damaged)
	}
	if got[0].Problems != want.Problems {
		t.Errorf("problems = %d, want %d", got[0].Problems, want.Problems)
	}
}

// writeSource puts a source file in a throwaway repo.
func writeSource(t *testing.T, root, rel string) {
	t.Helper()
	full := filepath.Join(root, rel)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
}

// Repairing must not depend on advancing. A building at the top of the ladder
// has nowhere to go, and coupling the two left a completed but damaged building
// permanently damaged — there was no next rank to reach, so the repair never ran.
func TestRepairWorksAtTheTopOfTheLadder(t *testing.T) {
	tw := liveTown(t, "src/a.ts")

	// Climb to the top.
	for range AllStatuses() {
		tw.Apply(ev("s1", "edit", "src/a.ts", "success"))
	}
	for range AllStatuses() {
		tw.Apply(testEvent("s1", "go test ./src", "success"))
	}
	if got := tw.Snapshot().Buildings[0].Status; got != StatusCompleted {
		t.Fatalf("status = %q, want completed", got)
	}

	// Break it, then repair it with work that cannot advance anything.
	tw.Apply(testEvent("s1", "go test ./src", "error"))
	if !tw.Snapshot().Buildings[0].Damaged {
		t.Fatal("a failed test must damage the building")
	}
	tw.Apply(testEvent("s1", "go test ./src", "success"))

	b := tw.Snapshot().Buildings[0]
	if b.Damaged {
		t.Error("a successful test must repair a completed building; there is no rank above it to advance to")
	}
	if b.Status != StatusCompleted {
		t.Errorf("status = %q, want it to stay completed", b.Status)
	}
	if b.Problems != 1 {
		t.Errorf("problems = %d, want the historical count 1", b.Problems)
	}
}
