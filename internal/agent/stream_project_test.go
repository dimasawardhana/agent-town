package agent

import (
	"bufio"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// recv takes one frame or reports that none arrived.
func recv(t *testing.T, ch <-chan []byte) (string, bool) {
	t.Helper()
	select {
	case b := <-ch:
		return string(b), true
	case <-time.After(200 * time.Millisecond):
		return "", false
	}
}

// TestPublishIsScopedToProject is the behaviour the project switcher depends
// on: a client viewing one town must never be handed another's snapshot, which
// would redraw the wrong town.
func TestPublishIsScopedToProject(t *testing.T) {
	b := NewBroadcaster()

	alpha, stopAlpha := b.Subscribe("/code/alpha")
	defer stopAlpha()
	bravo, stopBravo := b.Subscribe("/code/bravo")
	defer stopBravo()

	b.Publish("/code/alpha", []byte("alpha-frame"))

	got, ok := recv(t, alpha)
	if !ok || got != "alpha-frame" {
		t.Errorf("alpha subscriber got %q (ok=%v), want the frame published for it", got, ok)
	}

	if got, ok := recv(t, bravo); ok {
		t.Errorf("bravo subscriber received %q — a viewer of one town must not receive another's frames", got)
	}
}

// TestUnscopedPublishReachesEveryone covers any frame that belongs to no
// particular project.
func TestUnscopedPublishReachesEveryone(t *testing.T) {
	b := NewBroadcaster()

	alpha, stopAlpha := b.Subscribe("/code/alpha")
	defer stopAlpha()
	bravo, stopBravo := b.Subscribe("/code/bravo")
	defer stopBravo()

	b.Publish("", []byte("broadcast"))

	for name, ch := range map[string]<-chan []byte{"alpha": alpha, "bravo": bravo} {
		if got, ok := recv(t, ch); !ok || got != "broadcast" {
			t.Errorf("%s subscriber got %q (ok=%v), want the broadcast frame", name, got, ok)
		}
	}
}

// TestSubscriberWithNoProjectReceivesEverything keeps the unfiltered behaviour
// available: a client that names no project sees the whole daemon. This is
// what the single-project path always wanted.
func TestSubscriberWithNoProjectReceivesEverything(t *testing.T) {
	b := NewBroadcaster()

	all, stop := b.Subscribe("")
	defer stop()

	b.Publish("/code/alpha", []byte("alpha-frame"))
	b.Publish("/code/bravo", []byte("bravo-frame"))

	for _, want := range []string{"alpha-frame", "bravo-frame"} {
		if got, ok := recv(t, all); !ok || got != want {
			t.Errorf("unscoped subscriber got %q (ok=%v), want %q", got, ok, want)
		}
	}
}

// TestStreamHandlerFiltersByProjectQuery is the end-to-end version: the query
// parameter decides what a real SSE client receives.
func TestStreamHandlerFiltersByProjectQuery(t *testing.T) {
	b := NewBroadcaster()
	srv := httptest.NewServer(b.StreamHandler())
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/stream?project=" + url.QueryEscape("/code/alpha"))
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer resp.Body.Close()

	// Wait for the subscriber to register before publishing, or the frames go
	// into an empty room.
	deadline := time.Now().Add(2 * time.Second)
	for b.Count() == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if b.Count() == 0 {
		t.Fatal("subscriber never registered")
	}

	b.Publish("/code/bravo", []byte(`{"project":"bravo"}`))
	b.Publish("/code/alpha", []byte(`{"project":"alpha"}`))

	lines := make(chan string, 64)
	go func() {
		sc := bufio.NewScanner(resp.Body)
		for sc.Scan() {
			lines <- sc.Text()
		}
		close(lines)
	}()

	var seen []string
	timeout := time.After(3 * time.Second)
	for {
		select {
		case line, ok := <-lines:
			if !ok {
				t.Fatalf("stream closed before the viewed project's frame; saw %v", seen)
			}
			seen = append(seen, line)
			if strings.Contains(line, `"project":"alpha"`) {
				for _, l := range seen {
					if strings.Contains(l, `"project":"bravo"`) {
						t.Errorf("received another project's frame: %q", l)
					}
				}
				return
			}
		case <-timeout:
			t.Fatalf("never received the viewed project's frame; saw %v", seen)
		}
	}
}
