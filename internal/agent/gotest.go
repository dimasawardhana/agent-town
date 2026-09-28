package agent

// Which buildings a test run actually broke.
//
// A scoped run — `go test ./internal/town` — names its own directory, and the
// event's target already says which building that is. A **whole-repo** run names
// nothing: `go test ./...` targets the Yard, so a building that failed inside it
// is never marked and the damage lands nowhere. The output is the only place the
// answer exists, and it was being read and discarded.
//
// So this parses it. The design is bounded by one decision from the spec:
// **only `go test`**, because only `go test` prints a machine-readable package
// path. `node --test` prints a test name and no path at all, and a parser that
// guessed there would damage buildings that did not break. A missing attribution
// is an absence; a wrong one is a lie, and only one of those is survivable.

import "strings"

// VacuousMarker is what `go test -run` prints when it matched no tests at all.
//
// It matters more than it looks. The ladder's finishing ranks are gated on a
// *passing* test, so three runs that matched nothing would carry a building from
// `roofed` to `completed` while running no test whatsoever — the map claiming a
// finish that never happened.
const VacuousMarker = "[no tests to run]"

// TestRunResult is what one test run said, as far as the town can honestly read.
type TestRunResult struct {
	// Packages are the packages the runner reported as failing, in the order it
	// printed them. Empty for a pass, and empty for output this parser does not
	// understand — which is different from "everything passed", and the
	// difference is why the two are not the same field.
	Packages []string
	// Vacuous is whether the runner reported that it matched no tests.
	Vacuous bool
}

// ParseGoTest reads a `go test` result.
//
// The attribution line is `FAIL\t<package>` and it is the *only* line that names
// a package; the bare `FAIL` above it carries no path. Matching on the first
// field and taking the second is the whole parser, and matching anything looser
// is how a `?` line — which means "no test files", not "failed" — ends up
// damaging every building that has no test suite.
func ParseGoTest(text string) TestRunResult {
	out := TestRunResult{Vacuous: strings.Contains(text, VacuousMarker)}
	if text == "" {
		return out
	}
	for _, line := range strings.Split(text, "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 3 && fields[0] == "FAIL" && isDuration(fields[2]) {
			out.Packages = append(out.Packages, fields[1])
		}
	}
	return out
}

// isDuration is the guard that keeps this a **go test** parser rather than a
// parser that happens to start with `FAIL`.
//
// It was not in the spec and it is not optional. Vitest prints
//
//	FAIL  src/a.test.ts > suite > case
//
// which matches `FAIL <path>` exactly, and this parser would have read
// `src/a.test.ts` as a Go package and damaged whichever building owns that file —
// a TypeScript test failing on a Go-shaped claim. `go test` always ends an
// attribution with a duration (`FAIL	pkg	0.336s`) and vitest never does, so
// requiring one is what separates them.
//
// This is the same shape as the `?`-line trap the spec named, in a runner the
// spec had not measured, and it is why the refusal tests matter more than the
// happy path.
func isDuration(field string) bool {
	return len(field) > 1 && strings.HasSuffix(field, "s")
}
