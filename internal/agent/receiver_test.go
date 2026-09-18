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
