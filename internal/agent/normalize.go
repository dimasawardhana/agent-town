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

// GapError reports lost frames between two sequence numbers.
//
// It lives here rather than in receiver.go because NormalizeFrame is what
// detects a gap, and this file is where that happens. Defining it next to its
// only producer keeps each task self-contained.
type GapError struct {
	Expected int64
	Got      int64
	Lost     int64
}

func (e *GapError) Error() string {
	return "event gap: lost sequence numbers"
}
