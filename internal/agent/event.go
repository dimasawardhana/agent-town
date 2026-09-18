// Package agent observes AI coding agents and normalizes their activity
// into a single event vocabulary.
//
// The normalized shape is fixed by prd.md section 9 and docs/adr/0008.
// Every adapter, present and future, MUST produce exactly this shape.
package agent

// UnifiedTarget identifies what an event acted upon.
type UnifiedTarget struct {
	Path string `json:"path"`
}

// UnifiedAgentEvent is the agent-agnostic record of a single agent action.
// It is the contract between every adapter and the town engine.
type UnifiedAgentEvent struct {
	ID        string        `json:"id"`
	SessionID string        `json:"session_id"`
	Agent     string        `json:"agent"`
	Type      string        `json:"type"`
	Tool      string        `json:"tool"`
	Target    UnifiedTarget `json:"target"`
	Result    string        `json:"result"`
	Timestamp int64         `json:"timestamp"`
}
