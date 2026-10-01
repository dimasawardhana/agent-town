// The follow camera's zoom policy.
//
// A follow camera is the only thing in this renderer that decides how close to
// look, and it has to decide it against a rule that is not negotiable: the
// isometric zoom is whole numbers between 1 and 4, because a fractional zoom
// makes some art pixels two screen pixels wide and their neighbours one — the
// single most recognisable way a pixel-art screen looks broken
// (`TownScene.controls`). So the follow camera's freedom is not "how close may I
// zoom" but "where inside a fixed range do I sit while following".
//
// It lives in its own module rather than in `view.ts` because `view.ts` is pure
// geometry and holds no camera state at all — no zoom, no scroll, no pan. A
// follow target is a camera decision, and this would be the first camera value
// that file had ever held.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { clampZoom, FOLLOW_ZOOM, followZoom, ZOOM_MAX, ZOOM_MIN } from "../src/follow";
import { crewLabel } from "../src/actions";
import { useTown } from "../src/store";
import { workerLabelId } from "../src/visibility";

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

// --- who is being followed, and who is who -----------------------------------

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
  //
  // These four ids are real, taken from a live run — and they are the case that
  // broke the first build of `crewLabel`. They share their first ten characters
  // because that is a ULID timestamp, so a label that took its characters from
  // the front rendered all four as `omp 01a0f635`.
  const ids = [
    "01a0f635-2029-73cf-8431-bbd4189a0ed4",
    "01a0f635-a03d-7392-b477-60efeebc1aa8",
    "01a0f635-a031-702b-8d29-03001c4a19a2",
    "01a0f635-a020-7624-827b-8aa4b29b8f57",
  ];
  const labels = ids.map((s) => crewLabel("omp", s));
  assert.equal(new Set(labels).size, ids.length, `sessions rendered as ${JSON.stringify(labels)}`);
  assert.ok(labels[0].startsWith("omp"), "the agent is still the first word a reader looks for");
});


test("a session with no id still names its agent", () => {
  // A daemon that has not reported a session id, or a hand-written frame, must
  // not produce a row reading "omp undefined" — that is worse than no name,
  // because it looks like a real value that went wrong.
  assert.equal(crewLabel("pi", ""), "pi");
});
