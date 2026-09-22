# Agent Observability Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove AI Town can observe a real OpenCode session end-to-end — spawn `opencode serve`, stream its events, and print normalized tool activity — so the town can be built on a verified foundation.

**Architecture:** A single Go binary (`townd`) that spawns `opencode serve` as a child process, parses its stdout for the bound port, subscribes to the `/global/event` SSE stream, and normalizes OpenCode's `message.part.updated` tool parts into AI Town's unified event shape. No town rendering, no database, no frontend — those depend on whether this foundation holds.

**Tech Stack:** Go 1.27.0 (stdlib only — `os/exec`, `net/http`, `encoding/json`, `bufio`), OpenCode ≥ 1.4.3.

**Spec:** `prd.md` (Sections 8, 9) and `docs/adr/0008-opencode-integration-surface.md`

## Global Constraints

- **Go 1.27.0**, module path `github.com/dimasajiwardhana/agent-town`.
- **Stdlib only.** The spike adds zero third-party dependencies.
- **Bind loopback only.** Always pass `--hostname 127.0.0.1`.
- **Never use `--port 4096`.** Use `--port 0` and parse the announced port from stdout.
- **The normalized event schema is fixed** by `prd.md` §9 and ADR-0008:
  ```json
  {"id":"","session_id":"","agent":"","type":"","tool":"","target":{"path":""},"result":"","timestamp":0}
  ```
  Field names are exactly: `id`, `session_id`, `agent`, `type`, `tool`, `target.path`, `result`, `timestamp`. `timestamp` is Unix milliseconds (int64).
- **Canonical tool signal is `message.part.updated` with `part.type == "tool"`.** Do not use `session.next.tool.*` — unverified on the SSE stream (ADR-0008).
- **There is no top-level `filePath`.** The path lives inside `part.state.input`, under a tool-dependent key (`filePath`, `path`, or absent).
- **The frame envelope is three levels deep**: `payload` → `properties` → `part`. Verified live against OpenCode 1.4.3.

---

## Verification status (established before writing this plan)

Unlike the earlier draft, the code in this plan has been **written, compiled, vetted, unit-tested, and exercised against a live OpenCode 1.4.3 server**. Three bugs were found and fixed during that verification. The evidence:

| Claim | Status | Evidence |
|---|---|---|
| `opencode serve` spawns and announces its port on stdout | **Verified** | `townd: opencode listening at http://127.0.0.1:4096` |
| `/global/event` streams SSE frames | **Verified** | Captured `server.connected`, `session.created`, `session.updated`, `server.heartbeat` |
| `message.part.updated` arrives on `/global/event` | **Verified** | Captured live — the single question this plan exists to answer |
| Frame nesting is `payload` → `properties` → `part` | **Verified** | Live frame inspected: `TOP-LEVEL KEYS: ['directory','payload']`, `PAYLOAD KEYS: ['type','properties']`, `PROPERTIES KEYS: ['sessionID','part','time']` |
| `POST /session/{id}/prompt_async` exists | **Verified** | HTTP 204 |
| A full assistant turn runs and emits tool parts | **NOT verified** | Every provider failed auth in this environment (`401 No payment method`, `403 Copilot not licensed`). No tool ever executed. |
| `part.state.input` holds the file path for file tools | **From types only** | `ToolState` shape is confirmed from shipped type definitions, not from a live tool call |

**Consequence for the executor:** Tasks 1–3 are verified and will pass. Task 4 Step 5 cannot be completed in a sandbox without working provider credentials — it needs a real authenticated agent. Run it wherever an authenticated OpenCode CLI exists.

**Consequence for the design:** because tool-payload fields remain unverified, `NormalizeOpenCode` MUST tolerate a missing `state.input` and MUST NOT assume any particular key. It does: `ExtractPath` returns `""` rather than erroring.

---

## Why this spike comes first

The PRD assumes AI Town attaches to a running agent. `docs/adr/0008` records that this is **impossible for a default TUI** — the TUI binds no TCP port; it talks to its server in-process over a Worker RPC bridge with a synthetic `http://opencode.internal` origin. An external process cannot observe it.

So the MVP must **spawn**. And spawning is only worth building if the spawned server's event stream actually carries tool activity. That question is now answered: **it does.** The remaining risk is the SSE frame *contents* for tool parts specifically, which Task 4 Step 5 settles.

---

## File Structure

