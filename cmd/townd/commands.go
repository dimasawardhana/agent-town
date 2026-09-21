package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/dimasajiwardhana/agent-town/internal/agent/extension"
	"github.com/dimasajiwardhana/agent-town/internal/analyzer"
	"github.com/dimasajiwardhana/agent-town/internal/registry"
)

// runAdd registers a project.
//
// It analyzes before writing, so a path that cannot be a town is refused
// immediately rather than discovered as an empty map in the browser. That
// makes the registry a list of paths proven to work.
func runAdd(args []string) int {
	if len(args) != 1 {
		fmt.Fprintln(os.Stderr, "usage: townd add <path>")
		return 2
	}

	abs, err := filepath.Abs(args[0])
	if err != nil {
		fmt.Fprintf(os.Stderr, "townd: %v\n", err)
		return 1
	}
	info, err := os.Stat(abs)
	if err != nil {
		fmt.Fprintf(os.Stderr, "townd: cannot add %s: %v\n", abs, err)
		return 1
	}
	if !info.IsDir() {
		fmt.Fprintf(os.Stderr, "townd: cannot add %s: not a directory\n", abs)
		return 1
	}

	configPath := registry.ConfigPath()
	reg, err := registry.Load(configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "townd: could not read %s: %v\n", configPath, err)
		return 1
	}
	if reg.Get(abs) != nil {
		fmt.Fprintf(os.Stderr, "townd: already registered: %s\n", abs)
		return 1
	}

	// Add analyzes before returning, so a failure here means the path cannot be
	// a town. It refuses rather than registering something unusable.
	p, err := reg.Add(abs)
	if err != nil {
		fmt.Fprintf(os.Stderr, "townd: cannot analyze %s: %v\n", abs, err)
		return 1
	}
	if err := p.AnalysisError(); err != nil {
		fmt.Fprintf(os.Stderr, "townd: cannot analyze %s: %v\n", abs, err)
		return 1
	}

	// Guarded rather than assumed: the crash this replaced was a dereference
	// of Static() justified by an AnalysisError() check that did not hold.
	t := p.Static()
	if t == nil {
		fmt.Fprintf(os.Stderr, "townd: %s analyzed but produced no map\n", abs)
		return 1
	}

	if err := reg.Save(configPath); err != nil {
		fmt.Fprintf(os.Stderr, "townd: could not write %s: %v\n", configPath, err)
		return 1
	}

	fmt.Printf("added %s — %d buildings, %d districts\n", abs, len(t.Buildings), len(t.Districts))
	fmt.Printf("config: %s\n", configPath)
	return 0
}

// runRemove unregisters a project.
//
// Removing one that is not registered reports that rather than succeeding
// quietly, so a typo does not look like it worked.
func runRemove(args []string) int {
	if len(args) != 1 {
		fmt.Fprintln(os.Stderr, "usage: townd rm <path>")
		return 2
	}

	abs, err := filepath.Abs(args[0])
	if err != nil {
		fmt.Fprintf(os.Stderr, "townd: %v\n", err)
		return 1
	}

	configPath := registry.ConfigPath()
	reg, err := registry.Load(configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "townd: could not read %s: %v\n", configPath, err)
		return 1
	}
	if !reg.Remove(abs) {
		fmt.Fprintf(os.Stderr, "townd: not registered: %s\n", abs)
		return 1
	}
	if err := reg.Save(configPath); err != nil {
		fmt.Fprintf(os.Stderr, "townd: could not write %s: %v\n", configPath, err)
		return 1
	}

	fmt.Printf("removed %s\n", abs)
	return 0
}

