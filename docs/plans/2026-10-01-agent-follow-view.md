# Agent Follow View Implementation Plan

> **Status: finished and merged** — PR #3, commit `34e57d7`, 2026-10-01. There is
> no remaining work in this plan. The checkboxes below were never ticked, and
> they are left unticked on purpose: the steps ran, but not as a pass over this
> document, so ticking them would record an execution nobody watched. The
> deliverable was verified in the tree on 2026-10-02 instead — `ui/src/follow.ts`
> (`FOLLOW_ZOOM`, `followZoom`), `labelVisible`'s fourth parameter
> (`visibility.ts:87`), `workerLabelId` relocated to `visibility.ts:54`,
> `followTick` (`scene.ts:1572`), `follow`/`unfollow` in the store, the crew rows
> in `Hud.tsx`, and the `Follow` entry in `CONTEXT.md` with ADR-0022. Treat the
> prose below as the record of what was decided, not as a checklist to run.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a reader pick one machine and watch it work — the camera follows it across the town at a legible zoom, its caption stays lit, and every live crew is named and followable from the panel.

**Architecture:** The camera keeps its one fixed 2:1 dimetric projection; a "follow" is the existing camera re-aimed at a figure each frame, not a new camera and not a new projection. The zoom rule (whole numbers, `[1,4]`) is unchanged — following only *floors* the zoom at 3 rather than widening the range. Crew identity is a UI concern: `Worker.session` already crosses the wire and is already in the store, so the panel is what was missing. No Go changes.

**Tech Stack:** TypeScript, Phaser 4 (CANVAS renderer, `pixelArt: true`), React 19, Zustand 5, `node:test` + `esbuild` for the UI suite. Go is untouched by this plan.

**Spec:** No separate spec document; this plan is the spec. The three product decisions were taken with the user on 2026-10-01 and are recorded in "Decisions Taken" below. The design grounding is in "Measured Facts".

## Global Constraints

- **The projection does not change.** The town is 2:1 dimetric with no rotation and no perspective anywhere in the system (`DESIGN.md:19-21`). Every cel has the skew baked into its pixels, so no transform recovers a new viewing angle. A follow view is *the same camera aimed at a moving target*.
- **Isometric zoom stays whole numbers in `[1, 4]`.** `ui/src/scene.ts:1441` and `ui/src/scene.ts:2090`. Do not widen the range, do not allow fractions. A fractional zoom makes some art pixels two screen pixels wide and their neighbours one. The **plan** view's separate `[0.2, 8]` clamp at `ui/src/scene.ts:2081` is not part of this rule and is not touched.
- **The camera is never a data source** (`DESIGN.md:30-31`). Follow state is a *selection* and goes in the store next to `focused`; the zoom before/after is *camera mechanics* and stays private to the scene. The store still holds no zoom, no scroll, no pan.
- **Layout geometry arrives from the daemon and is never recomputed in the browser** (ADR-0012). The follow resolves a position from the sprite the layer already placed; it never derives one.
- **No Go changes.** `Worker.Session` already serialises as `session` (`internal/town/town.go:16`). `Tier` stays `"chief"` for everything Go produces (`internal/town/town.go:283`, `:400`) — the subagent policy is still the open question in `CONTEXT.md`, and this plan does not decide it.
- **All art stays as it is.** No new cels, no atlas budget spent (`ui/src/art/` is untouched). The machine is a `32x22` cel; a follow view is a *camera* change, not an art change.
- **House style — heavy explanatory comments explaining _why_.** Comments state what a reader would otherwise mis-read. No comments that restate the line below. The reasoning behind a number belongs next to the number.
- **Never commit unless the user asks.** This repo has uncommitted work. Treat every `git commit` step below as `git add -A && git diff --cached --stat` and report the result.
- **Run before claiming done**, from `ui/`:
  - `./node_modules/.bin/tsc --noEmit -p tsconfig.json` — want empty
  - `npm run test:follow` — want all pass
  - `npm test` — want all pass
  - `./node_modules/.bin/vite build` — want success
  - From the repo root: `gofmt -l ./internal/ ./cmd/` (want empty), `go vet ./...` (want empty), `go test ./... -count=1` (want all ok — this proves the untouched Go side still passes)

---

## Decisions Taken

Asked and answered on 2026-10-01, because each has materially different trade-offs and none is recoverable from the code.

1. **Single follow camera, not picture-in-picture.** One machine is followed at a time, on `cameras.main`. PIP would need N extra Phaser cameras, a per-inset ignore list, a second draw surface, and it fights the integer-zoom rule at inset size.
2. **Following floors the zoom at 3, and does not widen `[1,4]`.** A machine cel is `32x22`; at 3x it is `96x66`, close enough to read the pose and far enough to keep a building's plot and a district's name in frame.
3. **Crews are labelled by session; chief only.** The Crew list grows a session name and each row becomes a follow control. No change to the event contract, no Go change, no subagent decision.

---

## Measured Facts

Read from this repository on 2026-10-01. **Do not re-derive them; do not contradict them.**

1. **A machine cel is `32x22` pixels.** `W = 30`, `PAD = 1` → `CEL_W = 32`; `ARM_H = 13` + `BASE_H = 7` + `PAD` → `CEL_H = 22` (`ui/src/art/machine.ts:134-137`, `:562-564`). At 3x that is `96x66` on screen.

2. **At map scale the machine is 2.5% of the frame, and the town already says so.** `ui/src/scene.ts:1491-1495`: *"A worker standing at a building is the second tier: the machine is 2.5% of the frame, so the ring is what actually says 'here' at map scale."* This is why following cannot simply keep the fit zoom — at 1x a follow camera tracks a 32-pixel speck, which is the map view with a lag.

3. **There is no `Camera` class and no camera module.** The camera is `this.cameras.main` plus five fields on `TownScene` (`ui/src/scene.ts:305-308`) and two methods. There are exactly six camera write sites: `scene.ts:353` (background), `:520` (bounds), `:537-541` (the fit guard), `:1430-1431` (drag), `:1441` (wheel), and `fit` at `:2068-2092`. `ui/src/view.ts` is pure geometry and holds **no** zoom, no scroll, no pan — so follow policy does not belong there.

4. **`update(time)` is the only per-frame hook, and it returns early at `ui/src/scene.ts:1479`.** Anything a reader must watch every frame goes *above* that return. `drawPlanWorkers()` is already there for the same reason (`:1476-1478`).

5. **A drag already wins the camera, and only during the drag.** `ui/src/scene.ts:1425-1432` writes `scrollX`/`scrollY` on every `pointermove` while `this.dragging`. `this.dragging` is cleared on `pointerup` at `:1423`. This is the gate a follow tick needs — Phaser runs `update` *after* input, so without the gate a follow tick visibly wins the reader's own drag.

6. **`fit()` is called from two places and one of them is unguarded.** `ui/src/scene.ts:540` (guarded by `fittedSignature`) and `ui/src/scene.ts:2001` (unguarded, in `drawPlan`). The guard's signature is `` `${view}:${w}x${h}:${sites}:${districts}` `` (`:537`) — it does **not** include `turn` or `depth`, so a turn and a depth change do **not** re-fit. Only a view toggle and a layout-identity change do.

7. **A turn does not re-fit, and a turned layout is what the workers are drawn on.** `ui/src/scene.ts:447` turns the layout; `WorkerLayer` is rebuilt on every draw and re-reads the turn (`ui/src/workers.ts:440`). A follow resolves the target from the live sprite every frame, so it re-corrects itself across a turn with no extra work.

8. **A worker's on-screen position is owned by a per-journey listener, not by the layer tick.** `ui/src/workers.ts:722-747`: the stepper computes `t = clamp01((now - startedAt) / ms)`, calls `pointAlong(path, t)`, and sets the sprite to `(p.x, p.y - lift)`. `WorkerLayer` has **no** public position getter today; `sprites` (`:381`) and `groundY` (`:419`) are private. Following needs a new public accessor.

9. **A removed figure leaves no position behind, and that is the release signal.** `ui/src/workers.ts:896-914` destroys the sprite, zone, caption, and every per-worker map. A follow camera holding a remembered coordinate would sit over empty ground for the rest of the session.

