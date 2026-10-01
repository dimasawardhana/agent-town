# 02 — Share the blank cap frames

**What to build:** The construction stages that draw no roof share one blank cel
per footprint, so the atlas stops baking the same empty image three hundred times.

A cap only draws a roof from `roofed` upward, so every cap at `planned`,
`foundation`, `framed` and `walled` is an empty image — 320 of the 640 cap cels,
in 18 distinct shapes.

They are load-bearing. The stack emits a key per storey and restaging swaps
frames by index, so a building's number of children must not change when its
stage does. That is exactly why the cap is deliberately blank before its feature
exists, and that behaviour is preserved. What is not load-bearing is baking a
*separate* empty cel for every combination of roof kind, damage and verification
— the key must be per-kind, the frame need not be.

Nothing about the town looks different after this ticket. The picture is
identical; the sheet is 304 cels smaller.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] The four pre-roof stages resolve to one shared blank frame per footprint,
      independent of roof kind, damage and verification
- [x] The post-roof stages are unaffected and still resolve per kind
- [x] Every combination still resolves to a real frame — no key becomes dangling
- [x] Restaging through all eight stages keeps the child count stable, proven by
      a test rather than asserted
- [x] The pre-roof caps are still blank: sharing must not make a roof appear early
- [x] The total drops from 1140 to **836**, the sheet stays 2048×8192, and both
      figures are recorded

## Comments

This is a prefactor and it is why the archetype work is affordable: it is worth
304 cels on its own, and it is the difference between a twelve-archetype
vocabulary and a rationed one. It is also the highest-confidence item in the
whole plan — no visible change, and a correctness argument that is a number.

The natural place for a future axis to go wrong is here, so the acceptance
criteria lean on counting rather than on looking: the count is the proof.

### Measured

**1140 → 836 cels**, cell 115×93, sheet 2048×8192 — the ceiling is unmoved at
1408, so the 304 cels are pure headroom. The town renders identically: 14 sites,
zero missing frames, checked against a running daemon rather than by eye alone.

The restage invariant is a test, not a comment: every storey and every cap
resolves to a real frame at all eight stages, so no stage can present fewer
children than another.
