package town

import (
	"sync"
	"time"

	"github.com/dimasajiwardhana/agent-town/internal/agent"
	"github.com/dimasajiwardhana/agent-town/internal/analyzer"
)

// Worker is one animated figure: a chief for the agent driving a session, a
// sub worker for anything it spawns.
type Worker struct {
	ID        string         `json:"id"`
	Session   string         `json:"session"`
	Agent     string         `json:"agent"`
	Tier      string         `json:"tier"` // "chief" or "sub"
	Action    Action         `json:"action"`
	Place     string         `json:"place"` // building path, or a place kind
	PlaceKind analyzer.Place `json:"placeKind"`
	// Label is what the worker is doing, for the UI. The animation shows the
	// kind; this says which tool.
	Label string `json:"label"`
	// Since is when this action began, so the UI can pace the animation
	// rather than showing a hammer swing that finished seconds ago.
	Since int64 `json:"since"`
}

// BuildingState is a building's construction, which changes as work lands on it.
//
// Condition and progress are separate fields on purpose. `Problems` is damage:
// it can appear at any stage and does not move the building backwards. `Status`
// is the ladder. An earlier shape folded them into one field with a `broken`
// status, which could not express the difference between a building that was
// never started and one that was finished and then failed — the second is the
// more useful fact, and it was unrepresentable.
type BuildingState struct {
	Path string `json:"path"`
	// Touches counts actions that landed here this process.
	Touches int `json:"touches"`
	// Problems is the running count of failures here: history, never cleared.
	Problems int `json:"problems"`
	// Damaged is whether the building is currently damaged. It is a condition
	// rather than a stage, so damage is drawn over whatever the building has
	// reached, and a success repairs it without undoing any progress.
	Damaged   bool   `json:"damaged"`
	LastAgent string `json:"lastAgent"`
	Status    Status `json:"status"`
	Updated   int64  `json:"updated"`
}

// Status is how far a building has been built.
//
// The ladder is ordered and strictly increasing, and each rank means exactly
// one more part of the building is standing — which is what makes a glance at
// the map answer "how finished is this?" rather than only "has anything
// happened?". Ranks are never skipped, so a building cannot show a roof without
// walls, and a status alone is enough to draw it.
//
// The first four ranks are raised by making changes, the last four by passing
// tests. That split is not decoration: it is what puts a test run on the
// building it verified. Before it, every test landed in the Yard as site-wide
// work, so a building could never be tested, never be glazed, and never be
// completed — `completed` was declared and ranked but unreachable.
type Status string

const (
	// Planned: the plot is staked out and nothing is standing. The state a
	// building is in before any work has landed on it.
	StatusPlanned Status = "planned"
	// Foundation: footings dug, spoil heaped. The first edit.
	StatusFoundation Status = "foundation"
	// Framed: pillars and beams up, open to the sky.
	StatusFramed Status = "framed"
	// Walled: the shell is closed, still open above.
	StatusWalled Status = "walled"
	// Roofed: the roof is on and the building is weathertight. The last rank a
	// change can reach — structure is what a change makes.
	StatusRoofed Status = "roofed"
	// Glazed: windows fitted. The first rank a passing test reaches; a test is
	// what says the work is sound enough to be finished off.
	StatusGlazed Status = "glazed"
	// Doored: the door is hung, so the building has an inside.
	StatusDoored Status = "doored"
	// Completed: trimmed, painted, and finished. A building only reaches this
	// by passing tests, which is the whole reason the finish ranks are gated
	// on them.
	StatusCompleted Status = "completed"
)

// AllStatuses is the ladder in order, lowest first.
//
// It exists so the order is data rather than a switch statement repeated in
// three places, and so a test can assert the ladder is complete and strictly
// increasing without restating it.
func AllStatuses() []Status {
	return []Status{
		StatusPlanned,
		StatusFoundation,
		StatusFramed,
		StatusWalled,
		StatusRoofed,
		StatusGlazed,
		StatusDoored,
		StatusCompleted,
	}
}

