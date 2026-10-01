# 13 — What the review found, and the two bugs it caught

**What to build:** The findings of a two-axis review of tickets 06–12, fixed.

**Blocked by:** 12

**Status:** done

- [x] A damaged building's base is not dropped from its stack
- [x] The base draws the material it was asked for
- [x] A finished walk does not leave a per-frame listener behind
- [x] The road kind is no longer documented as deliberately absent
- [x] Containment roads link buildings only
- [x] The smoke depth comment matches the depth it is handed
- [x] `CONTEXT.md` describes the archetype, material and road axes

## Comments

### Two real bugs, both shipped because the tests could not see them

**A damaged building lost its ground storey.** `baseKey` still asked for a
`:dmg` base after the base's damage became an overlay, and `stackContainer`
*skips* a key the atlas cannot answer. So the base child was never added, which
put every child of the stack one index out of step with `restage`: the first
band drew on the base's frame and the pennant was never swapped. Every test
passed `false` for `damaged`, so the suite was green and the feature was broken.

**Four of the five material families baked the wrong art.** The bake iterates
materials, but `buildBase` took an *archetype* and looked the material up from
it, so the bake hashed a fabricated path to get one. `base:*:stone` was drawn
from a `market` (timber) drawing. The fix is at the source: `buildBase` takes a
material name, because a material is what the caller has.

### The leak that never failed

The polyline walker replaced an auto-cleaned tween with a manual
`events.on('update')` that was never removed. The layer is destroyed and rebuilt
on **every draw**, which is to say on every event, so a live session accumulated
one closure per journey forever. Nothing threw, nothing grew visibly, and the
only symptom would have been a session getting slower over hours.

### Four documents that contradicted the code

`terrain.ts` still said the road kind was "deliberately absent" directly above a
`Ground` type that listed it. The smoke comment claimed a depth the call site
inverted. `CONTEXT.md` described roofs as "pitched and flat" and had no entry at
all for roads or materials, which are now first-class drawn concepts. And
`containmentRoads` linked containers as well as buildings, which drew roads
between a district and its own neighbourhood.

### The lesson, recorded because it is the second time

**A test that passes `false` for a boolean cannot catch a bug that only happens
when it is `true`.** Every call site in the suite was the convenient value. The
missing test is not "did the feature work" but "does the stack still line up when
a condition is set", and that is now checked against a live town rather than
assumed.
