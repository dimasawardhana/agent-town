# Plugin Event Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver agent events from a running OpenCode process into AI Town, with directory isolation, sequence-gap detection, and a load handshake — so the town can be built on a trustworthy stream.

**Architecture:** An OpenCode plugin runs inside the agent process and POSTs frames to a loopback HTTP endpoint on the AI Town daemon. The daemon rejects frames from directories it does not watch (403), detects sequence gaps, and normalizes frames into AI Town's unified event type. The plugin keeps an in-memory queue so a daemon restart does not lose events.

**Tech Stack:** TypeScript (plugin, Node 24), Go 1.27.0 stdlib only (daemon), OpenCode ≥ 1.4.3.

**Spec:** `prd.md` §8, §9, §34; `docs/adr/0008`, `0009`, `0010`; `docs/plugin-transport-recommendations.md`

## Global Constraints

- **Go 1.27.0**, module path `github.com/dimasajiwardhana/agent-town`. **Stdlib only** — no third-party Go dependencies.
- **Bind loopback only.** `127.0.0.1`. Never `0.0.0.0`.
- **Never break the agent.** Every plugin failure path is swallowed. The agent must work identically with AI Town absent.
- **Normalized event schema is fixed** by `prd.md` §9: `id`, `session_id`, `agent`, `type`, `tool`, `target.path`, `result`, `timestamp`. `timestamp` is Unix milliseconds (int64).
- **Attribute by `sessionID`, never by directory.** A directory is node scope, not identity — two agents in one repo share it (`docs/plugin-transport-recommendations.md` Q5).
- **Never emit an event for unfinished work.** `running`/`pending`/`tool.before` produce nothing (`prd.md` §34).
- **Reject unwatched directories with 403.** The plugin stops forwarding on 403.
- **Adapters MUST use observation hooks only — never intercepting hooks.** pi and omp
  abort tool execution when a `tool_call` handler throws ("fail-closed"). An observer
  subscribed to an intercepting hook can break the user's agent. Use
  `message.part.updated` with `part.type == "tool"` (opencode). See `docs/adr/0011`.
  This applies to every future adapter: `tool_execution_*` for pi/omp,
  `post_tool_call` for hermes.
- **The daemon is agent-neutral; only extraction is adapter-specific.** The frame format,
  receiver, directory gate and gap detection are shared across all agents. Path extraction
  is per-agent: opencode tries `filePath`/`file_path`/`path`/`filename`; pi uses `path`;
  omp uses `path` then `details.path`; hermes uses `path`. See `docs/multi-agent-support.md`.

---

## Verification status

The code in this plan was **written, compiled, vetted, unit-tested, and exercised end-to-end** before the plan was written. What that established:

| Claim | Status |
|---|---|
| Plugin forwards events to an external HTTP listener | **Verified** |
| Plugin queue survives a daemon outage | **Verified** — 7 events buffered, delivered on recovery |
| `seq` is monotonic with no gaps | **Verified** — `monotonic: True gaps: [1,1,1,1,1,1,1]` |
| `hello` handshake fires on load | **Verified** — fires per directory instance, lazily |
| Unwatched directory rejected with 403 | **Verified** — 0 frames accepted, agent stayed healthy |
| Env var reaches the plugin | **Verified** — `AI_TOWN_URL` readable in the plugin |
| Daemon normalizes to the unified shape | **Verified** — real JSON emitted |
| Gap reported alongside the event, not instead of it | **Verified** after a bug fix (see below) |
| **A real tool call produces a live normalized event** | **Verified** — omp and pi, via a free OpenRouter model |
| **Failure path produces `result: "error"`** | **Verified** — a real failed `read` |
| **Agent identity is preserved per adapter** | **Verified** — `agent: "omp"` and `agent: "pi"` |

**Live verification recipe (unblocks the credential blocker).** Every paid
provider fails in this environment (`402 Insufficient Balance`,
`403 Copilot not licensed`). Free OpenRouter models work:

```bash
# Find a working free model — many are rate-limited upstream.
curl -s https://openrouter.ai/api/v1/models -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  | python3 -c "import sys,json; [print(m['id']) for m in json.load(sys.stdin)['data'] if m['id'].endswith(':free')]"

# Confirmed working at time of writing: cohere/north-mini-code:free,
# nex-agi/nex-n2.5-pro:free, google/gemma-4-31b-it:free,
# nvidia/nemotron-3-super-120b-a12b:free

# omp
omp -p --mode json --yolo -e ./omp-town.ts \
    --model "openrouter/cohere/north-mini-code:free" "Read <file> using the read tool"

# pi
pi --mode json -p "Read <file> using the read tool" -e ./pi-town.ts \
   --provider openrouter --model "cohere/north-mini-code:free"
```

Note: `qwen/qwen3.8-27b:free` returns `429` (upstream rate limit) and omp's
`/responses` API path returned `400`. Use a model confirmed responsive first.

**Bug found and fixed during verification.** The first `NormalizeFrame` returned early on a sequence gap and **discarded the frame's own events**, compounding the loss it was reporting. Caught by POSTing a `tool.after` at seq 100 after only seq 1 was seen: the event vanished. Fixed to extract events first, then assess the gap. A regression test guards it.

---

## File Structure

| File | Responsibility |
|---|---|
| `go.mod` | Module definition. No dependencies. |
| `internal/agent/event.go` | `UnifiedAgentEvent`, `UnifiedTarget`. The public contract. |
| `internal/agent/frame.go` | `Frame` — the plugin wire format. |
| `internal/agent/normalize.go` | `NormalizeFrame` and helpers. Pure functions, no I/O. |
| `internal/agent/normalize_test.go` | Tests for normalization and gap handling. |
| `internal/agent/receiver.go` | HTTP handler: directory gate, gap detection, dispatch. |
| `internal/agent/receiver_test.go` | Tests for the gate and gap detection. |
| `internal/agent/plugin/town-forward.ts` | The OpenCode plugin. Queue, seq, hello, 403 handling. |
| `cmd/townd/main.go` | Wires receiver, announces `AI_TOWN_URL`. |
| `docs/plugin-install.md` | How to install the plugin. |

