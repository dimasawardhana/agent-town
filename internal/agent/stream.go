package agent

import (
	"fmt"
	"net/http"
	"sync"
	"time"
)

// Broadcaster fans normalized events out to every connected UI.
//
// It implements the SSE half of ADR-0013: the daemon serves the UI and
// streams events to it from the same origin.
//
// Design constraints:
//   - A slow or stalled subscriber must NEVER block the daemon. Frames are
//     delivered on a best-effort basis; a subscriber whose buffer is full is
//     dropped from this event rather than stalling the pipeline that feeds
//     every other subscriber.
//   - Late subscribers do not receive history. The UI fetches the current
//     town snapshot on connect, and the sequence numbers already on every
//     frame let it detect what it missed.
type Broadcaster struct {
	mu   sync.Mutex
	subs map[chan []byte]string // channel -> the project it wants, "" for all
}

// NewBroadcaster creates an empty broadcaster.
func NewBroadcaster() *Broadcaster {
	return &Broadcaster{subs: make(map[chan []byte]string)}
}

// Publish delivers a frame to the subscribers watching that project.
//
// project scopes the delivery: a daemon serves several towns (ADR-0014), and a
// client viewing one must never be handed another's snapshot, which would
// redraw the wrong town. Filtering here rather than in the browser keeps the
// daemon the single authority on routing, as ADR-0013 requires. An empty
// project means the frame belongs to no particular one and goes to everyone.
//
// A subscriber whose channel is full is skipped, not waited on. Dropping one
// frame is recoverable — the sequence number exposes the gap — whereas
// blocking would stall every other subscriber and the ingest path with them.
func (b *Broadcaster) Publish(project string, frame []byte) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for ch, want := range b.subs {
		if want != "" && project != "" && want != project {
			continue
		}
		select {
		case ch <- frame:
		default:
			// This subscriber is not keeping up. Skip it this round.
		}
	}
}

// Subscribe registers a subscriber for one project and returns its channel
// plus a function to call on disconnect. An empty project receives every
// frame. The unsubscribe function is idempotent.
func (b *Broadcaster) Subscribe(project string) (<-chan []byte, func()) {
	ch := make(chan []byte, 256)
	b.mu.Lock()
	b.subs[ch] = project
	b.mu.Unlock()

	return ch, func() {
		b.mu.Lock()
		if _, ok := b.subs[ch]; ok {
			delete(b.subs, ch)
			close(ch)
		}
		b.mu.Unlock()
	}
}

// Count reports how many subscribers are connected. Used by tests.
func (b *Broadcaster) Count() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.subs)
}

// StreamHandler serves the Server-Sent Events endpoint described in ADR-0013.
//
// Why SSE rather than WebSocket: the only continuous flow is server to client.
// EventSource gives browser-native reconnection for free, which a WebSocket
// would require hand-writing.
func (b *Broadcaster) StreamHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		// No Access-Control-Allow-Origin. This endpoint is same-origin by
		// construction, and the stream carries private file paths — setting a
		// wildcard CORS header would let any website the developer visits
		// read their codebase's activity through EventSource.
		w.WriteHeader(http.StatusOK)

		// An initial comment opens the stream immediately so the client's
		// EventSource fires onopen without waiting for the first event.
		fmt.Fprint(w, ": connected\n\n")
		flusher.Flush()

		// The UI names the project it is viewing. An absent parameter means
		// every project, which is what the single-project path always wanted.
		frames, unsubscribe := b.Subscribe(r.URL.Query().Get("project"))
		defer unsubscribe()

		// Keepalive: a comment line every 15s keeps intermediaries from
		// closing an idle connection. Loopback makes this unlikely, but it
		// costs nothing and removes a class of "the town froze" bug.
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case frame, ok := <-frames:
				if !ok {
					return
				}
				if _, err := fmt.Fprintf(w, "data: %s\n\n", frame); err != nil {
					return
				}
				flusher.Flush()
			case <-ticker.C:
				if _, err := fmt.Fprint(w, ": keepalive\n\n"); err != nil {
					return
				}
				flusher.Flush()
			case <-r.Context().Done():
				return
			}
		}
	})
}