10. **Session identity already crosses the wire and is already in the store.** `internal/town/town.go:16` is `Session string \`json:"session"\``. `ui/src/store.ts:134-144` has `session: string` on `Worker`. `ui/src/App.tsx:564-575` renders the crew rows and never reads it. **This is the whole reason "each agent" was not selectable: nothing was missing but a label.**

11. **The store's `focused` / `hovered` are label state, not camera state,** and they carry ids from two owners under a namespace prefix. `workerLabelId` (`ui/src/workers.ts:85`) prefixes a worker's id as `worker:<id>`; the prefix exists so a worker id equal to a site id cannot light two labels at once. It is currently module-private in `workers.ts`, which imports `useTown` from `store.ts` — so `store.ts` **cannot** import it from there without a cycle.

12. **`ui/src/visibility.ts` imports nothing.** It is the leaf module for "the rules that decide what the map shows", and it already owns `labelVisible` (`ui/src/visibility.ts:62-64`), which both `scene.ts:1222` and `workers.ts:632` obey. It is the correct home for the label namespace.

13. **A crew row is a `<li>` of `<span>`s today** (`ui/src/App.tsx:564-575`), styled at `ui/index.html:408-437` as a flex row with a 1px left rule. There is no interactive element in it today, and the whole app is mouse-only — `input.keyboard` appears nowhere in `ui/src`.

---

## File Structure

| Path | Change | Responsibility |
|---|---|---|
| `ui/src/follow.ts` | **new** | The follow camera's zoom policy as pure numbers. No Phaser import, so it is testable in a plain `node --test` process. Owns `ZOOM_MIN`/`ZOOM_MAX` so the range is stated once instead of at two call sites. |
| `ui/test/follow.test.ts` | **new** | The follow feature's pure contract: the zoom range is whole and bounded, following only ever moves closer, and two sessions of one agent are tellable apart. |
| `ui/src/visibility.ts` | modify | Gains `workerLabelId` (moved out of `workers.ts`) and the followed-caption rule in `labelVisible`. |
| `ui/test/visibility.test.ts` | modify | Gains the followed-caption cases, next to the six existing label cases. |
| `ui/src/store.ts` | modify | Gains `following: string \| null`, `follow`, `unfollow`; clears `following` in `setCurrent` and in `focus`/`unfollow` transitions. |
| `ui/src/workers.ts` | modify | Gains the public `positionOf(id)`; imports `workerLabelId` from `visibility` instead of declaring it; the hit zone's `pointerup` follows as well as focuses; `applyLabels` takes `following`. |
| `ui/src/scene.ts` | modify | Gains `followTick()` and the private `followZoomBefore`; calls the tick from `update`; uses `clampZoom` at the two existing inline clamps; releases the follow on a view toggle; passes `following` into the label sweep. |
| `ui/src/App.tsx` | modify | The Crew list gains a session name, a follow button per row, and a "following" banner with a stop control. |
| `ui/index.html` | modify | Styles for the follow button, the followed row, and the banner. |
| `docs/adr/0022-follow-is-a-camera-not-a-projection.md` | **new** | Why a third-person view is a follow camera and not a perspective camera, and why the zoom range did not widen. |
| `CONTEXT.md` | modify | A `Follow` glossary entry, beside `Turn` in the view-preference language. |
| `ui/package.json` | modify | `test:follow` script, and `test:follow` added to the `test` chain. |

---

## Task 1: The follow camera's zoom policy

The three decisions a follow camera makes about zoom, stated once as pure numbers, with the two existing inline clamps routed through them. No renderer involved, so the rules are testable without a canvas.

**Files:**
- Create: `ui/src/follow.ts`
- Create: `ui/test/follow.test.ts`
- Modify: `ui/src/scene.ts:1441` and `ui/src/scene.ts:2090` (use `clampZoom`)
- Modify: `ui/package.json` (add `test:follow`, wire into `test`)

**Interfaces:**
- Consumes: nothing. This task is the root of the feature.
- Produces:
  ```ts
  // ui/src/follow.ts
  export const ZOOM_MIN: 1;
  export const ZOOM_MAX: 4;
  export const FOLLOW_ZOOM: 3;
  export function clampZoom(zoom: number): number;
  export function followZoom(current: number): number;
  // ui/test/follow.test.ts also covers, added in Task 3:
  //   crewLabel(agent: string, session: string): string   <- from ../src/actions
  ```
  Every later task imports these. If a signature here changes, every later task changes with it — re-read this block before editing.

- [ ] **Step 1: Register the test script, so a new suite is a first-class citizen rather than a file nothing runs**

In `ui/package.json`, add to `scripts`:

```json
"test:follow": "./node_modules/.bin/esbuild --bundle --format=esm --platform=node --outfile=ui-follow.test.mjs test/follow.test.ts --log-level=warning && node --test ui-follow.test.mjs",
```

Then in the existing `"test"` script, insert `&& npm run test:follow` immediately after `&& npm run test:visibility` — the alphabetical-ish grouping there puts the visibility and label suites together, and this is the label-adjacent suite.

- [ ] **Step 2: Write the failing test**

Create `ui/test/follow.test.ts`:

```ts
// The follow camera's zoom policy.
//
// A follow camera is the only thing in this renderer that decides how close to
// look, and it has to decide it against a rule that is not negotiable: the
// isometric zoom is whole numbers between 1 and 4, because a fractional zoom
// makes some art pixels two screen pixels wide and their neighbours one — the
// single most recognisable way a pixel-art screen looks broken
// (`TownScene.controls`). So the follow camera's freedom is not "how close may
// I zoom" but "where inside a fixed range do I sit while following".
//
// It lives in its own module rather than in `view.ts` because `view.ts` is pure
// geometry and holds no camera state at all — no zoom, no scroll, no pan. A
// follow target is a camera decision, and this would be the first camera value
// that file had ever held.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { clampZoom, FOLLOW_ZOOM, followZoom, ZOOM_MAX, ZOOM_MIN } from "../src/follow";

test("the isometric zoom stays a whole number between one and four", () => {
  // The rounding is the claim. A clamp alone would let 2.5 through, and 2.5 is
  // exactly the value the rule exists to forbid — the range is not the
  // constraint, the whole numbers are.
  assert.equal(clampZoom(2.5), 3, "a fractional zoom must be pulled to a whole one");
  assert.equal(clampZoom(0.5), 1, "there is no zoom below 1: it destroys the art rather than showing more of it");
  assert.equal(clampZoom(9), ZOOM_MAX, "there is no zoom above 4 in the isometric view");
  assert.equal(clampZoom(2), 2, "a whole number inside the range is left alone");
  assert.equal(ZOOM_MIN, 1);
  assert.equal(ZOOM_MAX, 4);
});

test("following gets close enough to read, and no closer than the reader already was", () => {
  // The floor is the feature. A machine cel is 32x22 pixels; at 1x — the zoom a
  // big town fits at — it is the 2.5% of the frame the town already complains
  // about in `TownScene.update`, and following a 32-pixel speck is the map view
  // with a lag.
  assert.equal(followZoom(1), FOLLOW_ZOOM, "a fitted town must come closer to follow");
  assert.equal(followZoom(2), FOLLOW_ZOOM);
  assert.equal(followZoom(3), FOLLOW_ZOOM, "already at the floor, so unchanged");
});

test("following never zooms a reader out", () => {
  // `max`, not an assignment. A reader who has deliberately zoomed to 4 to read
  // a building is not asking to be pulled back to 3 the moment they follow
  // something else on the same plot.
  assert.equal(followZoom(4), 4, "a reader who zoomed in keeps their zoom");
  assert.equal(followZoom(99), ZOOM_MAX, "even nonsense input lands inside the range");
});

test("no follow zoom is ever fractional or out of range", () => {
  // A property over the inputs the camera can actually produce, because the
  // rule is an invariant of the module rather than of any one call.
  for (let z = -2; z <= 6; z += 0.25) {
    const f = followZoom(z);
    assert.ok(Number.isInteger(f), `followZoom(${z}) = ${f}, which is not a whole number`);
    assert.ok(f >= ZOOM_MIN && f <= ZOOM_MAX, `followZoom(${z}) = ${f}, which is outside [${ZOOM_MIN}, ${ZOOM_MAX}]`);
  }
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd ui && npm run test:follow`

