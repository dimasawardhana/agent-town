package web

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// okHandler stands in for the mux: it records that it was reached, so a test
// can distinguish "allowed" from "refused".
func okHandler() (http.Handler, *bool) {
	reached := false
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = true
		w.WriteHeader(http.StatusOK)
	}), &reached
}

func TestGuardAllowsLoopbackHosts(t *testing.T) {
	for _, host := range []string{
		"127.0.0.1", "127.0.0.1:7777", "localhost", "localhost:7777",
		"[::1]:7777", "127.0.0.53:1234", "LOCALHOST:80",
	} {
		t.Run(host, func(t *testing.T) {
			next, reached := okHandler()
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/town", nil)
			req.Host = host

			Guard(next).ServeHTTP(rec, req)

			if !*reached {
				t.Errorf("Host %q was refused; it is loopback", host)
			}
			if rec.Code != http.StatusOK {
				t.Errorf("Host %q got status %d, want 200", host, rec.Code)
			}
		})
	}
}

// TestGuardRefusesForeignHost is the check that defeats DNS rebinding: a
// rebound request carries the attacker's hostname in Host, whatever it
// resolved to.
func TestGuardRefusesForeignHost(t *testing.T) {
	for _, host := range []string{
		"evil.example", "evil.example:7777", "ai-town.attacker.test",
		"192.168.1.10:7777", "10.0.0.1", "example.com",
	} {
		t.Run(host, func(t *testing.T) {
			next, reached := okHandler()
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/town", nil)
			req.Host = host

			Guard(next).ServeHTTP(rec, req)

			if *reached {
				t.Errorf("Host %q reached the handler; a non-loopback Host must be refused", host)
			}
			if rec.Code != http.StatusMisdirectedRequest {
				t.Errorf("Host %q got status %d, want 421", host, rec.Code)
			}
		})
	}
}

func TestGuardAllowsAbsentOrigin(t *testing.T) {
	// The extension is not a browser and sends no Origin. Refusing it would
	// break the product's only event source.
	next, reached := okHandler()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/events", nil)
	req.Host = "127.0.0.1:7777"

	Guard(next).ServeHTTP(rec, req)

	if !*reached {
		t.Error("a request with no Origin was refused; non-browser clients must still work")
	}
}

func TestGuardAllowsOwnOrigin(t *testing.T) {
	for _, origin := range []string{
		"http://127.0.0.1:7777", "http://localhost:7777", "http://[::1]:7777",
	} {
		t.Run(origin, func(t *testing.T) {
			next, reached := okHandler()
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/events", nil)
			req.Host = "127.0.0.1:7777"
			req.Header.Set("Origin", origin)

			Guard(next).ServeHTTP(rec, req)

			if !*reached {
				t.Errorf("Origin %q was refused; it is this daemon's own origin", origin)
			}
		})
	}
}

func TestGuardRefusesForeignOrigin(t *testing.T) {
	for _, origin := range []string{
		"https://evil.example", "http://evil.example:7777",
		"http://192.168.1.10", "null", "https://ai-town.attacker.test",
	} {
		t.Run(origin, func(t *testing.T) {
			next, reached := okHandler()
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/events", nil)
			req.Host = "127.0.0.1:7777"
			req.Header.Set("Origin", origin)

			Guard(next).ServeHTTP(rec, req)

			if *reached {
				t.Errorf("Origin %q reached the handler; it must be refused", origin)
			}
			if rec.Code != http.StatusMisdirectedRequest {
				t.Errorf("Origin %q got status %d, want 421", origin, rec.Code)
			}
		})
	}
}

// TestGuardCoversEveryPath checks the guard is mounted over the mux rather
// than on individual routes, so a route added later is covered by default.
func TestGuardCoversEveryPath(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	mux.HandleFunc("/api/town", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	mux.HandleFunc("/stream", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	mux.HandleFunc("/events", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	mux.HandleFunc("/a-route-added-later", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })

	for _, path := range []string{"/", "/api/town", "/stream", "/events", "/a-route-added-later"} {
		t.Run(path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, path, nil)
			req.Host = "evil.example"

			Guard(mux).ServeHTTP(rec, req)

			if rec.Code != http.StatusMisdirectedRequest {
				t.Errorf("%s got status %d with a foreign Host, want 421", path, rec.Code)
			}
		})
	}
}

func TestRefusalNamesTheRule(t *testing.T) {
	next, _ := okHandler()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Host = "evil.example"

	Guard(next).ServeHTTP(rec, req)

	if body := rec.Body.String(); body == "" {
		t.Error("refusal had no body; the cause must be legible")
	} else if !strings.Contains(body, "Host") {
		t.Errorf("refusal body %q does not name the rule that was broken", body)
	}
}

// TestGuardRejectsMalformedLoopbackLookalikes guards the address rule the Host
// check depends on. A hand-rolled "127." prefix test accepts these, which are
// not addresses at all and would let a spoofed Host through.
func TestGuardRejectsMalformedLoopbackLookalikes(t *testing.T) {
	for _, host := range []string{
		"127.999.999.999", "127.x.y.z", "127.0.0.1.evil.com",
		"localhost.evil.com", "127.1", "0.0.0.0",
	} {
		if isLoopbackHost(host) {
			t.Errorf("isLoopbackHost(%q) = true; it is not a loopback address", host)
		}
	}
}

// TestGuardAcceptsTheWholeLoopbackBlock covers the other direction: the entire
// 127.0.0.0/8 range really is loopback, and 127.0.0.53 is a common stub
// resolver address a browser may legitimately use.
func TestGuardAcceptsTheWholeLoopbackBlock(t *testing.T) {
	for _, host := range []string{"127.0.0.1", "127.0.0.53", "127.255.255.255", "localhost", "::1"} {
		if !isLoopbackHost(host) {
			t.Errorf("isLoopbackHost(%q) = false; it is loopback", host)
		}
	}
}

// TestGuardStatusIsDistinctFromTheDirectoryGate is the load-bearing part of
// using 421 rather than 403. The extension treats 403 on /events as "this
// directory is not watched" and stops forwarding it permanently, so a guard
// refusal sharing that status would let a misconfigured AI_TOWN_URL disable an
// agent's forwarding while reporting it as an unwatched project.
func TestGuardStatusIsDistinctFromTheDirectoryGate(t *testing.T) {
	next, _ := okHandler()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/events", nil)
	req.Host = "evil.example"
	Guard(next).ServeHTTP(rec, req)

	if rec.Code == http.StatusForbidden {
		t.Fatal("the guard refuses with 403, which the extension reads as 'directory not watched' and stops forwarding for good")
	}
	if rec.Code != http.StatusMisdirectedRequest {
		t.Errorf("guard refused with %d, want 421", rec.Code)
	}
}
