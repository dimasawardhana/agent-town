# A town that is alive when nobody is working

**Status:** draft for review. Nothing here is built.

## The problem

The town is a good map and a quiet one. Every mark on it is a fact about the
code, and every one of them is frozen: a road is a band, damage is a hole, a
verified building carries a pennant. The only things that ever move are the
things an agent is doing *right now*, which means **a town with no session running
looks exactly like a dead one** — and a reader cannot tell those apart.

That is a claim the town is making, silently and wrongly, and this project does
not make claims it cannot support. It is the same defect as the missing import
count: an absence with nothing to say it is an absence.

## What liveliness means here

Not animation. A figure moving because it looks nice is decoration wearing a
claim's clothes, and this town does not do that.

**Every moving thing answers a question the reader can ask, from data the daemon
already holds.** Nothing is invented to fill a frame.

There are three kinds of mover, and they are told apart by direction and colour
rather than by shape, because at the fitted zoom a 20-pixel figure is read by its
silhouette long before it is read by its detail:

| mover | direction | colour | what it says |
|---|---|---|---|
| **machine** | *toward* a building | its own material | an agent is working there |
| **car** | *along* an import road, importer → imported | its own signal colour, warmer than any material | this building uses that one |
| **figure** | *out of* a building, toward the Yard | the failure colour | this building is failing, and has been N times |

Three populations, three directions, and **the machine is the only one that means
an agent.** That is the load-bearing property: a reader who can identify the
machine can always answer "is an agent working here", which is the question the
map exists to answer.

**The car is not neutral, and that is a measured decision rather than a taste
one.** The word above used to be "neutral", on the reasoning that a car is not a
claim about an agent and should not look like one. Built neutral — in the
palette's own metal — nine cars on nine roads produced a town that looked
exactly like one with no traffic at all, because a car in the metal ramp is the
value of a building's own windows and reads as part of the wall it passes. The
car now has one colour of its own, lighter than every material in the palette,
because separating it at a handful of pixels is the whole job. It stays short
of `accent`, which is the chief's flag and the panel's live-state marks: a car
wearing that would read as a session badge. The load-bearing property above is
unharmed — the machine is still the only mover that means an agent.

## The five features

### 1. Cars on import roads — the spine

The town has real import roads: 60 on `team-builder`, each an actual dependency
between two buildings the analyzer resolved. They are currently **static bands
and nothing has ever travelled one.**

A car runs a road from the importer to the imported, at a speed tied to the road's
length, and there is **one per road** — not one per import statement, because a
road is a deduplicated edge and 111 statements are not 111 facts.

This is the feature the other four hang off, and it is the only one that is
purely an increase in what the town can already say. A car on a road is the
dependency graph moving. A town with a lot of import traffic is a town whose
districts are tightly coupled, and that is **true and currently invisible**.

Containment roads get no traffic. "This sits inside that" is a true fact and a
static one; putting a car on it would claim a dependency that does not exist.

### 2. Figures for failing tests

A figure walks out of a building that is failing and crosses to the Yard, where
ADR-0004 already puts side-wide work. **One figure per building, not one per
problem** — the *number of problem buildings* is what the map shows, and the
exact count stays in the panel. A swarm would read as panic; a slow walk reads as
a fact.

The data is `BuildingState.Problems`, *"the running count of failures here: history,
never cleared."* It already exists, already travels the wire, and the panel
already prints it. **This feature invents no data.**

Its absence is the cost. Failure is the one thing the town renders worst: a red
roof mark says *this is broken* and nothing on the map says *this is broken
constantly*. A figure makes the rate visible without a number.

### 3. A town that admits it is idle

The cheapest and most honest of the five. A town with no session reports it — in
the panel, and by the **absence** of machines rather than by an addition. A town
with no machines and no figure on it is quiet, and the reader can tell a quiet
town from a dead one because the Yard and the chimneys still move.

This is feature zero in the sense that it makes the other four honest: without it,
an empty town and a populated one look alike when nothing is happening.

### 4. Ambient at rest

Smoke already drifts. What else moves at rest is a question with a wrong answer
available — "whatever looks good" — and the right one available too: **anything
that is a fact about the code.**

Candidates, in order of how defensible they are: a crane's jib that turns slowly
on a building tall enough to have one; the verified pennant lifting on a gust;
rain over a district whose tests are currently failing. Each is a fact wearing
motion. Anything that is *only* motion is out of scope by this document's first
paragraph.

### 5. Time of day

One key light for the whole town, not a light per building. The buildings already
have top / lit / shadow faces and `visibleFaces` already picks two of them per
turn; a time of day changes the **palette** those faces draw from and nothing
else.

Explicitly **not** per-building lighting, for two reasons: a real light per
building is 1,237 new cels, and the pixel-art rules forbid the soft gradient it
wants — the honest version is a whole-town key, and the honest version is also
the cheap one.

This is last because it touches every baked cel's palette and is the one feature
that can make existing art worse.

## Non-goals

- **Pedestrians as population.** A person who is not a claim is a costume.
- **Anything drawn per agent that the daemon does not report.** The town is a
  pure function of the analysis and the event stream (ADR-0012), and liveness that
  requires a fiction breaks that.
- **Making a still town look busy.** The failure mode this document exists to
  prevent. A town with no session must read as *idle*, and idle is a legitimate
  state with a legitimate look.

## How this will be judged

By the four instruments this project already has, and by the reader:

- `commenttruth` — every comment must say what the code does
- `selftest.test.ts` — no test that reimplements what it is testing
- `test:mutate` — a car with no road, a figure that never leaves, a light that
  does not change the palette, each must break a test
- **and the judgement that none of those can make:** does a town with a session
  look different from a town without one, *for a reason you can name*

That last one is why this spec exists and why the last feature on the list is the
one that would be most impressive.