Expected: FAIL with `Cannot find module '../src/follow'` — esbuild reports the unresolved import and `node --test` exits non-zero. That is the correct failure: the module does not exist yet.

- [ ] **Step 4: Write the implementation**

Create `ui/src/follow.ts`:

```ts
// The follow camera: what zoom it sits at, as numbers.
//
// A follow camera is the only thing in this renderer that decides how close to
// look, and it has to decide it against a rule that is not negotiable — the
// isometric zoom is whole numbers between 1 and 4, because a fractional zoom
// makes some art pixels two screen pixels wide and their neighbours one
// (`TownScene.controls`). So the follow camera's freedom is not "how close may I
// zoom" but "where inside a fixed range do I sit while following".
//
// It is its own module because `view.ts` is pure geometry and holds no camera
// state at all: turn, projection, road routing, and no zoom, no scroll, no pan.
// A follow target is a camera decision, and this would be the first camera value
// that file had ever held.
//
// No Phaser import, deliberately, for the same reason `workers.ts` imports Phaser
// for its types only: a value import pulls the engine in, and the engine touches
// `window` while it is being imported, so a plain `node --test` process could not
// load this file and none of the rules below could be pinned by a test.

/** The lowest zoom the isometric town is drawn at. Below 1 the art is destroyed
 *  rather than more of it shown, which is why the wheel stops here too. */
export const ZOOM_MIN = 1;

/** The highest. Whole numbers at both ends: see the file comment. */
export const ZOOM_MAX = 4;

/**
 * The zoom a follow camera floors itself at.
 *
 * Three, not four. A machine cel is 32x22 pixels, so 4x is the clearest read of
 * the pose — and 3x is the closest zoom that still leaves a building's whole
 * plot and its district's name in frame. Following at 4 would be watching a
 * machine in an empty field, which is the same problem as following at 1 from
 * the other end: the town is what makes one action legible as work on a place.
 */
export const FOLLOW_ZOOM = 3;

/**
 * clampZoom holds a zoom inside the whole-number range the town is drawn at.
 *
 * The rounding is the point, not a convenience. Every caller used to clamp by
 * hand — the wheel handler and the isometric fit each spelled out
 * `Phaser.Math.Clamp(x, 1, 4)` — and both reached it by a route that happened to
 * be integral: the wheel steps by one, and the fit floors before clamping. A
 * third caller that did not would have put a half-width pixel on screen without
 * any of the three of them looking wrong. Stating the range once, with the
 * rounding attached, is what makes the rule a property of the module rather than
 * a coincidence of the call sites.
 */
export function clampZoom(zoom: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(zoom)));
}

/**
 * followZoom is the zoom to sit at while following: at least `FOLLOW_ZOOM`, and
 * never further out than the reader already was.
 *
 * `max` rather than an assignment, for the reason in the test: a reader who has
 * zoomed in deliberately is not asking to be pulled back out. The floor only
 * ever raises.
 */
export function followZoom(current: number): number {
  return clampZoom(Math.max(current, FOLLOW_ZOOM));
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd ui && npm run test:follow`

Expected: PASS, 4 tests.

- [ ] **Step 6: Route the two existing inline clamps through `clampZoom`**

In `ui/src/scene.ts`:

At line 1441, inside the `wheel` handler — replace
```ts
      const next = dy > 0 ? cam.zoom - 1 : cam.zoom + 1;
      cam.setZoom(Phaser.Math.Clamp(next, 1, 4));
```
with
```ts
      const next = dy > 0 ? cam.zoom - 1 : cam.zoom + 1;
      cam.setZoom(clampZoom(next));
```

At line 2090, inside `fit` — replace
```ts
    cam.setZoom(Phaser.Math.Clamp(Math.min(byWidth, byHeight), 1, 4));
```
with
```ts
    cam.setZoom(clampZoom(Math.min(byWidth, byHeight)));
```

**Leave line 2081 alone.** The plan view's `[0.2, 8]` clamp is a different rule for a different view: a plan draws rectangles, not skewed cels, so a fractional zoom is legitimate there and the comment above it says so. It does not go through `clampZoom`.

Add the import to `ui/src/scene.ts`'s import block, alongside the existing `./view` import:
```ts
import { clampZoom } from "./follow";
```

- [ ] **Step 7: Confirm the refactor changed no behaviour**

Run: `cd ui && npm run test:plan && ./node_modules/.bin/tsc --noEmit -p tsconfig.json`

