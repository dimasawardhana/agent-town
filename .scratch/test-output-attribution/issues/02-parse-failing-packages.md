# 02 — A failing test names the package that broke

**What to build:** Parse a `go test` result for its `FAIL <package>` lines and
carry those package paths on the event, so a whole-repo run can say which
building failed.

**Blocked by:** 01 (the output must arrive first).

**Status:** ready-for-agent

- [ ] A `go test` result with one failing package yields that package path
- [ ] A result with several failing packages yields all of them, in output order
- [ ] A passing result yields none
- [ ] A result whose text is not `go test` output yields none, and does not
      throw
- [ ] The paths are repo-relative after resolution, and a path that resolves to
      no building is dropped rather than filed in the Yard
- [ ] Verified against the real command: inject a failing test, run
      `go test ./...`, and confirm the damaged building is the one that failed

## Why

Measured output:

```
ok  	…/internal/agent	0.358s
--- FAIL: TestDeliberateWholeFailure (0.00s)
FAIL
FAIL	…/internal/analyzer	0.336s
ok  	…/internal/registry	0.015s
```

`FAIL\t<package>` is the attribution line, and it is the *only* line that names
the package. The bare `FAIL` above it carries no path.

## A trap the parser must not fall into

A `?` line is **not** a failure. Verified output from this repository:

```
?   	…/cmd/analyze	[no test files]
?   	…/cmd/townd	[no test files]
```

A package with no test files reports `?`, which is neither a pass nor a fail.
Matching it would damage every building that has no test file — which in this
repository is `cmd/analyze`, `cmd/townd` and `internal/agent/extension`.
Match `FAIL` only.

## The parser

Resolve by the second field of a `FAIL` line and nothing else:

```go
for _, line := range strings.Split(text, "\n") {
    fields := strings.Fields(line)
    if len(fields) >= 2 && fields[0] == "FAIL" {
        out = append(out, fields[1])
    }
}
```

Verified to work against both the plain and the `-race` form, which use the same
`FAIL\t<package>` line.

## Notes

Only `go test` is in scope. Verified that `node --test` emits `✖ name` with no
package path at all, so a parser for it is different work with different
evidence — and shipping a guess would damage buildings that did not break, which
is worse than the gap this closes.
