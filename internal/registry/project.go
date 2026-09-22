// Package registry holds the projects a daemon serves.
//
// A Project is one imported directory and the town drawn for it. The daemon
// serves a set of them (ADR-0014), so state that used to be a local variable
// in main is owned here instead — one place that knows how to open a project,
// fold events into it, and persist the result.
package registry

import (
	"errors"
	"sync"

	"github.com/dimasajiwardhana/agent-town/internal/agent"
	"github.com/dimasajiwardhana/agent-town/internal/analyzer"
	"github.com/dimasajiwardhana/agent-town/internal/town"
)

// Project is one imported directory and the town that represents it.
//
// The fields separate what is recomputed from what is remembered: the map is a
// pure function of the directory tree (ADR-0012) and is rebuilt on every
// start, while the live state is the record of what agents actually did and is
// the only thing persisted.
type Project struct {
	// mu guards every mutable field below.
	//
	// A Project is touched by several goroutines at once: the HTTP handler
	// applying frames as they arrive, the /api/town handler analyzing on first
	// view, and the session-end callback. Without this, viewing a project
	// while an agent works in it races on the pending buffer — reproduced
	// under -race before this existed.
	mu sync.Mutex

	// path is the absolute directory this project represents.
	path string

	// static is the map — districts and buildings derived from the tree. It
	// is nil when the project could not be analyzed, which the daemon serves
	// rather than treating as fatal.
	static *analyzer.Town

	// layout is where each site sits, computed once from static. Nil exactly
	// when static is nil.
	layout *analyzer.Layout

	// live folds events into state: where workers stand, and what condition
	// the buildings they touch are in. Nil exactly when static is nil,
	// because a worker cannot be placed without a map.
	live *town.Town

	// statePath is where the live state is written. Empty when there is
	// nothing to persist.
	statePath string

	// analysisErr records why there is no map, so the UI can say so instead
	// of rendering an empty town as though it were a real one.
	analysisErr error
	// saveErr is the most recent persistence failure. Kept rather than
	// returned because a failed save costs history, not correctness, and the
	// daemon reports it instead of stopping.
	saveErr error

	// pending holds events that arrived before there was a map to place them
	// on. Folding an event needs the analysis, because the resolver is built
	// from it, so a project that is registered but not yet analyzed cannot
	// place anything — and dropping those events would lose the start of a
	// session that is already running.
	pending pendingBuffer
}

// maxPending bounds the buffer. A project registered and never analyzed, while
// an agent works in it, must not grow without limit: that is a daemon dying of
// a problem the developer did not cause. Overflow is reported rather than
// silently absorbed, because a town missing history must say so.
const maxPending = 200

// pendingBuffer holds events for a project that has no map yet.
type pendingBuffer struct {
	events []agent.UnifiedAgentEvent

	// dropped is a running total for the project's life, not just the current
	// buffer. Draining resets the events but NOT this: a loss that happened
	// before the project was opened must still be reportable afterwards,
	// because a town missing history has to say so.
	dropped int64
}

// Add keeps an event until it can be placed, or counts it as dropped.
func (b *pendingBuffer) Add(ev agent.UnifiedAgentEvent) {
	if len(b.events) >= maxPending {
		// Drop the OLDEST rather than refusing the newest: recent activity is
		// what the developer is watching for, and the count reports the loss.
		b.events = b.events[1:]
		b.dropped++
	}
	b.events = append(b.events, ev)
}

// Drain returns everything buffered and clears the events.
//
// The lifetime drop count is deliberately not reset: it is what the UI reports
// as history the town never saw.
func (b *pendingBuffer) Drain() []agent.UnifiedAgentEvent {
	evs := b.events
	b.events = nil
	return evs
}

// Len is how many events are waiting.
func (b *pendingBuffer) Len() int { return len(b.events) }

// Open analyzes a directory and returns the project representing it.
//
// An analysis failure is recorded on the project rather than returned: a
// directory that cannot be analyzed is still a project the daemon accepts
// events for, and the UI explains the failure instead of the daemon exiting.
//
// The returned error reports only that previous state could not be restored.
// That costs history, not correctness, so a caller should report it and carry
// on.
func Open(dir string) (*Project, error) {
	return OpenBounded(dir, analyzer.DefaultMaxFiles)
}