// rank is a status's position on the ladder. An unknown status ranks 0, so a
// status this build does not know about can never claim to be progress.
func rank(s Status) int {
	for i, known := range AllStatuses() {
		if s == known {
			return i
		}
	}
	return 0
}

// nextAfter returns the rank one above the given status, or the same status at
// the top of the ladder.
func nextAfter(s Status) Status {
	all := AllStatuses()
	i := rank(s)
	if i >= len(all)-1 {
		return all[len(all)-1]
	}
	return all[i+1]
}

// advanceBy returns the status one *event* of the given action would justify.
//
// A change raises the building by one structural rank and no further, because
// one change is one part: an edit is a course of wall, the next edit is the
// next thing. A passing test is what adds the finishing trades. A read changes
// nothing — looking at a building does not build it.
//
// This is deliberately not "set the status to the action's level", which is the
// shape that broke before: it meant a single edit jumped a building to a fully
// framed one, and a later test could never apply because tests ranked lower
// than construction.
func advanceBy(s Status, a Action) (Status, bool) {
	switch a {
	case ActionBuild, ActionHammer:
		// Structure: four ranks, raised one at a time by making changes.
		if rank(s) >= rank(StatusRoofed) {
			return s, false
		}
		return nextAfter(s), true
	case ActionTest:
		// Finish: fitted only once the shell is weathertight, then one trade at
		// a time. A test on an unfinished building therefore does not glaze a
		// roofless one; it simply cannot advance it.
		if rank(s) < rank(StatusRoofed) {
			return s, false
		}
		return nextAfter(s), true
	default:
		return s, false
	}
}

// Town is the live state: which crews are at work, where their workers stand,
// and what condition the buildings are in.
//
// It is deliberately separate from analyzer.Town, which is the static shape.
// That one is a pure function of a directory tree and never changes; this one
// changes with every event and is what the UI renders.
type Town struct {
	mu        sync.RWMutex
	workers   map[string]*Worker // session id -> the crew's chief
	buildings map[string]*BuildingState
	events    []agent.UnifiedAgentEvent
	resolver  *analyzer.Resolver
	maxEvents int
}

// New creates a live town for a project.
func New(t *analyzer.Town) *Town {
	return &Town{
		workers:   map[string]*Worker{},
		buildings: map[string]*BuildingState{},
		resolver:  analyzer.NewResolver(t),
		maxEvents: 200,
	}
}

