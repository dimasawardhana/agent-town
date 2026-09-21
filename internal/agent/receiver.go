package agent

import (
	"errors"
	"io"
	"log"
	"net/http"
	"path/filepath"
	"sync"
	"time"
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

	// lastDropped tracks the highest overflow count reported per directory,
	// so a jump is surfaced once rather than on every frame carrying the
	// total. Keyed by directory for the same reason as lastSeq: a single
	// scalar would let one project's overflow suppress another's.
	lastDropped map[string]int64

	// OnEvent receives normalized events. Called from the HTTP handler, so
	// it must not block.
	OnEvent func(UnifiedAgentEvent)

	// OnGap is called when the extension's sequence indicates lost frames.
	OnGap func(directory string, lost int64)

	// OnDrop is called when an extension reports it gave up on frames because
	// its queue overflowed.
	OnDrop func(directory string, lost int64)

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
		watched:     w,
		lastSeq:     make(map[string]int64),
		lastDropped: make(map[string]int64),
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
		// A hello announces a fresh extension instance, and a fresh instance
		// restarts its sequence numbering. Resetting the baseline here is what
		// keeps gaps detectable across a restart: without it, a previous
		// session's high-water mark would mask every loss in the new one.
		// Set the baseline to the hello's own sequence rather than clearing
		// it: clearing would leave 0, and a 0 baseline means "nothing seen
		// yet, so nothing can have been missed" — which is exactly the state
		// that masks the new session's losses.
		r.mu.Lock()
		r.lastSeq[dir] = frame.Seq
		// A fresh extension starts its counter over.
		r.lastDropped[dir] = frame.Dropped
		r.mu.Unlock()

		if r.OnHello != nil {
			r.OnHello(dir)
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}

	r.mu.Lock()
	last := r.lastSeq[dir]
	r.mu.Unlock()

	// An extension that did not send a time gets the moment the daemon saw
	// the frame. Better an approximate time than epoch zero, which would
	// place every such event in 1970 and break any timeline.
	if frame.Time == 0 {
		frame.Time = time.Now().UnixMilli()
	}

	// An extension reports how many frames it gave up on when its queue
	// overflowed. The count is cumulative per extension process, so it is
	// surfaced as a delta: a jump means the town is missing history, which
	// ADR-0010 requires be recorded rather than silently absorbed.
	var dropLost int64
	r.mu.Lock()
	if frame.Dropped > r.lastDropped[dir] {
		dropLost = frame.Dropped - r.lastDropped[dir]
		r.lastDropped[dir] = frame.Dropped
	}
	r.mu.Unlock()
	if dropLost > 0 && r.OnDrop != nil {
		r.OnDrop(dir, dropLost)
	}

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
