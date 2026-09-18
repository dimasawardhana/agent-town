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
