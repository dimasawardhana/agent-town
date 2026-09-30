# A town that is alive when nobody is working

**Status:** feature 1 built three times and removed twice; the third removal was
of the mark itself. Feature 5 built, and not as specified. Features 2–4 open.

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

There are two kinds of mover, and they are told apart by direction and colour
rather than by shape, because at the fitted zoom a 20-pixel figure is read by its
silhouette long before it is read by its detail:

| mover | direction | colour | what it says |
|---|---|---|---|
| **machine** | *toward* a building | its own material | an agent is working there |
| **figure** | *out of* a building, toward the Yard | the failure colour | this building is failing, and has been N times |

Two populations, two directions, and **the machine is the only one that means an
agent.** That is the load-bearing property: a reader who can identify the
machine can always answer "is an agent working here", which is the question the
map exists to answer.

## What feature 1 actually became

The plan was a car on every import road. The road was built, the car was built,
and both were removed, because **a connection is the wrong carrier for the fact
and a moving mark is the wrong scale for the town.**

### Why the road lost

An import edge was drawn as the bounding box between two building centres, trimmed
to where the line leaves each plot. That was true — a band that crossed a
building it did not connect was a lie, and there were three of those. It was also
invisible, and then it was too much, and the middle of that is the whole story:

- The gap between two neighbouring plots is **14 world units**; the road *tile* is
  **16**. Five of the fifteen banded roads on this repository were **shorter than
  the tile they were painted with**, so each came out as one or two checkered
  diamonds spilling under the buildings on either side. A road through a tunnel.
- Widening the cell gap to 40 fixed that and left the town carrying nine slabs
  across a 600-pixel view. Seventeen roads for fourteen buildings.

### Why the car lost

A 14-pixel car on a 600-pixel town is not a signal, it is a speck. Four rounds of
re-authoring it — size, colour, shape, lighting, shadow, rotation — and the thing
that would have fixed it was not art. **A 14-pixel car was never going to say
"these districts are coupled."** That is a scale problem, and four rounds of
pixel work is what it costs to fail to notice that.

The rotation is worth recording, because it is the mistake a reader repeats: a
directional light baked into a sprite that turns on its road every frame points
into shadow on the next street. Only a sprite's *own* axis survives a rotation,
so that is the only axis it may be lit on.

### Why the mark lost

The second carrier was a mark on the building's own roof. It was a cool tint with
its own palette entry, deliberately not `accent`, drawn where nothing stands on
top of it — and three attempts to place it were invisible before that, each for a
reason that had nothing to do with brightness. Once it was finally visible, the
reader who had to see it said it was a mess, that it disturbed the town, and that
no replacement would be better.

That is the right verdict and it is worth keeping the reasoning, because the
instinct every time until then was to make it louder and brightness was never the
problem. **A mark that takes four attempts to place and then draws attention to
itself is not carrying a fact — it is competing with the art.** The roof is where
the archetype's own ornament lives, and putting a tint there asked the eye to
read a flat wash as information set against ornament drawn to be looked at.

### What replaced it

Nothing. That is the whole of the answer, and it took a third removal to get there.

- `Site.Imports` still records what a building imports, because the panel prints
  it and the panel is not a picture of the town.
- The analyzer emits **no import road at all**.
- The map draws **no import mark**. Nothing on it says *whether* a building
  imports, and no count is drawn either.

**The cost, stated so nobody rediscovers it by wanting the graph back:** the
dependency is invisible without a click. A reader cannot see that `ui/src`
reaches two things rather than one without selecting it, and cannot see that it
reaches any at all without selecting it. That was never reliably visible with a
car on it either — it was reliably visible as a speck.

The scanner's guarantees are untouched: a bare specifier is unresolvable, a
relative specifier escapes the repository, a multi-line import is an import. All
three are now visible only where the map is allowed to be legible.

Two narrower conclusions, which are really one:

- **There is no fourth carrier.** Plot, roof and the gap between plots are the
  three surfaces a mark could occupy, and all three are closed — two because the
  building covers them, one because the gap is too small to hold anything
  without becoming a road.
- **A map mark has to earn its place against the art, not against the absence of
  itself.** This one never did. The town is better for not drawing it, and the
  lesson is worth more than the feature was.

Feature 1 is therefore **done**, in the form of having removed itself, and the
"spine" it was going to hang the others off has to be re-founded: there is
nothing on the map that moves with the code's *shape*. What moves is the crew,
and that is all.

## The four that were open, and what they became

Re-scoped against what the map has become. Each is now judged by whether the town
can carry it at fitted zoom — the test feature 1 failed.

### 2. Figures for failing tests

Unchanged and still the best of the four. A figure walks out of a building that is
failing and crosses to the Yard, where ADR-0004 already puts side-wide work.
**One figure per building, not one per problem** — the *number of problem
buildings* is what the map shows, and the exact count stays in the panel. A swarm
would read as panic; a slow walk reads as a fact.

