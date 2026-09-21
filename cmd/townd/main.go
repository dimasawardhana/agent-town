// Command townd is the AI Town daemon.
//
// It receives frames from an AI Town extension running inside an agent
// process, normalizes them into agent-agnostic events, and serves the UI that
// visualizes them.
//
// One process serves the UI, every town, and the event stream (ADR-0013,
// ADR-0014): the UI comes from an embedded filesystem, events arrive over
// Server-Sent Events, and the projects it serves come from a registry, so
// there is no CORS, no second server, and no restart to change which town you
// are looking at.
//
// Usage:
//
//	townd                     # serve the registered projects
//	townd --dir ~/code/thing  # also serve this one, for this run only
//	townd add ~/code/thing    # register a project
//	townd install             # install the agent extension
//
// It prints AI_TOWN_URL on stdout so a caller can export it before starting
// an agent, and prints the UI address on stderr.
package main

import (
	"context"
	"encoding/json"
	"errors"
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
	"github.com/dimasajiwardhana/agent-town/internal/registry"
	"github.com/dimasajiwardhana/agent-town/internal/web"
)

// defaultPort is fixed so the extension can find the daemon without being
// told where it is (ADR-0016). 7777 rather than the more obvious 7000 because
// 7000 collides with macOS AirPlay.
const defaultPort = 7777

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "add":
			os.Exit(runAdd(os.Args[2:]))
		case "rm":
			os.Exit(runRemove(os.Args[2:]))
		case "ls":
			os.Exit(runList(os.Args[2:]))
		case "install":
			os.Exit(runInstall(os.Args[2:]))
		}
	}
	os.Exit(runDaemon(os.Args[1:]))
}