// Apply folds one event into the town and returns the resulting crew.
//
// It never drops an event for want of a location: a tool that names no file
// is site-wide work and is staged in the Yard, which is what keeps a session
// from rendering as a worker standing still.
func (t *Town) Apply(ev agent.UnifiedAgentEvent) *Worker {
	// The adapter already normalized the tool, target and command, so the
	// event goes to Classify as-is. Rebuilding an argument map here would
	// re-derive what the normalizer decided.
	c := Classify(ev, t.resolver)

	t.mu.Lock()
	defer t.mu.Unlock()

	// Record the event regardless of classification: the feed is the honest
	// record, and the town is the interpretation of it.
	t.events = append([]agent.UnifiedAgentEvent{ev}, t.events...)
	if len(t.events) > t.maxEvents {
		t.events = t.events[:t.maxEvents]
	}

	w, ok := t.workers[ev.SessionID]
	if !ok {
		// A session that never announced itself still gets a worker. An agent
		// whose handshake was lost is still working, and showing nothing
		// would be the town lying about it.
		w = &Worker{
			ID:      "chief:" + ev.SessionID,
			Session: ev.SessionID,
			Agent:   ev.Agent,
			Tier:    "chief",
		}
		t.workers[ev.SessionID] = w
	}

	w.Action = c.Action
	w.Place = placeKey(c)
	w.PlaceKind = c.Place
	w.Label = ev.Tool
	w.Since = ev.Timestamp

	// Work on a building moves it up the ladder, or damages it. It is never
	// moved back down: a building keeps the progress it earned (ADR-0004).
	if c.Place == analyzer.PlaceBuilding && c.Path != "" {
		b, ok := t.buildings[c.Path]
		if !ok {
			// A building the town has not seen worked on yet is a staked plot,
			// not an absent thing: it exists in the map the moment the project
			// is analyzed, and this is the state it starts in.
			b = &BuildingState{Path: c.Path, Status: StatusPlanned}
			t.buildings[c.Path] = b
		}
		b.Touches++
		b.LastAgent = ev.Agent
		b.Updated = ev.Timestamp

		if ev.Result == "error" {
			// A failure is damage, never a stage. Problems is the running count
			// of them, which is history and is never cleared; Damaged is the
			// current condition, which a later success repairs. Keeping one
			// field for both made the two unrepresentable together, which is
			// why a building that failed and was fixed could not be told from
			// one that had never failed.
			b.Problems++
			b.Damaged = true
			return w
		}

		switch c.Action {
		case ActionBuild, ActionHammer, ActionTest:
			// Work that succeeds repairs the building, whether or not it also
			// moves it on. These are separate facts: a building at the top of
			// the ladder cannot advance, and repairing it must not depend on
			// finding a rank above the one it already holds — coupling the two
			// left a completed but damaged building permanently damaged, because
			// there was no next rank to reach.
			b.Damaged = false
			// At most one rank per event, so the ladder is climbed part by part
			// and never skipped. Reads, shell commands and planning events
			// cannot advance it at all.
			if next, advanced := advanceBy(b.Status, c.Action); advanced {
				b.Status = next
			}
		}
	}

	return w
}

// placeKey renders a classification's location as the key the renderer uses
// to find it on the map.
func placeKey(c Classification) string {
	if c.Place == analyzer.PlaceBuilding && c.Path != "" {
		return analyzer.SiteIDBuildingPrefix + c.Path
	}
	return string(c.Place)
}

// StartSession creates a crew for a session.
func (t *Town) StartSession(sessionID, agentName string) *Worker {
	t.mu.Lock()
	defer t.mu.Unlock()
	w := &Worker{
		ID:        "chief:" + sessionID,
		Session:   sessionID,
		Agent:     agentName,
		Tier:      "chief",
		Action:    ActionPlan,
		Place:     string(analyzer.PlaceDepot),
		PlaceKind: analyzer.PlaceDepot,
		Label:     "session start",
		Since:     time.Now().UnixMilli(),
	}
	t.workers[sessionID] = w
	return w
}

// EndSession marks a crew as leaving. The town keeps whatever the session
// built: the buildings are the result, and deleting them on exit would throw
// away the only persistent thing the product produces.
func (t *Town) EndSession(sessionID string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if w, ok := t.workers[sessionID]; ok {
		w.Action = ActionCelebrate
		w.Label = "session complete"
		w.Since = time.Now().UnixMilli()
	}
}

// Snapshot is what the UI receives.
type Snapshot struct {
	Workers   []Worker                  `json:"workers"`
	Buildings []BuildingState           `json:"buildings"`
	Events    []agent.UnifiedAgentEvent `json:"events"`
}

// Snapshot returns a copy of the live state, safe to serialize while events
// keep arriving.
func (t *Town) Snapshot() Snapshot {
	t.mu.RLock()
	defer t.mu.RUnlock()

	workers := make([]Worker, 0, len(t.workers))
	for _, w := range t.workers {
		workers = append(workers, *w)
	}

	buildings := make([]BuildingState, 0, len(t.buildings))
	for _, b := range t.buildings {
		buildings = append(buildings, *b)
	}

	events := make([]agent.UnifiedAgentEvent, len(t.events))
	copy(events, t.events)

	return Snapshot{Workers: workers, Buildings: buildings, Events: events}
}
