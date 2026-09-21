package agent

// Frame is one message from the AI Town forwarder extension.
//
// Fields are a superset of every frame kind. Only `kind`, `directory` and
// `seq` are present on all of them; the rest are populated per kind.
//
// `Seq` is monotonic per extension instance and is how the daemon detects that
// it missed frames while it was down (docs/adr/0010).
type Frame struct {
	Kind      string `json:"kind"`
	Directory string `json:"directory"`
	Seq       int64  `json:"seq"`
	Dropped   int64  `json:"dropped"`

	// Agent identifies which adapter produced this frame: "opencode",
	// "pi", "omp", "hermes". REQUIRED — without it the daemon cannot tell
	// which agent an event came from, and would have to guess.
	Agent string `json:"agent"`

	Type      string `json:"type"`
	SessionID string `json:"sessionID"`

	// Part is the raw message part for `message.part.updated` events. Kept
	// raw so the normalizer owns the shape decisions.
	Part map[string]any `json:"part"`

	// Kind "session.end" marks a crew leaving. Without it the daemon never
	// learns a session finished, and its worker stays frozen mid-action
	// forever — the town claiming work is happening when the agent is gone.
	//
	// Time is when the extension observed the action, in Unix milliseconds.
	// The tool hooks have no clock of their own on the wire, so without this
	// every tool event would arrive with no usable time and could not be
	// ordered on a timeline.
	Time int64 `json:"time"`

	// Tool hook fields.
	Tool    string         `json:"tool"`
	CallID  string         `json:"callID"`
	Args    map[string]any `json:"args"`
	IsError bool           `json:"isError"`

	PID int `json:"pid"`
}
