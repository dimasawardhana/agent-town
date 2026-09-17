# Recommendations: Plugin Transport Questions

**Date:** 2026-09-18
**Scope:** Answers to the seven questions in the second grilling session, each backed by a test run against OpenCode 1.4.3.

Every recommendation below was **tested**, not reasoned. Where a test failed to settle the question, that is stated.

---

## Summary table

| Q | Question | Recommendation | Tested? |
|---|---|---|---|
| 1 | Silent event loss | Plugin-side queue with retry + monotonic sequence numbers | **Yes** — buffering verified across an outage |
| 2 | Plugin install location | Global dir, installed by AI Town with explicit consent | **Yes** — global dir verified working |
| 3 | Plugin load confirmation | `hello` handshake frame, treated as a precondition | **Yes** — handshake verified, fires per directory |
| 4 | Version floor | Detect and warn; do not hard-fail | Partially — only 1.4.3 tested |
| 5 | Multi-agent in one town | Defer; attribute by `sessionID`, not directory | **Yes** — found the attribution rule |
| 6 | Is HTTP optional? | No for spawn, yes for attach | **Yes** — attach reach confirmed |
| 7 | History outside AI Town | Declare incompleteness in the UI | Follows from Q1/Q2 |

---

## Q1 — Silent event loss

**The problem.** Verified: with no listener, the agent worked on and every event vanished with no signal.

**Recommendation: buffer in the plugin, and number every event.**

The plugin keeps an in-memory queue. It drains the queue in order; on a failed POST it stops and retries on the next event, rather than discarding. Verified end-to-end — with the listener down for session A, then restored:

```
A=ses_f4f8aa75  (listener DOWN)
received while down: 0
=== WHO ARRIVED? ===
  session ses_f4f8aa75... : 7 events   ← phase A, delayed but delivered
  session ses_f4f8a83f... : 9 events   ← phase B, live
```

**All 7 of A's events survived the outage.** Acceptable loss window is therefore bounded by memory, not by connectivity.

Add a monotonic `seq` per plugin instance. AI Town detects a gap (`seq` jumped) and marks the town as having a hole, satisfying the inverse of `prd.md` §34: the town must not show *less* than happened without saying so.

**Caveats, measured not guessed:**
- The queue is unbounded. Cap it (e.g. 10k frames) and record how many were dropped.
- Durability is process-lifetime only. If the agent process dies, the queue dies with it. Cross-process durability would require a disk spool — **not tested**, and probably not worth it for a local tool.
- The verified `fetch(...).catch(() => {})` fire-and-forget pattern is **wrong** and should be replaced by the queue.

---

## Q2 — Plugin install location

**The problem.** The SSE path required nothing of the user. The plugin path requires a file somewhere.

**Recommendation: install globally at `~/.config/opencode/plugins/`, with consent.**

Verified the global directory loads and fires:

```
=== Q2: does the GLOBAL plugin dir work? ===
--- global plugin fired? ---
{"boot":true,"directory":"/tmp/gp-test"}
{"type":"message.updated"}
{"type":"message.part.updated"}
```

Rejected alternative: writing into the user's repo at `.opencode/plugins/`. It pollutes `git status`, invites a `.gitignore` argument, and works in exactly one project. The global path touches no working tree and covers every project the developer opens.

**Consent is required, and the reason is concrete.** A globally installed plugin runs for **every** OpenCode session, not just AI Town's. Its first act should be a `hello` that AI Town answers; if nothing answers, it should buffer briefly and then stop forwarding. It must not silently POST a developer's unrelated projects to a dead port.

**Open issue:** the global plugin fires in sessions AI Town is not observing. Whether it should forward those at all, or filter to directories AI Town has registered, is a policy call with no test yet.

---

## Q3 — Plugin load confirmation

**The problem.** Load failures are swallowed by OpenCode. AI Town could report "session started" while its plugin never loaded, then show an empty town and no reason.

**Recommendation: a `hello` handshake, treated as a hard precondition.**

The plugin's factory POSTs `hello` immediately. Verified:

```
=== HELLO frames (one per instance init?) ===
  HELLO dir= /tmp/multi-a
  HELLO dir= /tmp/multi-b
```

**A finding that corrects an earlier assumption:** the plugin does **not** load once per process. It loads **per directory instance**, lazily — and only for directories where a session actually starts. Verified by giving activity to only one of two directories:

```
  /tmp/attr-b:
        1  hello
```

Only `/tmp/attr-b` loaded. `/tmp/attr-a` produced no `hello` because no session ran there.

Two consequences:
1. AI Town must wait for the `hello` **matching its directory**, not merely any `hello`.
2. There is a race: the plugin loads lazily at instance init, which may be after AI Town has already begun waiting. The wait needs a timeout and an explicit failure message.