Expected: `test:plan` passes (it is the suite that exercises `fit`'s zoom), `tsc` empty.

Then run the full suite once, because two clamp sites changed:
`cd ui && npm test`
Expected: all pass.

- [ ] **Step 8: Report instead of committing**

```bash
git add -A && git diff --cached --stat
```

---

## Task 2: The label namespace, and the followed caption

Follow needs to keep one machine's Action Caption lit, and the store needs to say which machine. Both need the `worker:<id>` prefix, which today is private to `workers.ts` — a module that imports the store, so the store cannot import it back. `visibility.ts` imports nothing and already owns the label rule, so it becomes the prefix's home.

**Files:**
- Modify: `ui/src/visibility.ts` (add `workerLabelId`; extend `labelVisible`)
- Modify: `ui/src/workers.ts:77-85` (delete the local `workerLabelId`), `:44` (import it), `:630-634` (`applyLabels` takes `following`)
- Modify: `ui/src/scene.ts:1205-1223` (`refreshLabels` passes `following`), `:1222` (`applyLabels` call)
- Test: `ui/test/visibility.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  ```ts
  // ui/src/visibility.ts
  export const workerLabelId: (id: string) => string;   // "worker:<id>"
  export function labelVisible(
    id: string,
    hovered: string | null,
    focused: string | null,
    following?: string | null,
  ): boolean;
  // ui/src/workers.ts
  class WorkerLayer {
    applyLabels(focused: string | null, hovered: string | null, following: string | null): void;
  }
  ```
  The `following` parameter on `labelVisible` is **optional and last**, so both existing two- and three-argument call sites keep compiling. Task 3 and Task 4 pass it.

- [ ] **Step 1: Write the failing test**

In `ui/test/visibility.test.ts`, add after the existing test `losing the focus leaves only the hover standing`:

```ts
test("a followed figure keeps its caption lit", () => {
  // A follow camera is a request to watch one machine, and the caption is the
  // only thing that says which of the eight actions the pose is standing in
  // for. Following without it would leave a reader watching a machine hammer
  // and reading nothing.
  const id = workerLabelId("chief:s1");
  assert.equal(labelVisible(id, null, null, "chief:s1"), true, "following pins the caption open");
  assert.equal(labelVisible(id, null, null, "chief:s2"), false, "following another machine does not");
  // The case that decides whether the rule composes: a reader who follows a
  // machine and then clicks a building moves the *focus*, and the caption has to
  // stay lit anyway. Focus and follow are different acts — one is a click, one
  // is a standing choice — and the second must not be undone by the first.
  assert.equal(labelVisible(id, null, "building:internal", "chief:s1"), true, "a building click must not unpin a followed caption");
});

test("following one figure cannot light another's label", () => {
  // The same collision the `worker:` prefix exists to prevent, one step further
  // on: a site id and a worker id are drawn from different owners, and a follow
  // target is a third place that has to agree about which object it means.
  assert.equal(labelVisible("building:internal", null, null, "chief:s1"), false, "a site is not a figure");
  assert.equal(labelVisible(workerLabelId("chief:s1"), null, null, "chief:s1"), true);
});

test("the label rule is unchanged for a reader who is not following", () => {
  // A fourth argument that defaulted to "followed" would turn every pinned
  // label on the map into a permanently visible one, which is the wall of
  // thirteen boards ADR-0019 was written to undo.
  assert.equal(labelVisible("a", null, null), false);
  assert.equal(labelVisible("a", null, "a"), true);
  assert.equal(labelVisible("a", "a", null), true);
});
```

Add to the file's import from `../src/visibility` so the file has what it needs:

```ts
import { labelVisible, visibleAt, workerLabelId } from "../src/visibility";
```

(Read the existing import line first and extend it rather than adding a second import from the same module.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ui && npm run test:visibility`

Expected: FAIL. `workerLabelId` is not exported from `ui/src/visibility.ts` — esbuild reports no matching export. That is the correct failure.

- [ ] **Step 3: Move the prefix into `visibility.ts` and extend the rule**

In `ui/src/visibility.ts`, add after `labelVisible` (line 64). First replace `labelVisible` with:

```ts
export function labelVisible(
  id: string,
  hovered: string | null,
  focused: string | null,
  following: string | null = null,
): boolean {
  return (
    id === focused ||
    id === hovered ||
    (following !== null && id === workerLabelId(following))
  );
}
```

and update its doc comment by appending, after the paragraph ending *"a preview and a focus can therefore both be lit…"*:

```
 * A followed figure is a fourth thing that shows a label, and it is the one
 * case that is not a pointer at all: following a machine is a request to watch
 * it work, and its caption is the only thing that says which of the eight
 * actions the pose is standing in for. It is scoped to one id for the same
 * reason focus is — two machines both "followed" would be two cameras, and there
 * is one.
```

Then add the prefix itself, before `labelVisible`:

```ts
/**
 * workerLabelId is the id a figure's caption is focusable and hoverable under.
 *
 * Namespaced, because the store's `focused`/`hovered`/`following` carry ids from
 * two owners — `WorkerLayer`'s figures and the scene's buildings — and a raw
 * worker id that happened to equal a site id would light both labels at once.
 * The prefix makes that collision impossible rather than unlikely.
 *
 * It lives here rather than in `workers.ts` because the store needs it too: the
 * follow state is written by the store and read by the scene, and `workers.ts`
 * imports the store, so a prefix declared there could not be imported back
 * without a cycle. This module imports nothing, so both can reach it.
 */
export const workerLabelId = (id: string): string => `worker:${id}`;
```

- [ ] **Step 4: Delete the duplicate from `workers.ts`**

In `ui/src/workers.ts`, delete lines 77-85 — the `workerLabelId` declaration and the doc comment above it. Change the import at line 44 from:

```ts
import { labelVisible } from "./visibility";
```

to:

```ts
import { labelVisible, workerLabelId } from "./visibility";
```

- [ ] **Step 5: Widen `applyLabels` to the followed rule**

In `ui/src/workers.ts`, read `applyLabels` at lines 630-634 and change its signature and its `labelVisible` call so `following` reaches the rule. The method is a three-line sweep over `this.captions`; add the third parameter, pass it to `labelVisible`, and extend its doc comment with one sentence saying that a followed figure's caption is lit for as long as the follow lasts, for the same reason `labelVisible` states — the caption is what names the action, and a followed machine with no caption is one the reader cannot act on.

Then find where `applyLabels` is called inside `sync` — read lines 495-505. It destructures `{ focused, hovered }` from `useTown.getState()` and passes both. Add `following` to the destructuring and to the call, so the sweep reflects a follow that engaged after the last layout draw.

- [ ] **Step 6: Pass `following` through the scene's sweep**

In `ui/src/scene.ts`, read `refreshLabels` at lines 1205-1223. It reads `{ focused, hovered }` and calls `this.workers?.applyLabels(focused, hovered)`. Add `following` to both.

Its `for (const [id, images] of this.labels)` loop does not need it: those are site label ids, and `labelVisible` compares them against `workerLabelId(following)`, which no site id can equal. Leave that loop alone.

- [ ] **Step 7: Run the tests**

Run: `cd ui && npm run test:visibility && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && npm test`

Expected: all pass, `tsc` empty.

- [ ] **Step 8: Report instead of committing**

```bash
git add -A && git diff --cached --stat
```

---

## Task 3: The follow state, and a crew you can name

`following` is a selection, so it goes in the store beside `focused` — not in the scene, because the panel has to be able to show it and clear it. It holds a **raw worker id**, not the prefixed label id: the panel row has `w.id` in hand, and the prefix belongs to the label rule rather than to the identity of a machine.

**Files:**
- Modify: `ui/src/store.ts` (state key, two actions, `setCurrent`, `focus`)
- Modify: `ui/src/actions.ts` (add `crewLabel`)
- Test: `ui/test/follow.test.ts` (append the store and `crewLabel` cases)

**Interfaces:**
- Consumes: `workerLabelId` from `ui/src/visibility.ts` (Task 2).
- Produces:
  ```ts
  // ui/src/store.ts — additions to the useTown store
  following: string | null;
  follow: (id: string) => void;
  unfollow: () => void;

  // ui/src/actions.ts
  export function crewLabel(agent: string, session: string): string;
  ```
  Task 4 reads `following` in the scene tick. Task 5 wires the panel to `follow`/`unfollow`/`crewLabel`.

- [ ] **Step 1: Write the failing tests**

Append to `ui/test/follow.test.ts`:

```ts
// --- who is being followed, and who is who -----------------------------------

import { useTown } from "../src/store";
import { crewLabel } from "../src/actions";

test("following a machine pins its caption, and following another moves the pin", () => {
  // The caption is what says which of the eight actions the pose stands in for,
  // so a follow that did not pin it would be a reader watching a machine hammer
  // with nothing naming the hammer. It moves rather than stacks because `focused`
  // is a single id on purpose (store.ts) — two lit captions would be a second
  // thing to keep in step, for no reader who wants it.
  useTown.getState().follow("chief:a");
  assert.equal(useTown.getState().following, "chief:a");
  assert.equal(useTown.getState().focused, workerLabelId("chief:a"));

  useTown.getState().follow("chief:b");
  assert.equal(useTown.getState().following, "chief:b");
  assert.equal(useTown.getState().focused, workerLabelId("chief:b"), "the pin moved with the follow");
});

test("releasing a follow un-pins the caption it pinned", () => {
  // Asymmetric on purpose. Following sets the focus, so releasing has to clear
  // it — otherwise stopping leaves a caption lit that no pointer is on and no
  // focus is asking for, which is the one state ADR-0019's rule cannot produce.
  useTown.getState().follow("chief:c");
  useTown.getState().unfollow();
  assert.equal(useTown.getState().following, null);
  assert.equal(useTown.getState().focused, null, "the caption the follow pinned must not outlive it");
});

test("switching projects drops the follow", () => {
  // A worker id from the project being left names nothing in the one being
  // opened. Left set, the camera would resolve a target that does not exist and
  // sit over whatever coordinate it used to occupy — or, with the release in
  // Task 4, silently unfollow itself on the first frame and look like a bug.
  useTown.getState().follow("chief:d");
  useTown.getState().setCurrent("/some/other/project");
  assert.equal(useTown.getState().following, null, "a stale id must not survive a project switch");
  assert.equal(useTown.getState().focused, null);
});

test("two sessions of one agent are told apart by their names", () => {
  // The reason a session name is in the panel at all. Two omp sessions on one
  // repo are two chiefs of the same agent, and without this the Crew list shows
  // two identical rows and following is a coin toss.
  const a = crewLabel("omp", "01a0b0ab-1111-2222-3333-444455556666");
  const b = crewLabel("omp", "01a0b0cd-1111-2222-3333-444455556666");
  assert.notEqual(a, b, "two sessions of one agent must not render the same name");
  assert.ok(a.startsWith("omp"), "the agent is still the first word a reader looks for");
});

test("a session with no id still names its agent", () => {
  // A daemon that has not reported a session id, or a hand-written frame, must
  // not produce a row reading "omp undefined" — that is worse than no name,
  // because it looks like a real value that went wrong.
  assert.equal(crewLabel("pi", ""), "pi");
});
```

And extend the file's import from `../src/visibility` to include `workerLabelId` (Task 2 added it there):

```ts
import { workerLabelId } from "../src/visibility";
```

> **Note for the executor:** the tests above import `../src/store` and `../src/actions` at a point below the existing imports. Hoist all imports to the top of the file with the rest, matching `ui/test/routing.test.ts`, before running. A mid-file `import` is valid ESM but is not this repo's style.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ui && npm run test:follow`

Expected: FAIL. `crewLabel` is not exported from `../src/actions`, and `follow`/`unfollow` are not on the store. esbuild reports both missing exports.

> If the failure is a module-load error inside `zustand` rather than a missing export, stop and report it. `useTown` is created by `zustand`'s `create`, which pulls React in; if a plain `node --test` process cannot load it, keep the two `crewLabel` tests in this file, move the three store tests into `ui/src/App.tsx`'s behaviour where they can be exercised in the browser, and **say so in the final report** rather than deleting them silently. `selftest.test.ts` bans `as unknown as T` and a test that cannot be written honestly is better reported than faked.

- [ ] **Step 3: Add `crewLabel` to `ui/src/actions.ts`**

Append after `targetOf` (ends at line 73):

```ts
/**
 * crewLabel is what a crew is called in the panel: the agent, then enough of its
 * session to tell two of them apart.
 *
 * The session is the whole of the disambiguation, and it is needed because the
 * daemon builds one chief per session with the same agent name — two omp
 * sessions on one repo are two identical rows without it, and following is a
 * coin toss. Eight characters is enough to separate UUIDs and short enough to sit
 * beside an action in a 316px column.
 *
 * A session with no id gets the agent alone rather than a trailing separator:
 * "omp undefined" reads as a real value that went wrong, which is worse than no
 * name at all.
 */
export function crewLabel(agent: string, session: string): string {
  return session ? `${agent} ${session.slice(0, 8)}` : agent;
}
```

- [ ] **Step 4: Add the follow state to the store**

In `ui/src/store.ts`, add the import. The file does not currently import from `./visibility`; add it alongside the existing imports:

```ts
import { workerLabelId } from "./visibility";
```

Add the state key to the `State` interface, immediately after `hovered` (line 241) and its doc comment:

```ts
  /**
   * The one machine the camera is following, or null.
   *
   * A selection, like `focused` and not like the camera: it says *what* the
   * reader has chosen to watch, and the scene works out where to point. Nothing
   * about the camera itself — no zoom, no scroll, no pan — lives here, which is
   * what lets the transport stay one-way and the camera stay local
   * (`TownScene` header, ADR-0002).
   *
   * A raw worker id, not the `worker:<id>` label id, because the thing being
   * followed is a machine and not a caption; the prefix belongs to the label
   * namespace and is applied at the two places that address a caption.
   *
   * One, not a set: one camera, one target. Two would be two cameras, which is
   * a different feature and was explicitly not what was asked for.
   */
  following: string | null;
```

Add the two actions to the `State` interface's action list, after `hover` (line 308):

```ts
  /** follow points the camera at a machine and pins its caption open. */
  follow: (id: string) => void;
  /** unfollow releases the camera and unpins the caption following pinned. */
  unfollow: () => void;
```

Initialise it in the store body, after `hovered: null` (line 345):

```ts
  following: null,
```

Add the two action bodies, after `hover` (line 376):

```ts
  // Following pins the caption as a side effect rather than leaving it to each
  // call site. There are two call sites — a click on the machine and a click on
  // its row in the panel — and a caption that is lit for a machine being
  // followed but not for one it is not would make the follow look broken in one
  // of them. Focus is a single id, so a new follow moves the pin rather than
  // adding a second.
  follow: (following) => set({ following, focused: workerLabelId(following) }),
  // Clearing the pin on release is the asymmetry the other half of that comment
  // is about: following set the focus, so a stop that left it lit would leave a
  // caption showing for no pointer and no focus, which is the one state the
  // label rule cannot otherwise produce.
  unfollow: () => set({ following: null, focused: null }),
```

Add `following: null` to the `setCurrent` reset (line 357-372), beside `focused: null` and `hovered: null`:

```ts
      // The follow goes with them for the same reason, and harder: a live id
      // resolves to a real machine in the town being opened only by accident, and
      // a camera pointed at an id that names nothing is a camera pointed at a
      // coordinate it remembers.
      following: null,
```

- [ ] **Step 5: Run the tests**

Run: `cd ui && npm run test:follow`

Expected: PASS, 9 tests.

- [ ] **Step 6: Typecheck and run the suite**

Run: `cd ui && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && npm test`

Expected: `tsc` empty, all suites pass.

- [ ] **Step 7: Report instead of committing**

```bash
git add -A && git diff --cached --stat
```

---

## Task 4: The camera follows the machine

The follow tick, the position lookup it reads, and the four places that would otherwise fight it. This is the whole feature; the rest is how a reader starts and stops it.

**Files:**
- Modify: `ui/src/workers.ts` (add `positionOf`; the hit zone follows as well as focuses)
- Modify: `ui/src/scene.ts` (`followTick`, `followZoomBefore`, the `update` call, the view-toggle release)

**Interfaces:**
- Consumes: `following`/`unfollow` from the store (Task 3); `clampZoom`/`followZoom` from `ui/src/follow.ts` (Task 1); `workerLabelId` from `ui/src/visibility.ts` (Task 2).
- Produces:
  ```ts
  // ui/src/workers.ts
  class WorkerLayer {
    positionOf(id: string): { x: number; y: number } | null;
  }
  // ui/src/scene.ts — private
  private followZoomBefore: number | null;
  private followTick(): void;
  ```
  Task 5 adds no scene surface; it drives the same store actions the map click drives.

- [ ] **Step 1: Add `positionOf` to `WorkerLayer`**

In `ui/src/workers.ts`, add immediately after `setRoads` (which ends at line 426), so the two public accessors sit together above the constructor:

```ts
  /**
   * positionOf is where a figure is right now, in picture pixels, or null when
   * there is no such figure.
   *
   * Read by the follow camera, which has to ask every frame and cannot work it
   * out for itself: a travelling machine's position is written by its own
   * stepper from the arc length of its route (`stepper`), and neither the route
   * nor the sprite is reachable from outside this class.
   *
   * The sprite's own position rather than `groundY`, which differs by the walk
   * lift of 0 or 1 pixel: a camera aiming at a body that bobs on its tracks
   * inherits the bob, and one aiming at the ground it is not standing on would
   * be aiming at a point the reader cannot see anything at.
   *
   * Null rather than a stale point is the whole contract. `remove` destroys the
   * sprite and every per-worker map when the daemon stops reporting a session,
   * and a follow camera holding the last coordinate it saw would sit over empty
   * ground for the rest of the session — pointing at nothing with full
   * confidence, which is the one thing this town must never do.
   */
  positionOf(id: string): Point | null {
    const sprite = this.sprites.get(id);
    if (!sprite) return null;
    return { x: sprite.x, y: sprite.y };
  }
```

`Point` is already imported at `ui/src/workers.ts:38`.

- [ ] **Step 2: Make a click on a machine follow it**

In `ui/src/workers.ts`, read the hit zone's handlers at lines 609-615. Replace:

```ts
    zone.on("pointerup", () => {
      if (!this.dragged()) useTown.getState().focus(workerLabelId(w.id));
    });
```

with:

```ts
    zone.on("pointerup", () => {
      // The same gesture that focuses a caption now follows the machine, and
      // the two are the same act: pointing at a figure and clicking it is asking
      // what it is *and* to watch it, and the walk between buildings is most of
      // what a machine does — a caption says "Hammering / internal" and shows
      // none of it.
      if (this.dragged()) return;
      // Clicking the machine you are already following stops following it, so
      // the same gesture both starts and ends. There is no keyboard handler in
      // this app and adding one for an escape hatch would be the first
      // (TownScene.controls registers pointer events only), and a visible stop
      // control is in the panel either way.
      const { following, follow, unfollow } = useTown.getState();
      if (following === w.id) unfollow();
      else follow(w.id);
    });
```

Note this **replaces** the `focus(workerLabelId(w.id))` call rather than adding to it: `follow` already pins the focus (Task 3), so calling both would be the same write twice.

- [ ] **Step 3: Add the tick and the saved zoom to the scene**

In `ui/src/scene.ts`, add the field beside the other camera fields at lines 305-308:

```ts
  /**
   * The zoom the reader was at before following started, or null when not
   * following.
   *
   * Doubles as the "am I following" flag, which is why it is a number and not a
   * separate boolean: the two can never disagree, and there is no state in which
   * a restore is owed but nothing says so.
   *
   * Camera state, deliberately not in the store — the store says *what* is being
   * watched and nothing about how (see `State.following`).
   */
  private followZoomBefore: number | null = null;
```

Add the tick, immediately after `update` ends (line 1501) and before the method that follows it:

```ts
  /**
   * followTick keeps the camera on the followed figure.
   *
   * The policy is three numbers and a lookup — a target, a zoom, and
   * `centerOn` — and everything that makes following awkward is about not
   * fighting the other five places the camera is written.
   *
   * Called from `update` above the embers' early return, because a reader
   * watching a machine is watching the one thing on screen that matters whether
   * or not the town has a layout yet.
   */
  private followTick(): void {
    const cam = this.cameras.main;
    const { following, unfollow } = useTown.getState();

    // A drag is the reader taking the camera back, and the pointer is already
    // down when it starts — the same gesture that picked the figure. Phaser
    // runs `update` after input, so without this the follow visibly wins the
    // reader's own drag. Yielding for as long as the pointer is down lets them
    // look around the machine without fighting it. Letting go re-centres it,
    // which is the follow's contract rather than a snap-back to apologise for.
    if (this.dragging) return;

    if (following === null) {
      // Releasing restores the reader's own zoom rather than re-fitting. A fit
      // would answer "where is the town" to a reader who asked "where was I",
      // and the pan they had set would be gone.
      if (this.followZoomBefore !== null) {
        cam.setZoom(clampZoom(this.followZoomBefore));
        this.followZoomBefore = null;
      }
      return;
    }

    const at = this.workers?.positionOf(following) ?? null;
    // No figure means the daemon stopped reporting that session, and
    // `WorkerLayer.remove` has already taken the sprite out. Release rather than
    // hold the last point: a camera with full confidence and nothing to look at
    // is the failure this town is not allowed to have.
    if (!at) {
      unfollow();
      return;
    }

    if (this.followZoomBefore === null) {
      // Saved on the first frame of a follow, not at the call that started it,
      // so the zoom is whatever the camera actually had — including a fit that
      // landed a frame earlier.
      this.followZoomBefore = cam.zoom;
      cam.setZoom(followZoom(cam.zoom));
    }
    // `setBounds` in `draw` already clamps a target that walks to the edge of the
    // town, and that is the right answer: the camera may follow a machine across
    // the land, not off it.
    cam.centerOn(at.x, at.y);
  }
```

- [ ] **Step 4: Call the tick from `update`**

In `ui/src/scene.ts`, in `update` (line 1470-1501), insert after the `drawPlanWorkers()` call at line 1478 and before the `if (!this.embers || !this.layout) return;` at line 1479:

```ts
    // The follow camera is above the embers' guard for the same reason the plan's
    // crews are: it is one of the two things a reader is watching, and it must
    // move on a town that has no embers yet exactly as much as on one that does.
    this.followTick();
```

- [ ] **Step 5: Release the follow on a view toggle**

In `ui/src/scene.ts`, in the store subscription, the view branch at lines 395-406, add the release beside `this.fittedSignature = ""`:

```ts
        // Following ends at the plan view. The plan is not a camera on the town
        // but a second drawing of the layout (`plan.ts`), and a machine in it is
        // a 9px mark in its crew's colour, not a figure — there is nothing to
        // follow. It also has its own `[0.2, 8]` zoom, so carrying a follow zoom
        // across would hand the plan a framing it never chose. The fit below
        // re-frames anyway.
        useTown.getState().unfollow();
```

- [ ] **Step 6: Typecheck and run the suite**

Run: `cd ui && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && npm test`

Expected: `tsc` empty, all suites pass.

There is **no unit test in this task**, and that is deliberate rather than a gap. The three rules that could be unit-tested are already covered in Task 1 (`clampZoom`, `followZoom`) and Task 2 (`labelVisible` with a follow). What is left is three lines wiring a Phaser camera to a sprite position, and the only honest test of that is looking at it — Task 5 does that. Constructing a `WorkerLayer` in a `node --test` process is not currently possible: the class needs Phaser textures, `scene.events` and `scene.time.now`, and no existing test constructs one.

- [ ] **Step 7: Report instead of committing**

```bash
git add -A && git diff --cached --stat
```

---

## Task 5: The crew list names its crews and follows them

The entry point a reader uses most: a row in the panel. It needs the session name — without it two omp sessions are two identical rows and following is a coin toss — and a visible way to stop.

**Files:**
- Modify: `ui/src/App.tsx:560-578` (the crew list), and the hook block at lines 195-217
- Modify: `ui/index.html:403-437` (styles)
- Verify: live in a browser

**Interfaces:**
- Consumes: `following`, `follow`, `unfollow` from the store (Task 3); `crewLabel` from `ui/src/actions.ts` (Task 3).
- Produces: nothing new. This is the last consumer of every interface above.

- [ ] **Step 1: Read the panel's hook block and add the three subscriptions**

In `ui/src/App.tsx`, the hook block runs from about line 195 to line 217. Add three lines beside the existing `focus` subscription at line 207:

```ts
  const following = useTown((s) => s.following);
  const follow = useTown((s) => s.follow);
  const unfollow = useTown((s) => s.unfollow);
```

In the same component, beside the `built` / `place` / `drawnName` derivations (lines 223-238), add:

```ts
  // The machine being watched, for the banner. Null when the follow has been
  // released but the worker is still on screen, which is the ordinary case the
  // banner has to render as nothing rather than as a dangling name.
  const watched = following ? live.workers.find((w) => w.id === following) : undefined;
```

- [ ] **Step 2: Rewrite the crew list**

In `ui/src/App.tsx`, replace lines 560-578 — the whole `{live.workers.length > 0 && ( <section className="crew"> … )}` block — with:

```tsx
        {live.workers.length > 0 && (
          <section className="crew">
            <h2>Crew</h2>
            {/* What the camera is on, and the one control that stops it. It sits
                above the list rather than on the row because a row is also a
                target: a reader who has lost the machine in a big town needs one
                place that says which one, and one place to undo the choice. */}
            {watched && (
              <p className="following-now">
                <span className="nm">Following</span>
                <span className="who">{crewLabel(watched.agent, watched.session)}</span>
                <span className="what">{actionInfo(watched.action).plain}</span>
                <button type="button" onClick={unfollow}>
                  Stop
                </button>
              </p>
            )}
            <ul>
              {live.workers.map((w) => {
                const on = following === w.id;
                return (
                  <li key={w.id} className={w.action === "celebrating" ? "done" : ""}>
                    {/* A button rather than a click handler on the row: this is
                        the one control in the panel that changes what the map is
                        doing rather than what the panel is describing, and it has
                        to be reachable by keyboard and announce its state. */}
                    <button
                      type="button"
                      className={`follow ${on ? "on" : ""}`}
                      aria-pressed={on}
                      onClick={() => (on ? unfollow() : follow(w.id))}
                    >
                      <span className={`tier ${w.tier}`}>{w.tier}</span>
                      {/* Agent plus the head of the session id. Two sessions of
                          one agent are the ordinary case — one repo, one agent,
                          two terminals — and without this the list shows two
                          identical rows. */}
                      <span className="agent">{crewLabel(w.agent, w.session)}</span>
                      {/* The world's word is the map's job — it captions the figure
                          itself. Here the panel has room to be exact, so it says
                          what the agent actually did rather than which animation
                          is playing: "editing an existing file", not "hammering". */}
                      <span className="action">{actionInfo(w.action).plain}</span>
                      <span className="at">{targetOf(w.place, SITE_ID_BUILDING_PREFIX)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
```

Then extend the import at `ui/src/App.tsx:8` from
```ts
import { actionInfo, targetOf } from "./actions";
```
to
```ts
import { actionInfo, crewLabel, targetOf } from "./actions";
```

- [ ] **Step 3: Style the new parts**

In `ui/index.html`, after the `.crew .at` block (which ends at line 437, before the blank line and `.feed` at 439), add:

```css
      /* The follow control. It wraps the row's spans rather than sitting beside
         them, so the row's own left rule, its tier chip and its place name keep
         the positions they had — the reader who never follows sees the same list
         they saw before, with a different cursor over it. */
      .crew .follow {
        display: flex;
        gap: 7px;
        align-items: baseline;
        width: 100%;
        padding: 0;
        border: 0;
        background: none;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      /* The followed row says so by its own rule, the same one-pixel signal the
         rest of the panel uses for a crew's agent colour, rather than by a wash:
         a whole-row tint on the one row the camera is on would be the loudest
         thing in a 316px column. */
      .crew .follow.on { box-shadow: inset 2px 0 0 var(--accent); padding-left: 4px; }
      .crew .follow:focus-visible { outline: 1px solid var(--accent); outline-offset: 1px; }

      /* The banner. A reader who has lost the machine in a big town needs one
         line that says which one it is and one control that stops it; both are
         here rather than on the row so they are found without hunting the list
         for the row that is currently lit. */
      .crew .following-now {
        display: flex;
        gap: 7px;
        align-items: baseline;
        margin: 0 14px 8px 12px;
        padding: 4px 0 4px 8px;
        border-left: 1px solid var(--accent);
      }
      .crew .following-now .nm {
        font-family: var(--pixel);
        font-size: 8px;
        text-transform: uppercase;
        letter-spacing: .06em;
        color: var(--text-dim);
      }
      .crew .following-now .who { color: var(--testing); }
      .crew .following-now .what {
        color: var(--text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .crew .following-now button {
        margin-left: auto;
        font-family: var(--pixel);
        font-size: 8px;
        text-transform: uppercase;
        letter-spacing: .06em;
        color: var(--void);
        background: var(--accent);
        border: 0;
        padding: 2px 5px;
        cursor: pointer;
      }
      .crew .following-now button:focus-visible { outline: 1px solid var(--text); outline-offset: 1px; }
```

Every variable used above is already declared in this file's `:root` block — confirmed by reading it, so none of these rules can fail silently on an unset name:

| Variable | Value | Line |
|---|---|---|
| `--void` | `#0e141c` | `ui/index.html:35` |
| `--raised` | `#1e2733` | `ui/index.html:37` |
| `--edge` | `#2c3846` | `ui/index.html:39` |
| `--edge-lit` | `#3d4d5e` | `ui/index.html:40` |
| `--text` | `#d7e0ea` | `ui/index.html:42` |
| `--text-dim` | `#8595a8` | `ui/index.html:43` |
| `--accent` | `#e6bb38` | `ui/index.html:44` |
| `--down` | `#cf5a42` | `ui/index.html:47` |
| `--testing` | `#5aa9d9` | `ui/index.html:48` |
| `--done` | `#57b8a0` | `ui/index.html:49` |

`--accent` is the right colour for the followed row: `palette.ts:80` names it as the one already used for the chief's helmet top, the crew flag and the panel's live marks, so the follow state joins the existing accent rather than introducing a fifth signal colour.

- [ ] **Step 4: Build and typecheck**

Run:
```bash
cd ui && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && ./node_modules/.bin/vite build
```
Expected: `tsc` empty, build succeeds.

- [ ] **Step 5: Drive it in a real browser**

This is the verification that matters, and it is not optional: Tasks 1-4 are wiring, and wiring is exactly the thing that compiles and does nothing.

Start the daemon on this project, in the background:

```bash
go run ./cmd/townd --dir .
```

Then drive a machine without an LLM. The daemon's `POST /events` accepts the same frames an extension sends (`internal/agent/frame.go`), so a `curl` produces a real live worker with real movement — no API key, no model, and repeatable:

```bash
D=$PWD
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:7777/events \
  -H 'Content-Type: application/json' \
  -d "{\"kind\":\"hello\",\"directory\":\"$D\",\"seq\":1,\"agent\":\"omp\",\"sessionID\":\"smoke-a\"}"
```

Expect `204`. Then a tool event that names a file inside a building, so the machine has somewhere to walk to:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:7777/events \
  -H 'Content-Type: application/json' \
  -d "{\"kind\":\"tool.after\",\"directory\":\"$D\",\"seq\":2,\"agent\":\"omp\",\"sessionID\":\"smoke-a\",\"type\":\"FILE_READ\",\"tool\":\"read\",\"callID\":\"c1\",\"args\":{\"path\":\"$D/ui/src/follow.ts\"},\"isError\":false,\"time\":$(date +%s000)}"
```

Expect `204`. Add a second session so the two-rows-are-distinguishable claim is actually observed rather than assumed — repeat both curls with `"sessionID":"smoke-b"`, `"seq":1` and `"seq":2`, and a different `args.path` such as `"$D/internal/town/town.go"`.

Now open the UI with the `browser` tool at `http://127.0.0.1:7777/`, and check each of these by looking at the page, not by reading the code:

1. **Two distinct crew rows.** The Crew list shows two rows, both beginning `omp`, with different eight-character session fragments. Screenshot them.
2. **Following engages.** Click the first row. The camera moves to that machine, the row is marked as pressed, the banner appears above the list naming the crew and what it is doing, and the machine's Action Caption is lit. Screenshot.
3. **The zoom really changed.** Read the camera zoom from the page — `window.__town` is the Phaser game (`ui/src/TownCanvas.tsx:46`), so evaluate `window.__town.scene.scenes[0].cameras.main.zoom` and expect `3` (or `4` if the reader had zoomed in first). Also read `scrollX` before and after a second, different tool event to confirm the camera moved.
4. **The machine walks and the camera follows.** Post another `tool.after` for a *different* file, and screenshot a few seconds later. The camera should have travelled with the machine, not snapped to the fit.
5. **Releasing restores.** Click **Stop**. The banner disappears, the row unpresses, and the zoom returns to what it was before the follow — verify by reading `cameras.main.zoom` again.
6. **Re-targeting.** Click the *other* row. The camera moves to that machine, the banner names the new one, and only one row is marked.
7. **A drag yields.** Press and drag the map while following. The camera follows the pointer. Release, and the follow resumes from where the drag left it.
8. **The plan view releases.** With a follow running, click the plan/iso toggle. The camera re-fits for the plan, the banner is gone, and switching back does **not** restore the follow.
9. **A session ending releases.** Post a `session.end` frame for the followed session:
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:7777/events \
     -H 'Content-Type: application/json' \
     -d "{\"kind\":\"session.end\",\"directory\":\"$D\",\"seq\":9,\"agent\":\"omp\",\"sessionID\":\"smoke-a\"}"
   ```
   Within a couple of seconds the banner must disappear on its own, and the camera must not be left pointing at the coordinate the machine used to occupy.

If the daemon serves the UI from a different port than 7777, read the port it logs at startup and use that.

**Report honestly.** If a step cannot be run — no daemon, no browser, no port — say which and why in the final report. Do not describe the follow as working on the strength of a passing typecheck.

- [ ] **Step 6: Run the whole suite**

Run: `cd ui && npm test`
Expected: all pass.

- [ ] **Step 7: Report instead of committing**

```bash
git add -A && git diff --cached --stat
```

---

## Task 6: Record the decision and the new word

A follow view is the second time this project has been asked for a camera it does not have, and the first time a reader-facing *mode* has been added to the view preferences. Both belong in the record, or the next person re-asks.

**Files:**
- Create: `docs/adr/0022-follow-is-a-camera-not-a-projection.md`
- Modify: `CONTEXT.md` (glossary entry; the ADR list; the Open Questions note)

**Interfaces:**
- Consumes: nothing. Documentation only.

- [ ] **Step 1: Write ADR-0022**

Create `docs/adr/0022-follow-is-a-camera-not-a-projection.md`, following the shape of `docs/adr/0020-the-view-turns-the-world-does-not.md` — Context, Decision, Why, Consequences:

```markdown
# ADR-0022: A follow view is a camera, not a projection

## Context

The request was "a 3rd person view for each agent, so I can see each agent
work in action".

The renderer is a fixed 2:1 dimetric projection with no rotation and no
perspective anywhere in the system (`DESIGN.md`), and every cel — 1145 of them
at last count — has the 2:1 skew baked into its pixels. `store.ts` says what
that costs in the sharpest terms available: the plan view is a second *drawing*
of the layout because a top-down rendering of that art "is not a transform, it
is a re-authoring of all 1145 cels".

So the literal reading of the request — a camera behind a machine, over its
shoulder, at whatever angle the machine happens to be facing — is not a camera
change. It is 1145 cels re-authored per angle, or a projection the rest of the
system would then have to agree with.

What was actually being asked for is the thing a third-person camera is *for*:
follow one agent and watch it work. That is a camera decision, and this renderer
has a camera.

## Decision

**A follow view is the existing camera, re-aimed at a moving target each frame.
It adds a target and a zoom floor, and no new projection, no new camera object
and no new art.**

1. **One followed machine at a time, on `cameras.main`.** A second camera per
   agent — a picture-in-picture strip — is a different feature with a different
   cost: N extra Phaser cameras, a per-camera ignore list, a second draw
   surface, and insets small enough that the integer-zoom rule has to bend. It
   was offered and declined.

2. **The zoom range does not widen. Following floors it at 3.** The isometric
   zoom stays whole numbers in `[1,4]`, because a fractional zoom makes some art
   pixels two screen pixels wide and their neighbours one — the single most
   recognisable way a pixel-art screen looks broken. What changes is where in
   that range a follow sits: never closer out than 3, and never further out than
   the reader already was. A machine cel is `32x22`; at 1x it is the 2.5% of
   the frame `TownScene.update` already complains about, and following a
   32-pixel speck is the map view with a lag.

3. **The target is resolved from the sprite, every frame.** Not from the layout
   and not from a remembered coordinate. A machine's position is written by its
   own per-journey stepper from the arc length of its route, which means it is
   only knowable from the figure itself.

4. **A target that disappears releases the follow.** The daemon stops reporting
   a session, `WorkerLayer.remove` takes the sprite out, and the next frame has
   no position — so the follow ends. A camera that held its last known point
   would sit over empty ground with full confidence, which is the one thing this
   town is not allowed to do.

5. **A drag wins, for as long as it lasts.** Phaser runs `update` after input,
   so a follow tick that did not yield would visibly take the camera back from
   the reader mid-gesture — on the same gesture that started the follow.

6. **Following pins the caption, and releasing unpins it.** The caption is the
   only thing that says which of the eight actions a pose is standing in for.
   The pin is set and cleared by the follow rather than left to each call site,
   because there are two call sites and a caption lit for one and not the other
   would make the follow look broken in one of them.

7. **The plan view releases the follow.** A plan is a second drawing of the
   layout, not a camera on the town, and a machine in it is a 9px mark in its
   crew's colour. There is nothing to follow, and the plan's `[0.2, 8]` zoom
   would inherit a framing it never chose.

## Why

**Why not author the angles.** Because the cost is not a camera line, it is the
art system. The town bakes one cel per square footprint per turn already, and a
facing an art system has no notion of is a dimension the atlas does not have.

**Why a follow rather than a close-up.** Because the town is what makes one
action legible as work on a place. A machine hammering with no plot under it and
no district around it is an animation; a machine hammering on `internal/agent`
is an agent editing a file. The zoom floor is set at 3 and not 4 for the same
reason: 4 is the clearest read of the pose and the emptiest frame around it.

**Why `followZoom` takes a maximum rather than assigning.** A reader who has
deliberately zoomed in to read a building is not asking to be pulled back out
the moment they follow something on the same plot. The floor only ever raises.

**Why the crew had to be named before it could be followed.** Not for the
follow — for the choice. `Worker.session` already crossed the wire
(`internal/town`) and was already in the store; `App.tsx` simply never rendered
it. Two omp sessions on one repo are two identical rows without it, and
following one of two identical rows is a coin toss.

## Consequences

- `ui/src/follow.ts` is new and holds the zoom range that two call sites
  previously each spelled out. `clampZoom` rounds, which neither caller needed
  and which makes "whole numbers" a property of the module rather than a
  coincidence of two routes that happened to be integral.
- The store gained `following`, `follow`, `unfollow`. It holds no zoom and no
  scroll: the store says what is being watched, the scene works out where to
  point, and the transport stays one-way (ADR-0002, ADR-0013).
- `workerLabelId` moved from `workers.ts` to `visibility.ts`, because the store
  needs it and `workers.ts` imports the store.
- The subagent question is untouched and still open: Go hardcodes `Tier:
  "chief"`, so an omp subagent's work folds into its chief's machine. Following
  is per session, and a session's subagents are followed as part of it.
```

- [ ] **Step 2: Add the glossary entry and the ADR pointer**

In `CONTEXT.md`:

The ADR list in `CONTEXT.md` is **stale**: it ends at ADR-0018 (`CONTEXT.md:240`) while `docs/adr/` holds 0019, 0020 and 0021. Append all four after line 240, using the titles from each file's own H1:

```
- ADR-0019: Labels are revealed on hover, and pinned one at a time by focus
- ADR-0020: The view turns, the world does not
- ADR-0021: Roofs are deliberate ornament, confined away from every measured channel
- ADR-0022: A follow view is a camera, not a projection
```

The first three are not this plan's work — they are the list catching up with `docs/adr/`. Add them in the same edit so the list is not left half-repaired.


Add a glossary entry after the **Turn** entry (which ends at `CONTEXT.md:67`), since follow is the same species of thing — a view preference that changes what the reader is looking at and nothing about what the town says:

```markdown
**Follow**:
Which way the camera is pointed when it is following one worker, rather than
framing the town. A view preference like Turn: the layout from the daemon is
never changed, only aimed, so following cannot change what the town says — only
what the reader is looking at. One worker at a time, and the zoom floors at three
while it lasts. The follow ends when the worker does, when the reader stops it,
and when the view changes to the plan — a plan draws workers as marks, and there
is nothing there to follow.
_Avoid_: third-person view, chase camera, lock-on, spectate
```

And in **Open Questions**, extend the existing **Subagent mapping** entry rather than adding a new one, so the two stay one fact:

```
- **Subagent mapping.** omp gives subagents their own session id inside the
  parent process. Rendering them as Sub Workers is mechanically possible; the
  policy is undecided. The follow view inherits this: it follows one session, so
  a subagent's work is followed as part of its chief.
```

- [ ] **Step 3: Verify the docs claim what the code does**

The ADR says Go hardcodes `Tier: "chief"`. Confirm it still does, so the
document is not asserting something a later task changed:

Run: `cd /home/dimasajiwardhana/Documents/code/agent-town` and grep the Go
sources for `Tier:` assignments.

Expected: `internal/town/town.go` lines 283 and 400, both `"chief"`. If either
has changed, correct the ADR before finishing.

- [ ] **Step 4: Run the full verification set**

From `ui/`:
```bash
./node_modules/.bin/tsc --noEmit -p tsconfig.json
npm run test:follow
npm test
./node_modules/.bin/vite build
```
Expected: `tsc` empty; `test:follow` all pass; `npm test` all pass; build
succeeds.

From the repo root:
```bash
gofmt -l ./internal/ ./cmd/
go vet ./...
go test ./... -count=1
```
Expected: `gofmt` empty, `go vet` empty, all Go packages ok. **This plan changes
no Go file** — a failure here means something outside this plan's scope touched
Go, and it must be reported rather than fixed silently.

- [ ] **Step 5: Report instead of committing**

```bash
git add -A && git diff --cached --stat
```

Report the full list of files changed, the `npm test` and `go test` results, and
the outcome of every one of the nine browser checks in Task 5 Step 5 — including
any that could not be run.
