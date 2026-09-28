# 07 — Damage becomes an overlay instead of a cap variant

**What to build:** A damaged roof still shows its damage, but the damage is a
prop placed on the roof rather than a variant of the roof's own picture.

The cap's damage axis costs 320 cels and buys one mark baked into a cel that
already carries eight stages and two conditions. As a positioned prop it costs
about sixteen.

The drawing already exists — each roof kind already knows how to draw its own
failure, and it already draws at the right height. What does not exist is a
sprite that sits *on top of* a building rather than inside it, across all four
orientations, without drifting as the footprint changes. That placement is the
whole of this ticket.

**Blocked by:** 03 — the archetypes should be settled before the overlay has to
handle them.

**Status:** ready-for-agent

- [ ] Damage is no longer a variant of the cap; the cap family loses the axis
- [ ] Damage draws as a prop on the roof, correct on all four orientations
- [ ] Damage stays per-archetype — a hole in a slope, a collapsed bay in a slab —
      and is not one shared mark
- [ ] A damaged building that is also verified shows both; the two are
      independent conditions
- [ ] Damage still never moves a building down the ladder (ADR-0004)
- [ ] A damaged building at every stage looks damaged, including the stages whose
      cap is blank
- [ ] Total cels measured; the cap family is 320 smaller

## Comments

**This is the ticket most likely to need a second pass.** "It looks right on turn
zero" is not evidence, and the turn-dependence suite exists for precisely this
case — it should be extended rather than worked around.

Out of scope, deliberately: ADR-0004 also asks for rubble at the base and a crack
up the wall. Neither fits in this ticket, and a ticket that ships late and
half-done is worse than one that ships. They want their own spec, and the
overlay this ticket builds is the thing that would carry them.
