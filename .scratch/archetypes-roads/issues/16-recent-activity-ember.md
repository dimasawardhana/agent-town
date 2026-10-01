# 16 — A recent-activity ember

**What to build:** A building says it was worked on, and then stops saying so.

**Blocked by:** none

**Status:** done

- [x] A building touched recently glows
- [x] The glow fades and the sprite is destroyed when its window passes
- [x] The texture is generated, not baked: no atlas cels
- [x] The stack's child count is untouched
- [x] A future-dated or absent timestamp cannot produce a negative or eternal glow

## Comments

### The town was static-rich and dynamic-poor

It knew a great deal about a repository and almost nothing about what an agent was
doing *now*, so a session making two hundred edits left the same picture as one
making two. `BuildingState.updated` had been tracked and persisted from the start
and never drawn. This draws it.

### What it is allowed to say

An ember means **touched in the last two minutes**, and nothing more. It is not a
"hot" or "busy" badge, because those claim something the town cannot know: a
building nobody has touched in an hour is not cold, it is simply untouched, and a
marker that lingered would be asserting otherwise. So it reaches zero and is
destroyed, rather than settling at some visible minimum.

### A decoration layer, not another child

Restaging swaps frames by **index**, so anything that changes a stack's child count
is a bug waiting for the next event — the bug ticket 13 fixed. An ember has to
*cool*, which means no event to hang it off, which means it could not be an
event-driven child either. It lives in its own layer, ticked on the scene's frame.

### The clock bug

The first version compared `BuildingState.updated` (Unix milliseconds) against
Phaser's `scene.time.now` (a clock starting near zero). Every age came out hugely
negative, every ember clamped to full strength, and **nothing ever faded** — a
glow that never goes out is exactly the claim this exists to avoid. It is the same
mistake the damage overlay made with origins, and the same lesson: a mark
positioned against a coordinate space it does not share is a mark that drifts.

Caught by watching the town rather than by a test, because the tests all passed:
the rule was correct and the *unit* was wrong. There is now a test for it.
