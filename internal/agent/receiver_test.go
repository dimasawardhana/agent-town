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

// postFrame sends one hello frame from dir and reports the gate's status.
func postFrame(r *Receiver, dir string) int {
	body := `{"kind":"hello","directory":"` + dir + `","seq":1}`
	req := httptest.NewRequest(http.MethodPost, "/events", strings.NewReader(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w.Code
}

// A frame from a subdirectory of a watched root belongs to that root.
//
// The agent runs in the directory it was started in, and in a monorepo that is
// a package rather than the imported root. Exact-matching the root rejected
// every such frame, so a project whose work happens in a package produced no
// town at all.
func TestReceiverAcceptsSubdirectoryOfWatchedRoot(t *testing.T) {
	r := NewReceiver("/tmp/nest")

	for _, dir := range []string{
		"/tmp/nest",
		"/tmp/nest/pkg-a",
		"/tmp/nest/pkg-a/internal/deep",
	} {
		if code := postFrame(r, dir); code != http.StatusNoContent {
			t.Errorf("directory %q: status = %d, want 204", dir, code)
		}
	}
}

// Regression: ownership is by path segment, not by string prefix.
//
// A naive strings.HasPrefix(dir, root) reads /repo-other and /repo20 as
// children of /repo, which ships one project's frames into another's town.
// Reproduced: a prefix test answers 204 for these directories against a
// receiver watching only /repo.
func TestReceiverRejectsSiblingSharingPrefix(t *testing.T) {
	r := NewReceiver("/tmp/repo")

	for _, dir := range []string{"/tmp/repo-other", "/tmp/repo20", "/tmp/repository"} {
		if code := postFrame(r, dir); code != http.StatusForbidden {
			t.Errorf("directory %q: status = %d, want 403", dir, code)
		}
	}
}

// A frame naming no directory names no project. It must be rejected rather
// than resolved, because resolving an empty path reads as the daemon's own
// working directory — which would fold an unattributable frame into whatever
// project the daemon happens to be started in.
func TestReceiverRejectsEmptyDirectory(t *testing.T) {
	r := NewReceiver("/tmp/watched")
	if code := postFrame(r, ""); code != http.StatusForbidden {
		t.Errorf("status = %d, want 403", code)
	}
}

// A registry daemon decides ownership through OnOwner, and that decision is
// the gate. The receiver must not second-guess it from its own watched set,
// or the registry would not be the single authority on membership.
func TestReceiverOnOwnerDecidesOwnership(t *testing.T) {
	r := NewReceiver()
	r.OnOwner = func(dir string) bool {
		// The registry owns /repo and its packages, but not siblings.
		return dir == "/repo" || strings.HasPrefix(dir, "/repo/")
	}

	for _, dir := range []string{"/repo", "/repo/pkg-a/src"} {
		if code := postFrame(r, dir); code != http.StatusNoContent {
			t.Errorf("directory %q: status = %d, want 204", dir, code)
		}
	}
	for _, dir := range []string{"/repo-other", "/elsewhere"} {
		if code := postFrame(r, dir); code != http.StatusForbidden {
			t.Errorf("directory %q: status = %d, want 403", dir, code)
		}
	}
}

// Regression: the gate must not latch after a rejection.
//
// A frame refused while the project was unimported must not keep the project
// out once it is imported: the gate answers from the watched set every time.
func TestReceiverRejectionDoesNotBlockLaterFrames(t *testing.T) {
	r := NewReceiver("/tmp/watched")

	if code := postFrame(r, "/tmp/unwatched"); code != http.StatusForbidden {
		t.Fatalf("unwatched: status = %d, want 403", code)
	}
	if code := postFrame(r, "/tmp/watched"); code != http.StatusNoContent {
		t.Errorf("watched root after a rejection: status = %d, want 204", code)
	}
	if code := postFrame(r, "/tmp/watched/pkg"); code != http.StatusNoContent {
		t.Errorf("watched subdirectory after a rejection: status = %d, want 204", code)
	}
}

// Nested watched roots — a monorepo and one of its packages both imported —
// must attribute a frame to the deepest root that owns it. A shallow match
// would credit the monorepo, and a registry routing on the owner would then
// fold a package's events into the wrong town.
func TestReceiverProjectForPicksDeepestWatchedRoot(t *testing.T) {
	r := NewReceiver("/tmp/mono", "/tmp/mono/packages/a")

	cases := map[string]string{
		"/tmp/mono/packages/a":     "/tmp/mono/packages/a",
		"/tmp/mono/packages/a/src": "/tmp/mono/packages/a",
		"/tmp/mono/packages/b":     "/tmp/mono",
		"/tmp/mono":                "/tmp/mono",
		"/tmp/mono-other":          "",
		"/tmp/elsewhere":           "",
	}
	for dir, want := range cases {
		if got := r.ProjectFor(dir); got != want {
			t.Errorf("ProjectFor(%q) = %q, want %q", dir, got, want)
		}
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

// Regression: a restarted extension must not have its gaps masked.
//
// A hello announces a fresh extension instance, and a fresh instance restarts
// its sequence numbering. Before this was fixed, lastSeq only ever ratcheted
// upward: after one session reached a high mark, a restarted session's frames
// all looked already-seen, so losses in the new session went unreported and
// the town silently showed less than happened.
func TestHelloResetsSequenceBaseline(t *testing.T) {
	r := NewReceiver("/tmp/watched")
	var gaps []int64
	r.OnGap = func(_ string, lost int64) { gaps = append(gaps, lost) }

	post := func(body string) {
		req := httptest.NewRequest(http.MethodPost, "/events", strings.NewReader(body))
		r.ServeHTTP(httptest.NewRecorder(), req)
	}

	// Session A climbs to a high sequence number.
	post(`{"kind":"event","directory":"/tmp/watched","seq":100,"type":"session.idle"}`)

	// The extension restarts: hello, then the new session numbers from 1.
	post(`{"kind":"hello","directory":"/tmp/watched","seq":1,"agent":"omp"}`)

	// Frames 2..10 are genuinely lost; 11 arrives.
	post(`{"kind":"event","directory":"/tmp/watched","seq":11,"type":"session.idle"}`)

	if len(gaps) != 1 {
		t.Fatalf("got %d gap warnings, want exactly 1 — a restart must not mask loss", len(gaps))
	}
	if gaps[0] != 9 {
		t.Errorf("reported %d lost frames, want 9", gaps[0])
	}
}

// Regression: an extension that overflowed its queue must be reported.
//
// The extension stamps a cumulative drop count on every frame, and ADR-0010
// requires the count be recorded rather than silently absorbed. Before this,
// nothing read it, so a town could be missing history with no sign.
func TestReceiverReportsExtensionDrops(t *testing.T) {
	r := NewReceiver("/tmp/watched")
	var reported []int64
	r.OnDrop = func(_ string, lost int64) { reported = append(reported, lost) }

	post := func(body string) {
		req := httptest.NewRequest(http.MethodPost, "/events", strings.NewReader(body))
		r.ServeHTTP(httptest.NewRecorder(), req)
	}

	post(`{"kind":"hello","directory":"/tmp/watched","seq":1,"dropped":0}`)
	post(`{"kind":"event","directory":"/tmp/watched","seq":2,"dropped":7,"type":"session.idle"}`)
	// The count is cumulative, so repeating it must not report again.
	post(`{"kind":"event","directory":"/tmp/watched","seq":3,"dropped":7,"type":"session.idle"}`)
	// A further overflow reports only the delta.
	post(`{"kind":"event","directory":"/tmp/watched","seq":4,"dropped":10,"type":"session.idle"}`)

	if len(reported) != 2 {
		t.Fatalf("got %d drop reports %v, want 2 (one per increase)", len(reported), reported)
	}
	if reported[0] != 7 || reported[1] != 3 {
		t.Errorf("reported %v, want [7 3]", reported)
	}
}

// A hello resets the drop baseline, since a fresh extension restarts its count.
func TestHelloResetsDropBaseline(t *testing.T) {
	r := NewReceiver("/tmp/watched")
	var reported []int64
	r.OnDrop = func(_ string, lost int64) { reported = append(reported, lost) }

	post := func(body string) {
		req := httptest.NewRequest(http.MethodPost, "/events", strings.NewReader(body))
		r.ServeHTTP(httptest.NewRecorder(), req)
	}

	post(`{"kind":"event","directory":"/tmp/watched","seq":5,"dropped":20,"type":"session.idle"}`)
	post(`{"kind":"hello","directory":"/tmp/watched","seq":1,"dropped":0,"agent":"omp"}`)
	// Post-restart overflow must be reported from the new baseline.
	post(`{"kind":"event","directory":"/tmp/watched","seq":2,"dropped":4,"type":"session.idle"}`)

	if len(reported) != 2 {
		t.Fatalf("got %v, want two reports", reported)
	}
	if reported[1] != 4 {
		t.Errorf("post-restart report = %d, want 4", reported[1])
	}
}

// Regression: the drop baseline must be per directory, not process-wide.
//
// With a single scalar, a high count from one watched project suppressed the
// report from another — so a second project's overflow was silently swallowed.
// Reproduced: /tmp/watched-b reporting dropped:5 produced no OnDrop at all
// after /tmp/watched-a had reported 20.
func TestDropBaselineIsPerDirectory(t *testing.T) {
	r := NewReceiver("/tmp/a", "/tmp/b")
	var reported []string
	r.OnDrop = func(dir string, lost int64) {
		reported = append(reported, dir)
	}

	post := func(body string) {
		req := httptest.NewRequest(http.MethodPost, "/events", strings.NewReader(body))
		r.ServeHTTP(httptest.NewRecorder(), req)
	}

	// Directory A reports a large overflow.
	post(`{"kind":"hello","directory":"/tmp/a","seq":1,"dropped":0}`)
	post(`{"kind":"event","directory":"/tmp/a","seq":2,"dropped":20,"type":"session.idle"}`)

	// Directory B overflows independently. A process-wide scalar would
	// swallow this because 5 < 20.
	post(`{"kind":"hello","directory":"/tmp/b","seq":1,"dropped":0}`)
	post(`{"kind":"event","directory":"/tmp/b","seq":2,"dropped":5,"type":"session.idle"}`)

	if len(reported) != 2 {
		t.Fatalf("got %d drop reports %v, want 2 — one per directory", len(reported), reported)
	}
}