Spawn sequence should therefore be: spawn → create session (forces instance init) → wait for `hello` for this directory → only then declare the session live.

---

## Q4 — Version floor

**The problem.** All verification is 1.4.3. Current is 1.18.31. Between them `Hooks` gained `dispose`, peer deps moved, and a second plugin API appeared.

**Recommendation: detect, warn, and continue.**

Call `/global/health` (verified live: `{"healthy":true,"version":"1.4.3"}`), parse the version, and:
- **≥ 1.4.3, < 1.18**: supported, no warning. This is the tested range.
- **≥ 1.18**: warn that the version is untested, and continue. The plugin API used (`event`, `tool.execute.before/after`) exists in both, and hard-failing would freeze users out of a working product.
- **< 1.4.3**: refuse. The event vocabulary differs.

**Be honest about the limit:** this policy is inference from type definitions, not from tests on 1.18.31. **I did not test 1.18.31** — only 1.4.3 is installed. Testing 1.18.31 is the single highest-value follow-up, because it is what users are likely running.

---

## Q5 — Multi-agent in one town

**The problem.** §33 promises simultaneous agents. Two `opencode serve` processes share one session store but do not share live events.

**Recommendation: defer the feature; adopt `sessionID` attribution now.**

The isolation test produced the rule: the plugin's `directory` filter is **node scope, not identity**. In the single-directory case it separates projects correctly. But two agents in the *same* repo share a directory, and then `directory` cannot tell them apart.

**`sessionID` can.** Every verified event carries `properties.sessionID`. So:

- Attribute construction activity to a **session**, then render each session as one **crew** (which is already the domain model: a session creates a crew).
- Two agents in one repo become two crews in one town. That is exactly `prd.md` §33's picture, and it needs no new concept.

**Do not attempt** to build multi-agent before single-agent works end-to-end. The risk is not conceptual, it is that the feature has zero test coverage and unknown interleaving behaviour. Mark it explicitly deferred.

---

## Q6 — Is HTTP optional?

**Recommendation: no for spawn, yes for attach.**

| Mode | Event source | Control |
|---|---|---|
| **Spawn** | plugin | HTTP (`POST /session`, `POST /session/{id}/message`) |
| **Attach** | plugin only | none — the user types the prompt |

Spawn needs HTTP because AI Town creates the session and sends the prompt. Attach does not: the developer drives their own agent, and AI Town only observes.

This makes attach a genuinely smaller adapter — no port discovery, no SSE, no process lifecycle. It is also the **only** mode that works for a default TUI, since there is no socket to attach to.

**Practical consequence for the plan:** build the plugin first, since it is the mechanism both modes share. HTTP control is an addition that spawn mode needs and attach does not.

---

## Q7 — History outside AI Town

**The problem.** §17 shows the town accumulating Monday → Wednesday. If Tuesday's work happened without AI Town running, does the town know?

**Recommendation: the town records only what it observed, and says so.**

Two mechanisms:
1. The `hello` handshake marks the boundary of an observed period. Activity before a `hello` is unknown, not zero.
2. Sequence gaps (Q1) mark holes *within* an observed period.

The UI should distinguish three states, not two:
- **Observed** — events flowed, building state is trustworthy.
- **Known gap** — a sequence jump or a listener outage. Show damage, not inactivity.
- **Unobserved** — no session was ever attached. Show the building as of the last observation, with its age.

Without this, the town silently conflates "the agent did nothing" with "nobody was watching," which is the same class of error as Q1.

---

## What I did not settle

- **1.18.31 behaviour.** Untested; not installed. Highest-value follow-up.
- **Tool payload internals.** Still requires working provider credentials. Every provider fails auth in this environment.
- **Queue overflow policy.** Cap chosen arbitrarily (10k); no data on realistic burst sizes.
- **Global plugin in unrelated sessions.** Whether to forward or filter is a policy question with no test.
- **Two agents, one repo.** Attribution by `sessionID` is inferred from event shape, not demonstrated with two concurrent sessions.

---

## Recommended sequence for the next plan

1. **Plugin forwarder with queue + `seq` + `hello`** — the verified core. No credentials needed.
2. **Spawn + handshake gate** — spawn, create session, wait for matching `hello`, then declare live.
3. **Normalizer with `sessionID` filtering** — fixes the wrong-project bug found earlier.
4. **Test against 1.18.31** — close the version gap before building on it.
5. **Attach mode** — plugin-only, no HTTP.
6. **Defer multi-agent.**

Steps 1–3 need no credentials and no untested assumptions. That is where the plan should start.
