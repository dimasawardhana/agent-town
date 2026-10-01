package town

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
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
	// should have been recorded as a building touch. The building is present
	// because the tree seeds every one of them — what is being asserted here is
	// that no event landed on it, which the count of buildings never actually said.
	for _, b := range tw.Snapshot().Buildings {
		if b.Touches != 0 {
			t.Errorf("site-wide work recorded %d touch(es) on %q — the Yard and Depot are not buildings", b.Touches, b.Path)
		}
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
	// The buildings the tree seeded are still there; what must be absent is the
	// history a good file would have restored.
	for _, b := range tw.Snapshot().Buildings {
		if b.Touches != 0 || b.Problems != 0 {
			t.Errorf("corrupt state produced history on %q: touches=%d problems=%d", b.Path, b.Touches, b.Problems)
		}
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

// Each band is pinned on both sides, so a threshold that drifts in either
// direction fails rather than quietly reclassifying buildings.
func TestSeedStatusBands(t *testing.T) {
	cases := []struct {
		bytes int
		want  Status
	}{
		{0, StatusPlanned},
		{7_999, StatusPlanned},
		{8_000, StatusFoundation},
		{31_999, StatusFoundation},
		{32_000, StatusFramed},
		{127_999, StatusFramed},
		{128_000, StatusWalled},
		{511_999, StatusWalled},
		{512_000, StatusRoofed},
		{50_000_000, StatusRoofed},
	}
	for _, c := range cases {
		if got := SeedStatus(analyzer.Building{AuthoredBytes: c.bytes}); got != c.want {
			t.Errorf("SeedStatus at %d authored bytes = %q, want %q", c.bytes, got, c.want)
		}
	}
}

// The seed reads authored bytes, never the total. A directory whose mass is a
// build artefact is not a tower: sizing it from its total is the exact failure
// `analyzer.Floors` already avoids for a container, and `internal/web` is the
// live case — 1.7MB of embedded bundle beside 28KB of hand-written Go.
func TestSeedStatusReadsAuthoredNotTotal(t *testing.T) {
	b := analyzer.Building{
		AuthoredBytes: 28_119,
		TotalBytes:    1_724_316,
		Generated:     true,
	}
	if got := SeedStatus(b); got != StatusFoundation {
		t.Errorf("SeedStatus with 28119 authored bytes = %q, want %q", got, StatusFoundation)
	}
	// The fixture only means something if the two readings disagree: the total
	// would carry this to the top of the structural half, the authored mass to
	// its second rung. If they ever agree this test stops proving the rule.
	if got := SeedStatus(analyzer.Building{AuthoredBytes: 0, TotalBytes: b.TotalBytes}); got != StatusPlanned {
		t.Fatalf("the fixture no longer distinguishes authored from total: 1.7MB of total alone seeds to %q", got)
	}
}

// A directory that is only a bundle has no authored mass at all, so it seeds to
// the bottom whatever the compiler wrote into it. Measured on this repository,
// `internal/web/static/assets` is exactly this: 1.7MB, none of it hand-written.
func TestSeedStatusIgnoresAPureArtefact(t *testing.T) {
	pure := analyzer.Building{AuthoredBytes: 0, TotalBytes: 1_696_197, Generated: true}
	if got := SeedStatus(pure); got != StatusPlanned {
		t.Errorf("SeedStatus on a pure artefact = %q, want %q", got, StatusPlanned)
	}
}

// Seeding is structural, and structure is only half the ladder. No size may
// claim a finishing trade, because no file size says the tests pass — that is
// the one thing the seed must never assert on the repository's behalf.
func TestSeedStatusNeverClaimsAFinishingTrade(t *testing.T) {
	for _, b := range []int{0, 1, 1_000, 10_000, 100_000, 1_000_000, 1_000_000_000} {
		got := SeedStatus(analyzer.Building{AuthoredBytes: b})
		if rank(got) > rank(StatusRoofed) {
			t.Errorf("SeedStatus at %d bytes = %q, which is a finishing trade", b, got)
		}
	}
}

// Seeding must not make an event worth two ranks. The seed sets where a
// building starts; an event still moves it exactly one rung, from wherever it
// started. If this fails, some future change has made a single edit both
// establish and advance a rank, and the ladder climbs faster than the work
// justifies.
func TestSeedingDoesNotMakeAnEventAdvanceTwoRanks(t *testing.T) {
	for _, start := range AllStatuses()[:5] { // the structural half
		for _, a := range []Action{ActionBuild, ActionHammer, ActionTest} {
			next, advanced := advanceBy(start, a, false)
			if !advanced {
				continue
			}
			if got := rank(next) - rank(start); got != 1 {
				t.Errorf("advanceByB(%q, %q) moved %d ranks, want 1", start, a, got)
			}
		}
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
	// The tree still seeds its buildings, but nothing from the stale file may be
	// adopted. The old vocabulary's statuses are not on the ladder, so a
	// building holding one would draw as whatever the fallback happened to be —
	// which is the whole reason the version guard exists.
	for _, b := range tw.Snapshot().Buildings {
		if b.Status != StatusPlanned {
			t.Errorf("a stale file's status reached %q; only the tree's own seed should survive", b.Status)
		}
		if b.Touches != 0 || b.Problems != 0 {
			t.Errorf("a stale file's history reached %q: touches=%d problems=%d", b.Path, b.Touches, b.Problems)
		}
	}
}

// A stored rank below the tree's seed is corrected upward on load. This is the
// discontinuity the whole change exists for: every town built before seeding
// re-renders taller on its next start, and nothing else in the file changes.
func TestLoadRaisesAStoredStatusToTheSeed(t *testing.T) {
	root := t.TempDir()
	// The building is the directory `src`, not the file inside it — a stored
	// path naming the file would simply not match and nothing would be restored.
	writeBulk(t, root, "src/big.ts", 200_000)
	at, err := analyzer.Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	if got := SeedStatus(at.Buildings[0]); got != StatusWalled {
		t.Fatalf("fixture seeds at %q, not walled — the test would prove nothing", got)
	}

	path := filepath.Join(t.TempDir(), "state.json")
	if err := os.WriteFile(path, []byte(`{"version":2,"updated":0,"buildings":[
		{"path":"src","touches":9,"problems":2,"damaged":true,"status":"foundation","updated":1}
	]}`), 0o644); err != nil {
		t.Fatal(err)
	}

	tw := New(at)
	if err := tw.Load(path); err != nil {
		t.Fatal(err)
	}
	b := tw.Snapshot().Buildings[0]
	if b.Status != StatusWalled {
		t.Errorf("status = %q, want walled — the tree is the floor", b.Status)
	}
	// The rest of the record is history and must survive the correction intact.
	if b.Touches != 9 || b.Problems != 2 || !b.Damaged {
		t.Errorf("history lost in the correction: touches=%d problems=%d damaged=%v", b.Touches, b.Problems, b.Damaged)
	}
}

// writeBulk puts a realistically-sized source file in a throwaway repo, so a
// fixture can reach a band the seed reads. Real text rather than a run of zero
// bytes: a file of NULs reads as binary, and a single long line reads as
// minified output. The analyzer is entitled to exclude both, and does — which
// is how a 200KB fixture once measured as an empty building.
func writeBulk(t *testing.T, root, rel string, size int) {
	t.Helper()
	writeSource(t, root, rel)
	body := strings.Repeat("package main\n", size/13+1)
	if err := os.WriteFile(filepath.Join(root, rel), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

// A finishing rank is history and outranks any seed, so loading never demotes
// a building that has already been finished off.
func TestLoadKeepsAStoredFinishingRank(t *testing.T) {
	root := t.TempDir()
	writeSource(t, root, "src/a.ts")
	at, err := analyzer.Analyze(root)
	if err != nil {
		t.Fatal(err)
	}

	path := filepath.Join(t.TempDir(), "state.json")
	if err := os.WriteFile(path, []byte(`{"version":2,"updated":0,"buildings":[
		{"path":"src","touches":40,"problems":0,"damaged":false,"status":"completed","updated":1}
	]}`), 0o644); err != nil {
		t.Fatal(err)
	}

	tw := New(at)
	if err := tw.Load(path); err != nil {
		t.Fatal(err)
	}
	if got := tw.Snapshot().Buildings[0].Status; got != StatusCompleted {
		t.Errorf("status = %q, want completed — the seed must never demote finished work", got)
	}
}

// Loading is idempotent. A state file saved from a town that has already been
// corrected must reload to the same thing, or the second restart would undo the
// first one's correction and the town would flicker between two readings.
func TestLoadIsIdempotent(t *testing.T) {
	root := t.TempDir()
	writeBulk(t, root, "src/big.ts", 200_000)
	at, err := analyzer.Analyze(root)
	if err != nil {
		t.Fatal(err)
	}

	first := New(at)
	first.Apply(ev("s1", "edit", "src/big.ts", "success"))
	path := filepath.Join(t.TempDir(), "state.json")
	if err := first.Save(path); err != nil {
		t.Fatal(err)
	}

	var statuses []Status
	for range 3 {
		tw := New(at)
		if err := tw.Load(path); err != nil {
			t.Fatal(err)
		}
		statuses = append(statuses, tw.Snapshot().Buildings[0].Status)
		if err := tw.Save(path); err != nil {
			t.Fatal(err)
		}
	}
	for i := 1; i < len(statuses); i++ {
		if statuses[i] != statuses[0] {
			t.Fatalf("load is not idempotent: %v then %v", statuses[0], statuses[i])
		}
	}
}

// A stored path that is no longer in the tree must not conjure a building. The
// snapshot describes what the map can paint, and a deleted directory has none.
func TestLoadDropsAStoredPathThatNoLongerExists(t *testing.T) {
	root := t.TempDir()
	writeSource(t, root, "src/a.ts")
	at, err := analyzer.Analyze(root)
	if err != nil {
		t.Fatal(err)
	}

	path := filepath.Join(t.TempDir(), "state.json")
	if err := os.WriteFile(path, []byte(`{"version":2,"updated":0,"buildings":[
		{"path":"src/a.ts","status":"completed"},
		{"path":"src/deleted.ts","touches":7,"status":"completed"}
	]}`), 0o644); err != nil {
		t.Fatal(err)
	}

	tw := New(at)
	if err := tw.Load(path); err != nil {
		t.Fatal(err)
	}
	for _, b := range tw.Snapshot().Buildings {
		if b.Path == "src/deleted.ts" {
			t.Error("a path that is no longer in the tree was resurrected from the state file")
		}
	}
}

// Every building is present from the moment the town is built, whether or not
// anything has ever happened to it. A building the town has not heard about
// still has a size, and the ladder is supposed to describe the code.
func TestEveryBuildingIsSeededWithoutAnyEvent(t *testing.T) {
	root := t.TempDir()
	writeBulk(t, root, "src/big.ts", 200_000)
	at, err := analyzer.Analyze(root)
	if err != nil {
		t.Fatal(err)
	}

	tw := New(at)
	got := tw.Snapshot().Buildings
	if len(got) != len(at.Buildings) {
		t.Fatalf("a fresh town holds %d buildings, want one per building in the tree (%d)", len(got), len(at.Buildings))
	}
	for _, b := range got {
		if b.Touches != 0 {
			t.Errorf("%q has %d touches before any event", b.Path, b.Touches)
		}
		if b.Status != SeedStatus(at.Buildings[0]) {
			t.Errorf("%q seeded at %q, want %q", b.Path, b.Status, SeedStatus(at.Buildings[0]))
		}
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

// A passing test verifies, and nothing else does. An edit changes the code
// without saying whether that code works, so a building edited a hundred times
// and never tested is still unverified — which is precisely the gap that sent
// `ui` to `foundation` with a hundred touches and no failures.
func TestOnlyATestCanVerify(t *testing.T) {
	tw := liveTown(t, "src/a.ts")

	for range 5 {
		tw.Apply(ev("s1", "edit", "src/a.ts", "success"))
	}
	if tw.Snapshot().Buildings[0].Verified {
		t.Error("five successful edits verified the building; an edit is not a test")
	}

	tw.Apply(testEvent("s1", "go test ./src", "success"))
	if !tw.Snapshot().Buildings[0].Verified {
		t.Error("a passing test did not verify the building")
	}
}

// A failure withdraws verification, and not only a failed test: an edit that
// errors leaves the code just as unverified as a red suite does.
func TestAFailureWithdrawsVerification(t *testing.T) {
	tw := liveTown(t, "src/a.ts")
	tw.Apply(testEvent("s1", "go test ./src", "success"))
	if !tw.Snapshot().Buildings[0].Verified {
		t.Fatal("fixture did not verify")
	}

	tw.Apply(ev("s1", "edit", "src/a.ts", "error"))
	b := tw.Snapshot().Buildings[0]
	if b.Verified {
		t.Error("a failed edit left the building advertising a passing suite that has not run since")
	}
	if !b.Damaged {
		t.Error("a failure must still damage the building")
	}
}

// Verified and Damaged are the three-state condition: good, broken, unknown.
// They are never both true, because a building cannot be known-good and
// known-broken at once, and the renderer has no way to draw that.
func TestVerifiedAndDamagedAreNeverBothTrue(t *testing.T) {
	steps := []struct {
		name string
		ev   agent.UnifiedAgentEvent
	}{
		{"passing test", testEvent("s1", "go test ./src", "success")},
		{"failing test", testEvent("s1", "go test ./src", "error")},
		{"passing edit", ev("s1", "edit", "src/a.ts", "success")},
		{"failing edit", ev("s1", "edit", "src/a.ts", "error")},
		{"passing build", ev("s1", "write", "src/a.ts", "success")},
		{"failing build", ev("s1", "write", "src/a.ts", "error")},
		{"read", ev("s1", "read", "src/a.ts", "success")},
	}
	// Every reachable pair of conditions, reached by replaying every ordered
	// pair of steps. Six steps is 42 sequences — small enough to be exhaustive
	// and large enough that a rule which set only one flag would be caught.
	for i := range steps {
		for j := range steps {
			tw := liveTown(t, "src/a.ts")
			for _, s := range []struct {
				name string
				ev   agent.UnifiedAgentEvent
			}{steps[i], steps[j]} {
				tw.Apply(s.ev)
				b := tw.Snapshot().Buildings[0]
				if b.Verified && b.Damaged {
					t.Fatalf("%s then %s left a building both verified and damaged", s.name, steps[j].name)
				}
			}
		}
	}
}

// Verification is a condition like damage, so it survives a restart. A town
// that forgets which buildings were verified on every start would draw a
// building as unverified between sessions and flip it back on the next test.
func TestVerifiedSurvivesARestart(t *testing.T) {
	root := t.TempDir()
	writeSource(t, root, "src/a.ts")
	at, err := analyzer.Analyze(root)
	if err != nil {
		t.Fatal(err)
	}

	first := New(at)
	first.Apply(testEvent("s1", "go test ./src", "success"))
	path := filepath.Join(t.TempDir(), "state.json")
	if err := first.Save(path); err != nil {
		t.Fatal(err)
	}

	restored := New(at)
	if err := restored.Load(path); err != nil {
		t.Fatal(err)
	}
	if !restored.Snapshot().Buildings[0].Verified {
		t.Error("verification did not survive a restart; it is a condition, not a stage")
	}
}

// A state file written before `Verified` existed reads as unverified, which is
// the honest default: nothing had established that those buildings' tests
// passed. This is why persistenceVersion stays at 2 — a missing boolean is not
// a stale vocabulary, and bumping the guard would throw away every recorded
// touch to preserve a distinction that means nothing.
func TestAnOlderStateFileReadsAsUnverified(t *testing.T) {
	root := t.TempDir()
	writeSource(t, root, "src/a.ts")
	at, err := analyzer.Analyze(root)
	if err != nil {
		t.Fatal(err)
	}

	path := filepath.Join(t.TempDir(), "state.json")
	// No `verified` key anywhere: this is the shape a version-2 file had
	// before the field was added.
	if err := os.WriteFile(path, []byte(`{"version":2,"updated":0,"buildings":[
		{"path":"src","touches":12,"problems":1,"damaged":false,"status":"walled","updated":1}
	]}`), 0o644); err != nil {
		t.Fatal(err)
	}

	tw := New(at)
	if err := tw.Load(path); err != nil {
		t.Fatalf("Load: %v", err)
	}
	b := tw.Snapshot().Buildings[0]
	if b.Verified {
		t.Error("a file with no verification recorded claims the building is verified")
	}
	// The rest of the history must be intact, or the default cost more than it
	// bought.
	if b.Touches != 12 || b.Problems != 1 {
		t.Errorf("history lost: touches=%d problems=%d", b.Touches, b.Problems)
	}
}

// The field is on the wire under a name that says what it is, so the renderer
// is reading a fact rather than inferring one from a stage.
func TestVerifiedIsOnTheWire(t *testing.T) {
	tw := liveTown(t, "src/a.ts")
	tw.Apply(testEvent("s1", "go test ./src", "success"))

	raw, err := json.Marshal(tw.Snapshot())
	if err != nil {
		t.Fatal(err)
	}
	var got struct {
		Buildings []struct {
			Verified *bool `json:"verified"`
		} `json:"buildings"`
	}
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Buildings) != 1 || got.Buildings[0].Verified == nil {
		t.Fatalf("the snapshot carries no `verified` field: %s", raw)
	}
	if !*got.Buildings[0].Verified {
		t.Error("verified is on the wire but false for a building that just passed")
	}
}

// A whole-repo run names no building of its own, so the building that broke has
// to come out of the output. This is the case that motivated the whole feature:
// before it, the damage landed in the Yard and no building was ever marked.
func TestAWholeRepoRunDamagesTheBuildingThatFailed(t *testing.T) {
	tw := liveTown(t, "internal/town/a.go", "internal/analyzer/b.go")

	// `go test ./...` targets the repository, so the event names no directory.
	tw.Apply(agent.UnifiedAgentEvent{
		ID: "e1", SessionID: "s1", Agent: "omp", Type: "COMMAND_COMPLETED",
		Tool:   "bash",
		Target: agent.UnifiedTarget{Command: "go test ./..."},
		Result: "error",
		Output: "ok  \t…/internal/town\t0.358s\n--- FAIL: T (0.00s)\nFAIL\n" +
			"FAIL\tgithub.com/dimasajiwardhana/agent-town/internal/analyzer\t0.336s\n" +
			"ok  \t…/internal/registry\t0.015s\n",
	})

	damaged := map[string]bool{}
	for _, b := range tw.Snapshot().Buildings {
		if b.Damaged {
			damaged[b.Path] = true
		}
	}
	if !damaged["internal/analyzer"] {
		t.Errorf("the building that failed was not marked; damaged = %v", damaged)
	}
	if damaged["internal/town"] {
		t.Error("a building that passed was marked damaged; the output named one package and it was not this one")
	}
}

// Output the parser cannot read damages nobody, and falls back to the command's
// own building. A whole-repo run landing in the Yard is the old behaviour and
// is survivable; damaging a building nobody said had failed is not.
func TestUnreadableTestOutputDamagesNobodyElse(t *testing.T) {
	tw := liveTown(t, "src/a.go")
	tw.Apply(agent.UnifiedAgentEvent{
		ID: "e1", SessionID: "s1", Agent: "omp", Type: "COMMAND_COMPLETED",
		Tool:   "bash",
		Target: agent.UnifiedTarget{Path: "src/a.go", Command: "go test ./..."},
		Result: "error",
		Output: "X deliberate (1.4ms)\nX failing tests:\n", // a runner we do not read
	})
	for _, b := range tw.Snapshot().Buildings {
		if b.Path == "src" && b.Damaged {
			t.Error("a command that named no building and printed unreadable output damaged one anyway")
		}
	}
}

// A package that is not a building in this town is dropped rather than filed
// somewhere convenient.
func TestAFailingPackageOutsideTheTownIsDropped(t *testing.T) {
	tw := liveTown(t, "src/a.go")
	tw.Apply(agent.UnifiedAgentEvent{
		ID: "e1", SessionID: "s1", Agent: "omp", Type: "COMMAND_COMPLETED",
		Tool:   "bash",
		Target: agent.UnifiedTarget{Command: "go test ./..."},
		Result: "error",
		Output: "FAIL\tgithub.com/other/repo/elsewhere\t0.336s\n",
	})
	// The event named no building, so the fallback damages nothing either.
	for _, b := range tw.Snapshot().Buildings {
		if b.Damaged {
			t.Errorf("%s was damaged by a failure in another repository", b.Path)
		}
	}
}

// `go test -run TestNoSuchTest` exits 0 and prints `[no tests to run]`. Before
// this, three of those in a row carried a building from `roofed` to `completed`
// while running no test at all — the ladder claiming a finish that never
// happened, which is the one thing this project is not allowed to do.
func TestAVacuousTestRunDoesNotFinishABuilding(t *testing.T) {
	tw := liveTown(t, "src/a.ts")

	// Climb to `roofed` with edits, which is where the finishing ranks start.
	for range 4 {
		tw.Apply(ev("s1", "edit", "src/a.ts", "success"))
	}
	before := tw.Snapshot().Buildings[0].Status
	if before != StatusRoofed {
		t.Fatalf("fixture is at %q, want roofed", before)
	}

	for range 3 {
		tw.Apply(agent.UnifiedAgentEvent{
			ID: "t", SessionID: "s1", Agent: "omp", Type: "COMMAND_COMPLETED",
			Tool:   "bash",
			Target: agent.UnifiedTarget{Path: "src", Command: "go test -run TestNoSuchTest ./src"},
			Result: "success",
			Output: "ok  \t…/src\t0.002s [no tests to run]\n",
		})
	}
	if got := tw.Snapshot().Buildings[0].Status; got != StatusRoofed {
		t.Errorf("three runs that tested nothing moved the building to %q", got)
	}
}

// A real pass still finishes, because the guard is about *evidence* and not
// about test runs in general.
func TestAGenuineTestRunStillFinishesABuilding(t *testing.T) {
	tw := liveTown(t, "src/a.ts")
	for range 4 {
		tw.Apply(ev("s1", "edit", "src/a.ts", "success"))
	}
	for range 3 {
		tw.Apply(agent.UnifiedAgentEvent{
			ID: "t", SessionID: "s1", Agent: "omp", Type: "COMMAND_COMPLETED",
			Tool:   "bash",
			Target: agent.UnifiedTarget{Path: "src", Command: "go test ./src"},
			Result: "success",
			Output: "ok  \t…/src\t0.031s\n",
		})
	}
	if got := tw.Snapshot().Buildings[0].Status; got != StatusCompleted {
		t.Errorf("a building with three real passing runs is at %q, want completed", got)
	}
}
