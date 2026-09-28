# 03 — The archetype axis, end to end

**What to build:** Five named archetypes replace the five roof kinds, and the
town's buildings say what they are.

A Tenement, a Works, a Cottage, a Hall and a Library appear where a flat, a
sawtooth, a pitched roof, a gantried roof and a dome used to. One axis,
**replacing** the roof kinds rather than added beside them — same slot,
different meaning. Roof *shapes* survive: a Library is domed, a Works is
sawtoothed. What disappears is the idea that a path hashes to one of five
abstract shapes.

Each archetype carries its own height, so its cel box differs and each is a
genuinely distinct cel. That is how a Stadium and a Library will be told apart
later without a second axis.

The archetype is chosen by hashing the path, exactly as the roof kind is today —
deterministic, free, and the same repository always yields the same town. It is
ornament, and says so: the town asserts *this is a Library*, not anything about
what the code does.

**Blocked by:** 02 — the atlas headroom.

**Status:** done

- [x] Five archetypes are live and visible in the town: Tenement, Works, Cottage,
      Hall, Library
- [x] Each existing town still renders, and the atlas cel count is asserted
      against the tables rather than a remembered number
- [x] Each archetype is distinguishable from the other four at the fitted zoom,
      with no label — that is the only evidence a Library is a Library
- [x] The same path always yields the same archetype
- [x] No roof-kind vocabulary survives as a name; roof *shapes* do
- [x] The damage and verification marks still draw over every archetype
- [x] Total cels and cell height are measured and recorded

## Comments

The first five are renames of art that already exists, which is deliberate: the
town keeps rendering through the transition and nothing that works is thrown
away. Tickets 04 and 05 add the seven new silhouettes.

**No placard.** Naming an archetype on the map would let a weak drawing hide
behind a strong word. Naming it in the selection panel is ticket 06's business
and is the fallback for a reader who is not sure — the silhouette has to work
first.

### Measured

836 cels, cell 115×93, sheet 2048×8192 — unchanged, because renaming five values
bakes no extra cels. Frame keys now read `cap:78:works:roofed` and
`cap:78:library:completed`.

**The distribution is visibly lumpy with only five.** Five of the eight
buildings whose roof is drawn hashed to `works` (sawtooth). That is a real
consequence of a five-wide axis and it is what tickets 04 and 05 are for: a
wider set spreads the same fourteen buildings.

The rename was done as AST-level identifier rewrites, and the prose was fixed
afterwards — a rename that leaves "roof kind" in the comments has moved the
vocabulary without moving the meaning. `roofFor` was still *named* in a doc
comment for the function it used to be.