// OpenBounded is Open with an explicit file budget, so a directory large
// enough to be pathological is bounded rather than walked in full.
func OpenBounded(dir string, maxFiles int) (*Project, error) {
	p := &Project{path: dir}

	t, err := analyzer.AnalyzeBounded(dir, maxFiles)
	if err != nil {
		p.analysisErr = err
		return p, nil
	}

	l := analyzer.LayoutTown(t)
	p.static, p.layout = t, &l
	p.live = town.New(t)
	p.statePath = town.StatePath(dir)

	if err := p.live.Load(p.statePath); err != nil {
		return p, err
	}
	return p, nil
}

// Path is the absolute directory this project represents.
//
// It is immutable after construction, so it needs no lock.
func (p *Project) Path() string { return p.path }

// Analyzed reports whether the project has a map. A project that could not be
// analyzed still accepts events; it just cannot place them.
func (p *Project) Analyzed() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.static != nil
}

// AnalysisError is why there is no map, or nil when there is one.
//
// A project that has never been analyzed reports an error rather than nil,
// because a nil here alongside a nil Static() is the shape that invites a
// caller to write `if err := p.AnalysisError(); err != nil { ... }` and then
// dereference Static() — which crashed `townd ls` on a freshly registered
// project. Analysis is deferred by design (see Register), so "not yet" is a
// normal state that callers must handle, not an absence of error.
func (p *Project) AnalysisError() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.static == nil && p.analysisErr == nil {
		return errNotAnalyzed
	}
	return p.analysisErr
}

// errNotAnalyzed reports a project whose analysis has not been attempted.
//
// It is a sentinel so callers can tell "not yet" from "failed", which have
// different remedies: one waits, the other is fixed or removed.
var errNotAnalyzed = errors.New("not analyzed yet")

// ErrNotAnalyzed is errNotAnalyzed for callers outside this package, which
// need to distinguish a deferred analysis from a failure to present the right
// message.
var ErrNotAnalyzed = errNotAnalyzed

// Static is the analyzed town, or nil when analysis has not succeeded.
func (p *Project) Static() *analyzer.Town {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.static
}

// Layout is the computed map, or nil when analysis has not succeeded.
func (p *Project) Layout() *analyzer.Layout {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.layout
}

// Snapshot is the current live state, and whether one exists.
func (p *Project) Snapshot() (town.Snapshot, bool) {
	p.mu.Lock()
	live := p.live
	p.mu.Unlock()
	if live == nil {
		return town.Snapshot{}, false
	}
	// The town has its own lock, so this is called outside ours to avoid
	// holding two locks at once and to avoid blocking event application for
	// the duration of a serialize.
	return live.Snapshot(), true
}

// Apply folds one event into the town and persists the result.
//
// It returns the resulting snapshot and whether the event could be placed at
// all. An unplaceable event is not an error and is not lost: a project with no
// map yet buffers it, so a session that started before its project was
// analyzed is still drawn once the analysis lands.
func (p *Project) Apply(ev agent.UnifiedAgentEvent) (town.Snapshot, bool) {
	p.mu.Lock()
	live := p.live
	if live == nil {
		p.pending.Add(ev)
		p.mu.Unlock()
		return town.Snapshot{}, false
	}
	p.mu.Unlock()

	// The town serializes its own application, so folding happens outside our
	// lock and a slow save cannot block another frame's arrival.
	live.Apply(ev)
	snap := live.Snapshot()
	p.save(live)
	return snap, true
}

