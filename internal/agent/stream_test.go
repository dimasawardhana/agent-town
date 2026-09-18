package agent

import (
	"bufio"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestBroadcasterDeliversToSubscriber(t *testing.T) {
	b := NewBroadcaster()
	ch, unsub := b.Subscribe()
	defer unsub()

	b.Publish([]byte(`{"type":"FILE_READ"}`))

	select {
	case got := <-ch:
		if string(got) != `{"type":"FILE_READ"}` {
			t.Errorf("got %q", got)
		}
	case <-time.After(time.Second):
		t.Fatal("frame was not delivered")
	}
}

func TestBroadcasterFansOutToAllSubscribers(t *testing.T) {
	b := NewBroadcaster()
	a, ua := b.Subscribe()
	defer ua()
	c, uc := b.Subscribe()
	defer uc()

	b.Publish([]byte("x"))

	for name, ch := range map[string]<-chan []byte{"a": a, "c": c} {
		select {
		case <-ch:
		case <-time.After(time.Second):
			t.Fatalf("subscriber %s received nothing", name)
		}
	}
}

// A stalled subscriber must not block the publisher. This is the property
// that keeps a frozen browser tab from stalling the ingest path.
func TestBroadcasterDoesNotBlockOnSlowSubscriber(t *testing.T) {
	b := NewBroadcaster()
	_, unsub := b.Subscribe() // never read from
	defer unsub()

	done := make(chan struct{})
	go func() {
		// Far more than the subscriber buffer, to guarantee a full channel.
		for i := 0; i < 1000; i++ {
			b.Publish([]byte("flood"))
		}
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Publish blocked on a slow subscriber")
	}
}

func TestBroadcasterUnsubscribeIsIdempotent(t *testing.T) {
	b := NewBroadcaster()
	_, unsub := b.Subscribe()
	unsub()
	unsub() // must not panic on double-close
	if b.Count() != 0 {
		t.Errorf("Count = %d after unsubscribe, want 0", b.Count())
	}
}

func TestStreamHandlerRejectsNonGet(t *testing.T) {
	b := NewBroadcaster()
	w := httptest.NewRecorder()
	b.StreamHandler().ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/stream", nil))
	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", w.Code)
	}
}

// The stream must open immediately, before any event exists, so the client's
// EventSource fires onopen rather than hanging.
func TestStreamHandlerOpensImmediately(t *testing.T) {
	b := NewBroadcaster()
	srv := httptest.NewServer(b.StreamHandler())
	defer srv.Close()

	resp, err := http.Get(srv.URL)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer resp.Body.Close()

	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
		t.Fatalf("Content-Type = %q, want text/event-stream", ct)
	}
}

// An event published after a client connects must reach that client.
func TestStreamHandlerDeliversPublishedEvent(t *testing.T) {
	b := NewBroadcaster()
	srv := httptest.NewServer(b.StreamHandler())
	defer srv.Close()

	resp, err := http.Get(srv.URL)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer resp.Body.Close()

	// Wait for the subscriber to register before publishing, or the event
	// is published into an empty room.
	deadline := time.Now().Add(2 * time.Second)
	for b.Count() == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if b.Count() == 0 {
		t.Fatal("subscriber never registered")
	}

	b.Publish([]byte(`{"hello":"town"}`))

	// Read lines until the event arrives or we give up.
	lines := make(chan string, 64)
	go func() {
		sc := bufio.NewScanner(resp.Body)
		for sc.Scan() {
			lines <- sc.Text()
		}
		close(lines)
	}()

	timeout := time.After(3 * time.Second)
	for {
		select {
		case line, ok := <-lines:
			if !ok {
				t.Fatal("stream closed before the event arrived")
			}
			if strings.Contains(line, "hello") {
				return // found it
			}
		case <-timeout:
			t.Fatal("published event never reached the stream")
		}
	}
}
