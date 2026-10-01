# 40 — The last line between two buildings

**What to build:** Stop drawing containment bands. Nothing on this map runs from
one building to another.

**Blocked by:** 36

**Status:** done

- [x] The analyzer emits no containment road, and `containmentRoads`,
      `containmentBand` and `bandBetween` are gone
- [x] `Road` carries no centre line — `Ax`/`Ay`/`Bx`/`By` are gone, and `Kind` is
      `"row"` or `"district"`
- [x] The renderer's band path is gone: the `hasBand` branch in `paintRoads`,
      `BAND_TREATMENT`, `bandQuad`, and `Band`/`hasBand`/`turnBand` in `view.ts`
- [x] Three band tests and their helper are replaced by one stronger invariant
- [x] Two road fixtures that named kinds the analyzer cannot produce

## Why this one, when the import road is already gone

Because a containment band **is** a line between two buildings, drawn the same
way the import road was drawn, and the reader had already told us twice that
this shape is disturbing in this town. We removed the import road (issue 15) and
then the mark on the roof (36), and the band was still there — it had inherited
the silhouette of the thing that was removed without inheriting its meaning, and
a band from `ui/src` up to `ui` reads as a connection exactly as an import band
did.

Six of them. The last thing drawn between two buildings on this map.

## What it cost, stated

**"This sits inside that" is no longer drawn.** It is a true fact, and it is the
most predictable thing on the map — the `BAND_TREATMENT` comment said so itself,
in the document that ranked it *below* the import bands because the eye could
"already half-read it from nesting".

And it *is* half-read from nesting, because the layout places a child building
inside its parent's plate. The band was saying what the arrangement already
showed, in the loudest shape available. The real loss is the second half of
"half-read": a reader who wanted the tree at a glance now has to look at where
the buildings sit rather than at a line. That is a smaller thing than it sounds,
and it is the honest cost either way.

## The test that replaced three

Three containment tests went with the bands: a band's extent is its band, it
crosses no third building, it uses the nearest ancestor. Each could only fail for
a kind that existed, which is exactly why each removal of a kind took its
guarantees with it and left the *shape* free to return in a new guise.

So they are replaced by one that is about the shape rather than the kind:

> `TestNoRoadJoinsTwoPlaces` — every road the layout emits is `"row"` or
> `"district"`. A new kind that joins two places fails here whatever it is
> called.

That is stronger than the three it replaces, because it holds against a kind
that has not been written yet.

## Worth recording

The reader was asked twice and the answer was the same both times, which is worth
noticing: the first request was "the import things being drawn as a line is just
a mess", and the second was "I still see the line of imports". The second one was
not a misreading — it was a different carrier of the same shape, and the honest
lesson is that **removing a fact is not the same as removing a shape**. Three
times this map has carried a line between two buildings, and three times the
line has been the problem rather than the fact.