// runDaemon serves every registered project until interrupted.
func runDaemon(args []string) int {
	fs := flag.NewFlagSet("townd", flag.ContinueOnError)
	var dirs dirFlag
	fs.Var(&dirs, "dir", "project directory to serve for this run only (repeatable)")
	addr := fs.String("addr", fmt.Sprintf("127.0.0.1:%d", defaultPort), "loopback address to listen on")
	port := fs.Int("port", 0, "loopback port to listen on (overrides the port in --addr)")
	maxFiles := fs.Int("max-files", analyzer.DefaultMaxFiles, "stop analyzing after this many source files (0 = unbounded)")
	quiet := fs.Bool("quiet", false, "do not print events to stdout")
	fs.Usage = func() {
		fmt.Fprint(os.Stderr, "usage: townd [flags] | townd add <path> | townd rm <path> | townd install\n\n")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return 2
	}

	// --port is the readable form of the common case; --addr still wins for a
	// full address, so specifying both is a mistake worth naming.
	listen := *addr
	if *port != 0 {
		if fs.Lookup("addr").Value.String() != fmt.Sprintf("127.0.0.1:%d", defaultPort) {
			fmt.Fprintln(os.Stderr, "townd: --port and --addr both set; use one")
			return 2
		}
		listen = fmt.Sprintf("127.0.0.1:%d", *port)
	}

	configPath := registry.ConfigPath()
	reg, err := registry.LoadBounded(configPath, *maxFiles)
	if err != nil {
		fmt.Fprintf(os.Stderr, "townd: could not read %s: %v\n", configPath, err)
		return 1
	}

	// --dir adds projects for this run without persisting them, so a script or
	// a one-off debugging session does not permanently alter the registry.
	for _, d := range dirs {
		if _, err := reg.Add(d); err != nil {
			fmt.Fprintf(os.Stderr, "townd: cannot serve %s: %v\n", d, err)
			return 1
		}
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	bus := agent.NewBroadcaster()

	// Frames are routed to the project that owns their directory. A rejected
	// frame is refused so a globally-installed extension stops forwarding an
	// unrelated project's activity.
	recv := agent.NewReceiver()
	recv.OnOwner = func(dir string) bool { return reg.Owner(dir) != nil }
	recv.OnHello = func(d string) {
		fmt.Fprintf(os.Stderr, "townd: extension handshake from %s\n", d)
	}
	recv.OnSessionEnd = func(directory, session string) {
		p := reg.Owner(directory)
		if p == nil {
			return
		}
		if snap, ok := p.EndSession(session); ok {
			publishTown(bus, p, snap)
		}
		reportSaveError(p)
		fmt.Fprintf(os.Stderr, "townd: session ended %s\n", session)
	}
	recv.OnGap = func(d string, lost int64) {
		fmt.Fprintf(os.Stderr, "townd: WARNING lost %d frame(s) from %s\n", lost, d)
	}
	recv.OnDrop = func(d string, lost int64) {
		fmt.Fprintf(os.Stderr, "townd: WARNING extension queue overflowed, %d frame(s) dropped from %s\n", lost, d)
	}
	recv.OnEvent = func(directory string, ev agent.UnifiedAgentEvent) {
		raw, err := json.Marshal(ev)
		if err != nil {
			fmt.Fprintf(os.Stderr, "townd: encode: %v\n", err)
			return
		}
		if !*quiet {
			_, _ = os.Stdout.Write(append(raw, '\n'))
		}

		p := reg.Owner(directory)
		if p == nil {
			return
		}
		// The UI wants the resulting town, not the raw event: the movement of
		// a worker is the product, and recomputing it client-side would make
		// the browser a second authority on where things are.
		if snap, ok := p.Apply(ev); ok {
			publishTown(bus, p, snap)
			reportSaveError(p)
			return
		}
		// No map yet, so there is nowhere to stand a worker. The raw event
		// still travels so the UI can show that work is arriving.
		bus.Publish(p.Path(), raw)
	}

	mux := http.NewServeMux()
	mux.Handle("/events", recv)
	mux.Handle("/stream", bus.StreamHandler())
	mux.HandleFunc("/api/town", func(w http.ResponseWriter, r *http.Request) {
		// Viewing a project builds its map if it does not have one yet. The
		// work is deferred to this point rather than done at startup so a
		// daemon with many projects opens immediately, and so the developer
		// waits only for the project they actually asked for.
		if name := r.URL.Query().Get("project"); name != "" {
			if p := reg.Get(name); p != nil && !p.Analyzed() {
				if snap, ok, dropped := p.Analyze(*maxFiles); ok {
					publishTown(bus, p, snap)
					if dropped > 0 {
						fmt.Fprintf(os.Stderr, "townd: %s: %d events dropped before analysis\n", p.Path(), dropped)
					}
					reportSaveError(p)
				}
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(townResponse(reg, r.URL.Query().Get("project")))
	})
	mux.HandleFunc("/api/projects", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(projectsResponse(reg))
	})
	mux.Handle("/", web.Handler())

	if err := requireLoopback(listen); err != nil {
		fmt.Fprintf(os.Stderr, "townd: %v\n", err)
		return 1
	}

	ln, err := net.Listen("tcp", listen)
	if err != nil {
		// A fixed port makes collisions routine, so this is a first-class
		// outcome rather than an edge case. Silent fallback to another port is
		// the trap to avoid: the extension posts to a fixed address, so a
		// daemon that quietly moved would receive nothing and the town would
		// look broken with no error anywhere.
		fmt.Fprintf(os.Stderr, "townd: cannot listen on %s: %v\n", listen, err)
		fmt.Fprintf(os.Stderr, "townd: another daemon is probably already running\n")
		fmt.Fprintf(os.Stderr, "townd: use --port <n> to listen elsewhere, or stop the other one\n")
		return 1
	}

	srv := &http.Server{Handler: web.Guard(mux)}
	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			fmt.Fprintf(os.Stderr, "townd: serve: %v\n", err)
		}
	}()

	url := fmt.Sprintf("http://%s", ln.Addr().String())
	fmt.Printf("AI_TOWN_URL=%s\n", url)
	describeProjects(os.Stderr, reg)
	fmt.Fprintf(os.Stderr, "townd: open %s\n", url)
	fmt.Fprintln(os.Stderr)
	fmt.Fprintln(os.Stderr, "townd: start an agent with this URL, or run 'townd install' to set up")
	fmt.Fprintln(os.Stderr, "townd: the extension so it finds this daemon without configuration")

	<-ctx.Done()
	fmt.Fprintln(os.Stderr, "townd: shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
	return 0
}

// publishTown sends a project's snapshot to the clients viewing that project.
//
// Scoping matters once a daemon serves several towns (ADR-0014): a client
// viewing one must never be handed another's snapshot, which would redraw the
// wrong town.
func publishTown(bus *agent.Broadcaster, p *registry.Project, snap any) {
	raw, err := json.Marshal(snap)
	if err != nil {
		return
	}
	bus.Publish(p.Path(), raw)
}

// reportSaveError surfaces a persistence failure once per occurrence.
//
// It is reported rather than fatal: the town in memory is still correct, and
// a failed save costs history on the next start rather than correctness now.
func reportSaveError(p *registry.Project) {
	if err := p.SaveError(); err != nil {
		fmt.Fprintf(os.Stderr, "townd: could not save %s: %v\n", p.Path(), err)
	}
	p.ClearSaveError()
}

// townResponse builds the payload for one project, or for all of them.
func townResponse(reg *registry.Registry, project string) map[string]any {
	if project != "" {
		p := reg.Get(project)
		if p == nil {
			return map[string]any{"error": "no such project"}
		}
		return projectPayload(p)
	}
	// No project named: report every one, so a client can draw any of them
	// without a second round trip.
	out := map[string]any{"projects": map[string]any{}}
	projects := map[string]any{}
	for _, p := range reg.Projects() {
		projects[p.Path()] = projectPayload(p)
	}
	out["projects"] = projects
	return out
}

// projectPayload is one project's map, layout and live state.
func projectPayload(p *registry.Project) map[string]any {
	resp := map[string]any{
		"path":     p.Path(),
		"analyzed": p.Analyzed(),
		"state":    p.State(),
		"pending":  p.Pending(),
	}
	if d := p.Dropped(); d > 0 {
		resp["dropped"] = d
	}
	if err := p.AnalysisError(); err != nil {
		resp["error"] = err.Error()
	}
	resp["town"] = p.Static()
	resp["layout"] = p.Layout()
	// The live state travels with the map so a client that reconnects draws
	// the current town rather than an empty one. Events missed during the gap
	// are not replayed; the snapshot is the authority.
	if snap, ok := p.Snapshot(); ok {
		resp["live"] = snap
	}
	return resp
}

// projectsResponse lists the registry, which is what the switcher draws.
func projectsResponse(reg *registry.Registry) map[string]any {
	out := make([]map[string]any, 0, reg.Len())
	for _, p := range reg.Projects() {
		entry := map[string]any{
			"path":     p.Path(),
			"name":     filepath.Base(p.Path()),
			"analyzed": p.Analyzed(),
			"state":    p.State(),
		}
		if err := p.AnalysisError(); err != nil {
			entry["error"] = err.Error()
		}
		out = append(out, entry)
	}
	return map[string]any{"projects": out}
}

// describeProjects prints what the daemon is serving.
//
// It is printed rather than left implicit because a daemon serving a registry
// with an empty one is easy to mistake for a broken daemon.
func describeProjects(w *os.File, reg *registry.Registry) {
	if reg.Len() == 0 {
		fmt.Fprintln(w, "townd: no projects registered — run 'townd add <path>' to add one")
		return
	}
	// Projects are registered, not analyzed, at startup: a daemon serving many
	// projects must answer immediately rather than walking every tree first.
	// So most lines here say only the path, and a count appears once a project
	// has been opened. A deferred analysis is the normal case, not a fault, so
	// it is reported as pending rather than as an error.
	fmt.Fprintf(w, "townd: serving %d project(s):\n", reg.Len())
	for _, p := range reg.Projects() {
		// Checked before the error, because "not analyzed yet" is an error
		// value but is not a problem: it is what every project looks like
		// until someone views it.
		if !p.Analyzed() {
			if errors.Is(p.AnalysisError(), registry.ErrNotAnalyzed) {
				fmt.Fprintf(w, "townd:   %s\n", p.Path())
				continue
			}
			if err := p.AnalysisError(); err != nil {
				fmt.Fprintf(w, "townd:   %s (cannot read: %v)\n", p.Path(), err)
				continue
			}
		}

		t := p.Static()
		if t == nil {
			fmt.Fprintf(w, "townd:   %s\n", p.Path())
			continue
		}
		if t.Partial {
			fmt.Fprintf(w, "townd:   %s (%d buildings, PARTIAL — stopped after %d files)\n",
				p.Path(), len(t.Buildings), t.FilesSeen)
			continue
		}
		fmt.Fprintf(w, "townd:   %s (%d buildings)\n", p.Path(), len(t.Buildings))
	}
}

// dirFlag collects repeated --dir flags.
type dirFlag []string

func (d *dirFlag) String() string { return fmt.Sprint([]string(*d)) }

func (d *dirFlag) Set(v string) error {
	*d = append(*d, v)
	return nil
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