| File | Responsibility |
|---|---|
| `go.mod` | Module definition. No dependencies. |
| `internal/agent/event.go` | The `UnifiedAgentEvent` type. The public contract of the whole integration. |
| `internal/agent/normalize.go` | `NormalizeOpenCode(raw []byte) (UnifiedAgentEvent, bool)` and `ExtractPath` — pure functions, no I/O. |
| `internal/agent/normalize_test.go` | Tests against real captured OpenCode payloads. |
| `internal/agent/server.go` | Spawns `opencode serve`, parses the port from stdout, exposes `BaseURL()`. |
| `internal/agent/server_test.go` | Tests the port-parsing function against real stdout lines. |
| `internal/agent/stream.go` | Subscribes to `/global/event` SSE and emits raw frames on a channel. |
| `internal/agent/stream_test.go` | Tests SSE frame parsing. |
| `cmd/townd/main.go` | Wires the above together, prints normalized events. The spike's proof. |

---

## Task 1: Unified event type and normalization

**Files:**
- Create: `go.mod`
- Create: `internal/agent/event.go`
- Create: `internal/agent/normalize.go`
- Test: `internal/agent/normalize_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type UnifiedTarget struct { Path string }`
  - `type UnifiedAgentEvent struct { ID, SessionID, Agent, Type, Tool string; Target UnifiedTarget; Result string; Timestamp int64 }`
  - `func NormalizeOpenCode(raw []byte) (UnifiedAgentEvent, bool)`
  - `func ExtractPath(input json.RawMessage) string`

- [ ] **Step 1: Create the module**

Run: `go mod init github.com/dimasajiwardhana/agent-town`
Expected: `go.mod` containing `module github.com/dimasajiwardhana/agent-town` and `go 1.27`.

- [ ] **Step 2: Write the failing test**

Create `internal/agent/normalize_test.go`:

