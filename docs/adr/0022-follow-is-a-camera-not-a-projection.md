# ADR-0022: A follow view is a camera, not a projection

## Context

The request was "a 3rd person view for each agent, so I can see each agent work
in action".

The renderer is a fixed 2:1 dimetric projection with no rotation and no
perspective anywhere in the system (`DESIGN.md`), and every cel has the 2:1 skew
baked into its pixels. `store.ts` says what that costs in the sharpest terms
available: the plan view is a second *drawing* of the layout because a top-down
rendering of that art "is not a transform, it is a re-authoring of all 1145
cels".

So the literal reading — a camera behind a machine, over its shoulder, at
whatever angle the machine happens to be facing — is not a camera change. It is
the whole art system, re-authored per angle, or a projection the rest of the
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
   that range a follow sits: never further out than 3, and never closer in than
   the reader already was. A machine cel is `32x22`; at 1x it is the 2.5% of the
   frame `TownScene.update` already complains about, and following a 32-pixel
   speck is the map view with a lag.

3. **The target is resolved from the sprite, every frame.** Not from the layout
   and not from a remembered coordinate. A machine's position is written by its
   own per-journey stepper from the arc length of its route, which means it is
   only knowable from the figure itself.

4. **A target that disappears releases the follow.** The daemon stops reporting
   a session, `WorkerLayer.remove` takes the sprite out, and the next frame has
   no position — so the follow ends. A camera that held its last known point
   would sit over empty ground with full confidence, which is the one thing this
   town is not allowed to do.

   **Ending a session is not the same as a session disappearing.** `session.end`
   sets a worker to `celebrating` and leaves it standing, because "a figure is
   never removed while the daemon still reports it" (`workers.ts`). So a finished
   crew stays followed, showing the session complete. The release fires when the
   figure actually goes — a daemon restart, which persists buildings but not
   crews.

5. **A drag wins, for as long as it lasts.** Phaser runs `update` after input, so
   a follow tick that did not yield would visibly take the camera back from the
   reader mid-gesture — on the same gesture that started the follow. Letting go
   re-centres the machine, which is the follow's contract rather than a snap-back
   to apologise for: a camera that left its subject off-centre would not be
   following.

6. **Following pins the caption, and releasing unpins it.** The caption is the
   only thing that says which of the eight actions a pose is standing in for.
   The pin is set and cleared by the follow rather than left to each call site,
   because there are two call sites and a caption lit for one and not the other
   would make the follow look broken in one of them. A building clicked while a
   follow is running takes the focus and leaves the followed caption lit —
   `labelVisible` treats the two as independent, because a click and a standing
   choice are different acts.

7. **The plan view releases the follow.** A plan is a second drawing of the
   layout, not a camera on the town, and a machine in it is a 9px mark in its
   crew's colour. There is nothing to follow, and the plan's `[0.2, 8]` zoom
   would inherit a framing it never chose.

## Why

**Why not author the angles.** Because the cost is not a camera line, it is the
art system. The town bakes one cel per square footprint per turn already, and a
facing is a dimension the atlas does not have.

**Why a follow rather than a close-up.** Because the town is what makes one
action legible as work on a place. A machine hammering with no plot under it and
no district around it is an animation; a machine hammering on `internal/agent` is
an agent editing a file. The zoom floor is 3 and not 4 for the same reason: 4 is
the clearest read of the pose and the emptiest frame around it.

**Why `followZoom` takes a maximum rather than assigning.** A reader who has
deliberately zoomed in to read a building is not asking to be pulled back out the
moment they follow something on the same plot. The floor only ever raises.

**Why the crew had to be named before it could be followed.** Not for the
follow — for the choice. `Worker.session` already crossed the wire
(`internal/town`) and was already in the store; `App.tsx` simply never rendered
it. Two omp sessions on one repo are two identical rows without it, and
following one of two identical rows is a coin toss.

**Why the session name takes its characters from the end.** Measured, not
assumed. omp's session ids are ULIDs, and a ULID's first ten characters are its
creation timestamp in base32, so every session opened in the same stretch of
time shares them. A live run produced four crews whose ids were `01a0f635-2029-…`,
`01a0f635-a03d-…`, `01a0f635-a031-…` and `01a0f635-a020-…`; the first build took
eight characters from the front and rendered all four as `omp 01a0f635`, which is
the one thing the name exists to prevent. The entropy in a ULID is all after the
tenth character, and in a UUIDv4 it is the last group, so the tail separates both.

## Consequences

- `ui/src/follow.ts` is new and holds the zoom range that two call sites
  previously each spelled out. `clampZoom` rounds, which neither caller needed and
  which makes "whole numbers" a property of the module rather than a coincidence
  of two routes that happened to be integral.
- The store gained `following`, `follow`, `unfollow`. It holds no zoom and no
  scroll: the store says what is being watched, the scene works out where to
  point, and the transport stays one-way (ADR-0002, ADR-0013).
- `workerLabelId` moved from `workers.ts` to `visibility.ts`, because the store
  needs it and `workers.ts` imports the store.
- The subagent question is untouched and still open: Go hardcodes `Tier:
  "chief"`, so an omp subagent's work folds into its chief's machine. Following
  is per session, and a session's subagents are followed as part of it.
- The Crew rows became buttons rather than a list of spans. This is the first
  control in the panel that changes what the map is doing rather than what the
  panel is describing, and it is the app's first `aria-pressed` — there is still
  no keyboard handler anywhere in `ui/src`.
