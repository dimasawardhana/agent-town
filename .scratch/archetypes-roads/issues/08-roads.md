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

**Status:** done

- [x] Row gaps are paved, and the gap is continuous along a row
- [x] A building is connected to the building containing it
- [x] Placement is decided by the daemon; the browser never recomputes the map
      (ADR-0012)
- [x] Roads meet cleanly at junctions rather than overlapping into a blob
- [x] Roads read as a made surface distinct from grass *and* from the earth of the
      Yard and Workshop plots — three places sharing a surface is the ADR-0004
      failure where a reader cannot tell where one ends and the next begins
- [x] Roads change no building's own geometry or stage
- [x] A flat repository with one building draws no road and does not fail
- [x] Determinism: the same tree gives the same roads (ADR-0012)

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

### Implemented, and verified in the map

Grey tarmac bands with kerbed edges, running between the buildings and along the
districts. The `road` ground kind is back — 4 tiles and 16 edges, 20 cels.

**The art and the geometry ship together**, which is the only way this cannot
become dead art a second time. `terrain.ts` no longer carries a comment saying a
road tile had nothing to place it, because something does.

### Two kinds, and what each asserts

**Row roads** are the gap the layout already made between district rows. The band
is emitted at the moment of the wrap, so the road and the gap cannot disagree —
a Go test asserts a row road never overlaps a building's plot.

**Containment roads** run from a nested building to the nearest ancestor. Longest
-prefix match, so `ui/src/art` is inside `ui/src` and not inside the repository —
true, and useless. It is the only claim available without a dependency graph:
`ui/src/art` really is inside `ui`, and a reader scanning the map is trying to
learn the shape of the tree.

Import dependency would say far more and is **out of scope** — it is a real
analysis the daemon does not perform, and it gets its own spec.

### The failure mode, and what it cost to rule out

The first version of the fixture put twenty-four buildings in one district. A row
break only happens *between* districts, so twenty-four buildings in one district
are one very wide row and produce no road at all — the test passed, and proved
nothing. The fixture now builds fourteen districts so the layout has to wrap.

That is the same shape as the original deletion: a road kind with no geometry
behind it, which is indistinguishable from a road kind nobody asked for.
