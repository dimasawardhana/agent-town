# 09 — Deep detail is drawn on request, without moving anything

**What to build:** The town draws shallower sites first and reveals deeper ones on request. Because the layout is computed once from the full analysis and only *filtered* for display, revealing deeper buildings never moves the ones already on screen.

This is the property that makes the feature safe. Buildings are placed by index into a sorted slice, so re-running the layout over a subset moves them — measured at 12 of 18 buildings. Filtering the output avoids that entirely.

**Blocked by:** 06, 08.

**Status:** done

- [x] A detail control limits which buildings are drawn, by depth
- [x] Revealing deeper buildings leaves every visible building in exactly the position it already occupied
- [x] Positions are identical to the full layout, so the same repository yields the same town regardless of how much detail is shown
- [x] The camera bounds account for what is drawn, so revealing deeper buildings does not clip them
- [x] A site that is not drawn yet still resolves — a worker sent there is not lost

## Comments

Implemented by filtering on the way *out* of a full layout, never by re-running
the layout over a subset. `Site.Depth` is now carried on the wire from
`analyzer.Building.Depth`; the three special places carry 0, so no filter value
can hide the Yard. The control appears only when a town actually has nested
buildings, and its range is the deepest depth the daemon reported rather than a
guessed ceiling.

Verified live against a real daemon on this repository (18 sites, depths 0-4):

| Depth | Drawn | Moved |
|---|---|---|
| 1 | 4 of 18 | 0 |
| 2 | 13 of 18 | 0 |
| 3 | 16 of 18 | 0 |
| 4 | 18 of 18 | 0 |

Camera bounds grow with the filter (679x725 at depth 1, 885x739 at depth 4), and
the layout retains all 18 sites at every setting so a worker sent to a hidden
building still resolves.

## Follow-up: the shallowest view had nothing standing for it

The filter above is correct — nothing moves, the layout is computed in full — but
the *content* at depth 1 was wrong, and that is a separate defect worth recording
here because it is the same feature.

A directory is a building only if it holds source **directly**, so a project laid
out as `internal/<pkg>/` has almost nothing at its top level. Measured on this
repository before the fix: "top level only" drew **one** building holding **7.9%**
of the source, and ten buildings had no visible ancestor at all. `ui` survived
only because `ui/vite.config.ts` (477 B) and `ui/index.html` (14 786 B) happen to
live at the top level — the shallowest view was decided by where two config files
sit. A Go repo with no root-level source showed nothing.

**Fixed** by placing a site for any directory that holds source below it and none
of its own. These are Containers, not buildings: no rank, no damage, drawn from
the completed picture, and sized from **hand-written** bytes so an embedded bundle
does not collapse them to one storey. Coverage at depth 1 went 1 building / 7.9%
→ 3 sites / 33%, and `internal` now draws as a 9-storey tower over 327 kB of
authored code.

The load-bearing detail, and a defect found by measuring rather than by reasoning:
a container must be drawn **only while the buildings it summarises are hidden**. A
plain `depth <= filter` rule put `internal` and its ten packages on screen
together at filter 2 — a tower standing on the plate of the things it stood for,
the map double-counting the same bytes. The rule is now
`depth <= filter < minChildDepth`, where `minChildDepth` is the shallowest building
below the container; `Site.MinChildDepth` carries it and `ui/src/visibility.ts`
holds the predicate, tested as a property ("no container and its child are ever
drawn at the same filter") rather than as one case.

Verified live at every filter: no container drawn alongside a building beneath it,
`children == floors + 1` for everything drawn, and containers rendering with zero
interior holes (a floor seam would scale with the floor count; measured at 0px for
9 storeys).

Measured positions of the container sites at depth 1, confirming nothing moved:
`container:internal` 262×262 and `container:cmd` 102×44, both on their district
plates, with every building keeping the coordinates it had at filter 4.

## Follow-up: a site's art and its declared footprint must agree

Filtering was correct, but what was *drawn* was not where the layout said it
would be, and the reader saw it as a container standing outside its section.

`Site.W/H` is the daemon's declared footprint, and the renderer draws the atlas
cel for exactly that number. Two defects broke that agreement:

- **The daemon sent the plate's extent for a container's size**, while the atlas
  bakes only four footprints (44, 60, 78, 100). The renderer then drew the
  *nearest* baked size, so `internal` declared 262x262 and had 100x100 art drawn —
  measured standing 81 units left and 66 up of its own plate, and `cmd`'s 100-unit
  art overflowing its 142x114 plate by 43. Fixed by naming a baked footprint and
  centring the site itself, with the renderer guessing nothing.
- **`stackContainer` never called `.setOrigin(0, 0)`**, so every building and
  container was drawn half a cel up-and-left of its plot — 36 px left / 48 up on a
  73x85 cel, 56/54 on a 113x111 one. `place()` has that call and a comment about
  exactly this bug; its twin did not. Now measured at worst error 0 at every
  detail depth.

A floor under the plate's size was also added, so a container always has ground to
stand on: a test district's tightened pitch (`testPitch`) could leave an inner area
of 30.8 units under a container wanting a 44-unit cel. See
`TestContainerFitsATightPlate`, which fails if the floor is removed.

## Follow-up: labels

Depth-keyed labelling (`depth <= 1` wears its name outright) was measured against
this repository and produced thirteen boards for eighteen sites — a wall of type
whose skyline was the thing it obscured. Replaced by hover to reveal, click to pin,
one focus at a time. See ADR-0019.
