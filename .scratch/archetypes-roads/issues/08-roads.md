# 08 — Roads

**What to build:** Roads appear: the gaps between district rows are paved, and
each building is connected to the building that contains it.

The layout has contained roads all along — districts are placed in wrapped rows
with a gap between them. A `road` ground kind was drawn once and deleted, and the
note recording the deletion gives the reason: *"a road tile had nothing to place
it and was baked as dead art."*

That reason still holds, and it is why art and placement are one ticket. The
drawing is twenty cels and trivial; the hard part is that nothing placed it.
Shipping the art alone would recreate the exact dead art that got the kind
deleted the first time.

Two kinds. **Row roads** fill the gaps the layout already creates — purely
additive. **Containment roads** run from a building to the building containing
it: a subdirectory is inside its parent, the analyzer already nests them, and the
statement is always true.

**Blocked by:** 02 — the atlas headroom.

**Status:** ready-for-agent

- [ ] Row gaps are paved, and the gap is continuous along a row
- [ ] A building is connected to the building containing it
- [ ] Placement is decided by the daemon; the browser never recomputes the map
      (ADR-0012)
- [ ] Roads meet cleanly at junctions rather than overlapping into a blob
- [ ] Roads read as a made surface distinct from grass *and* from the earth of the
      Yard and Workshop plots — three places sharing a surface is the ADR-0004
      failure where a reader cannot tell where one ends and the next begins
- [ ] Roads change no building's own geometry or stage
- [ ] A flat repository with one building draws no road and does not fail
- [ ] Determinism: the same tree gives the same roads (ADR-0012)

## Comments

The junction problem is where naive tile placement produces a visible seam, and
in a pixel-art town a seam reads as damage. Whatever junction tiles this needs
are part of the twenty cels rather than an addition to them; if they turn out to
cost more, the honest move is to drop containment roads rather than overrun the
ceiling.

**Import dependency is out of scope and deserves its own spec.** A road from one
package to another because one calls the other says far more than "this is
inside that", and it is a dependency graph the daemon does not build. Containment
is what can be true today without inventing anything — and it is genuinely
informative, because it shows the shape of the tree, which is what a reader
looking for "where does this live" is trying to learn.
