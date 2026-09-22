# 04 — A test run that ran nothing must not finish a building

**What to build:** Suppress the finish-advance when the runner reports it matched
no tests. Today three vacuous runs take a building from `roofed` to `completed`.

**Blocked by:** 01 (the output must arrive first).

**Status:** ready-for-agent

- [ ] A result containing `[no tests to run]` sets `NoTests` on the event
- [ ] A `NoTests` test event does **not** advance the finish ranks, at any rank
- [ ] A `NoTests` event still counts as a success for repair: a damaged building
      whose vacuous run passes is repaired, because the command did succeed
- [ ] A genuine passing run still advances exactly one rank
- [ ] Verified end to end: three `go test -run TestThatDoesNotExist ./pkg` runs
      leave a `roofed` building at `roofed`, not `completed`

## Why

This is a credibility defect, not a cosmetic one. The ladder's finish ranks are
gated on *passing tests*, and the mechanism that reaches `completed` is exactly
three passing runs. Verified:

```
$ go test -run TestNoSuchTest ./internal/analyzer
ok  	…/internal/analyzer	0.002s [no tests to run]
$ echo $?
0
```

Exit code 0, no tests executed, and today that counts as a pass. Three of them
complete a building. So `completed` can currently mean "a command exited zero",
which is the opposite of what the rank claims.

## Notes

The marker is `[no tests to run]`, which `go test` emits when its filter matches
nothing. Verified against this repository — and it is emitted **only** for a
scoped run whose `-run` filter matched nothing, not by a whole-repo pass:

```
$ go test -run TestZZZNoSuch ./internal/analyzer
ok  	…/internal/analyzer	0.002s [no tests to run]

$ go test ./...
(no occurrence of the marker anywhere in the output)
```

That narrows the fix usefully: the vacuous-run hole is reachable through a
*scoped* command, which is also the only form that carries a building. A
whole-repo run cannot hit it, so the wildcard case does not need handling.

Distinguish it from `?   <pkg> [no test files]`, which is a *package* with no
test file rather than a *run* that matched no tests. Verified both strings exist
in this repository's output and they mean different things:

```
?   	…/cmd/townd	[no test files]
```

A `?` line is not a test result at all, so ticket 02's parser ignores it — and
this ticket has nothing to suppress for it either.

The repair path must keep working: a vacuous success is still a success for
clearing `damaged`. Only the *advance* is suppressed. Getting that backwards
would make a vacuous run damage a building, which is worse than the bug being
fixed.
