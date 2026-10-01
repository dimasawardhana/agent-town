package agent

// The parser's most important test is the one about what it *refuses* to read.
// A `go test` result contains a line that looks like a failure and is not, and
// matching it would damage every building that has no test file.

import "testing"

const realGoFailure = `ok  	github.com/x/internal/agent	0.358s
--- FAIL: TestDeliberateWholeFailure (0.00s)
    something_test.go:12: expected 1, got 2
FAIL
FAIL	github.com/x/internal/analyzer	0.336s
ok  	github.com/x/internal/registry	0.015s
`

func TestGoTestNamesTheFailingPackage(t *testing.T) {
	got := ParseGoTest(realGoFailure)
	if len(got.Packages) != 1 {
		t.Fatalf("packages = %v, want exactly one", got.Packages)
	}
	if got.Packages[0] != "github.com/x/internal/analyzer" {
		t.Errorf("package = %q", got.Packages[0])
	}
	if got.Vacuous {
		t.Error("a run with a real failure is not vacuous")
	}
}

func TestGoTestNamesEveryFailingPackageInOutputOrder(t *testing.T) {
	got := ParseGoTest("FAIL\ta/b\t0.1s\nFAIL\ta/c\t0.2s\nFAIL\ta/d\t0.3s\n")
	want := []string{"a/b", "a/c", "a/d"}
	if len(got.Packages) != len(want) {
		t.Fatalf("packages = %v, want %v", got.Packages, want)
	}
	for i := range want {
		if got.Packages[i] != want[i] {
			t.Errorf("package %d = %q, want %q", i, got.Packages[i], want[i])
		}
	}
}

func TestGoTestAPassYieldsNoPackages(t *testing.T) {
	got := ParseGoTest("ok  \ta/b\t0.1s\nok  \ta/c\t0.2s\nPASS\n")
	if len(got.Packages) != 0 {
		t.Errorf("a passing run reported %v as failing", got.Packages)
	}
}

// The trap. A `?` line means "this package has no test files", which is neither a
// pass nor a failure. Matching it would damage `cmd/analyze`, `cmd/townd` and
// `internal/agent/extension` in this repository — three buildings that did not
// break.
func TestGoTestDoesNotReadAQuestionMarkLineAsAFailure(t *testing.T) {
	got := ParseGoTest("?   \tgithub.com/x/cmd/analyze\t[no test files]\n" +
		"?   \tgithub.com/x/cmd/townd\t[no test files]\n" +
		"ok  \tgithub.com/x/internal/agent\t0.1s\n")
	if len(got.Packages) != 0 {
		t.Errorf("packages with no test files were reported as failing: %v", got.Packages)
	}
}

// Output from a runner this parser does not understand must yield nothing rather
// than a guess. `node --test` prints no package path at all.
func TestForeignOutputYieldsNothingAndDoesNotThrow(t *testing.T) {
	for name, text := range map[string]string{
		"node":   "X deliberate (1.404551ms)\nX failing tests:\n",
		"vitest": " FAIL  src/a.test.ts > suite > case\nAssertionError: expected 1 to be 2\n",
		"empty":  "",
		"junk":   "not a test run at all",
	} {
		t.Run(name, func(t *testing.T) {
			if got := ParseGoTest(text); len(got.Packages) != 0 {
				t.Errorf("read %v out of %s output", got.Packages, name)
			}
		})
	}
}

// A bare `FAIL` with no path is the summary line, not an attribution. Reading it
// would file a failure against a package literally named "FAIL".
func TestABareFailLineNamesNoPackage(t *testing.T) {
	if got := ParseGoTest("--- FAIL: TestThing (0.00s)\nFAIL\n"); len(got.Packages) != 0 {
		t.Errorf("the summary FAIL line was read as an attribution: %v", got.Packages)
	}
}

func TestAVacuousRunIsDetected(t *testing.T) {
	got := ParseGoTest("ok  \tgithub.com/x/internal/analyzer\t0.002s [no tests to run]\n")
	if !got.Vacuous {
		t.Error("a run that matched no tests was not detected as vacuous")
	}
	if len(got.Packages) != 0 {
		t.Errorf("a vacuous run reported failures: %v", got.Packages)
	}
	// And a real run is not vacuous.
	if ParseGoTest(realGoFailure).Vacuous {
		t.Error("a real failure was reported as vacuous")
	}
}

// The `-race` form uses the same attribution line, so it must parse identically.
func TestTheRaceFormParsesTheSame(t *testing.T) {
	plain := ParseGoTest("FAIL\ta/b\t0.336s\n")
	raced := ParseGoTest("FAIL\ta/b\t0.336s\nexit status 1\n")
	if len(plain.Packages) != 1 || len(raced.Packages) != 1 || plain.Packages[0] != raced.Packages[0] {
		t.Errorf("plain %v vs race %v", plain.Packages, raced.Packages)
	}
}
