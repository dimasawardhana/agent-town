package analyzer

import (
	"os"
	"path/filepath"
	"testing"
)

// tree writes n source files spread across a few directories, so a budget can
// be observed to cut the walk short.
func fileTree(t *testing.T, n int) string {
	t.Helper()
	root := t.TempDir()
	for i := range n {
		dir := filepath.Join(root, "pkg", string(rune('a'+i%5)))
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		name := filepath.Join(dir, "f"+string(rune('a'+i%26))+digits(i)+".go")
		if err := os.WriteFile(name, []byte("package x\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func digits(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}

func TestBudgetUnderTheLimitIsNotPartial(t *testing.T) {
	root := fileTree(t, 20)
	tw, err := AnalyzeBounded(root, 100)
	if err != nil {
		t.Fatal(err)
	}
	if tw.Partial {
		t.Errorf("Partial = true for a tree of 20 files under a budget of 100")
	}
	if tw.FilesSeen != 0 || tw.MaxFiles != 0 {
		t.Errorf("truncation reported on an untruncated town: seen=%d max=%d", tw.FilesSeen, tw.MaxFiles)
	}
}

func TestBudgetStopsTheWalkAndSaysSo(t *testing.T) {
	root := fileTree(t, 60)
	tw, err := AnalyzeBounded(root, 10)
	if err != nil {
		t.Fatal(err)
	}
	if !tw.Partial {
		t.Error("Partial = false after the walk hit its budget; a partial town must say so")
	}
	if tw.FilesSeen != 10 {
		t.Errorf("FilesSeen = %d, want 10", tw.FilesSeen)
	}
	if tw.MaxFiles != 10 {
		t.Errorf("MaxFiles = %d, want 10", tw.MaxFiles)
	}
	if len(tw.Buildings) == 0 {
		t.Error("no buildings from the first 10 files; the budget must still yield a town")
	}
}

// TestBudgetIsDeterministic is what makes the bound safe to ship: ADR-0012
// requires the same tree to yield the same town, and a budget that cut
// differently on each run would break that.
func TestBudgetIsDeterministic(t *testing.T) {
	root := fileTree(t, 60)

	var first []string
	for range 5 {
		tw, err := AnalyzeBounded(root, 7)
		if err != nil {
			t.Fatal(err)
		}
		names := make([]string, 0, len(tw.Buildings))
		for _, b := range tw.Buildings {
			names = append(names, b.Path)
		}
		if first == nil {
			first = names
			continue
		}
		if len(names) != len(first) {
			t.Fatalf("building count varies between runs: %d vs %d", len(names), len(first))
		}
		for i := range names {
			if names[i] != first[i] {
				t.Fatalf("building %d differs between runs: %q vs %q", i, names[i], first[i])
			}
		}
	}
}

// TestUnboundedBudgetVisitsEverything keeps the escape hatch honest.
func TestUnboundedBudgetVisitsEverything(t *testing.T) {
	root := fileTree(t, 60)

	bounded, err := AnalyzeBounded(root, 10)
	if err != nil {
		t.Fatal(err)
	}
	unbounded, err := AnalyzeBounded(root, 0)
	if err != nil {
		t.Fatal(err)
	}
	if unbounded.Partial {
		t.Error("a zero budget reported Partial; it means unbounded")
	}
	if len(unbounded.Buildings) < len(bounded.Buildings) {
		t.Errorf("unbounded analysis found fewer buildings (%d) than bounded (%d)",
			len(unbounded.Buildings), len(bounded.Buildings))
	}
}

// TestDefaultBudgetLeavesAnOrdinaryRepositoryWhole checks the default does not
// truncate real projects — the whole point of choosing 2000.
func TestDefaultBudgetLeavesAnOrdinaryRepositoryWhole(t *testing.T) {
	root := t.TempDir()
	for i := range 120 {
		dir := filepath.Join(root, "internal", "pkg"+digits(i%8))
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "f"+digits(i)+".go"), []byte("package x\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	tw, err := Analyze(root)
	if err != nil {
		t.Fatal(err)
	}
	if tw.Partial {
		t.Errorf("a 120-file repository was truncated by the default budget of %d", DefaultMaxFiles)
	}
}

// TestBudgetExactBoundaryIsNotPartial guards a bug that shipped briefly: a
// tree holding exactly as many files as the budget reported itself truncated
// when nothing had been omitted. The walk stopping is not the same as the tree
// ending, and only the second is a partial town.
func TestBudgetExactBoundaryIsNotPartial(t *testing.T) {
	cases := []struct {
		files     int
		budget    int
		wantPart  bool
		wantSeen  int
		reasoning string
	}{
		{4, 5, false, 0, "fewer files than the budget: the tree simply ended"},
		{5, 5, false, 0, "exactly the budget: the tree still ended, nothing omitted"},
		{6, 5, true, 5, "more files than the budget: genuinely cut off"},
	}
	for _, c := range cases {
		root := t.TempDir()
		sub := filepath.Join(root, "pkg")
		if err := os.MkdirAll(sub, 0o755); err != nil {
			t.Fatal(err)
		}
		for i := range c.files {
			name := filepath.Join(sub, "f"+digits(i)+".go")
			if err := os.WriteFile(name, []byte("package x\n"), 0o644); err != nil {
				t.Fatal(err)
			}
		}

		tw, err := AnalyzeBounded(root, c.budget)
		if err != nil {
			t.Fatal(err)
		}
		if tw.Partial != c.wantPart {
			t.Errorf("%d files with budget %d: Partial = %v, want %v (%s)",
				c.files, c.budget, tw.Partial, c.wantPart, c.reasoning)
		}
		if tw.FilesSeen != c.wantSeen {
			t.Errorf("%d files with budget %d: FilesSeen = %d, want %d",
				c.files, c.budget, tw.FilesSeen, c.wantSeen)
		}
	}
}
