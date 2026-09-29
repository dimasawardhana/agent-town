# 34 — Does any test notice when the code is wrong?

**What to build:** The answer to the question the other checks cannot ask.

**Blocked by:** 33.

**Status:** done

- [x] Six mutations across the places a wrong answer becomes a false claim
- [x] Five caught; the sixth recorded as a measured, explained survival
- [x] Two real defects found by the runner, not by reading

## Comments

### Why this and not more rules

Three of the four ways this project shipped a useless test were *shapes*, and
`selftest.test.ts` catches them. The fourth is not a shape: a test that calls the
right function and asserts the wrong thing reads perfectly, imports the real
module, and uses the real names. There is no grep for it.

That question — *if this code were wrong, would this test notice?* — has a
mechanical answer. Break the code on purpose, run the suite, require red.

### Deliberately narrow

Mutation testing the whole suite is slow enough that nobody runs it, and a slow
check is a dead check. These six are the places where a wrong answer becomes a
**false claim on the map**: the ember's window, the sky's plain, the tree's test
district weight, the district gap, and the bare-specifier exclusion. Those are the
ones the project's founding promise depends on.

### What it found, both times

**A bad assertion in a test written an hour earlier.** The sky test asserted
`Math.abs(centre - plain) > 2` — that the centre is *unlike* the plain. A check
phrased as a difference passes on a **substitution**, which is the one change it
should have caught: repainting the whole backdrop a different colour satisfied
"unlike skyGround" perfectly.

**A real bug in the road layout.** The district roads were emitted at the *next*
district's left edge rather than in the gap before it — so every band was drawn
**underneath the following district**. A road through a building, on a map whose
whole claim is that it only says true things. The screenshots did not show it,
because the roads are painted under the districts that cover them.

### The mutation that kept surviving, and why it was not the test's fault

Removing the gap between districts (`x += blk.W`) survived every suite. The first
test written for it asserted that no two districts *overlap* — and a fixture that
does not wrap cannot falsify that, and even once it wraps, removing the gap makes
districts **flush rather than overlapping**.

So the test was asserting the wrong thing. The gap is not there to keep districts
apart; it is there so a **road fits in it**. Asserting that instead caught the
mutation immediately — and caught the real bug above, which the overlap test was
never going to find.

**A mutation that survives is a question about the test, not the code.** Two of
the three times this runner found something, the finding was in the assertion
rather than the implementation.
