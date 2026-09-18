# 05 — Workers construct the town

**What to build:** The product itself. A worker walks to the place its agent is working and performs a visible action there, live. Reading a file sends a worker to that building to inspect it; editing it makes them hammer; running the test suite gathers workers in the Yard. The town changes as work happens and keeps the result when the session ends.

**Blocked by:** 02 (events arrive) and 04 (there is a town to move on). Both must be done.

**Status:** ready-for-agent

- [ ] An event resolves to a **Place** — a Building, the Workshop, the Yard, or the Depot — and never silently vanishes for want of a location
- [ ] A file inside a building sends the worker to that building; a root file sends them to the Workshop
- [ ] Site-wide work — tests, builds, git, installs — is staged in the **Yard**, visible to the whole town
- [ ] Meta work — planning, task dispatch, evaluation — is staged in the **Depot**, so a planning agent is visibly working rather than idle
- [ ] The worker walks to the place before acting, then performs a distinct animation per action kind: inspecting, hammering, building, demolishing, testing
- [ ] A session start spawns a crew; a session end makes the workers leave and the town persist in its new state
- [ ] A failed tool leaves a visible **Construction Problem** on the place rather than advancing it
- [ ] Two sessions on one repo produce two crews, attributed by session id
- [ ] The town persists across a restart — closing AI Town and reopening shows what was built

**Why the Yard and Depot matter more than they look:** in a real omp session, `bash` is **48%** of all tool calls and meta tools another **~33%**. Only about **19%** of actions touch a single file. Without a place for site-wide and meta work, four fifths of a session renders as a worker standing still while the agent works hard — the town showing less than what happened, which the product principle forbids.

**Depends on a resolver that reports its misses.** Longest-prefix matching resolves file paths to buildings. It must also handle the cases that genuinely have no building, and say which: an internal URI (`skill://…`) is not a file; a glob pattern (`sub/*.txt`) names no single file; a path outside the repo belongs to no place in this town. Decide where each of those goes — most belong in the Yard — and record the decision rather than letting them fall through.

**Follow-up, deliberately not in this ticket:** deriving location from command *output*, so a failing test lights up the exact building that failed. That is what makes a test run dramatic, and it is the natural next slice once this one is proven.
