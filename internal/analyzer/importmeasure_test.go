package analyzer

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestImportEdgesCollapseToFewerRoads(t *testing.T) {
	town, err := Analyze("../..")
	if err != nil {
		t.Fatal(err)
	}
	buildings := map[string]bool{}
	for _, b := range town.Buildings {
		buildings[filepath.ToSlash(b.Path)] = true
	}
	var same, cross, unresolvable, bare int
	byPair := map[string]int{}
	root := town.Root
	_ = filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		ext := filepath.Ext(p)
		if ext != ".ts" && ext != ".tsx" && ext != ".go" {
			return nil
		}
		if strings.Contains(p, "node_modules") {
			return nil
		}
		for _, spec := range importSpecifiers(p) {
			if !strings.HasPrefix(spec, ".") && !strings.HasPrefix(spec, "/") {
				bare++
				continue
			}
			rel, _ := filepath.Rel(root, p)
			from := buildingOf(filepath.ToSlash(rel), buildings)
			to := resolveImport(root, p, spec, buildings)
			switch {
			case to == "":
				unresolvable++
			case from == to || from == "":
				same++
			default:
				cross++
				byPair[from+" -> "+to]++
			}
		}
		return nil
	})
	keys := make([]string, 0, len(byPair))
	for k := range byPair {
		keys = append(keys, k)
	}
	t.Logf("same=%d cross=%d unresolvable=%d bare=%d roads=%d", same, cross, unresolvable, bare, len(byPair))
	// The claim this file exists to correct: that nine roads is small because
	// this repository has few buildings, so most imports resolve within one.
	//
	// Measured: 111 cross-building import *statements* collapse to 9 distinct
	// building pairs. The count is low because **the edge set is deduplicated**,
	// not because the imports are few. The original explanation had it backwards
	// and would have been repeated for as long as the number was quoted.
	if cross <= len(byPair) {
		t.Errorf("cross=%d statements collapsed to %d roads, so deduplication is the whole story and something else is wrong too", cross, len(byPair))
	}
	if unresolvable > 0 {
		t.Errorf("%d relative specifiers resolved to nothing; every one of those is a dependency the map cannot draw", unresolvable)
	}
	if len(byPair) == 0 {
		t.Error("no import roads on this repository")
	}
}
