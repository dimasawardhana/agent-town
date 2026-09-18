package agent

// Frame is one message from the AI Town forwarder plugin.
//
// Fields are a superset of every frame kind. Only `kind`, `directory` and
// `seq` are present on all of them; the rest are populated per kind.
//
// `Seq` is monotonic per plugin instance and is how the daemon detects that
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

	// Tool hook fields.
	Tool    string         `json:"tool"`
	CallID  string         `json:"callID"`
	Args    map[string]any `json:"args"`
	IsError bool           `json:"isError"`

	PID int `json:"pid"`
}
