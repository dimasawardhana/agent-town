# 03 — The shipped base cel stops reserving roof headroom

**What to build:** The base cel is sized to what the base actually draws, reclaiming the vertical headroom it currently reserves for a roof it never draws.

Measured: the box that sizes a base cel adds the skin's roof height plus a ridge allowance, but the base draws no roof — its tallest feature is scaffold, which reaches one storey plus eight. The headroom exists solely so that a *composite* helper can blit a cap into the same cel. That helper has no production caller; it is used only by tests.

That waste is what sets the sheet's cell height, because the tallest cel on the sheet is a base cel. Reclaiming it lifts the atlas's ceiling by a factor of about 1.2 — which is what pays for the roof shapes in the following tickets without approaching the limit.

The change is a split, not a shrink: the composite keeps its tall box (it genuinely needs the room) while the shipped base cel gets a box sized to its own contents. Both must remain derivable from the same projection, so the cel and the placement cannot drift.

No user-visible behaviour changes: the base cel gets smaller and the pixels inside it are identical. Verification is that every cel's size still matches its box, the existing art suite is green, and the measured cell height and atlas ceiling have moved as predicted.

**Blocked by:** 02.

**Status:** done

- [x] A base cel is sized from what the base draws, with no allowance for a roof
- [x] The composite helper still has room for a cap blitted into it, and still produces the picture it did before
- [x] Every cel's dimensions still equal the box derived for it — the existing size invariant passes unchanged
- [x] The base cel's pixels are unchanged: the same drawing, only the cel around it is smaller
- [x] Measured and recorded in the ticket's comments: the new tallest-cel height, and the resulting atlas cel ceiling
- [x] The measured ceiling is at least 1400 cels, up from about 1150
- [x] The art suite is green, and no user-visible behaviour changes

## Comments

### The ticket was incomplete, and the measurement found it

The ticket said the base was the tallest cel and that reclaiming its headroom would
raise the ceiling. The first half was true; the second was not, because **the ground
shadow used the same box**. `buildShadow` was a flat `footprint` call at z = 0
sized by `boxFor(side, skin, 1)` — the whole-building box — so a shadow lying on the
ground was as tall as a roofed tower at 111px. It was the second-tallest cel on the
sheet. Fixing only the base would have left the ceiling where it was.

So `boxFor` was split into a private `footprintBox(side, zTop, turn)` plus three
named boxes, each sized to what it draws:

| box | zTop | why |
|---|---|---|
| `boxFor` | `bandHeight(floors) + roofHeight + 6` | the whole building; the test-only composite is its only caller |
| `baseBox` | `STOREY` | one storey — `buildBase` draws `storeyShell`, no roof |
| `shadowBox` | `0` | a single `footprint` call at z = 0 |
| `bandBox`, `capBox` | unchanged | already correct |

`baseBox` is deliberately identical to `bandBox`, and `art.test.ts` now asserts
that: the base *is* one storey, the same `storeyShell` drawing at the same height,
so the two must agree or the floor they share would not line up.

### Scaffold was a red herring

The ticket predicted the tallest feature would be scaffold at `STOREY + 8 = 28`.
Measured, the base's topmost pixel at its fullest is **21 rows above the origin**,
and on a 100-unit footprint a `framed` stage reaches only 7. Scaffold stands at the
footprint's *near* corner, and `sy = (wx + wy) / 4 - z` puts a point five units
beyond it eleven rows *below* the far corner's wall top — further below on every
larger footprint. `STOREY` is the right zTop, and it is the conservative one.

### The composite had to change with it

`buildBuilding` blitted both parts at `(0, 0)`, which was correct only while the
base and the cap shared one box. With per-part boxes each has its own `oy`, so a
zero offset would have put the shorter base `roofHeight + 6` pixels above its own
ground. The blits now derive their offset from the difference of the two origins,
which stays correct as the boxes change rather than accidentally.

### Proof

Two independent checks, and the second is the strong one.

**Origin-relative hashes.** Every base, band, cap, shadow and composite cel hashed
by its drawn pixels *relative to its own box origin*, so the hash is invariant to
the cel's trim. Before vs after: **0 of 452 lines differ**. The art did not move; only
the canvas around it shrank.

**A pixel-diff of two live renders.** Built the reverted binary on port 7821 and the
new one on 7820, snapshotted the Phaser renderer from both, compared:

```
old: tallest cel base:100:planned:0 111px, sheet 2048x8192
new: tallest cel cap:100:planned:0   91px, sheet 2048x4096
md5 old ab1c8a29505e6b4bd0d2df5b45aa4f70
md5 new ab1c8a29505e6b4bd0d2df5b45aa4f70
differing pixels: 0 of 1011600 (0.0000%)
```

Byte-identical output from a smaller atlas. That is the whole claim of this ticket.

### Measured result

| | before | after |
|---|---|---|
| tallest shipped cel | 111 (base) | 91 (cap) |
| cell height | 113 | 93 |
| sheet for today's 628 cels | 2048x8192 | 2048x4096 |
| cel ceiling | 1152 | **1408** |

Ceiling 1408 meets the ticket's 1400 target, so the roof shapes have room.

A correction found after this ticket was closed by measuring the live atlas: the
tallest shipped cel is the **cap** at 91, not the base or the band at 83. Ticket 03
lowered the base by 28 rows, which is what let the cap become the tallest — and the
cap was 91 before this ticket too, unchanged, because `capBox` was always sized to
the roof. So the cell height is 93 rather than the 85 this ticket first recorded,
and the ceiling is 1408 rather than 1536. Both numbers above are the corrected ones;
the claim that matters (>= 1400) still holds, with 8 cels of margin rather than
136.

### Tests

`art.test.ts` gained two invariants and lost one that would now be wrong:

- `every shipped cel is exactly the size of its own box` — replaces the old
  "equals `boxFor`" check, which would now *demand* that a base reserve roof
  headroom and so lock the waste back in.
- `the base, band and shadow cels fill their own height` — the fullest stage leaves
  at most 8 blank rows above the art (measured 5, 5 and 7; it was 33).
- The cap is deliberately not asserted: a ridge projects lower than the far corner
  the box is padded from, so the cap's box is legitimately looser and shrinking it
  is not this ticket's business.

Suites green: art 67, visibility 19, light 1, atlas 5. `tsc` clean.
