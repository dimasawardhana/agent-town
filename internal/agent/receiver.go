package agent

import (
	"errors"
	"io"
	"log"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Receiver accepts frames from the AI Town forwarder extension.
//
// It enforces the one guarantee the HTTP/SSE transport could not provide:
// only the directories AI Town serves are accepted. An extension running
// globally will fire for unrelated projects; those frames are rejected with
// 403 and the extension stops forwarding for that directory (docs/adr/0009).
//
// A served directory owns everything beneath it, so an agent started in a
// package of an imported monorepo is still AI Town's to observe. Ownership is
// decided per frame rather than remembered, so adding a project while its
// agent is already running takes effect on that agent's next frame.
type Receiver struct {
	// watched is the set of absolute roots AI Town is observing, used by the
	// single-project daemon where the process serves exactly one town. A frame
	// is accepted when one of these owns its directory.
	//
	// A multi-project daemon leaves this empty and answers through OnOwner
	// instead, so membership lives in its registry alone.
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

	// OnOwner decides whether the daemon wants a frame whose directory is dir,
	// which is absolute. A false answer is the 403 path.
	//
	// When set it is authoritative: a multi-project daemon keeps membership in
	// its registry (docs/adr/0014), and a second copy of that rule here could
	// only disagree with it.
	OnOwner func(dir string) bool

	// OnEvent receives normalized events, along with the directory the frame
	// came from so the daemon can fold them into the owning project. Called
	// from the HTTP handler, so it must not block.
	OnEvent func(directory string, ev UnifiedAgentEvent)

	// OnGap is called when the extension's sequence indicates lost frames.
	OnGap func(directory string, lost int64)

	// OnDrop is called when an extension reports it gave up on frames because
	// its queue overflowed.
	OnDrop func(directory string, lost int64)

	// OnHello is called when an extension proves it loaded. This is the gate
	// that lets a session be declared live (docs/adr/0010).
	OnHello func(directory string)

	// OnSessionEnd is called when an extension reports its session finished,
	// so the crew can be stood down rather than left frozen mid-action. The
	// directory says which crew: a daemon serves several projects (ADR-0014),
	// and a session id is only unique within the agent that issued it.
	OnSessionEnd func(directory, session string)
}

// NewReceiver creates a receiver watching the given directories.
//
// Paths are resolved to absolute form so an extension reporting a symlinked or
// relative path still matches. A multi-project daemon passes none and sets
// OnOwner instead, keeping membership in its registry.
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

// wants reports whether the daemon serves a directory.
//
// OnOwner wins when set, so the registry stays the single authority on which
// projects exist. Otherwise the static set is consulted, which is what the
// single-project daemon uses.
func (r *Receiver) wants(dir string) bool {
	if r.OnOwner != nil {
		return r.OnOwner(dir)
	}
	return r.ProjectFor(dir) != ""
}

// ProjectFor returns the watched root that owns dir, or "" when none does.
//
// The longest match wins, so nested roots — a monorepo and one of its packages
// both imported — attribute a frame to the package rather than to the monorepo.
//
// An empty directory returns "": filepath.Abs("") resolves to the daemon's own
// working directory, so accepting it would fold an unattributable frame into
// whichever project townd happened to be started in.
func (r *Receiver) ProjectFor(dir string) string {
	if dir == "" {
		return ""
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return ""
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	best := ""
	for root := range r.watched {
		if !owns(root, abs) {
			continue
		}
		if len(root) > len(best) {
			best = root
		}
	}
	return best
}

// owns reports whether root contains dir, on a path-segment boundary.
//
// The separator is what makes this correct: a bare prefix test would accept
// /repo-other as a child of /repo and hand one project's activity to another.
func owns(root, dir string) bool {
	if dir == root {
		return true
	}
	return strings.HasPrefix(dir, root+string(filepath.Separator))
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

	if !r.wants(dir) {
		// Not a project the daemon serves. Reject so the extension stops
		// forwarding this directory, and only this one.
		log.Printf("agent: rejected frame from unwatched directory %q", dir)
		http.Error(w, "directory not watched", http.StatusForbidden)
		return
	}

	if frame.Kind == "session.end" {
		if r.OnSessionEnd != nil {
			r.OnSessionEnd(dir, frame.SessionID)
		}
		w.WriteHeader(http.StatusNoContent)
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
			// The directory travels with the event so the daemon can fold it
			// into the owning project rather than guessing from the path.
			r.OnEvent(dir, ev)
		}
	}

	w.WriteHeader(http.StatusNoContent)
}