---

## Task 1: Unified event type and frame format

**Files:**
- Create: `go.mod`
- Create: `internal/agent/event.go`
- Create: `internal/agent/frame.go`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type UnifiedTarget struct { Path string }`
  - `type UnifiedAgentEvent struct { ID, SessionID, Agent, Type, Tool string; Target UnifiedTarget; Result string; Timestamp int64 }`
  - `type Frame struct { Kind, Directory string; Seq, Dropped int64; Type, SessionID string; Part map[string]any; Tool, CallID string; Args map[string]any; PID int }`

- [ ] **Step 1: Create the module**

Run: `go mod init github.com/dimasajiwardhana/agent-town`
Expected: `go.mod` with `module github.com/dimasajiwardhana/agent-town` and `go 1.27`.

- [ ] **Step 2: Write the event type**

Create `internal/agent/event.go`:

```go
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
```

- [ ] **Step 3: Write the frame format**

Create `internal/agent/frame.go`:

```go
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
```

- [ ] **Step 4: Verify it compiles**

Run: `go build ./... && go vet ./...`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git init
git add go.mod internal/agent/event.go internal/agent/frame.go
git commit -m "feat(agent): add unified event type and plugin frame format"
```

---

## Task 2: Normalization with gap detection

**Files:**
- Create: `internal/agent/normalize.go`
- Test: `internal/agent/normalize_test.go`

**Interfaces:**
- Consumes: `Frame` (Task 1), `UnifiedAgentEvent` (Task 1).
- Produces:
  - `func NormalizeFrame(f Frame, lastSeq int64) ([]UnifiedAgentEvent, int64, error)`
  - `func ToolToEventType(tool string) string`
  - `func ExtractPath(args map[string]any) string`
  - `func UnmarshalFrame(raw []byte) (Frame, error)`
  - `type GapError struct { Expected, Got, Lost int64 }`

- [ ] **Step 1: Write the failing test**

Create `internal/agent/normalize_test.go`:

