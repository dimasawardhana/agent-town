package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/dimasajiwardhana/agent-town/internal/analyzer"
)

func main() {
	town, err := analyzer.Analyze(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}

	if len(os.Args) > 3 && os.Args[2] == "--resolve" {
		r := analyzer.NewResolver(town)
		for _, p := range os.Args[3:] {
			kind, place, reason := r.Resolve(p)
			loc := place
			if loc == "" {
				loc = "—"
			}
			fmt.Printf("  %-12s %-24s %-14s %s\n", kind, loc, reason, p)
		}
		return
	}
	if len(os.Args) > 2 && os.Args[2] == "--json" {
		b, _ := json.MarshalIndent(town, "", "  ")
		fmt.Println(string(b))
		return
	}
	fmt.Printf("TOWN %s\n  districts=%d buildings=%d\n", town.Name, len(town.Districts), len(town.Buildings))
	for _, d := range town.Districts {
		fmt.Printf("  [%s] %-7s %d buildings, %d files\n", d.Name, d.Kind, d.Buildings, d.Files)
	}
}
