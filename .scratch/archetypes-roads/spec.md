# Archetypes and roads

## Context

Every building in the town is the same generic block. Height says how big a
directory is, the roof kind says which of five abstract shapes its path hashed
to, and nothing says *what kind of place it is*. A reader scanning the town sees
towers and sheds and cannot name a single one of them.

Two changes are wanted: named building **archetypes** — a hospital, a stadium, a
restaurant — so the map is readable at a glance, and **roads** so buildings are
connected rather than scattered.

Both are blocked by one thing, and it is not a design problem.

## The constraint: the atlas is the budget

The sprite sheet is `nextPow2(16 × cellW) × nextPow2(ceil(cels/16) × cellH)`. At
the present 93px cell height, 8192 is reached at 88 rows — a hard ceiling of
**1408 cels**, currently holding 1140.

Fixed families, measured from the real bake, take 500 and do not scale with this
work: band 64, base 128, ground 120, props 108, workers 76, shadow 4. That leaves
the cap family, and the cap is where an archetype has to live, because the cap
*is* a building's silhouette.

Priced naively — one archetype per roof kind, both conditions baked — twelve
archetypes is **920 over**.

## Phase 0: half the cap family is blank

That number says the vocabulary must be rationed, and that reaching a good list
means giving something up. That reading is wrong, and measuring rather than
arithmetic is what caught it.

**320 of the 640 cap cels draw nothing at all.** A cap only draws a roof from
`roofed` upward, so every cap at `planned`, `foundation`, `framed` and `walled`
is an empty image — baked 320 times over, in only **18 distinct shapes**.

They are not junk. They are load-bearing: the stack emits a key per storey and
restaging swaps frames by index, so a building must not change its number of
children when its stage changes. That is why the band and cap are *deliberately*
blank before their feature exists. But the key must be per-kind while the frame
need not be. One shared blank frame per footprint per pre-roof stage is sixteen
cels, not three hundred and twenty.

This is a prerequisite rather than an optimisation, and it is worth 304 cels on
its own.

## The budget after Phase 0

| archetypes | total | spare |
|---|---|---|
| 5 (shipped) | 744 | 664 |
| **12 (this spec)** | **936** | **472** |
| 20 | 1256 | 152 |
| 26 (the ceiling) | 1384 | 24 |

Every row is the *end state*: it includes the damage overlay and the road ground
kind, not only the archetypes. The figure straight after Phase 0, with five roof
kinds still in place and both conditions baked, is 836.

## Archetypes

One axis, **replacing** the roof kinds rather than added beside them. Same slot,
different meaning: a roof kind is an abstract shape a path hashed to, an
archetype is a named place. Roof *shapes* remain — a Stadium is domed — but the
town no longer picks between five abstract shapes.

Each archetype carries its own height, so its cel box differs and every archetype
is genuinely distinct. That is also how a Stadium and a Library are told apart
without a second axis: the Stadium is wide and low, the Library tall and formal.

**Twelve, not fourteen.** At 91px only silhouette carries a name. Fourteen forced
two pairs that read alike — three pitched roofs and two arched. Twelve gives
twelve distinct silhouettes and returns 64 cels.

| # | archetype | silhouette |
|---|---|---|
| 1 | **Tenement** | medium flat block — the default, claims nothing |
| 2 | **Tower** | tall flat glass |
| 3 | **Works** | sawtooth and chimney |
| 4 | **Cottage** | low pitched, chimney |
| 5 | **Restaurant** | pitched, wide awning |
| 6 | **Hospital** | wide low flat, cross-marked |
| 7 | **Stadium** | wide low dome |
| 8 | **Library** | tall dome, pediment |
| 9 | **Chapel** | narrow spire |
| 10 | **Hall** | long arched |
| 11 | **Market** | stall row, awnings |
| 12 | **School** | tall pitched, bell |

The five shipped roof shapes become entries 1, 3, 4, 8 and 10, so the town keeps
rendering through the transition and the art that exists is not thrown away.

### What picks an archetype

A hash of the path, exactly as the roof is today. Zero cost, deterministic, and
the same repository always yields the same town.

