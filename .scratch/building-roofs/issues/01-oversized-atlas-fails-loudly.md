# 01 — An oversized atlas fails loudly instead of silently

**What to build:** When the sprite sheet would exceed a safe canvas size, the bake refuses at boot with a named error saying what it wanted and what the limit is, instead of producing a blank texture.

This is the first ticket because every later one adds cels, and today the failure mode in that direction is invisible. There is precedent in the codebase for exactly this guard: the ground painter already refuses an oversized canvas, and its comment records why — an oversized canvas fails as a *blank texture, not an exception*, so the guard is the only thing that turns a silent visual catastrophe into a diagnosable one. The bake has no such guard.

No user-visible behaviour changes. The verification is that the suite stays green, the normal town is unaffected, and a deliberately oversized bake fails with a readable message.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] The atlas's safe side and area limits are named constants, each carrying the reason it exists
- [x] A bake that would exceed either limit fails at construction with an error naming the computed canvas dimensions and the limit
- [x] The error is raised before any canvas is allocated, so the failure is an exception rather than a blank texture
- [x] An ordinary town bakes exactly as before — same cel count, same canvas dimensions
- [x] A test forces the limit down (or the cel count up) and asserts the refusal, so the guard is proven rather than merely present
- [x] The existing art invariants all still pass

## Comments

Sizing split out of `rasterise` into `layoutAtlas` + `assertAtlasFits`, both
exported, so the guard is reachable from a test without a canvas — otherwise the
only way to prove it would be a 60MB bake.

The guard is checked **before** the canvas is allocated, so an oversized bake is
an exception rather than a blank texture.

Measured, for the record:

| cels | rows | sheet |
|---|---|---|
| 628 (today) | 40 | 2048x8192 |
| 1152 (the ceiling) | 72 | 2048x8192 |
| 1200 | 75 | 2048x16384 — refused |

The message names the dimensions, which limit broke, the cel count and the cell
pitch, because those are the two numbers a caller can act on ("bake fewer things"
or "draw something less tall").

One correction found by the test: the cell pitch reported is the *laid-out* cell
including its 2px gutter (115x113), not the drawn cel size (113x111). The test
asserted the latter and failed, which is the guard reporting the more useful
number.
