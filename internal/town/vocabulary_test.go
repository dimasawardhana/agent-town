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

// TestEveryActionHasItsOwnAnimationInTheUI checks the renderer actually
// distinguishes each action, since a shared branch would satisfy the vocabulary
// test above while still drawing two actions identically.
//
// It reads the art layer's timing table rather than looking for a switch
// statement in the renderer, because that is where the distinction now lives:
// the renderer advances frames from a per-action, per-frame duration table, and
// an action missing from it would render frozen. Asserting the table also
// asserts the property that matters — that no two actions share a rhythm, which
// is what makes a hammer blow and a test sweep look different at a glance.
func TestEveryActionHasItsOwnAnimationInTheUI(t *testing.T) {
	uiPath := filepath.Join("..", "..", "ui", "src", "art", "worker.ts")
	src, err := os.ReadFile(uiPath)
	if err != nil {
		t.Skipf("cannot read %s: %v", uiPath, err)
	}
	text := string(src)

	// Pull the FRAME_MS entries: `reading: [420, 420, 420, 420],`
	block := regexp.MustCompile(`(?s)export const FRAME_MS[^{]*\{(.*?)\n\};`).FindStringSubmatch(text)
	if block == nil {
		t.Fatalf("could not find `export const FRAME_MS` in %s; the contract this test guards has moved", uiPath)
	}
	entry := regexp.MustCompile(`(\w+):\s*\[([0-9,\s]+)\]`)
	rhythms := map[string]string{}
	for _, m := range entry.FindAllStringSubmatch(block[1], -1) {
		rhythms[m[1]] = strings.Join(strings.Fields(m[2]), "")
	}

	for _, a := range AllActions() {
		if _, ok := rhythms[string(a)]; !ok {
			t.Errorf("action %q has no animation timing in %s; it would render frozen", a, uiPath)
		}
	}

	// Two actions sharing a rhythm is the failure the vocabulary test above
	// cannot see: the names match, every action animates, and the town still
	// draws a test run and a hammer blow the same way.
	seen := map[string]string{}
	for name, r := range rhythms {
		if prev, ok := seen[r]; ok {
			t.Errorf("actions %q and %q share the animation rhythm [%s]; "+
				"the town would draw them identically", prev, name, r)
		}
		seen[r] = name
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

// TestStatusLadderMatchesTheUI guards the cross-language contract for stages.
//
// The daemon names a stage as a string and the renderer picks a picture by it.
// The two lists cannot share a definition, so nothing but a test keeps them
// equal — and a stage the renderer does not know draws as whatever its fallback
// is, silently, which is the same class of failure the action vocabulary test
// above exists for.
//
// It also asserts the order, because the renderer's ladder is what decides how
// much of a building to draw: two lists holding the same names in different
// orders would build the wrong parts.
func TestStatusLadderMatchesTheUI(t *testing.T) {
	uiPath := filepath.Join("..", "..", "ui", "src", "art", "building.ts")
	src, err := os.ReadFile(uiPath)
	if err != nil {
		t.Skipf("cannot read %s: %v", uiPath, err)
	}
	text := string(src)

	block := regexp.MustCompile(`(?s)export const STAGE_ORDER[^=]*=\s*\[(.*?)\]`).FindStringSubmatch(text)
	if block == nil {
		t.Fatalf("could not find `export const STAGE_ORDER` in %s; the contract this test guards has moved", uiPath)
	}

	var ui []string
	for _, q := range regexp.MustCompile(`"(\w+)"`).FindAllStringSubmatch(block[1], -1) {
		ui = append(ui, q[1])
	}

	goLadder := AllStatuses()
	if len(ui) != len(goLadder) {
		t.Fatalf("UI ladder has %d ranks %v, daemon has %d %v", len(ui), ui, len(goLadder), goLadder)
	}
	for i, s := range goLadder {
		if ui[i] != string(s) {
			t.Errorf("rank %d: daemon says %q, renderer says %q; the ladders have drifted", i, s, ui[i])
		}
	}
}

// TestEveryStatusHasAPictureInTheUI checks each rank the daemon can report has
// somewhere to draw itself, rather than falling through to a default.
func TestEveryStatusHasAPictureInTheUI(t *testing.T) {
	uiPath := filepath.Join("..", "..", "ui", "src", "art", "building.ts")
	src, err := os.ReadFile(uiPath)
	if err != nil {
		t.Skipf("cannot read %s: %v", uiPath, err)
	}
	text := string(src)

	block := regexp.MustCompile(`(?s)const PART_FOR_STAGE[^=]*=\s*\{(.*?)\n\};`).FindStringSubmatch(text)
	if block == nil {
		t.Fatalf("could not find `PART_FOR_STAGE` in %s; every rank must name the part it adds", uiPath)
	}

	// Every rank must appear both as a key in PART_FOR_STAGE and as a draw guard
	// in a drawing function. Asserting only that the key exists would pass for a
	// part nothing draws, which is the same silent fallback wearing a different
	// hat.
	//
	// The guards are scanned from the storey compositor to the end of the file
	// rather than in one function, because a building is no longer composed by a
	// single `buildBuilding`: `storeyShell`, `buildBase` and `buildCap` each draw
	// the ranks they own, so a rank's picture legitimately lives in any of them.
	// What must not happen is a rank with no guard anywhere — that rank renders
	// as nothing, which is the silent fallback this test exists to catch.
	assigned := map[string]bool{}
	for _, m := range regexp.MustCompile(`(\w+):\s*"\w+"`).FindAllStringSubmatch(block[1], -1) {
		assigned[m[1]] = true
	}
	drawing := regexp.MustCompile(`(?s)function storeyShell.*`).FindString(text)
	if drawing == "" {
		t.Fatalf("could not find the storey compositor in %s; the drawing guards must live after it", uiPath)
	}
	guarded := map[string]bool{}
	for _, m := range regexp.MustCompile(`want >= stageRank\("(\w+)"\)`).FindAllStringSubmatch(drawing, -1) {
		guarded[m[1]] = true
	}

	for _, s := range AllStatuses() {
		if !assigned[string(s)] {
			t.Errorf("rank %q has no part in PART_FOR_STAGE (%s); it would draw as whatever the fallback is", s, uiPath)
		}
		if !guarded[string(s)] {
			t.Errorf("rank %q is never drawn by the compositor in %s; a rank the drawing loop skips has no picture", s, uiPath)
		}
	}
}
