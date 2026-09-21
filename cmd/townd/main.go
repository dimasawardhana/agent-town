// Command townd is the AI Town daemon.
//
// It receives frames from an AI Town extension running inside an agent
// process, normalizes them into agent-agnostic events, and serves the UI that
// visualizes them.
//
// One process serves both the UI and the event stream (ADR-0013): the UI
// comes from an embedded filesystem and events arrive over Server-Sent
// Events, so there is no CORS and no second server to run.
//
// Usage:
//
//	townd --dir /path/to/project
//
// It prints AI_TOWN_URL on stdout so a caller can export it before starting
// an agent, and prints the UI address on stderr.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/dimasajiwardhana/agent-town/internal/agent"
	"github.com/dimasajiwardhana/agent-town/internal/analyzer"
	"github.com/dimasajiwardhana/agent-town/internal/town"
	"github.com/dimasajiwardhana/agent-town/internal/web"
)

func main() {
	dir := flag.String("dir", ".", "project directory to observe")
	addr := flag.String("addr", "127.0.0.1:0", "loopback address to listen on")
	project := flag.String("project", "", "project to draw as a town (defaults to --dir)")
	quiet := flag.Bool("quiet", false, "do not print events to stdout")
	flag.Parse()

	abs, err := filepath.Abs(*dir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "townd: resolve dir: %v\n", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Events travel to the UI through this broadcaster. stdout is kept as a
	// second sink because it is the fastest way to verify the pipeline.
	bus := agent.NewBroadcaster()

	// The town is computed once at startup. It is a pure function of the
	// directory tree (ADR-0012), so there is nothing to recompute.
	projectDir := *project
	if projectDir == "" {
		projectDir = abs
	}
	static, layout, townErr := buildTown(projectDir)
	if townErr != nil {
		fmt.Fprintf(os.Stderr, "townd: cannot analyze %s: %v\n", projectDir, townErr)
	}

	// The live town folds events into state: where workers stand, and what
	// condition the buildings they touch are in. The static town is the map;
	// this is what moves on it.
	var live *town.Town
	statePath := ""
	if static != nil {
		live = town.New(static)
		// Restore what earlier sessions built. The map is recomputed from the
		// tree every start, so only the live state needs persisting.
		statePath = town.StatePath(projectDir)
		if err := live.Load(statePath); err != nil {
			fmt.Fprintf(os.Stderr, "townd: could not restore town state: %v\n", err)
		}
	}

	recv := agent.NewReceiver(abs)
	recv.OnHello = func(d string) {
		fmt.Fprintf(os.Stderr, "townd: extension handshake from %s\n", d)
	}
	recv.OnSessionEnd = func(session string) {
		// The crew stands down. The buildings it touched stay, because the
		// town is the result of the work and clearing it on exit would throw
		// away the only persistent thing the product produces.
		if live != nil {
			live.EndSession(session)
			persist(live, statePath)
			if snap, err := json.Marshal(live.Snapshot()); err == nil {
				bus.Publish(snap)
			}
		}
		fmt.Fprintf(os.Stderr, "townd: session ended %s\n", session)
	}
	recv.OnGap = func(d string, lost int64) {
		fmt.Fprintf(os.Stderr, "townd: WARNING lost %d frame(s) from %s\n", lost, d)
	}
	recv.OnDrop = func(d string, lost int64) {
		fmt.Fprintf(os.Stderr, "townd: WARNING extension queue overflowed, %d frame(s) dropped from %s\n", lost, d)
	}
	recv.OnEvent = func(ev agent.UnifiedAgentEvent) {
		raw, err := json.Marshal(ev)
		if err != nil {
			fmt.Fprintf(os.Stderr, "townd: encode: %v\n", err)
			return
		}
		if !*quiet {
			_, _ = os.Stdout.Write(append(raw, '\n'))
		}
		// The UI wants the resulting town, not the raw event: the movement of
		// a worker is the product, and recomputing it client-side would make
		// the browser a second authority on where things are.
		if live != nil {
			live.Apply(ev)
			persist(live, statePath)
			if snap, err := json.Marshal(live.Snapshot()); err == nil {
				bus.Publish(snap)
			}
			return
		}
		bus.Publish(raw)
	}

	mux := http.NewServeMux()
	mux.Handle("/events", recv)                // extension -> daemon
	mux.Handle("/stream", bus.StreamHandler()) // daemon -> UI
	mux.HandleFunc("/api/town", func(w http.ResponseWriter, r *http.Request) {
		if townErr != nil {
			http.Error(w, townErr.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		resp := map[string]any{
			"town":   static,
			"layout": layout,
		}
		// The live state travels with the map so a client that reconnects
		// draws the current town rather than an empty one. Events missed
		// during the gap are not replayed; the snapshot is the authority.
		if live != nil {
			resp["live"] = live.Snapshot()
		}
		_ = json.NewEncoder(w).Encode(resp)
	})
	mux.Handle("/", web.Handler()) // the UI itself

	// The daemon serves an unauthenticated UI and API over an event stream
	// carrying private file paths, so it must never leave the machine
	// (ADR-0013). Refuse anything that is not loopback rather than trusting
	// the flag's default.
	if err := requireLoopback(*addr); err != nil {
		fmt.Fprintf(os.Stderr, "townd: %v\n", err)
		os.Exit(1)
	}

	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "townd: listen: %v\n", err)
		os.Exit(1)
	}

	srv := &http.Server{Handler: mux}
	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			fmt.Fprintf(os.Stderr, "townd: serve: %v\n", err)
		}
	}()

	// The extension discovers the daemon through this variable. Printing it
	// on stdout lets the caller export it before spawning an agent.
	fmt.Printf("AI_TOWN_URL=http://%s\n", ln.Addr().String())
	fmt.Fprintf(os.Stderr, "townd: watching %s\n", abs)
	fmt.Fprintf(os.Stderr, "townd: open http://%s\n", ln.Addr().String())

	<-ctx.Done()
	fmt.Fprintln(os.Stderr, "townd: shutting down")
	if live != nil {
		persist(live, statePath)
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
}

// requireLoopback rejects any listen address that is not loopback.
//
// A wildcard or routable address would expose the developer's agent activity
// and file paths to the network, with no authentication in front of it. The
// check is here rather than in documentation because a flag is easy to pass
// by accident and the consequence is silent.
func requireLoopback(addr string) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("invalid listen address %q: %w", addr, err)
	}
	if host == "" {
		return fmt.Errorf("refusing to bind %q: the address must be loopback", addr)
	}
	if host == "localhost" {
		return nil
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return fmt.Errorf("refusing to bind %q: only loopback addresses are allowed", addr)
	}
	return nil
}

// buildTown analyzes a project and computes its map.
//
// Layout is computed here rather than in the browser: ADR-0012 requires it to
// be a pure function of the analysis, and this keeps a single source of truth
// for where everything sits.
func buildTown(dir string) (*analyzer.Town, *analyzer.Layout, error) {
	t, err := analyzer.Analyze(dir)
	if err != nil {
		return nil, nil, err
	}
	l := analyzer.LayoutTown(t)
	return t, &l, nil
}

// persist writes the live town, discarding a write error.
//
// A failed save costs history on the next start, not correctness now, and the
// daemon has no better option at this point. Reported so it is not silent.
func persist(live *town.Town, path string) {
	if live == nil || path == "" {
		return
	}
	if err := live.Save(path); err != nil {
		fmt.Fprintf(os.Stderr, "townd: could not save town state: %v\n", err)
	}
}
