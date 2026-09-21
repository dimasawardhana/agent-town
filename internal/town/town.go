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

// BuildingState is a building's condition, which changes as work lands on it.
type BuildingState struct {
	Path string `json:"path"`
	// Touches counts actions that landed here this process.
	Touches int `json:"touches"`
	// Problems counts failures. A building with problems is visibly damaged
	// rather than silently fine, because a failed tool is news.
	Problems int `json:"problems"`
	// LastAgent is who worked here most recently, so a building can show a
	// colour per agent when several are running.
	LastAgent string `json:"lastAgent"`
	Status    Status `json:"status"`
	Updated   int64  `json:"updated"`
}

// Status is a building's life stage, following the PRD's vocabulary.
type Status string

const (
	StatusUntouched    Status = "untouched"
	StatusConstructing Status = "constructing"
	StatusTesting      Status = "testing"
	StatusCompleted    Status = "completed"
	StatusBroken       Status = "broken"
)

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

	// A failed tool damages the place rather than advancing it. This is the
	// construction problem, and it is the one thing that must never be
	// smoothed over: a failure is news.
	if c.Place == analyzer.PlaceBuilding && c.Path != "" {
		b, ok := t.buildings[c.Path]
		if !ok {
			b = &BuildingState{Path: c.Path, Status: StatusUntouched}
			t.buildings[c.Path] = b
		}
		b.Touches++
		b.LastAgent = ev.Agent
		b.Updated = ev.Timestamp
		if ev.Result == "error" {
			b.Problems++
			b.Status = StatusBroken
		} else if next := statusFor(c.Action); rank(next) > rank(b.Status) {
			// Progress only moves forward. A status is overwritten solely by
			// one further along, so reading a file cannot un-build a building
			// that was already constructed — the town would erase visible
			// work the moment the agent looked at it again.
			b.Status = next
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

// statusRank orders the stages so progress can be compared.
//
// Broken is excluded deliberately: it is not a stage of construction but a
// condition, set by a failure and cleared by the next success at whatever
// rank that success reaches.
func rank(s Status) int {
	switch s {
	case StatusUntouched:
		return 0
	case StatusTesting:
		return 1
	case StatusConstructing:
		return 2
	case StatusCompleted:
		return 3
	default:
		return 0
	}
}

// statusFor maps an action onto the building stage it implies.
func statusFor(a Action) Status {
	switch a {
	case ActionBuild, ActionHammer:
		return StatusConstructing
	case ActionTest:
		return StatusTesting
	case ActionDemolish:
		return StatusBroken
	default:
		return StatusUntouched
	}
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
