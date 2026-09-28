# 09 — The body follows the archetype, not the file count

**What to build:** A building's walls and ground storey come from what it *is*,
so a Chapel is stone and a Tower is glass, rather than every building sharing one
of two materials chosen by its file count.

**Blocked by:** 07 — the base damage overlay it depends on.

**Status:** done

- [x] Five material families, each with its own base and band drawing
- [x] Every archetype maps to exactly one family, and the mapping is total
- [x] A building's base and band agree, so no chapel is stone below and plaster
      above
- [x] Base damage becomes an overlay, so ADR-0004's rubble survives the change
- [x] The footprint still comes from the file count, unchanged
- [x] Total cels and the spare are measured and recorded

## Comments

### Five families, not eleven

The obvious version is eleven bases and eleven bands, which does not fit: base
and band together would be 704 cels and the atlas would reach 1632 against a
1408 ceiling.

Five families *does* fit, and reads better than eleven would have. Eleven
bodies that differ only at the ground floor, under a shared band, look like one
building with hats. Five coherent materials — stone, render, glass, timber,
concrete — give the whole building a single read, and the eleven roofs still
differentiate the archetypes on top of that.

Every archetype maps to a family, so the count is bounded by the families and
adding an archetype is 40 cels, not 40 plus a new body.

### Measured: 1144 cels, 264 spare

| family | cels |
|---|---|
| band (5 materials × 4 sides × 8 stages) | 160 |
| base (same) | 160 |
| base rubble + its blank | 40 |
| cap (11 archetypes) | 368 |
| cap damage + blank | 88 |
| ground / props / workers / shadow | 328 |

The plan said 1288; it came in at **1144**, because dropping the base's damage
axis cost less than the double-rubble model assumed.

### The test caught a collision I would not have seen

`stone` and `concrete` were both on `P.stone` with both `framed: false`, so they
drew **identical** walls — four families' worth of cels and one invisible axis.
The distinctness test is the only reason that shipped as a table with two
identical rows in it rather than a family that does not exist.

Concrete now takes `P.metal`: flat and industrial where stone reads as cut
blocks, and the ramp that separates two greys at a glance.

### Still not changed, deliberately

The **footprint** still comes from the file count. A Stadium is a stadium-shaped
building on whatever plot its file count earned, because a per-archetype
footprint means eleven widths and the atlas cannot hold them. Making the mass
itself vary is a separate piece of work and the one thing here I would want to
scope with fresh eyes.
