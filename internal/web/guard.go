package web

import (
	"net"
	"net/http"
	"strings"
)

// Guard wraps a handler with the checks that make loopback binding sufficient
// rather than merely necessary (ADR-0017).
//
// Binding to 127.0.0.1 keeps the daemon off the network, but it does not keep
// a web page out: a browser can reach localhost, and DNS rebinding lets an
// attacker's hostname resolve to it, at which point the browser treats the
// request as same-origin and both reads and writes succeed. Verified before
// this existed: `Host: evil.example` was served 200 and a foreign-Origin POST
// was accepted.
//
// It wraps the whole mux rather than individual routes so a route added later
// is covered by default; protecting routes one at a time makes safety
// something a future contributor has to remember.
func Guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !hostAllowed(r.Host) {
			refuse(w, "the Host header must be loopback")
			return
		}
		if o := r.Header.Get("Origin"); o != "" && !originAllowed(o) {
			refuse(w, "the Origin header must be this daemon's own loopback origin")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// refuse states which rule was broken, so a refusal is legible rather than
// looking like a crash. It is deliberately not 403: that status is already
// meaningful on /events, where it tells the extension to stop forwarding.
func refuse(w http.ResponseWriter, reason string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusForbidden)
	_, _ = w.Write([]byte("ai-town: refused: " + reason + "\n"))
}

// hostAllowed reports whether a Host header names this machine.
//
// The port is ignored: the daemon may be told to listen anywhere, and a
// legitimate client always sends the port it connected to.
func hostAllowed(host string) bool {
	if host == "" {
		// HTTP/1.0 clients may omit Host. Treating that as invalid would break
		// them while gaining nothing, because a rebound request always
		// carries the attacker's hostname.
		return true
	}
	return isLoopbackHost(stripPort(host))
}

// originAllowed reports whether an Origin header names this daemon.
func originAllowed(origin string) bool {
	h := strings.TrimSpace(origin)
	if h == "null" {
		// A sandboxed iframe or a file:// page. Not this daemon.
		return false
	}
	for _, scheme := range []string{"http://", "https://"} {
		if strings.HasPrefix(h, scheme) {
			h = strings.TrimPrefix(h, scheme)
			break
		}
	}
	if h == origin {
		// No recognised scheme; refuse rather than guess at the shape.
		return false
	}
	if i := strings.IndexByte(h, '/'); i >= 0 {
		h = h[:i]
	}
	return isLoopbackHost(stripPort(h))
}

// stripPort removes a port, handling the bracketed form IPv6 requires.
func stripPort(host string) string {
	if strings.HasPrefix(host, "[") {
		if end := strings.IndexByte(host, ']'); end >= 0 {
			return host[1:end]
		}
		return host
	}
	if i := strings.LastIndexByte(host, ':'); i >= 0 {
		return host[:i]
	}
	return host
}

// isLoopbackHost reports whether a host is a name or address for this machine.
//
// The address form is parsed rather than pattern-matched: a hand-rolled "127."
// check accepts "127.999.999.999" and "127.x.y.z", which are not addresses at
// all. net.ParseIP rejects both and accepts the whole 127.0.0.0/8 block, which
// is all loopback.
//
// "localhost" is accepted by name without resolving it. Resolution could be
// pointed elsewhere by /etc/hosts, but a request that arrived over loopback
// and names localhost is the ordinary browser case, and refusing it would
// break the common path to guard against a scenario this check cannot help
// with anyway.
func isLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
