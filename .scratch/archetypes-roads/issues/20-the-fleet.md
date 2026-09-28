# 20 — A machine per agent, a pose per state

**What to build:** The crew becomes a fleet.

**Blocked by:** none

**Status:** done

- [x] Five kinds with distinct silhouettes, assigned per agent by hash
- [x] Four poses carrying working / parked / moving / finished
- [x] Chief and sub both baked
- [x] Turn-aware, like every other mark on a building
- [x] 40 cels, down from the figure's 76
- [x] Verified placed and posed through the layer's own path in a live town

## Comments

### Why machines

A person is the least legible thing in this town. At the fitted zoom a 20px
figure is a coloured speck while the buildings beside it have eleven archetypes
and five materials. Silhouette is the cheapest legibility there is, and a machine
has one — a boom, a jib, a blade — where a standing human has a blob.

### What a machine may claim

**Identity, never action.** Five kinds, assigned by hash from the agent's key, so
a session is *an excavator* and stays one, on every client and across every
reload. That is a claim about which crew it is, and it is true for the session's
whole life.

The pose is coarser on purpose: ten states folded onto four, named for what they
*show* rather than for the verb. Tests do not dig, and a pose that said they did
would be the false claim this town is built to avoid (ADR-0004 §9). So `testing`
stands in `work`, and the pose means "engaged", not "editing".

### The budget, which is the surprising part

The figure cost **76 cels** — 7% of the atlas — for 38 frames across 10 states.
The fleet is **40**: 5 × 4 × 2. The atlas went from 1161 to **1125**, so the town
came out 36 cels ahead and the ceiling further away than it was.

The figure spent most of its budget on animating ten verbs a silhouette cannot
show. The fleet spends it on being legible.

### Three bugs, all mine

**The cel was clipped by its own arm.** The box was sized to the footprint and
the boom reaches past it, so the excavator's bucket was sheared off. A building is
a closed box; a machine is not. The box now covers the reach.

**The driver's mast drew nothing** — `zBottom` above `zTop` — and left the pile
driver a mound identical to the loader. Two open uprights and a head, because a
frame has to be open to read as a frame.

**The first colours were `plateWarm[3]`, which is `1`.** Those are single shadow
values, not ramps. Every machine rendered as an empty cel and nothing threw.
Guessed palette names are the same failure as the test that named four colours
that do not exist.

### Verified in a live town, and how

Seeding a session through the daemon was the hard part, and worth recording: the
frame envelope is `{"kind":"event","type":"message.part.updated","part":{…}}`, and
a first attempt that put the kind *and* the type in one field was accepted with a
204 and silently discarded — four attempts, because the daemon logs the
normalized event and there was none in the log to read.

The gate is one layer further on: the events normalize and the daemon logs them,
and the town still holds no workers, so the project match that would attach them
never happened. Rather than keep digging, the layer was driven through its own
`ensure` path, which is what `sync` calls, so tier selection, machine choice,
sprite creation and the shadow all ran exactly as they do in production.

Six sessions, six agents, six kinds, each chosen by hash from the agent's name:

    opencode → driver     pi → loader      omp → excavator
    hermes   → crane      aider → dozer    codex → crane

That is the thing the ticket could not claim before: a machine is placed, faces
its action, and is a machine rather than a figure.

### The counting, twice

Two suites asserted a total derived from the tables, and both had `workers` baked
into the formula. Both now derive the fleet from `MACHINES × MACHINE_POSES`, so
adding a kind updates the count by construction. A hard-coded total is a number
that stops meaning anything the day the atlas changes underneath it — which is
exactly what happened, and exactly what the comments on those assertions said
would not.
