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

**Status:** done

- [x] Damage is no longer a variant of the cap; the cap family loses the axis
- [x] Damage draws as a prop on the roof, correct on all four orientations
- [x] Damage stays per-archetype — a hole in a slope, a collapsed bay in a slab —
      and is not one shared mark
- [x] A damaged building that is also verified shows both; the two are
      independent conditions
- [x] Damage still never moves a building down the ladder (ADR-0004)
- [x] A damaged building at every stage looks damaged, including the stages whose
      cap is blank
- [x] Total cels measured; the cap family is 320 smaller

## Comments

**This is the ticket most likely to need a second pass.** "It looks right on turn
zero" is not evidence, and the turn-dependence suite exists for precisely this
case — it should be extended rather than worked around.

Out of scope, deliberately: ADR-0004 also asks for rubble at the base and a crack
up the wall. Neither fits in this ticket, and a ticket that ships late and
half-done is worse than one that ships. They want their own spec, and the
overlay this ticket builds is the thing that would carry them.

### Measured: 1220 → 956 cels

The cap family went **704 → 368**; damage now costs **88** (a mark and its blank,
per footprint and archetype) where it used to cost 336 inside the caps. The
tallest cel, cell height and sheet are all unchanged — this is purely a count
change, which is the whole reason for doing it.

### The failure the ticket predicted, and a second one beside it

Two, both about a mark that has to sit *on* a roof rather than in one.

**A mark placed at the crown floats.** The stadium's damage sat at the bowl's
highest point while the mark itself was drawn at the rim, where the surface is far
lower. It hung clear of the roof and the outline pass sealed the gap as an
enclosed hole. Same rule as the Restaurant: nothing sits where there is no
surface.

**A blank with a different origin moves the mark.** This one is not about art at
all. `setFrame` swaps a sprite's texture **without moving the sprite**, so the
undamaged blank has to share the origin of the mark it replaces. One blank for
the whole town cannot: its box would have to be eleven roofs at once. The first
version used one, and every damage mark landed 45px right and 30px down of its
building — measured, not eyeballed, which is the only reason it was caught before
it shipped.

Sixteen extra cels is the price of damage not landing beside the building, and it
is cheap against the 264 the change saves. The blank is now baked beside its mark
from the same box, and the comment on `noDamageFrame` says why it cannot be
shared.

**Verified in a running town**: a failing test on `internal/analyzer` puts
`dmg:78:library` on the roof with an offset of exactly `[0, 0]` against its cap.
