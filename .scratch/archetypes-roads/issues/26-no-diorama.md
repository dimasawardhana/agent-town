# 26 — No diorama

**What to build:** The backdrop stops being a backdrop.

**Blocked by:** 19.

**Status:** done

- [x] No horizon, no treeline, no ridges, no glow
- [x] A flat field with a vignette and a soft seat under the town
- [x] The plain is unlit, so it cannot read as ground receding
- [x] `HORIZON_FRACTION` is `null`, and a test says why

## Comments

### The user felt strange for it three times and was right

"I feel strange for the sky, but lets keep as is" is a polite no. The instinct was
sound and I shipped the thing anyway, twice, and spent a ticket improving it.

### A horizon is the diorama

The backdrop had a gradient, a glow, two ridges and a treeline, with the horizon
crossing the middle of the frame. I moved that line three times — 0.74 put the
treeline in *front* of the land, 0.6 put it through the middle — and each move
traded one diorama for another.

**The diorama was the horizon.** A horizon is a distant view. Putting one behind
something meant to be read from above says the map is a *model of a place* rather
than a place, and no amount of tuning the line's height fixes that, because the
line is the claim.

### What is left is what the void was always for

A region is bounded by nothing. That is what makes it a region, and it was the
one part of the original design that earned its keep. So: a flat plain, a
vignette that says *this is where you are looking* without saying *and there is
somewhere else*, and a soft radial seat under the town so the land is set into
the field rather than pasted on it.

The plain is deliberately **unlit**. A gradient there would immediately read as
ground receding toward a horizon and put the diorama straight back.

`HORIZON_FRACTION` is exported as `null` rather than deleted, so the test that
pinned the composition has something honest to assert about and a future change
that reintroduces a horizon fails loudly.