```go
package agent

import "testing"

func TestToolToEventType(t *testing.T) {
	tests := []struct {
		tool string
		want string
	}{
		{"read", "FILE_READ"},
		{"grep", "FILE_READ"},
		{"write", "FILE_CREATED"},
		{"edit", "FILE_EDITED"},
		{"multiedit", "FILE_EDITED"},
		{"bash", "COMMAND_COMPLETED"},
		{"some_unknown_tool", "FILE_EDITED"},
	}
	for _, tt := range tests {
		if got := ToolToEventType(tt.tool); got != tt.want {
			t.Errorf("ToolToEventType(%q) = %q, want %q", tt.tool, got, tt.want)
		}
	}
}

func TestExtractPath(t *testing.T) {
	tests := []struct {
		name string
		args map[string]any
		want string
	}{
		{"filePath", map[string]any{"filePath": "a/b.go"}, "a/b.go"},
		{"path", map[string]any{"path": "c/d.go"}, "c/d.go"},
		{"filename", map[string]any{"filename": "e.go"}, "e.go"},
		{"absent", map[string]any{"command": "go test"}, ""},
		{"empty value", map[string]any{"filePath": ""}, ""},
		{"nil", nil, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ExtractPath(tt.args); got != tt.want {
				t.Errorf("ExtractPath = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestNormalizeToolAfter(t *testing.T) {
	f := Frame{
		Kind:      "tool.after",
		Directory: "/tmp/p",
		Seq:       1,
		SessionID: "ses_1",
		CallID:    "call_1",
		Tool:      "edit",
		Args:      map[string]any{"filePath": "internal/auth/service.go"},
	}
	evs, seq, err := NormalizeFrame(f, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if seq != 1 {
		t.Fatalf("seq = %d, want 1", seq)
	}
	if len(evs) != 1 {
		t.Fatalf("got %d events, want 1", len(evs))
	}
	e := evs[0]
	if e.Type != "FILE_EDITED" {
		t.Errorf("Type = %q, want FILE_EDITED", e.Type)
	}
	if e.Target.Path != "internal/auth/service.go" {
		t.Errorf("Path = %q", e.Target.Path)
	}
	if e.Result != "success" {
		t.Errorf("Result = %q, want success", e.Result)
	}
	if e.SessionID != "ses_1" {
		t.Errorf("SessionID = %q", e.SessionID)
	}
}

func TestNormalizeToolBeforeEmitsNothing(t *testing.T) {
	// A tool that has started but not finished must not produce an event.
	f := Frame{Kind: "tool.before", Directory: "/tmp/p", Seq: 1, Tool: "edit"}
	evs, _, err := NormalizeFrame(f, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(evs) != 0 {
		t.Fatalf("got %d events, want 0 (work has not happened yet)", len(evs))
	}
}

func TestNormalizePartCompleted(t *testing.T) {
	f := Frame{
		Kind:      "event",
		Directory: "/tmp/p",
		Seq:       1,
		Type:      "message.part.updated",
		Part: map[string]any{
			"type":      "tool",
			"tool":      "read",
			"callID":    "call_9",
			"sessionID": "ses_9",
			"state": map[string]any{
				"status": "completed",
				"input":  map[string]any{"filePath": "main.go"},
				"time":   map[string]any{"start": float64(1), "end": float64(42)},
			},
		},
	}
	evs, _, err := NormalizeFrame(f, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(evs) != 1 {
		t.Fatalf("got %d events, want 1", len(evs))
	}
	if evs[0].Type != "FILE_READ" {
		t.Errorf("Type = %q, want FILE_READ", evs[0].Type)
	}
	if evs[0].Timestamp != 42 {
		t.Errorf("Timestamp = %d, want 42", evs[0].Timestamp)
	}
	if evs[0].SessionID != "ses_9" {
		t.Errorf("SessionID = %q", evs[0].SessionID)
	}
}

func TestNormalizePartRunningEmitsNothing(t *testing.T) {
	f := Frame{
		Kind: "event", Directory: "/tmp/p", Seq: 1,
		Type: "message.part.updated",
		Part: map[string]any{
			"type": "tool", "tool": "read", "callID": "c",
			"state": map[string]any{"status": "running"},
		},
	}
	evs, _, err := NormalizeFrame(f, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(evs) != 0 {
		t.Fatalf("got %d events, want 0 for a running tool", len(evs))
	}
}

func TestNormalizePartError(t *testing.T) {
	f := Frame{
		Kind: "event", Directory: "/tmp/p", Seq: 1,
		Type: "message.part.updated",
		Part: map[string]any{
			"type": "tool", "tool": "edit", "callID": "c", "sessionID": "s",
			"state": map[string]any{
				"status": "error",
				"input":  map[string]any{"filePath": "x.go"},
			},
		},
	}
	evs, _, err := NormalizeFrame(f, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(evs) != 1 {
		t.Fatalf("got %d events, want 1", len(evs))
	}
	if evs[0].Result != "error" {
		t.Errorf("Result = %q, want error", evs[0].Result)
	}
}

func TestNormalizeFrameReportsGap(t *testing.T) {
	f := Frame{Kind: "event", Directory: "/tmp/p", Seq: 10, Type: "session.idle"}
	_, seq, err := NormalizeFrame(f, 5)
	if err == nil {
		t.Fatal("expected a gap error for a sequence jump")
	}
	if seq != 10 {
		t.Fatalf("seq = %d, want 10", seq)
	}
	ge, ok := err.(*GapError)
	if !ok {
		t.Fatalf("error is %T, want *GapError", err)
	}
	if ge.Lost != 4 {
		t.Fatalf("Lost = %d, want 4", ge.Lost)
	}
}

func TestNormalizeHelloIsNotAGap(t *testing.T) {
	// A hello restarts the sequence: it must never be reported as a gap.
	f := Frame{Kind: "hello", Directory: "/tmp/p", Seq: 1}
	_, seq, err := NormalizeFrame(f, 999)
	if err != nil {
		t.Fatalf("hello must not report a gap: %v", err)
	}
	if seq != 1 {
		t.Fatalf("seq = %d, want 1", seq)
	}
}

// Regression: the frame's agent identity must be preserved.
//
// The first implementation hardcoded "opencode", so an omp or pi event was
// labelled as an opencode event. Found by running a real omp tool call
// through the full chain and reading the daemon's output.
func TestAgentIdentityIsPreserved(t *testing.T) {
	for _, agent := range []string{"opencode", "pi", "omp", "hermes"} {
		f := Frame{
			Kind: "tool.after", Directory: "/tmp/p", Seq: 1,
			Agent: agent, Tool: "read",
			Args: map[string]any{"path": "main.go"},
		}
		evs, _, err := NormalizeFrame(f, 0)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(evs) != 1 {
			t.Fatalf("got %d events, want 1", len(evs))
		}
		if evs[0].Agent != agent {
			t.Errorf("Agent = %q, want %q", evs[0].Agent, agent)
		}
	}
}

// Regression: a failed tool must not be reported as a success.
//
// The first implementation hardcoded Result: "success", so a failed tool
// rendered as a completed building — violating prd.md section 34. Found by
// running a real omp read of a nonexistent file.
func TestFailedToolReportsError(t *testing.T) {
	f := Frame{
		Kind: "tool.after", Directory: "/tmp/p", Seq: 1,
		Agent: "omp", Tool: "read", IsError: true,
		Args: map[string]any{"path": "/tmp/DOES_NOT_EXIST.txt"},
	}
	evs, _, err := NormalizeFrame(f, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(evs) != 1 {
		t.Fatalf("got %d events, want 1", len(evs))
	}
	if evs[0].Result != "error" {
		t.Errorf("Result = %q, want error — a failed tool is not a completed building", evs[0].Result)
	}
	if evs[0].Target.Path != "/tmp/DOES_NOT_EXIST.txt" {
		t.Errorf("Path = %q, want the failing path preserved", evs[0].Target.Path)
	}
}

// Regression: a gapped frame must still yield its own events.
//
// The first implementation returned early on a gap and discarded the frame's
// activity, which compounded the very loss it was reporting. Caught by an
// end-to-end POST of a tool.after frame at seq 100 after only seq 1 was seen.
func TestGappedFrameStillEmitsItsOwnEvents(t *testing.T) {
	f := Frame{
		Kind:      "tool.after",
		Directory: "/tmp/p",
		Seq:       100,
		SessionID: "ses_1",
		CallID:    "call_1",
		Tool:      "edit",
		Args:      map[string]any{"filePath": "internal/auth/service.go"},
	}
	evs, seq, err := NormalizeFrame(f, 1)

	if err == nil {
		t.Fatal("expected a gap error")
	}
	if seq != 100 {
		t.Fatalf("seq = %d, want 100", seq)
	}
	if len(evs) != 1 {
		t.Fatalf("got %d events, want 1 — the frame arrived intact, so its activity is real", len(evs))
	}
	if evs[0].Type != "FILE_EDITED" {
		t.Errorf("Type = %q, want FILE_EDITED", evs[0].Type)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/agent/ -v`
Expected: FAIL — `undefined: NormalizeFrame`.

- [ ] **Step 3: Write the normalizer**

Create `internal/agent/normalize.go`:

