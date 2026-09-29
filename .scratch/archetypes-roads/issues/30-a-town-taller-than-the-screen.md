# 30 — A town taller than the screen

**What to build:** Look at the multi-row path, which had never been executed.

**Blocked by:** 23.

**Status:** done

- [x] A 10-district, 4-row town laid out and rendered
- [x] District roads and row roads both correct, measured and seen
- [x] The one real limit found: a tall town is clipped, and it cannot be otherwise

## Comments

### The path works

Built a ten-district repository, laid it out and looked at it:

    districts=10 rows=4 layout=1186x1894
    districtRoads=6 rowRoads=3

- Every district road spans its **whole row** (h=356, the row's height) — the
  bug fixed in ticket 23 does not recur on the branch that was never run.
- Every row road spans the **full width** (w=1106) and sits exactly in the gap:
  row one ends at y=594, the road runs 594-658, row two starts at 658.

Seen as well as measured, which is the point of the exercise. The checkered road
grid reads correctly in both directions.

### The limit: it is clipped, and it has to be

    layout 1186 x 1894   ·   canvas 1084 x 900

`fit` computes an **integer** zoom and clamps it to `1..4`. A town 1894 units tall
in a 900-pixel canvas would need zoom 0.47, and **a non-integer zoom is the one
thing the pixel-art rules forbid** — it resamples every pixel and turns the art
to mud.

So the town cannot be shown whole. Two honest options, neither taken here:

- **Clip, and say so.** What happens now. The reader pans or uses the detail
  control. Nothing lies; the view is simply partial.
- **Let the camera pan automatically**, so a tall town is followed rather than
  cropped. That is a real feature and not a bug fix.

What must **not** happen is the third option: scaling to fit regardless, which
would show the whole town and destroy the art to do it.

### The other thing this found

The project registry holds **six real repositories**, including `team-builder` —
the exact repository ADR-0012 measured when it corrected the district rule
("e2e is 16 buildings across 22 files against src's 9 across 65"). Every claim in
this session about what a *real* repository looks like was made against
agent-town alone, while a measured example was sitting in the list the whole time.
That is the same failure as the import-road explanation: **asserting from one
sample and calling it a structure.**