// runList prints the registry and what each project amounts to.
//
// It analyzes each project rather than only listing paths, because "is this
// registered and is it any good" is the question `ls` answers, and a path
// alone cannot answer the second half. The daemon defers analysis so it can
// start immediately; an explicit request for the list is not that case.
func runList(args []string) int {
	fs := flag.NewFlagSet("townd ls", flag.ContinueOnError)
	maxFiles := fs.Int("max-files", analyzer.DefaultMaxFiles,
		"stop analyzing after this many source files (0 = unbounded)")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "usage: townd ls [--max-files <n>]")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return 2
	}

	configPath := registry.ConfigPath()
	// The same budget the daemon would use, so a project reported as PARTIAL
	// here is PARTIAL there. A different budget would let ls disagree with
	// what the daemon actually builds.
	reg, err := registry.LoadBounded(configPath, *maxFiles)
	if err != nil {
		fmt.Fprintf(os.Stderr, "townd: could not read %s: %v\n", configPath, err)
		return 1
	}
	if reg.Len() == 0 {
		fmt.Println("no projects registered")
		fmt.Println("add one with: townd add <path>")
		return 0
	}
	for _, p := range reg.Projects() {
		describe(os.Stdout, p, *maxFiles)
	}
	fmt.Printf("\nconfig: %s\n", configPath)
	return 0
}

// describe prints one project's line, analyzing it if that has not happened.
//
// It never dereferences an absent map: a project that has not been analyzed and
// one whose analysis failed are different states with different remedies, and
// conflating them is what crashed this command on a freshly registered project.
func describe(w io.Writer, p *registry.Project, maxFiles int) {
	if !p.Analyzed() {
		// Build the map so the line can report real counts.
		p.Analyze(maxFiles)
	}

	if err := p.AnalysisError(); err != nil {
		fmt.Fprintf(w, "%s — %s: %v\n", p.Path(), p.State(), err)
		return
	}

	t := p.Static()
	if t == nil {
		// Unreachable while Analyzed() and Static() agree, but the whole
		// crash being fixed here was an assumption that they do.
		fmt.Fprintf(w, "%s — %s\n", p.Path(), p.State())
		return
	}
	if t.Partial {
		fmt.Fprintf(w, "%s — %d buildings, PARTIAL (stopped after %d files)\n",
			p.Path(), len(t.Buildings), t.FilesSeen)
		return
	}
	fmt.Fprintf(w, "%s — %d buildings, %d districts\n", p.Path(), len(t.Buildings), len(t.Districts))
}

// runInstall copies the extension into an agent's extension directory.
//
// It exists so installation is one command rather than a mkdir and a cp from a
// source checkout, and it reports what it wrote so the result is verifiable
// rather than assumed.
func runInstall(args []string) int {
	fs := flag.NewFlagSet("townd install", flag.ContinueOnError)
	project := fs.String("project", "", "install into this project instead of globally (default: global)")
	force := fs.Bool("force", false, "replace an existing extension")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "usage: townd install [--project <path>] [--force]")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return 2
	}

	dir := ""
	if *project == "" {
		dir = extension.GlobalDir()
		if dir == "" {
			fmt.Fprintln(os.Stderr, "townd: cannot determine your home directory")
			return 1
		}
	} else {
		abs, err := filepath.Abs(*project)
		if err != nil {
			fmt.Fprintf(os.Stderr, "townd: %v\n", err)
			return 1
		}
		dir = extension.ProjectDir(abs)
	}

	path, err := extension.Write(dir, *force)
	switch {
	case errors.Is(err, os.ErrExist):
		fmt.Fprintf(os.Stderr, "townd: %s already exists; refusing to overwrite it\n", path)
		fmt.Fprintln(os.Stderr, "townd: pass --force to replace it, or edit it in place")
		return 1
	case err != nil:
		fmt.Fprintf(os.Stderr, "townd: could not install: %v\n", err)
		return 1
	}

	fmt.Printf("installed %s\n", path)
	fmt.Println()
	fmt.Println("to undo:")
	fmt.Printf("  rm %s\n", path)
	fmt.Println()
	fmt.Println("the extension finds the daemon on its default port; set AI_TOWN_URL")
	fmt.Println("to point it at a daemon listening elsewhere")
	return 0
}