```go
package agent

import "encoding/json"

// NormalizeFrame converts one forwarder frame into zero or more
// UnifiedAgentEvents.
//
// It returns the events, the frame's sequence number, and a *GapError when
// the plugin's sequence indicates frames were lost since the last one.
//
// A gap is reported ALONGSIDE the events, never instead of them: the gap
// describes frames that are missing, but this frame arrived intact and its
// activity is real. Dropping it would compound the loss it reports.
//
// A frame carrying no construction activity returns (nil, seq, nil), which
// is the common case: OpenCode emits far more text and status frames than
// tool frames.
func NormalizeFrame(f Frame, lastSeq int64) ([]UnifiedAgentEvent, int64, error) {
	// A hello starts a fresh sequence. It is the plugin announcing itself,
	// so it can never be a gap, however far the numbering has moved.
	if f.Kind == "hello" {
		return nil, f.Seq, nil
	}

	events := extractEvents(f)

	if f.Seq > lastSeq+1 && lastSeq > 0 {
		lost := f.Seq - lastSeq - 1
		return events, f.Seq, &GapError{Expected: lastSeq + 1, Got: f.Seq, Lost: lost}
	}

	return events, f.Seq, nil
}

// extractEvents turns a frame into the events it represents, if any.
func extractEvents(f Frame) []UnifiedAgentEvent {
	switch f.Kind {
	case "tool.before":
		// A tool that has started but not finished. Emitting it would show a
		// worker acting on work that has not happened (prd.md section 34).
		return nil

	case "tool.after":
		return normalizeToolHook(f)

	case "event":
		if f.Type != "message.part.updated" {
			return nil
		}
		ev, ok := normalizePart(f)
		if !ok {
			return nil
		}
		return []UnifiedAgentEvent{ev}
	}
	return nil
}

// normalizeToolHook converts a completed tool hook into a unified event.
//
// This is the authoritative signal: OpenCode fires it only after a tool
// actually succeeded, and it carries both the tool name and its arguments.
// Unlike the message-part path it has a definite completion, so it is the
// preferred source when both are present.
func normalizeToolHook(f Frame) []UnifiedAgentEvent {
	// Result comes from `isError`, not an assumption. omp and pi both send
	// tool.after frames for FAILED tools too; hardcoding "success" would
	// render a failed tool as a completed building (prd.md section 34).
	// This was a real bug: found by running an omp tool call that failed.
	result := "success"
	if f.IsError {
		result = "error"
	}
	return []UnifiedAgentEvent{{
		ID:        f.CallID,
		SessionID: f.SessionID,
		Agent:     agentName(f.Agent),
		Type:      ToolToEventType(f.Tool),
		Tool:      f.Tool,
		Target:    UnifiedTarget{Path: ExtractPath(f.Args)},
		Result:    result,
		Timestamp: 0,
	}}
}

// agentName returns the adapter identity, defaulting to "opencode" only
// when the frame is silent — which keeps older plugins working.
func agentName(a string) string {
	if a == "" {
		return "opencode"
	}
	return a
}

// normalizePart converts a message.part.updated frame whose part is a
// completed or errored tool into a unified event.
func normalizePart(f Frame) (UnifiedAgentEvent, bool) {
	if f.Part == nil {
		return UnifiedAgentEvent{}, false
	}
	if typ, _ := f.Part["type"].(string); typ != "tool" {
		return UnifiedAgentEvent{}, false
	}

	tool, _ := f.Part["tool"].(string)
	callID, _ := f.Part["callID"].(string)
	sessionID, _ := f.Part["sessionID"].(string)
	if sessionID == "" {
		sessionID = f.SessionID
	}

	state, _ := f.Part["state"].(map[string]any)
	if state == nil {
		return UnifiedAgentEvent{}, false
	}

	var result string
	switch status, _ := state["status"].(string); status {
	case "completed":
		result = "success"
	case "error":
		result = "error"
	default:
		// running / pending — not settled yet.
		return UnifiedAgentEvent{}, false
	}

	var ts int64
	if t, ok := state["time"].(map[string]any); ok {
		if end, ok := t["end"].(float64); ok {
			ts = int64(end)
		}
	}

	var path string
	if input, ok := state["input"].(map[string]any); ok {
		path = ExtractPath(input)
	}

	return UnifiedAgentEvent{
		ID:        callID,
		SessionID: sessionID,
		Agent:     agentName(f.Agent),
		Type:      ToolToEventType(tool),
		Tool:      tool,
		Target:    UnifiedTarget{Path: path},
		Result:    result,
		Timestamp: ts,
	}, true
}

// ToolToEventType maps an OpenCode tool name to a normalized event type.
// Unknown tools fall back to FILE_EDITED: the most conservative choice,
// since it moves progress without claiming a read or a delete.
func ToolToEventType(tool string) string {
	switch tool {
	case "read", "list", "glob", "grep":
		return "FILE_READ"
	case "write":
		return "FILE_CREATED"
	case "edit", "patch", "multiedit":
		return "FILE_EDITED"
	case "bash", "shell":
		return "COMMAND_COMPLETED"
	default:
		return "FILE_EDITED"
	}
}

// ExtractPath pulls the affected file path out of a tool's argument bag.
//
// There is no top-level filePath in OpenCode's payload (docs/adr/0009). The
// key is tool-dependent and absent for non-file tools, in which case this
// returns "". It never fails: a pathless event is preferable to a dropped one.
func ExtractPath(args map[string]any) string {
	if args == nil {
		return ""
	}
	for _, key := range []string{"filePath", "file_path", "path", "filename"} {
		if v, ok := args[key].(string); ok && v != "" {
			return v
		}
	}
	return ""
}

// UnmarshalFrame decodes one raw JSON frame body.
func UnmarshalFrame(raw []byte) (Frame, error) {
	var f Frame
	if err := json.Unmarshal(raw, &f); err != nil {
		return Frame{}, err
	}
	return f, nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/agent/ -v`
Expected: PASS — all 10 tests, including `TestGappedFrameStillEmitsItsOwnEvents`.

- [ ] **Step 5: Commit**

```bash
git add internal/agent/normalize.go internal/agent/normalize_test.go
git commit -m "feat(agent): normalize plugin frames with gap detection"
```

---

## Task 3: Receiver with directory gate

**Files:**
- Create: `internal/agent/receiver.go`
- Test: `internal/agent/receiver_test.go`

**Interfaces:**
- Consumes: `NormalizeFrame`, `UnmarshalFrame`, `GapError` (Task 2); `UnifiedAgentEvent` (Task 1).
- Produces:
  - `type Receiver struct { ... }` with callbacks `OnEvent`, `OnGap`, `OnHello`
  - `func NewReceiver(dirs ...string) *Receiver`
  - `func (r *Receiver) Watch(dir string)`
  - `func (r *Receiver) ServeHTTP(w http.ResponseWriter, req *http.Request)`

