package agent

import (
	"errors"
	"io"
	"log"
	"net/http"
	"path/filepath"
	"sync"
)

// Receiver accepts frames from the AI Town forwarder extension.
//
// It enforces the one guarantee the HTTP/SSE transport could not provide:
// only the directories AI Town explicitly watches are accepted. An extension
// running globally will fire for unrelated projects; those frames are
// rejected with 403 and the extension stops forwarding (docs/adr/0009).
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

	// OnGap is called when the extension's sequence indicates lost frames.
	OnGap func(directory string, lost int64)

	// OnHello is called when an extension proves it loaded. This is the gate
	// that lets a session be declared live (docs/adr/0010).
	OnHello func(directory string)
}

// NewReceiver creates a receiver watching the given directories.
// Paths are resolved to absolute form so an extension reporting a symlinked or
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
		// Not our project. Reject so the extension stops forwarding.
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