The data is `BuildingState.Problems`, *"the running count of failures here:
history, never cleared."* It already exists, already travels the wire, and the
panel already prints it. **This feature invents no data.**

**New in scope, from what feature 1 taught:** a figure is ~20 pixels and crosses
open ground, so it is a *position*, not a tint — unlike the import mark, a figure
cannot be hidden by the building it leaves. That is why it works where a car did
not, and it should be stated before anyone tries the same trick twice.

### 3. A town that admits it is idle

Now the most load-bearing of the four. With feature 1 removed, **the town has
nothing on it that moves when no agent does**, which is the problem this document
exists to name, arriving a different way. The chimneys and the smoke still drift,
so the distinction survives — but it is thinner than when this was written, and
this feature is what keeps it from being a fiction.

A town with no session reports it — in the panel, and by the **absence** of
machines rather than by an addition.

### 4. Ambient at rest

Smoke already drifts. What else moves at rest is a question with a wrong answer
available — "whatever looks good" — and the right one available too: **anything
that is a fact about the code.**

Candidates, in order of how defensible they are: a crane's jib that turns slowly
on a building tall enough to have one; the verified pennant lifting on a gust;
rain over a district whose tests are currently failing. Each is a fact wearing
motion. Anything that is *only* motion is out of scope by this document's first
paragraph.

**Deferred on evidence, not on taste:** the machinery pass this session went
looking for a boom you could read and could not get one below four pixels without
it turning into a plank. Ambient motion has the same ceiling. Whatever is chosen
here has to survive at the size it will actually be drawn, which is the test
feature 1 missed four times.

### 5. Time of day — built, and not as specified

One key light for the whole town, not a light per building. Explicitly **not**
per-building lighting, for the two reasons above: a real light per building is
1,237 new cels, and the pixel-art rules forbid the soft gradient it wants.

What shipped is three phases — day, dusk, night — and it changes two things:

- **the backdrop**, repainted from three of the seven validated sky keys, and
- **the glass**, which is lit warm in some windows and dark in others at dusk
  and at night, and is plain glass at day.

Three patterns per storey, so no two storeys of one building are lit the same
way twice running, and no two buildings are lit alike. The pattern comes from
the building's own path, so it is stable across redraws and across turns — the
`frontCorner` property, applied to a mark that did not exist when it was written.

**The facades do not change value with the phase, and the reason is the atlas.**
This section originally said a time of day "changes the palette those faces draw
from", and that is the honest description of a simulated key light. It is also
not affordable here: a second axis on the base and the band is 400 cels against
187 free, and a re-bake per phase is twelve atlases at 2048x8192 each. So the
light is the sky and the emissive, and a wall is the same colour at night as at
noon. The town reads as *a dark sky over a lit town*, which is a look and not a
simulation, and saying so is cheaper than pretending otherwise.

**A phase, not a clock.** Nothing in the analysis or the event stream says what
time it is, so any value would be invented. What the town *can* hold is the one
fact a reader is already reading the map in. Dusk is the default for the same
reason it is the middle of the list: it is the only phase that says anything.

The cost of that reading, stated: a lit window is a fact about the *hour* and
nothing else. It does not say an agent is inside, and it must not be read that
way — the machine is still the only mover that means an agent. If features 2 to 4
ever light a window for a reason, the two signals collide and one of them has to
go.

## Non-goals

- **Pedestrians as population.** A person that is not a claim is a costume.
- **Anything drawn per agent that the daemon does not report.** The town is a
  pure function of the analysis and the event stream (ADR-0012), and liveness that
  requires a fiction breaks that.
- **Making a still town look busy.** The failure mode this document exists to
  prevent. A town with no session must read as *idle*, and idle is a legitimate
  state with a legitimate look.
- **A connection drawn between two places, for any reason.** Added after feature 1.
  Every band on this map is between districts, or inside a district and about the
  tree. Nothing on the map says "this calls that" any more, and the reason is that
  a connection needs width, a surface, a kerb and ends, and having all four it
  crosses the things it passes.

## How this will be judged

By the four instruments this project already has, and by the reader:

- `commenttruth` — every comment must say what the code does. It cannot see a
  comment that is *nearly* true, so this catches lies and misses near-misses; the
  near-misses this session were found by reading, not by the suite.
- `selftest.test.ts` — no test that reimplements what it is testing.
- `test:mutate` — 7 mutations, all caught. A figure that never leaves and a light
  that does not change the palette would have to join them; there is no longer a
  car mutation, because there is no longer a car.
- **and the judgement that none of those can make:** does a town with a session
  look different from a town without one, *for a reason you can name*.

That last one is why this spec exists and why the last feature on the list is the
one that would be most impressive. It is also the one feature 1 failed, and
failing it four times is the most useful thing this document has recorded.