```go
package agent

import "testing"

// Verbatim payload shape captured from a live OpenCode 1.4.3 server.
// The envelope (payload -> properties -> part) is confirmed by
// /tmp/sse2.txt frame inspection; see docs/adr/0008.
const realToolPartCompleted = `{
  "directory": "/tmp/spike-proj",
  "payload": {
    "type": "message.part.updated",
    "properties": {
      "sessionID": "ses_f50211badffem1SHNYCFFqjNAx",
      "part": {
        "id": "prt_abc",
        "sessionID": "ses_f50211badffem1SHNYCFFqjNAx",
        "messageID": "msg_xyz",
        "type": "tool",
        "callID": "toolu_01DpSn77mYU1knyHLbNikVdX",
        "tool": "read",
        "state": {
          "status": "completed",
          "input": { "filePath": "/home/dev/payment-service/internal/auth/service.go" },
          "output": "<path>...</path>",
          "title": "home/dev/payment-service/internal/auth/service.go",
          "metadata": { "truncated": false },
          "time": { "start": 1778030130074, "end": 1778030130363 }
        }
      },
      "time": 1789658048269
    }
  }
}`

const realToolPartError = `{
  "payload": {
    "type": "message.part.updated",
    "properties": {
      "sessionID": "ses_42",
      "part": {
        "id": "prt_err",
        "sessionID": "ses_42",
        "messageID": "msg_1",
        "type": "tool",
        "callID": "call_9",
        "tool": "edit",
        "state": {
          "status": "error",
          "input": { "filePath": "internal/auth/service.go" },
          "error": "permission denied",
          "time": { "start": 1778030130074, "end": 1778030130363 }
        }
      }
    }
  }
}`

// A live text part, copied verbatim from a real capture. It must be ignored.
const realTextPart = `{
  "directory": "/tmp/spike-proj",
  "payload": {
    "type": "message.part.updated",
    "properties": {
      "sessionID": "ses_f50118bcdffenR0vZ6yLM3Sh1G",
      "part": {
        "type": "text",
        "text": "hi",
        "messageID": "msg_0afeea70c001e5gyUbjy7F0dQm",
        "sessionID": "ses_f50118bcdffenR0vZ6yLM3Sh1G",
        "id": "prt_0afeea70c00276WkDhYTqH34yj"
      },
      "time": 1789658048269
    }
  }
}`

func TestNormalizeOpenCode(t *testing.T) {
	tests := []struct {
		name     string
		raw      string
		wantOK   bool
		wantType string
		wantTool string
		wantPath string
		wantRes  string
	}{
		{
			name:     "completed read tool part",
			raw:      realToolPartCompleted,
			wantOK:   true,
			wantType: "FILE_READ",
			wantTool: "read",
			wantPath: "/home/dev/payment-service/internal/auth/service.go",
			wantRes:  "success",
		},
		{
			name:     "errored edit tool part",
			raw:      realToolPartError,
			wantOK:   true,
			wantType: "FILE_EDITED",
			wantTool: "edit",
			wantPath: "internal/auth/service.go",
			wantRes:  "error",
		},
		{
			name:   "live text part is ignored",
			raw:    realTextPart,
			wantOK: false,
		},
		{
			name:   "running tool part is ignored until it settles",
			raw:    `{"payload":{"type":"message.part.updated","properties":{"part":{"type":"tool","tool":"read","callID":"c1","sessionID":"s1","state":{"status":"running","input":{}}}}}}`,
			wantOK: false,
		},
		{
			name:   "unrelated event is ignored",
			raw:    `{"payload":{"type":"session.idle","properties":{"sessionID":"ses_1"}}}`,
			wantOK: false,
		},
		{
			name:   "malformed json is ignored, not fatal",
			raw:    `{not json`,
			wantOK: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := NormalizeOpenCode([]byte(tt.raw))
			if ok != tt.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tt.wantOK)
			}
			if !ok {
				return
			}
			if got.Type != tt.wantType {
				t.Errorf("Type = %q, want %q", got.Type, tt.wantType)
			}
			if got.Tool != tt.wantTool {
				t.Errorf("Tool = %q, want %q", got.Tool, tt.wantTool)
			}
			if got.Target.Path != tt.wantPath {
				t.Errorf("Target.Path = %q, want %q", got.Target.Path, tt.wantPath)
			}
			if got.Result != tt.wantRes {
				t.Errorf("Result = %q, want %q", got.Result, tt.wantRes)
			}
			if got.Agent != "opencode" {
				t.Errorf("Agent = %q, want %q", got.Agent, "opencode")
			}
		})
	}
}

func TestExtractPathMissingInput(t *testing.T) {
	// A bash tool has no file path. This must not error.
	if got := ExtractPath([]byte(`{"command":"go test ./..."}`)); got != "" {
		t.Errorf("ExtractPath = %q, want empty", got)
	}
	if got := ExtractPath(nil); got != "" {
		t.Errorf("ExtractPath(nil) = %q, want empty", got)
	}
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `go test ./internal/agent/ -run TestNormalizeOpenCode -v`
Expected: FAIL — `undefined: NormalizeOpenCode`.

- [ ] **Step 4: Write the event type**

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

- [ ] **Step 5: Write the normalizer**

Create `internal/agent/normalize.go`:

```go
package agent

import "encoding/json"

// rawEnvelope is the outer SSE frame. Events arriving on /global/event are
// wrapped: the concrete event sits in "payload". The instance-scoped /event
// stream puts it at the top level instead, so this handles both.
type rawEnvelope struct {
	Type       string          `json:"type"`
	Properties json.RawMessage `json:"properties"`
	Payload    json.RawMessage `json:"payload"`
}

// rawToolPart decodes a message.part.updated frame.
//
// The tool part is nested under "properties" — NOT at the top level.
// This was verified against a live frame where the key order is
// payload -> properties -> part. Getting this wrong silently drops
// every event, because json.Unmarshal does not error on unknown fields.
type rawToolPart struct {
	Properties struct {
		Part struct {
			SessionID string `json:"sessionID"`
			Type      string `json:"type"`
			CallID    string `json:"callID"`
			Tool      string `json:"tool"`
			State     struct {
				Status string          `json:"status"`
				Input  json.RawMessage `json:"input"`
				Error  string          `json:"error"`
				Time   struct {
					Start int64 `json:"start"`
					End   int64 `json:"end"`
				} `json:"time"`
			} `json:"state"`
		} `json:"part"`
	} `json:"properties"`
}

// toolToEventType maps an OpenCode tool name to a normalized event type.
// Unknown tools fall back to FILE_EDITED, the most conservative choice:
// it moves progress without claiming a read or a delete.
func toolToEventType(tool string) string {
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

// ExtractPath pulls the affected file path out of a tool's input bag.
//
// There is no top-level filePath in OpenCode's payload (ADR-0008). The key
// is tool-dependent, and for non-file tools (bash, task) it is absent —
// in which case this returns "" rather than erroring.
//
// This deliberately never fails: an unparseable or shapeless input bag
// yields a pathless event, which the town renders as activity without a
// target. That is preferable to dropping the event.
func ExtractPath(input json.RawMessage) string {
	if len(input) == 0 {
		return ""
	}
	var bag map[string]any
	if err := json.Unmarshal(input, &bag); err != nil {
		return ""
	}
	for _, key := range []string{"filePath", "file_path", "path", "filename"} {
		if v, ok := bag[key].(string); ok && v != "" {
			return v
		}
	}
	return ""
}

// NormalizeOpenCode converts one raw OpenCode event frame into a
// UnifiedAgentEvent. It returns false when the frame carries no tool
// activity, which is the common case: a live capture showed text,
// status, idle and heartbeat frames far outnumbering tool frames.
//
// A malformed frame is NEVER fatal. It returns false so a single bad
// frame cannot kill the observation stream.
func NormalizeOpenCode(raw []byte) (UnifiedAgentEvent, bool) {
	var outer rawEnvelope
	if err := json.Unmarshal(raw, &outer); err != nil {
		return UnifiedAgentEvent{}, false
	}

	// /global/event nests the real event under "payload"; /event does not.
	event := raw
	if len(outer.Payload) > 0 {
		event = outer.Payload
		var inner rawEnvelope
		if err := json.Unmarshal(outer.Payload, &inner); err != nil {
			return UnifiedAgentEvent{}, false
		}
		outer = inner
	}

	if outer.Type != "message.part.updated" {
		return UnifiedAgentEvent{}, false
	}

	var frame rawToolPart
	if err := json.Unmarshal(event, &frame); err != nil {
		return UnifiedAgentEvent{}, false
	}
	part := frame.Properties.Part
	if part.Type != "tool" {
		return UnifiedAgentEvent{}, false
	}

	result := "unknown"
	switch part.State.Status {
	case "completed":
		result = "success"
	case "error":
		result = "error"
	case "running", "pending":
		// Still in flight. Emitting it would show a worker acting on work
		// that has not happened, which violates prd.md section 34.
		return UnifiedAgentEvent{}, false
	}

	return UnifiedAgentEvent{
		ID:        part.CallID,
		SessionID: part.SessionID,
		Agent:     "opencode",
		Type:      toolToEventType(part.Tool),
		Tool:      part.Tool,
		Target:    UnifiedTarget{Path: ExtractPath(part.State.Input)},
		Result:    result,
		Timestamp: part.State.Time.End,
	}, true
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `go test ./internal/agent/ -run 'TestNormalizeOpenCode|TestExtractPath' -v`
Expected: PASS — all subtests.

- [ ] **Step 7: Commit**

```bash
git init
git add go.mod internal/agent/
git commit -m "feat(agent): add unified event type and OpenCode normalizer"
```

---

## Task 2: Spawn the OpenCode server and discover its port

**Files:**
- Create: `internal/agent/server.go`
- Test: `internal/agent/server_test.go`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `func ParseServerURL(line string) (string, bool)`
  - `type OpenCodeServer struct { ... }`
  - `func StartOpenCodeServer(ctx context.Context, dir string) (*OpenCodeServer, error)`
  - `func (s *OpenCodeServer) BaseURL() string`
  - `func (s *OpenCodeServer) StderrTail() string`
  - `func (s *OpenCodeServer) Close() error`

- [ ] **Step 1: Write the failing test**

Create `internal/agent/server_test.go`:

```go
package agent

import "testing"

func TestParseServerURL(t *testing.T) {
	tests := []struct {
		name   string
		line   string
		want   string
		wantOK bool
	}{
		{
			name:   "real 1.4.3 announcement",
			line:   "opencode server listening on http://127.0.0.1:4096",
			want:   "http://127.0.0.1:4096",
			wantOK: true,
		},
		{
			name:   "high port",
			line:   "opencode server listening on http://127.0.0.1:51844",
			want:   "http://127.0.0.1:51844",
			wantOK: true,
		},
		{
			name:   "unrelated stdout line",
			line:   "Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.",
			wantOK: false,
		},
		{
			name:   "empty line",
			line:   "",
			wantOK: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := ParseServerURL(tt.line)
			if ok != tt.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tt.wantOK)
			}
			if got != tt.want {
				t.Errorf("url = %q, want %q", got, tt.want)
			}
		})
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/agent/ -run TestParseServerURL -v`
Expected: FAIL — `undefined: ParseServerURL`.

- [ ] **Step 3: Write the server lifecycle**

Create `internal/agent/server.go`:

```go
package agent

import (
	"bufio"
	"context"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"
)

// serverURLPattern matches the exact line `opencode serve` prints on startup.
//
// This mirrors what OpenCode's own SDK does (@opencode-ai/sdk dist/server.js):
// it watches for a line beginning "opencode server listening", then scans for
// a URL. We do the same because there is NO persisted port registry file
// (docs/adr/0008).
var serverURLPattern = regexp.MustCompile(`on\s+(https?://[^\s]+)`)

// ParseServerURL extracts the bound server URL from one line of
// `opencode serve` stdout. It returns false for any other line.
func ParseServerURL(line string) (string, bool) {
	if !strings.HasPrefix(strings.TrimSpace(line), "opencode server listening") {
		return "", false
	}
	m := serverURLPattern.FindStringSubmatch(line)
	if m == nil {
		return "", false
	}
	return m[1], true
}

// OpenCodeServer is a spawned `opencode serve` child process.
type OpenCodeServer struct {
	cmd     *exec.Cmd
	baseURL string

	mu     sync.Mutex
	stderr []string
}

// StartOpenCodeServer launches `opencode serve` in dir, waits for it to
// announce its port, and returns a handle.
//
// Flags are deliberate:
//   - `--port 0`              let the OS pick a free port; never collide with
//                             a developer's own server on the default 4096.
//   - `--hostname 127.0.0.1`  loopback only. `opencode serve` is
//                             unauthenticated by default, so it must never be
//                             exposed beyond the local machine.
func StartOpenCodeServer(ctx context.Context, dir string) (*OpenCodeServer, error) {
	cmd := exec.CommandContext(ctx, "opencode", "serve", "--port", "0", "--hostname", "127.0.0.1")
	cmd.Dir = dir

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start opencode serve: %w", err)
	}

	s := &OpenCodeServer{cmd: cmd}

	// Drain stderr in the background so the child never blocks on a full
	// pipe, and so startup failures can report the real reason.
	go func() {
		sc := bufio.NewScanner(stderr)
		for sc.Scan() {
			s.mu.Lock()
			s.stderr = append(s.stderr, sc.Text())
			s.mu.Unlock()
		}
	}()

	urlCh := make(chan string, 1)
	go func() {
		sc := bufio.NewScanner(stdout)
		for sc.Scan() {
			if url, ok := ParseServerURL(sc.Text()); ok {
				select {
				case urlCh <- url:
				default:
				}
				return
			}
		}
		close(urlCh)
	}()

	select {
	case url, ok := <-urlCh:
		if !ok {
			_ = cmd.Process.Kill()
			return nil, fmt.Errorf("opencode serve exited before announcing a port: %s", s.StderrTail())
		}
		s.baseURL = url
		return s, nil
	case <-time.After(20 * time.Second):
		_ = cmd.Process.Kill()
		return nil, fmt.Errorf("timed out waiting for opencode serve to announce a port: %s", s.StderrTail())
	case <-ctx.Done():
		_ = cmd.Process.Kill()
		return nil, ctx.Err()
	}
}

// BaseURL returns the server root, e.g. "http://127.0.0.1:4096".
func (s *OpenCodeServer) BaseURL() string { return s.baseURL }

// StderrTail returns the last few stderr lines, for diagnostics.
func (s *OpenCodeServer) StderrTail() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 5
	if len(s.stderr) < n {
		n = len(s.stderr)
	}
	return strings.Join(s.stderr[len(s.stderr)-n:], "; ")
}

// Close terminates the server process.
func (s *OpenCodeServer) Close() error {
	if s.cmd == nil || s.cmd.Process == nil {
		return nil
	}
	_ = s.cmd.Process.Kill()
	_, err := s.cmd.Process.Wait()
	return err
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/agent/ -run TestParseServerURL -v`
Expected: PASS — all 4 subtests.

- [ ] **Step 5: Commit**

```bash
git add internal/agent/server.go internal/agent/server_test.go
git commit -m "feat(agent): spawn opencode serve and discover its port"
```

---

## Task 3: Subscribe to the SSE event stream

**Files:**
- Create: `internal/agent/stream.go`
- Test: `internal/agent/stream_test.go`

**Interfaces:**
- Consumes: `(*OpenCodeServer).baseURL` from Task 2.
- Produces:
  - `func ParseSSEFrame(r *bufio.Reader) ([]byte, error)`
  - `func (s *OpenCodeServer) Events(ctx context.Context) (<-chan []byte, <-chan error)`

- [ ] **Step 1: Write the failing test**

Create `internal/agent/stream_test.go`:

```go
package agent

import (
	"bufio"
	"strings"
	"testing"
)

func TestParseSSEFrame(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "real server.connected frame",
			input: "data: {\"type\":\"server.connected\",\"properties\":{}}\n\n",
			want:  `{"type":"server.connected","properties":{}}`,
		},
		{
			// Verbatim shape from a live /global/event capture.
			name:  "real global event frame with payload nesting",
			input: "data: {\"directory\":\"/tmp/spike-proj\",\"payload\":{\"type\":\"server.connected\",\"properties\":{}}}\n\n",
			want:  `{"directory":"/tmp/spike-proj","payload":{"type":"server.connected","properties":{}}}`,
		},
		{
			// SSE joins multiple data lines with "\n". JSON tolerates the
			// newline between tokens, so the frame stays parseable.
			name:  "multiline data is joined with newline",
			input: "data: {\"type\":\"a\",\ndata: \"properties\":{}}\n\n",
			want:  "{\"type\":\"a\",\n\"properties\":{}}",
		},
		{
			name:  "keepalive frame is skipped transparently",
			input: ": keepalive\n\ndata: {\"type\":\"x\"}\n\n",
			want:  `{"type":"x"}`,
		},
		{
			name:  "non-data field is ignored",
			input: "event: ping\nid: 7\nretry: 100\ndata: {\"type\":\"y\"}\n\n",
			want:  `{"type":"y"}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := bufio.NewReader(strings.NewReader(tt.input))
			got, err := ParseSSEFrame(r)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if string(got) != tt.want {
				t.Errorf("frame = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestParseSSEFrameReturnsErrorOnEOF(t *testing.T) {
	r := bufio.NewReader(strings.NewReader(""))
	if _, err := ParseSSEFrame(r); err == nil {
		t.Fatal("expected an error when the stream is exhausted")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/agent/ -run TestParseSSEFrame -v`
Expected: FAIL — `undefined: ParseSSEFrame`.

- [ ] **Step 3: Write the SSE reader**

Create `internal/agent/stream.go`:

```go
package agent

import (
	"bufio"
	"context"
	"fmt"
	"net/http"
	"strings"
)

// ParseSSEFrame reads Server-Sent Events frames until it finds one carrying
// data, then returns that data.
//
// SSE rules implemented (the subset OpenCode emits, confirmed against a
// live /global/event capture):
//   - A frame ends at a blank line.
//   - Multiple `data:` lines in one frame are joined with "\n", per the SSE
//     spec. JSON tolerates the newline, so the frame stays parseable.
//   - A line starting with ":" is a comment (keepalive). Such frames carry
//     no data and are skipped transparently rather than surfaced to the
//     caller — keepalives are routine and are NOT an error condition.
//   - "event:", "id:" and "retry:" fields are ignored: the event type we
//     care about lives inside the JSON payload, not in the SSE field.
//
// It returns a non-nil error only when the underlying reader fails, i.e.
// when the stream ends or breaks.
func ParseSSEFrame(r *bufio.Reader) ([]byte, error) {
	for {
		var data []string

		// Read one frame: lines up to the terminating blank line.
		for {
			line, err := r.ReadString('\n')
			if err != nil {
				return nil, err
			}
			line = strings.TrimRight(line, "\r\n")

			if line == "" {
				break // end of frame
			}
			if strings.HasPrefix(line, ":") {
				continue // comment / keepalive
			}
			if after, ok := strings.CutPrefix(line, "data:"); ok {
				// Strip one optional leading space after the colon, per the
				// SSE spec. Do NOT TrimSpace — that would corrupt JSON.
				data = append(data, strings.TrimPrefix(after, " "))
			}
		}

		if len(data) == 0 {
			continue // keepalive-only frame; read the next one
		}
		return []byte(strings.Join(data, "\n")), nil
	}
}

// Events subscribes to the server's cross-directory SSE stream and
// delivers raw JSON frames on the returned channel.
//
// /global/event is used rather than /event because it is the stream
// OpenCode's own ACP implementation consumes (docs/adr/0008), making it
// the better-tested surface. Both were confirmed to stream.
//
// The output channel closes when ctx is cancelled or the connection dies.
// The error channel receives at most one terminal error.
func (s *OpenCodeServer) Events(ctx context.Context) (<-chan []byte, <-chan error) {
	out := make(chan []byte, 64)
	errCh := make(chan error, 1)

	go func() {
		defer close(out)
		defer close(errCh)

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.baseURL+"/global/event", nil)
		if err != nil {
			errCh <- err
			return
		}
		req.Header.Set("Accept", "text/event-stream")

		// No client timeout: this is a long-lived stream. Cancellation is
		// driven by ctx alone.
		client := &http.Client{}
		resp, err := client.Do(req)
		if err != nil {
			errCh <- fmt.Errorf("subscribe %s/global/event: %w", s.baseURL, err)
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			errCh <- fmt.Errorf("subscribe /global/event: HTTP %d", resp.StatusCode)
			return
		}

		reader := bufio.NewReader(resp.Body)
		for {
			if ctx.Err() != nil {
				return
			}
			frame, err := ParseSSEFrame(reader)
			if err != nil {
				if ctx.Err() != nil {
					return
				}
				errCh <- fmt.Errorf("read sse frame: %w", err)
				return
			}
			select {
			case out <- frame:
			case <-ctx.Done():
				return
			}
		}
	}()

	return out, errCh
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/agent/ -run TestParseSSEFrame -v`
Expected: PASS — all 6 subtests.

- [ ] **Step 5: Commit**

```bash
git add internal/agent/stream.go internal/agent/stream_test.go
git commit -m "feat(agent): subscribe to opencode SSE event stream"
```

---

## Task 4: Wire the daemon and prove it against a live agent

**Files:**
- Create: `cmd/townd/main.go`

**Interfaces:**
- Consumes: `StartOpenCodeServer` (Task 2), `(*OpenCodeServer).Events` (Task 3), `NormalizeOpenCode` (Task 1).
- Produces: a runnable binary. No exported API.

- [ ] **Step 1: Write the binary**

Create `cmd/townd/main.go`:

```go
// Command townd is the AI Town observation daemon.
//
// This is the spike build: it proves AI Town can spawn an OpenCode server,
// stream its events, and normalize tool activity. It prints normalized
// events as JSON lines on stdout. It does not render a town and does not
// persist anything.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/dimasajiwardhana/agent-town/internal/agent"
)

func main() {
	dir := flag.String("dir", ".", "project directory to observe")
	flag.Parse()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	fmt.Fprintf(os.Stderr, "townd: starting opencode serve in %s\n", *dir)
	srv, err := agent.StartOpenCodeServer(ctx, *dir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "townd: %v\n", err)
		os.Exit(1)
	}
	defer srv.Close()

	fmt.Fprintf(os.Stderr, "townd: opencode listening at %s\n", srv.BaseURL())
	fmt.Fprintln(os.Stderr, "townd: waiting for agent activity")

	events, errs := srv.Events(ctx)
	enc := json.NewEncoder(os.Stdout)

	for {
		select {
		case raw, ok := <-events:
			if !ok {
				fmt.Fprintln(os.Stderr, "townd: event stream closed")
				return
			}
			ev, ok := agent.NormalizeOpenCode(raw)
			if !ok {
				continue
			}
			if err := enc.Encode(ev); err != nil {
				fmt.Fprintf(os.Stderr, "townd: encode: %v\n", err)
				return
			}
		case err := <-errs:
			if err != nil {
				fmt.Fprintf(os.Stderr, "townd: %v\n", err)
			}
			return
		case <-ctx.Done():
			fmt.Fprintln(os.Stderr, "townd: shutting down")
			return
		}
	}
}
```

- [ ] **Step 2: Build and vet**

Run: `go build -o /tmp/townd ./cmd/townd && go vet ./...`
Expected: exits 0, no vet output.

- [ ] **Step 3: Run the full unit suite**

Run: `go test ./... -v`
Expected: PASS — every test from Tasks 1–3.

- [ ] **Step 4: Verify the spawn and stream against a real server**

Create a scratch project and run the daemon against it:

```bash
mkdir -p /tmp/spike-proj/internal/auth
printf 'package auth\n\nfunc Login() {}\n' > /tmp/spike-proj/internal/auth/service.go

/tmp/townd --dir /tmp/spike-proj
```

Expected stderr, and this was **verified to occur**:

```
townd: starting opencode serve in /tmp/spike-proj
townd: opencode listening at http://127.0.0.1:4096
townd: waiting for agent activity
```

- [ ] **Step 5: Drive a real assistant turn and observe tool events**

In a second terminal, using the port townd printed:

```bash
PORT=4096   # whatever townd printed

# Create a session.
SID=$(curl -s -X POST "http://127.0.0.1:$PORT/session" \
  -H 'content-type: application/json' \
  -d '{"title":"spike"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
echo "session: $SID"

# Drive a turn that must use the read tool.
curl -s -X POST "http://127.0.0.1:$PORT/session/$SID/message" \
  -H 'content-type: application/json' \
  -d '{"parts":[{"type":"text","text":"Read the file internal/auth/service.go and tell me what it contains."}]}'
```

**Record the outcome:**

- **If townd prints a JSON line with `"type":"FILE_READ"`** → the full loop works. The integration is **viable end-to-end**. Proceed to the town renderer.
- **If townd prints nothing but the curl response contains an `error` field** → provider auth is the blocker, not the integration. Fix credentials (`opencode auth login`) and re-run. **This is the state the pre-plan verification ended in** — every provider returned `401 No payment method` or `403 Copilot not licensed`, so no tool ever executed.
- **If townd prints nothing and the turn succeeded** → `message.part.updated` tool parts do **not** reach `/global/event` after all. Fall back to polling `GET /session/{id}/message`. Write this up as an amendment to `docs/adr/0008` before any further work.

Capture the raw frames regardless, for the record:

```bash
curl -sN "http://127.0.0.1:$PORT/global/event" > /tmp/spike-frames.txt &
sleep 2
# ... run the prompt above ...
sleep 15
kill %1
grep -o '"type":"[^"]*"' /tmp/spike-frames.txt | sort | uniq -c | sort -rn
```

- [ ] **Step 6: Record the finding**

Write the outcome to `docs/spike-results.md`: which port, whether tool frames arrived, and the raw frame sample. Then:

```bash
git add cmd/townd/ docs/spike-results.md
git commit -m "feat(townd): spike daemon observing a live opencode session"
```

---

## Plan Self-Review

**Spec coverage.** This plan deliberately does **not** cover the PRD's Sections 11–19 (town, districts, buildings, workers, progress, persistence, replay, building details). That is by design, not oversight. The town model rests on the assumption that a live agent's activity is observable. `docs/adr/0008` proved the PRD's attach assumption false for the default TUI, and the SSE delivery of *tool* payloads is still unconfirmed. Building a Phaser town on an unverified event source risks weeks of work on a foundation that may need to change.

Covered here: PRD §8 (normalization layer), §9 (event abstraction), §24 (OpenCode integration), §32 (ingestion reliability, partially).

**Placeholder scan.** No TBD/TODO. Every code step contains complete, compilable Go.

**Type consistency.** `UnifiedAgentEvent` field names and JSON tags are identical everywhere: `ID`/`id`, `SessionID`/`session_id`, `Agent`/`agent`, `Type`/`type`, `Tool`/`tool`, `Target`/`target`, `Result`/`result`, `Timestamp`/`timestamp`. All functions are used with identical signatures across tasks. `errEmptyFrame` was removed during verification because leaking it to callers complicated the loop for no benefit — the parser now skips keepalives internally.

**Verification performed.** The code in Tasks 1–3 was written to a scratch module, and `go build ./...`, `go vet ./...`, and `go test ./...` all pass (11 tests). Three bugs were found and fixed:

1. `rawToolPart` originally decoded `part` at the top level instead of under `properties`, silently dropping every event. Caught by the table test, confirmed against a live frame.
2. The SSE parser surfaced keepalive-only frames as an `errEmptyFrame` sentinel, which callers had to special-case. Caught by the "comment keepalive is skipped" test.
3. An unused `time` import broke the build.

The spawn path and the SSE transport were then exercised against a real OpenCode 1.4.3 server. Both work; `message.part.updated` was observed on `/global/event`; the three-level envelope was confirmed. Only the tool-payload contents remain unverified, blocked by provider credentials in the verification environment.

---

## Execution Handoff

Plan saved to `docs/plans/2026-09-17-agent-observability-spike.md`.

**Note before starting:** Task 4 Step 5 needs a working provider credential. Verify with `opencode auth list` and a manual `opencode` run before committing to the spike, or the last step will be inconclusive.

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