This is ornament and is labelled as such: the town asserts *this is a Stadium*,
not *this is a hospital* or anything else about what the code does. A manifest
may later declare the real thing, and a declaration wins over the hash.

**Inferring archetypes from the code is rejected.** Reading imports, file types
and test presence to classify a directory is the ADR-0004 §9 failure mode:
per-language heuristics are how a map ends up asserting things it has not
verified. That argument was made when the roof axis was introduced and has not
weakened with a larger vocabulary.

### A directory with no authored bytes is not a building

ADR-0004 §4 says generated output *"shouldn't create buildings… may appear as
infrastructure (roads, pipes) but not as buildings."* The analyzer disagrees: it
marks such a directory generated and sizes it at one storey, but it remains a
building. Today it draws as a bare plot, which is merely dull. With archetypes it
would draw as a **Tenement** — a 1.7 MB compiled bundle rendered as a residential
block, with a name attached. A label turns a vague drawing into a false claim.

So the code is brought into line with the ADR: no authored bytes, no building.
This shrinks the subject of the vocabulary to things with real code in them, and
it is why it lands before any archetype is drawn.

## Naming: visual first, label on demand

Archetypes are **not** labelled on the map. A placard would let a bad drawing
hide behind a good word — if "School" can be read off a label, the drawing never
has to be legible, and the archetypes become twelve placards rather than twelve
silhouettes.

They **are** named in the selection panel, which already exists and already
shows a building's state. That is the right shape: the silhouette has to work
first, and the label is the fallback for a reader who is not sure.

The consequence is a real acceptance criterion rather than a nicety — with no
placard, the only evidence a Stadium is a Stadium is that it looks like one.

## Damage as an overlay

The cap's damage axis costs 320 cels and buys one mark baked into a cel that
already carries eight stages and two conditions. As a positioned prop it costs
about 16 and becomes a system that can grow.

This is the one place cels are traded for placement code, so it lands after the
archetypes and only because Phase 0 paid for it. ADR-0004's rubble and crack are
**out of scope here** — they are a separate piece of work, and a ticket that ships
late and half-done is worse than one that ships.

## Roads

The layout already contains roads. Districts are placed in wrapped rows with a gap
between them, and the terrain notes record that a `road` ground kind existed once
and was deleted:

> There is deliberately no `road`: the layout puts districts in wrapped rows and
> the roads are the gaps between them (ADR-0012), so a road tile had nothing to
> place it and was baked as dead art.

The deletion was right and the reason still holds. The art is twenty cels and
trivial; the hard part is that nothing places it. Roads are therefore one ticket,
art and placement together — shipping the art alone would recreate the exact
dead art that got the kind deleted.

Two kinds: **row roads** filling the gaps the layout already creates, and
**containment roads** from a building to the building containing it. A
subdirectory is inside its parent, the analyzer already nests them, and the
statement is always true.

**Import dependency is out of scope.** A road from one package to another because
one calls the other says far more than "this is inside that", and it is a
dependency graph the daemon does not build. It gets its own spec.

## Consequences

**The whole atlas is re-rendered**, twice over: Phase 0 changes every blank cap's
frame, and the archetype cutover changes every building's silhouette. The seeded
ladder already re-rendered every building once, so this is not a new class of
cost — but it is worth saying before twelve cap families are drawn.

**The roof axis stops existing as a name.** Roof shapes remain; five abstract
shapes a path can hash to do not. Roof variety is spent to buy place variety.
The trade is intended: a reader cannot name "gantried", but they can name the Hall.

**26 archetypes is the hard ceiling**, and 24 of those leave under 100 cels. The
next axis added to the cap will need Phase 0's trick again — find the cels that
draw nothing and stop baking one per combination.

## Out of scope

- Import-dependency roads (own spec).
- Damage as rubble and cracks at the base and walls (own spec).
- Wall material. The skin axis is untouched — two values — because Phase 0 made
  spending it unnecessary.
- Per-archetype props. A Hospital gets a Hospital roof and nothing else; props
  are a separate axis and a separate budget.
- Metaphor intensity (ADR-0004's promised setting; still unevaluable).
