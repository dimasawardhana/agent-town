# Spec: a failing test names the building that broke

**Status:** ready-for-agent
**Effort:** `test-output-attribution`
**Depends on:** nothing. Independent of the building-floors plan.

## The gap

Today a test run's *building* comes from the command string alone. A scoped run
names its directory and is credited to that building, which works. But:

- A **whole-repo** run (`go test ./...`) names no single directory, so it is
  filed in the Yard — and a building that fails inside it is never marked.
- A **failure** cannot say *which* building broke. `Town.Apply` sees
  `ev.Result == "error"` and damages the building the command named. When the
  command named none, the damage lands nowhere.

The README records this as: *"a test that fails still cannot say which building
actually broke: the output is not read."*

## What was measured

The README previously implied the data was unavailable. It is not — it is
**available and discarded**. Everything below was verified against the installed
agent and a real session transcript, not inferred.

**1. The tool result carries the output.** omp's `tool_execution_end` emits
`result`, which is the full tool-result object:

```js
{type:"tool_execution_end", toolCallId, toolName, result: ne, isError: fe}
// where ne = { content: [{type:"text", text: "..."}], details: {...}, providerMetadata, useless }
```

The extension destructures nothing from `result`:
`internal/agent/extension/ai-town.ts` sends `isError: e?.isError === true` and
drops `result` entirely.

**2. A real transcript confirms the shape.** From
`~/.omp/agent/sessions/-Documents-code-agent-town/*.jsonl`, a `toolResult`
record has exactly:

| Key | Type | Holds |
|---|---|---|
| `role` | string | `"toolResult"` |
| `toolCallId` | string | joins to the tool call |
| `toolName` | string | `"bash"`, `"edit"`, … |
| `content` | list | `[{type:"text", text:"…"}]` — **the output** |
| `details` | dict | `{timeoutSeconds, wallTimeMs}` — timing only, no output |
| `isError` | bool | the flag we already send |

So the output is `content[].text`, and `details` carries nothing useful for
attribution.

**3. Output sizes are small enough to transport.** Across 1,637 tool results in
a real session:

| | bytes |
|---|---|
| median text | 559 |
| p90 | 2,469 |
| max | 49,565 |
| over 50 kB | 0 |

**4. `go test` output names the failing package.** Verified by injecting a
deliberate failure and running the real command:

```
ok  	…/internal/agent	0.358s
--- FAIL: TestDeliberateWholeFailure (0.00s)
FAIL
FAIL	…/internal/analyzer	0.336s      <-- package path, parseable
ok  	…/internal/registry	0.015s
```

`awk '/^FAIL[ \t]/{print $2}'` extracts `…/internal/analyzer` exactly. **This is
the whole gap.** A whole-repo run *can* name the building that broke — the
information is in the output.

**5. A no-op test run is detectable.** `go test -run TestNoSuchTest ./pkg`
exits **0** and prints:

```
ok  	…/internal/analyzer	0.002s [no tests to run]
```

This matters because the building ladder's finish ranks are gated on a passing
test, and today three such runs would take a building from `roofed` to
`completed` while running nothing. The marker `[no tests to run]` makes that
distinguishable from a genuine pass.

**6. `node --test` names failures differently.** Verified:

```
✖ deliberate (1.404551ms)
✖ failing tests:
```

There is no package path. This is the honest cost of the work: **a parser is
per-runner**, and a `go test` parser is not a `vitest` parser.

## Decision

**Parse the result text for `go test`'s `FAIL <package>` lines, and only for
that runner.** Ship one runner properly rather than several badly.

Rejected alternatives:

- **Parse every runner now.** The work multiplies by runner and each parser is
  untestable without that runner installed. A wrong attribution is worse than a
  missing one: it damages a building that did not break.
- **Send the whole output to the daemon and parse there.** The daemon would then
  hold per-runner knowledge, which is what the adapter layer exists to prevent
  (`CONTEXT.md`: the adapter owns agent-agnosticism). Parsing belongs where the
  runner is known.
- **Infer from the command only.** That is today's behaviour and is the gap.

## Scope

### In

1. The extension captures `result.content[].text` for `bash` frames, truncated.
2. A `go test` parser that extracts failing package paths from `FAIL <pkg>`.
3. Failing packages are resolved to buildings and **damaged** — not advanced.
4. A `[no tests to run]` marker suppresses the finish-advance, so a vacuous run
   cannot complete a building.
5. The daemon accepts a list of additionally-affected buildings on a frame.

### Out

- Other runners (`vitest`, `pytest`, `cargo test`). The frame carries raw text,
  so each is a parser away, but each is its own change with its own tests.
- Reading output for *success* attribution. A pass advances only the building
  the command named; broadening that is a separate question and not part of the
  reported gap.
- Persisting output. This is live attribution, not an event store (ADR-0003).

## Constraints

- **Stdlib only** in Go. **No new dependencies** in the extension.
- **Bounded payload.** Truncate at 64 kB with an explicit marker. Measured max
  is 50 kB, so the cap never bites in practice; it exists so a runaway command
  cannot push an unbounded frame.
- **Attribution never guesses.** A package path that resolves to no building is
  dropped, not filed in the Yard. The town does not invent a location.
- **Deterministic.** Same output, same attribution.

## Interfaces

```go
// internal/agent/event.go
type UnifiedTarget struct {
    Path    string `json:"path"`
    Command string `json:"command,omitempty"`
    // Failing names the package paths a test run reported as failing, in the
    // order they appeared. Populated only for commands whose output was parsed;
    // empty means "no attribution available", never "nothing failed".
    Failing []string `json:"failing,omitempty"`
    // NoTests is set when the runner reported that it matched no tests at all.
    // A run that executed nothing must not advance a building's finish ranks.
    NoTests bool `json:"noTests,omitempty"`
}

// internal/agent/frame.go
type Frame struct {
    // ...
    // Result is the tool's own output text, already truncated by the extension.
    Result string `json:"result,omitempty"`
}
```

## Verification plan

Each of these is checkable, and the third is the one that would have caught the
gap:

1. `go test ./...` with one injected failing package damages **that** building.
2. The same run with everything passing damages nothing and advances the named
   building as before.
3. `go test -run TestNoSuchTest ./internal/analyzer` three times leaves a
   `roofed` building at `roofed`, not `completed`.
4. A whole-repo run with one failure damages only the failing building, and the
   pass side of the same output advances nothing it did not name.
5. A `FAIL` line naming a directory that is not a building is dropped, and the
   event is still recorded.

## Open question, stated rather than hidden

**Does a passing whole-repo run advance anything?** Today it does not — it lands
in the Yard with no building. This spec keeps that: only failures are attributed
from output. Attributing *passes* from output would let `go test ./...` finish
every building it covers, which is a larger behaviour change than the reported
gap and deserves its own decision.
