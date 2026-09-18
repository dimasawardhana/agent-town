// Package web embeds the UI that the daemon serves.
//
// ADR-0013: one process serves both the UI and the event stream, so there is
// no CORS, no second server, and nothing to path-resolve at runtime. The
// built UI travels inside the binary via go:embed.
//
// The placeholder page in static/ exists to prove the transport for ticket
// 01. Ticket 04 replaces it with the Phaser town.
package web

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed static
var files embed.FS

// Handler serves the embedded UI at the root.
//
// It is mounted at "/" and therefore must not shadow the API routes that
// share the mux — those are registered more specifically and win.
func Handler() http.Handler {
	sub, err := fs.Sub(files, "static")
	if err != nil {
		// Only reachable if the embed directive above is broken, which is a
		// build-time error rather than a runtime condition.
		panic("web: embedded static files missing: " + err.Error())
	}
	return http.FileServer(http.FS(sub))
}