// Analyze builds the map for a project that did not have one, then replays
// whatever arrived meanwhile.
//
// This is what makes `Registered` a real state rather than a waiting room: a
// frame accepted before the analysis is folded in order, so workers appear
// where they were actually working rather than only from the moment the
// developer opened the project.
//
// It returns the snapshot after replay, whether one exists, and how many
// buffered events had to be dropped for want of room.
func (p *Project) Analyze(maxFiles int) (town.Snapshot, bool, int64) {
	p.mu.Lock()
	if p.live != nil {
		live := p.live
		p.mu.Unlock()
		return live.Snapshot(), true, 0
	}
	p.mu.Unlock()

	// The walk is the expensive part and is deliberately outside the lock, so
	// frames keep being accepted while it runs. They land in the buffer and are
	// replayed below.
	t, err := analyzer.AnalyzeBounded(p.path, maxFiles)

	// Installing the map and draining the buffer must be atomic with respect
	// to Apply. Releasing the lock between them would let a frame arrive after
	// the installation and before the drain, where it would be applied to a
	// town that the drain is about to overwrite the order of.
	p.mu.Lock()
	defer p.mu.Unlock()

	// Another goroutine may have finished the same analysis while this one
	// walked. Its result wins and this one is discarded, so the expensive work
	// is wasted rather than two towns existing for one project.
	if p.live != nil {
		return p.live.Snapshot(), true, 0
	}
	if err != nil {
		p.analysisErr = err
		return town.Snapshot{}, false, 0
	}

	l := analyzer.LayoutTown(t)
	live := town.New(t)
	path := town.StatePath(p.path)
	if loadErr := live.Load(path); loadErr != nil {
		p.saveErr = loadErr
	}

	p.static, p.layout = t, &l
	p.live, p.statePath = live, path
	p.analysisErr = nil

	// Replayed raw rather than pre-resolved, so the resolver places them
	// exactly as it would have live.
	pending := p.pending.Drain()
	dropped := p.pending.dropped
	for _, ev := range pending {
		live.Apply(ev)
	}
	// Saved through the concrete value rather than p.Save, which would take
	// the lock this function already holds.
	if saveErr := live.Save(path); saveErr != nil {
		p.saveErr = saveErr
	}
	return live.Snapshot(), true, dropped
}

// Pending is how many events are waiting for a map.
func (p *Project) Pending() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.pending.Len()
}

// Dropped is how many events overflowed the buffer, so the UI can say the
// town is missing history rather than presenting it as complete.
func (p *Project) Dropped() int64 {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.pending.dropped
}

// State reports which of the project states this project is in.
//
// The states are distinct because they have different consequences: awaiting
// analysis still accepts work, whereas unreadable does not.
func (p *Project) State() State {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.live != nil {
		if p.static.Partial {
			return StatePartial
		}
		return StateReady
	}
	if p.analysisErr != nil {
		return StateUnreadable
	}
	return StateAnalyzing
}

// State is which of the project states a project is in (CONTEXT.md).
type State string

const (
	// StateRegistered is known to the daemon and accepting frames, before
	// analysis has been attempted.
	StateRegistered State = "registered"
	// StateAnalyzing is being walked to build its map.
	StateAnalyzing State = "analyzing"
	// StateReady has a map and can place every event it receives.
	StateReady State = "ready"
	// StatePartial has a map drawn from part of its tree, because the walk
	// stopped at the file budget.
	StatePartial State = "partial"
	// StateUnreadable cannot be analyzed at all — the path is gone or is not
	// a directory.
	StateUnreadable State = "unreadable"
)

// EndSession stands a crew down and persists the result.
//
// The buildings it touched stay: the town is the result of the work, and
// clearing it on exit would throw away the only persistent thing the product
// produces.
func (p *Project) EndSession(session string) (town.Snapshot, bool) {
	p.mu.Lock()
	live := p.live
	p.mu.Unlock()
	if live == nil {
		return town.Snapshot{}, false
	}
	live.EndSession(session)
	snap := live.Snapshot()
	p.save(live)
	return snap, true
}

// Save writes the live state, discarding the error.
//
// A failed save costs history on the next start, not correctness now, and the
// caller has no better option at this point. Reported so it is not silent.
func (p *Project) Save() {
	p.mu.Lock()
	live, path := p.live, p.statePath
	p.mu.Unlock()
	p.saveLocked(live, path)
}

// save persists the given town, recording a failure.
func (p *Project) save(live *town.Town) {
	p.mu.Lock()
	path := p.statePath
	p.mu.Unlock()
	p.saveLocked(live, path)
}

func (p *Project) saveLocked(live *town.Town, path string) {
	if live == nil || path == "" {
		return
	}
	err := live.Save(path)
	p.mu.Lock()
	p.saveErr = err
	p.mu.Unlock()
}

// SaveError is the most recent save failure, or nil. The daemon reports it
// rather than failing: the town in memory is still correct.
func (p *Project) SaveError() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.saveErr
}

// ClearSaveError forgets the last save failure.
//
// The daemon reports a save failure once per occurrence rather than on every
// event, so that a persistent disk problem does not flood stderr while the
// town keeps working in memory.
func (p *Project) ClearSaveError() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.saveErr = nil
}
