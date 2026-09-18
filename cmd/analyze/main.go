// Command analyze turns a git repository into a town and prints it.
//
// It is the project analyzer on its own, with no daemon and no agent: useful
// for inspecting what a repo looks like as a town, and for resolving a path
// onto a Place the way the daemon will when an event arrives.
//
// Usage:
//
//	analyze --dir /path/to/project
//	analyze --dir /path/to/project --json
//	analyze --dir /path/to/project --resolve src/domain/x.ts
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/dimasajiwardhana/agent-town/internal/analyzer"
)

func main() {
	dir := flag.String("dir", ".", "project directory to analyze")
	asJSON := flag.Bool("json", false, "print the whole town as JSON")
	flag.Parse()

	town, err := analyzer.Analyze(*dir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "analyze: %v\n", err)
		os.Exit(1)
	}

	// Any remaining arguments are paths to resolve.
	if paths := flag.Args(); len(paths) > 0 {
		r := analyzer.NewResolver(town)
		for _, p := range paths {
			kind, place, reason := r.Resolve(p)
			if place == "" {
				place = "—"
			}
			fmt.Printf("  %-10s %-24s %-14s %s\n", kind, place, reason, p)
		}
		return
	}

	if *asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(town); err != nil {
			fmt.Fprintf(os.Stderr, "analyze: encode: %v\n", err)
			os.Exit(1)
		}
		return
	}

	fmt.Printf("TOWN %s\n  districts=%d buildings=%d\n",
		town.Name, len(town.Districts), len(town.Buildings))
	for _, d := range town.Districts {
		fmt.Printf("  [%s] %-7s %d buildings, %d files\n",
			d.Name, d.Kind, d.Buildings, d.Files)
	}
}
