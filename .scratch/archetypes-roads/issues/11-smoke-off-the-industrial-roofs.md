# 11 — Smoke off the industrial roofs

**What to build:** Buildings whose archetype is industrial grow a slow plume of
smoke, so the town reads as inhabited rather than modelled.

**Blocked by:** 09 — an archetype axis to hang the effect on.

**Status:** done

- [x] Only archetypes that are industrial smoke; a Cottage does not
- [x] The plume rises from the building's own plot, not from the map's edge
- [x] Emitters are destroyed with the draw, so a session cannot accumulate them
- [x] The effect costs the atlas **nothing**
- [x] A redraw cannot leave two emitters on one roof

## Comments

### It costs zero cels, which is the whole reason it is affordable

The puff texture is **generated at runtime**, not baked. Every cel in the sheet
is paid for by the whole town, and 264 spare is not enough to animate eleven
archetypes across eight stages. Generating it costs nothing and leaves the atlas
exactly where it was.

That also lets the puff have a soft alpha edge, which the palette rule forbids
anywhere in the bake — the artifact never passes through an invariant, so the
rule has nothing to say about it.

### A claim about a building's type, not its state

The plume is attached to the **archetype**, never to "is anything being worked
on here". The second would be the stronger claim — smoke means work — and it
would flicker on every event, which in a live town is every few seconds. Tying
it to the type keeps it in the same register as the archetype itself: *this is a
Works, and works have chimneys.*

### Positive `speedY` is down

In Phaser's particle space a positive `speedY` moves the particle **down**, so
the first version laid smoke on the grass beside each building. It read exactly
like a misplaced emitter, and the emitter was correct. The comment at the call
site says so, because the symptom points at the wrong thing.

Verified by converting both emitters and both buildings into screen space and
comparing: (569,582) against (560,581), and (723,661) against (708,647). They
were on the roofs all along.
