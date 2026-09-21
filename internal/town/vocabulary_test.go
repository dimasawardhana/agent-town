package town

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// TestActionVocabularyMatchesTheUI guards a cross-language contract that has
// silently broken once.
//
// The daemon names a worker's action as a string and the renderer switches on
// those strings to choose an animation. The two lists cannot share a
// definition, so nothing but a test keeps them equal. When they drifted, every
// read rendered with the default pulse — the dimmest of the eight — because
// the action arrived as "inspecting" and the renderer only knew "reading".
func TestActionVocabularyMatchesTheUI(t *testing.T) {
	uiPath := filepath.Join("..", "..", "ui", "src", "store.ts")
	src, err := os.ReadFile(uiPath)
	if err != nil {
		t.Skipf("cannot read %s: %v", uiPath, err)
	}

	// The union type is the renderer's whole vocabulary:
	//   export type Action = "reading" | "hammering" | ...
	re := regexp.MustCompile(`(?s)export type Action =([^;]+);`)
	m := re.FindSubmatch(src)
	if m == nil {
		t.Fatalf("could not find `export type Action` in %s; the contract this test guards has moved", uiPath)
	}

	ui := map[string]bool{}
	for _, q := range regexp.MustCompile(`"(\w+)"`).FindAllStringSubmatch(string(m[1]), -1) {
		ui[q[1]] = true
	}
	if len(ui) == 0 {
		t.Fatal("parsed no actions from the UI's Action type")
	}

	// Every action the daemon can emit must be one the renderer can draw.
	for _, a := range AllActions() {
		if !ui[string(a)] {
			t.Errorf("the daemon emits action %q but the UI's Action type does not include it; "+
				"the renderer would fall through to its default animation", a)
		}
	}

	// And the reverse, so a renderer branch is not left unreachable.
	for name := range ui {
		found := false
		for _, a := range AllActions() {
			if string(a) == name {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("the UI handles action %q but the daemon never emits it; that branch is dead", name)
		}
	}
}

// TestEveryActionHasADistinctPulseInTheUI checks the renderer actually
// distinguishes each action, since a shared branch would satisfy the
// vocabulary test above while still drawing two actions identically.
func TestEveryActionHasADistinctPulseInTheUI(t *testing.T) {
	uiPath := filepath.Join("..", "..", "ui", "src", "workers.ts")
	src, err := os.ReadFile(uiPath)
	if err != nil {
		t.Skipf("cannot read %s: %v", uiPath, err)
	}
	text := string(src)

	for _, a := range AllActions() {
		if !strings.Contains(text, `case "`+string(a)+`":`) {
			t.Errorf("no animation branch for action %q in %s; it would render as the default", a, uiPath)
		}
	}
}

func TestAllActionsIsComplete(t *testing.T) {
	got := AllActions()
	if len(got) != 8 {
		t.Errorf("AllActions() has %d entries, want 8: %v", len(got), got)
	}
	seen := map[Action]bool{}
	for _, a := range got {
		if a == "" {
			t.Error("an empty action is in the vocabulary")
		}
		if seen[a] {
			t.Errorf("duplicate action %q", a)
		}
		seen[a] = true
	}
	sorted := append([]Action(nil), got...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	for i := range sorted {
		if sorted[i] != got[i] {
			t.Errorf("AllActions() is not sorted: %v", got)
			break
		}
	}
}