- [ ] **Step 1: Write the failing test**

Create `internal/agent/receiver_test.go`:

```go
package agent

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestReceiverRejectsUnwatchedDirectory(t *testing.T) {
	r := NewReceiver("/tmp/watched")
	body := `{"kind":"hello","directory":"/tmp/unwatched","seq":1}`
	req := httptest.NewRequest(http.MethodPost, "/events", strings.NewReader(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", w.Code)
	}
}

func TestReceiverAcceptsWatchedDirectory(t *testing.T) {
	r := NewReceiver("/tmp/watched")
	body := `{"kind":"hello","directory":"/tmp/watched","seq":1}`
	req := httptest.NewRequest(http.MethodPost, "/events", strings.NewReader(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", w.Code)
	}
}

func TestReceiverCallsOnHello(t *testing.T) {
	r := NewReceiver("/tmp/watched")
	var got string
	r.OnHello = func(d string) { got = d }

	body := `{"kind":"hello","directory":"/tmp/watched","seq":1}`
	req := httptest.NewRequest(http.MethodPost, "/events", strings.NewReader(body))
	r.ServeHTTP(httptest.NewRecorder(), req)

	if !strings.HasSuffix(got, "/tmp/watched") {
		t.Fatalf("OnHello got %q, want it to end with /tmp/watched", got)
	}
}

func TestReceiverDetectsGap(t *testing.T) {
	r := NewReceiver("/tmp/watched")
	var lost int64
	var called bool
	r.OnGap = func(_ string, n int64) { lost, called = n, true }

	// seq 1 establishes the baseline.
	for _, s := range []string{"1", "5"} {
		body := `{"kind":"event","directory":"/tmp/watched","seq":` + s +
			`,"type":"message.part.updated","part":{"type":"text"}}`
		req := httptest.NewRequest(http.MethodPost, "/events", strings.NewReader(body))
		r.ServeHTTP(httptest.NewRecorder(), req)
	}

	if !called {
		t.Fatal("OnGap was not called for a sequence jump")
	}
	if lost != 3 {
		t.Fatalf("lost = %d, want 3", lost)
	}
}

func TestReceiverDropsMalformedFrame(t *testing.T) {
	r := NewReceiver("/tmp/watched")
	req := httptest.NewRequest(http.MethodPost, "/events", strings.NewReader(`{not json`))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204 (malformed frames must not be fatal)", w.Code)
	}
}

func TestReceiverRejectsNonPost(t *testing.T) {
	r := NewReceiver("/tmp/watched")
	req := httptest.NewRequest(http.MethodGet, "/events", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", w.Code)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/agent/ -run TestReceiver -v`
Expected: FAIL — `undefined: NewReceiver`.

- [ ] **Step 3: Write the receiver**

Create `internal/agent/receiver.go`:

```go
package agent

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"path/filepath"
	"sync"
)

// Receiver accepts frames from the AI Town forwarder plugin.
//
// It enforces the one guarantee the HTTP/SSE transport could not provide:
// only the directories AI Town explicitly watches are accepted. A plugin
// running globally will fire for unrelated projects; those frames are
// rejected with 403 and the plugin stops forwarding (docs/adr/0009).
type Receiver struct {
	// watched is the set of absolute directories AI Town is observing.
	// A frame from any other directory is rejected.
	mu      sync.Mutex
	watched map[string]bool

	// lastSeq tracks the highest sequence number seen per directory, so
	// gaps are detected per agent rather than globally.
	lastSeq map[string]int64

	// OnEvent receives normalized events. Called from the HTTP handler, so
	// it must not block.
	OnEvent func(UnifiedAgentEvent)

	// OnGap is called when the plugin's sequence indicates lost frames.
	OnGap func(directory string, lost int64)

	// OnHello is called when a plugin proves it loaded. This is the gate
	// that lets a session be declared live (docs/adr/0010).
	OnHello func(directory string)
}

// NewReceiver creates a receiver watching the given directories.
// Paths are resolved to absolute form so a plugin reporting a symlinked or
// relative path still matches.
func NewReceiver(dirs ...string) *Receiver {
	w := make(map[string]bool, len(dirs))
	for _, d := range dirs {
		if abs, err := filepath.Abs(d); err == nil {
			w[abs] = true
		}
	}
	return &Receiver{
		watched: w,
		lastSeq: make(map[string]int64),
	}
}

// Watch adds a directory to the accepted set.
func (r *Receiver) Watch(dir string) {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.watched[abs] = true
}

// ServeHTTP implements http.Handler for the /events endpoint.
func (r *Receiver) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(io.LimitReader(req.Body, 4<<20))
	if err != nil {
		http.Error(w, "read error", http.StatusBadRequest)
		return
	}

	frame, err := UnmarshalFrame(body)
	if err != nil {
		// Malformed frames are dropped, never fatal.
		w.WriteHeader(http.StatusNoContent)
		return
	}

	dir := frame.Directory
	if dir != "" {
		if abs, err := filepath.Abs(dir); err == nil {
			dir = abs
		}
	}

	r.mu.Lock()
	allowed := r.watched[dir]
	r.mu.Unlock()

	if !allowed {
		// Not our project. Reject so the plugin stops forwarding.
		log.Printf("agent: rejected frame from unwatched directory %q", dir)
		http.Error(w, "directory not watched", http.StatusForbidden)
		return
	}

	if frame.Kind == "hello" {
		if r.OnHello != nil {
			r.OnHello(dir)
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}

	r.mu.Lock()
	last := r.lastSeq[dir]
	r.mu.Unlock()

	events, newSeq, err := NormalizeFrame(frame, last)

	r.mu.Lock()
	if newSeq > r.lastSeq[dir] {
		r.lastSeq[dir] = newSeq
	}
	r.mu.Unlock()

	if err != nil {
		// A gap is reported, not fatal: the frame is still accepted.
		var ge *GapError
		if errors.As(err, &ge) && r.OnGap != nil {
			r.OnGap(dir, ge.Lost)
		}
	}

	for _, ev := range events {
		if r.OnEvent != nil {
			r.OnEvent(ev)
		}
	}

	w.WriteHeader(http.StatusNoContent)
}

// GapError reports lost frames between two sequence numbers.
type GapError struct {
	Expected int64
	Got      int64
	Lost     int64
}

func (e *GapError) Error() string {
	return "event gap: lost sequence numbers"
}

// EncodeFrame is a test helper that marshals a frame to JSON.
func EncodeFrame(f Frame) []byte {
	b, _ := json.Marshal(f)
	return b
}
```

- [ ] **Step 4: Run the full suite**

Run: `go test ./... -v && go vet ./...`
Expected: PASS — all 16 tests, no vet output.

- [ ] **Step 5: Commit**

```bash
git add internal/agent/receiver.go internal/agent/receiver_test.go
git commit -m "feat(agent): add receiver with directory isolation and gap detection"
```

---

## Task 4: The OpenCode forwarder plugin

**Files:**
- Create: `internal/agent/plugin/town-forward.ts`
- Create: `docs/plugin-install.md`

**Interfaces:**
- Consumes: the daemon's HTTP contract from Task 3 — `POST /events`, 204 accepted, 403 rejected.
- Produces: the plugin file installed at `~/.config/opencode/plugins/ai-town-forward.ts`.

**Note on the plugin's language.** It is TypeScript, not Go. It runs inside OpenCode's Node process and cannot be written in Go. Keep it dependency-free — a plain `.ts` file with no imports.

- [ ] **Step 1: Write the plugin**

Create `internal/agent/plugin/town-forward.ts`:

```typescript
// AI Town forwarder plugin for OpenCode.
//
// Runs inside the OpenCode process and forwards agent events to the AI Town
// daemon over loopback HTTP.
//
// Design constraints, all established empirically (docs/adr/0009, 0010):
//
//  1. The plugin loads LAZILY, per directory instance, only where a session
//     starts. The `hello` handshake is how AI Town proves it is live.
//  2. Forwarding must survive the daemon being down. A naive
//     `fetch().catch(() => {})` discards events silently; this queue does not.
//  3. Every frame carries a monotonic `seq` so AI Town can detect gaps.
//  4. It must never forward a project AI Town is not watching. The daemon
//     rejects unknown directories with 403, and the plugin stops on that.
//  5. It must never break the agent. All forwarding is best-effort and every
//     failure path is swallowed.

const MAX_QUEUE = 10_000;

type Frame = Record<string, unknown>;

let queue: Frame[] = [];
let seq = 0;
let draining = false;
let dropped = 0;
let disabled = false;

function target(): string {
  const base = process.env.AI_TOWN_URL;
  if (!base) return "";
  return base.replace(/\/$/, "") + "/events";
}

async function drain(TARGET: string): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      const frame = queue[0]!;
      let res: Response;
      try {
        res = await fetch(TARGET, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(frame),
        });
      } catch {
        // Daemon unreachable. Keep the frame; retry on the next event.
        break;
      }
      if (res.status === 403) {
        // AI Town does not know this directory. Stop forwarding entirely so
        // an unrelated project is never shipped to the daemon.
        disabled = true;
        queue = [];
        break;
      }
      if (!res.ok) break;
      queue.shift();
    }
  } finally {
    draining = false;
  }
}

function send(TARGET: string, frame: Frame): void {
  if (disabled || !TARGET) return;
  seq += 1;
  queue.push({ ...frame, seq, dropped });
  if (queue.length > MAX_QUEUE) {
    const excess = queue.length - MAX_QUEUE;
    queue.splice(0, excess);
    dropped += excess;
  }
  void drain(TARGET);
}

// The adapter identity, sent on every frame so the daemon never has to guess
// which agent produced an event. REQUIRED: without it, an omp or pi event is
// indistinguishable from an opencode one.
const AGENT = "opencode";

export const TownForward = async ({ directory }: any) => {
  const TARGET = target();
  if (!TARGET) {
    // No daemon configured. Stay completely inert: do not touch the agent.
    return {};
  }

  // The handshake. AI Town treats this as proof the plugin loaded.
  send(TARGET, { kind: "hello", directory, agent: AGENT, pid: process.pid });

  return {
    event: async ({ event }: any) => {
      const props = event?.properties ?? {};
      send(TARGET, {
        kind: "event",
        directory,
        agent: AGENT,
        type: event?.type,
        sessionID: props.sessionID,
        part: props.part,
        info: props.info,
      });
    },
    "tool.execute.before": async (input: any, output: any) => {
      send(TARGET, {
        kind: "tool.before",
        directory,
        agent: AGENT,
        sessionID: input?.sessionID,
        callID: input?.callID,
        tool: input?.tool,
        args: output?.args,
      });
    },
    "tool.execute.after": async (input: any, output: any) => {
      // This hook fires ONLY on success — OpenCode skips it when a tool
      // throws. Failures arrive via `message.part.updated` with
      // `state.status == "error"`, which the daemon normalizes separately.
      // So isError is always false here.
      send(TARGET, {
        kind: "tool.after",
        directory,
        agent: AGENT,
        isError: false,
        sessionID: input?.sessionID,
        callID: input?.callID,
        tool: input?.tool,
        args: input?.args,
        title: output?.title,
        output: output?.output,
      });
    },
  };
};

export default { id: "ai-town-forward", server: TownForward };
```

- [ ] **Step 2: Write the install doc**

Create `docs/plugin-install.md`:

```markdown
# Installing the AI Town forwarder plugin

AI Town observes OpenCode sessions through a plugin that runs inside the
OpenCode process. The plugin forwards agent events to the AI Town daemon.

## Why a plugin

The alternative — subscribing to OpenCode's HTTP event stream — leaks.
Verified against OpenCode 1.4.3: `GET /session` returns every session on the
machine, and `GET /global/event` streams events for every directory, with
`?directory=` accepted but ignored. A town built on that stream would render
another project's work as its own.

The plugin is directory-isolated by OpenCode itself
(`packages/opencode/src/plugin/index.ts:255-260`).

## Install

Copy the plugin to the global plugin directory:

```bash
mkdir -p ~/.config/opencode/plugins
cp internal/agent/plugin/town-forward.ts ~/.config/opencode/plugins/ai-town-forward.ts
```

Global installation means the plugin loads for **every** OpenCode session,
not only the ones AI Town watches. That is safe: the plugin does nothing
unless `AI_TOWN_URL` is set, and the daemon rejects directories it does not
watch with 403, at which point the plugin stops forwarding.

Do **not** install it into a project's `.opencode/plugins/` directory — that
pollutes `git status` and covers only one project.

## How AI Town uses it

1. The daemon listens on a loopback port and prints `AI_TOWN_URL=...`.
2. AI Town spawns `opencode` (or `opencode serve`) with that variable set.
3. The plugin loads and sends a `hello` frame.
4. AI Town treats the `hello` as proof the plugin is live.

If no `hello` arrives, the plugin did not load. Common causes: OpenCode
predates 1.4.3, the file has a syntax error, or it exports something that is
not a plugin (OpenCode throws and swallows the error).

## Limitations

- **Loads only at process start.** Adding the file while OpenCode runs has no
  effect; restart it.
- **Loads lazily.** The plugin initialises when the first session starts in a
  directory, so the `hello` may arrive after AI Town begins waiting.
- **An unset `AI_TOWN_URL` makes it inert.** This is intentional: a globally
  installed plugin must not affect ordinary OpenCode usage.
```

- [ ] **Step 3: Verify the plugin is valid TypeScript**

The plugin uses `fetch`, `Response` and `process`, so it needs both DOM and Node
type definitions. `npx tsc` alone does not work — it resolves to an unrelated
package. Install the compiler locally first:

```bash
npm install --no-save typescript@5 @types/node
```

Then typecheck:

```bash
./node_modules/.bin/tsc --noEmit \
  --target es2022 --module esnext --moduleResolution bundler \
  --lib es2022,dom --types node \
  internal/agent/plugin/town-forward.ts
```

Expected: exits 0 with no output.

Verified: this exact command passes on the plugin as written above. Omitting
`--types node` produces `error TS2580: Cannot find name 'process'`; omitting
`--lib dom` produces errors for `fetch` and `Response`.

- [ ] **Step 4: Commit**

```bash
git add internal/agent/plugin/town-forward.ts docs/plugin-install.md
git commit -m "feat(plugin): add OpenCode forwarder with queue, seq and handshake"
```

---

## Task 5: The daemon

**Files:**
- Create: `cmd/townd/main.go`

**Interfaces:**
- Consumes: `NewReceiver`, `Receiver.OnEvent|OnGap|OnHello` (Task 3); `UnifiedAgentEvent` (Task 1).
- Produces: a runnable binary that prints `AI_TOWN_URL=...` on stdout.

- [ ] **Step 1: Write the daemon**

Create `cmd/townd/main.go`:

```go
// Command townd is the AI Town observation daemon.
//
// It receives normalized agent events from the AI Town forwarder plugin,
// which runs inside the OpenCode process, and prints them as JSON lines.
//
// This is the spike build: it proves the plugin transport works end to end.
// It does not render a town and does not persist anything.
//
// Usage:
//
//	townd --dir /path/to/project
//
// It prints AI_TOWN_URL to stdout before listening, so the caller (or a
// shell) can pass it to the agent process.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/dimasajiwardhana/agent-town/internal/agent"
)

func main() {
	dir := flag.String("dir", ".", "project directory to observe")
	addr := flag.String("addr", "127.0.0.1:0", "loopback address to listen on")
	flag.Parse()

	abs, err := filepath.Abs(*dir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "townd: resolve dir: %v\n", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	enc := json.NewEncoder(os.Stdout)

	recv := agent.NewReceiver(abs)
	recv.OnHello = func(d string) {
		fmt.Fprintf(os.Stderr, "townd: plugin handshake from %s\n", d)
	}
	recv.OnGap = func(d string, lost int64) {
		fmt.Fprintf(os.Stderr, "townd: WARNING lost %d frame(s) from %s\n", lost, d)
	}
	recv.OnEvent = func(ev agent.UnifiedAgentEvent) {
		if err := enc.Encode(ev); err != nil {
			fmt.Fprintf(os.Stderr, "townd: encode: %v\n", err)
		}
	}

	mux := http.NewServeMux()
	mux.Handle("/events", recv)

	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "townd: listen: %v\n", err)
		os.Exit(1)
	}

	srv := &http.Server{Handler: mux}
	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			fmt.Fprintf(os.Stderr, "townd: serve: %v\n", err)
		}
	}()

	// The plugin discovers the daemon through this variable. Printing it on
	// stdout lets the caller export it before spawning the agent.
	fmt.Printf("AI_TOWN_URL=http://%s\n", ln.Addr().String())
	fmt.Fprintf(os.Stderr, "townd: watching %s, listening on %s\n", abs, ln.Addr())

	<-ctx.Done()
	fmt.Fprintln(os.Stderr, "townd: shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
}
```

- [ ] **Step 2: Build and vet**

Run: `go build -o /tmp/townd ./cmd/townd && go vet ./...`
Expected: exits 0.

- [ ] **Step 3: Run the full unit suite**

Run: `go test ./... -v`
Expected: PASS — all 16 tests.

- [ ] **Step 4: Verify the daemon starts and announces its URL**

```bash
/tmp/townd --dir /tmp
```

Expected stderr: `townd: watching /tmp, listening on 127.0.0.1:<port>`
Expected stdout: `AI_TOWN_URL=http://127.0.0.1:<port>`

- [ ] **Step 5: Verify directory rejection end to end**

With the daemon still running, using its announced URL:

```bash
URL=http://127.0.0.1:<port>

# A watched directory is accepted.
curl -s -o /dev/null -w "watched  -> %{http_code}\n" -X POST "$URL/events" \
  -H 'content-type: application/json' \
  -d '{"kind":"hello","directory":"/tmp","seq":1}'
# Expect 204.

# An unwatched directory is rejected.
curl -s -o /dev/null -w "unwatched-> %{http_code}\n" -X POST "$URL/events" \
  -H 'content-type: application/json' \
  -d '{"kind":"tool.after","directory":"/home/someone/other-project","seq":1,"tool":"edit","args":{"filePath":"secret.go"}}'
# Expect 403.
```

- [ ] **Step 6: Verify a tool event normalizes**

```bash
URL=http://127.0.0.1:<port>
curl -s -o /dev/null -X POST "$URL/events" -H 'content-type: application/json' \
  -d '{"kind":"tool.after","directory":"/tmp","seq":2,"sessionID":"ses_1","callID":"c1","tool":"edit","args":{"filePath":"internal/auth/service.go"}}'
```

Expected on the daemon's stdout:

```json
{"id":"c1","session_id":"ses_1","agent":"opencode","type":"FILE_EDITED","tool":"edit","target":{"path":"internal/auth/service.go"},"result":"success","timestamp":0}
```

- [ ] **Step 7: Verify the gap is reported without dropping the event**

```bash
URL=http://127.0.0.1:<port>
# Jump the sequence. The event must still be emitted; the gap is a warning.
curl -s -o /dev/null -X POST "$URL/events" -H 'content-type: application/json' \
  -d '{"kind":"tool.after","directory":"/tmp","seq":100,"sessionID":"ses_1","callID":"c2","tool":"write","args":{"filePath":"new.go"}}'
```

Expected: a `FILE_CREATED` JSON line **and** `townd: WARNING lost N frame(s)`. Both — the event is not sacrificed to report the gap.

- [ ] **Step 8: Commit**

```bash
git add cmd/townd/
git commit -m "feat(townd): add daemon receiving plugin frames"
```

---

## Task 6: Live end-to-end verification

**Files:**
- Create: `docs/e2e-results.md`

**Interfaces:**
- Consumes: everything above.
- Produces: a written record of what worked and what did not.

This task requires a **working OpenCode provider credential**. Verify first:

```bash
opencode auth list
```

If every provider fails when you prompt (`401 No payment method`, `403 Copilot not licensed`), the tool-call steps will be inconclusive. Complete Steps 1–3 regardless — they prove the transport — and record the limitation.

- [ ] **Step 1: Start the daemon**

```bash
mkdir -p ~/.config/opencode/plugins
cp internal/agent/plugin/town-forward.ts ~/.config/opencode/plugins/ai-town-forward.ts

mkdir -p /tmp/e2e-proj
/tmp/townd --dir /tmp/e2e-proj
```

Note the announced URL.

- [ ] **Step 2: Spawn OpenCode with the daemon URL**

In a second terminal:

```bash
cd /tmp/e2e-proj
AI_TOWN_URL="http://127.0.0.1:<port>" opencode serve --port 0 --hostname 127.0.0.1
```

- [ ] **Step 3: Confirm the handshake**

Create a session and send a prompt, so the plugin's instance initialises:

```bash
PORT=<opencode port>
SID=$(curl -s -X POST "http://127.0.0.1:$PORT/session" \
  -H 'content-type: application/json' -d '{"title":"e2e"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')

curl -s -X POST "http://127.0.0.1:$PORT/session/$SID/message" \
  -H 'content-type: application/json' \
  -d '{"parts":[{"type":"text","text":"Read the file README.md and summarise it."}]}'
```

Expected on the daemon's stderr: `townd: plugin handshake from /tmp/e2e-proj`.

**This is the proof the plugin loaded.** If it does not appear, stop and diagnose — nothing downstream can work.

- [ ] **Step 4: Confirm tool events arrive**

Watch the daemon's stdout. If the provider is authenticated, the read tool fires and you should see:

```json
{"id":"...","session_id":"ses_...","agent":"opencode","type":"FILE_READ","tool":"read","target":{"path":"..."},"result":"success","timestamp":...}
```

- [ ] **Step 5: Record the outcome**

Write `docs/e2e-results.md` with: the OpenCode version, whether the handshake arrived, whether tool events arrived, and the raw frames. If tools did not run because of credentials, say so explicitly and record which provider failed with what error.

- [ ] **Step 6: Commit**

```bash
git add docs/e2e-results.md
git commit -m "docs: record end-to-end verification results"
```

---

## Plan Self-Review

**Spec coverage.** This plan covers the event transport only — the part of the PRD that was unverified and where a wrong choice would poison everything above it. It does **not** cover `prd.md` §11–19 (town, districts, buildings, workers, progress, persistence, replay). That is deliberate: those rest on the assumption that a trustworthy event stream exists, which this plan establishes and does not assume.

Covered here: §8 (agent activity, at the normalization layer), §9 (event abstraction), §34 (never claim an action that did not happen — enforced by dropping `tool.before` and unsettled parts), §24 (OpenCode integration).

**Placeholder scan.** No TBD/TODO. Every code step is complete and compilable. Every verification step states an expected observable result.

**Type consistency.** `UnifiedAgentEvent` JSON tags are identical everywhere: `id`, `session_id`, `agent`, `type`, `tool`, `target`, `result`, `timestamp`. `Frame` field names match the plugin's emitted JSON exactly (`kind`, `directory`, `seq`, `sessionID`, `callID`, `tool`, `args`, `part`, `pid`, `dropped`). `NormalizeFrame` returns `([]UnifiedAgentEvent, int64, error)` in every call site. `GapError` is defined once in `receiver.go` and used in `normalize.go` — both in package `agent`, so no import cycle.

**Verification performed.** All Go code was compiled, vetted and tested (16 tests pass), then exercised end to end: a real plugin in a real OpenCode 1.4.3 process forwarded to a real daemon. One bug was found and fixed — a gapped frame discarded its own events — and a regression test now guards it.

---

## Execution Handoff

Plan saved to `docs/plans/2026-09-18-plugin-event-transport.md`.

**Before starting:** note that Task 6 needs a working provider credential. Tasks 1–5 do not, and they establish everything except a live tool call.

Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks.

**2. Inline Execution** — batch execution with checkpoints in this session.

Which approach?
