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
	"github.com/dimasajiwardhana/agent-town/internal/web"
)

func main() {
	dir := flag.String("dir", ".", "project directory to observe")
	addr := flag.String("addr", "127.0.0.1:0", "loopback address to listen on")
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

	recv := agent.NewReceiver(abs)
	recv.OnHello = func(d string) {
		fmt.Fprintf(os.Stderr, "townd: extension handshake from %s\n", d)
	}
	recv.OnGap = func(d string, lost int64) {
		fmt.Fprintf(os.Stderr, "townd: WARNING lost %d frame(s) from %s\n", lost, d)
	}
	recv.OnEvent = func(ev agent.UnifiedAgentEvent) {
		raw, err := json.Marshal(ev)
		if err != nil {
			fmt.Fprintf(os.Stderr, "townd: encode: %v\n", err)
			return
		}
		bus.Publish(raw)
		if !*quiet {
			_, _ = os.Stdout.Write(append(raw, '\n'))
		}
	}

	mux := http.NewServeMux()
	mux.Handle("/events", recv)                // extension -> daemon
	mux.Handle("/stream", bus.StreamHandler()) // daemon -> UI
	mux.Handle("/", web.Handler())             // the UI itself

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

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
}
