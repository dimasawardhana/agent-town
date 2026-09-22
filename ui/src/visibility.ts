// The two rules that decide what the map shows, kept out of the scene so they
// can be tested without a renderer.
//
// Both rules are about *reading* rather than drawing, and both have a failure
// mode that is invisible in a screenshot of a small town and obvious in a real
// one: a neighbourhood with nothing standing for it, and a map buried under its
// own labels. That is why they live here as functions with assertions rather
// than as conditions inlined at their call sites.

/** The subset of a site these rules need. Declared structurally so a container,
 *  a building and a special place all satisfy it without a cast. */
export interface VisibleSite {
  /** Path segments below the repo root. 0 for the three special places. */
  depth: number;
  /** Containers only: the shallowest depth of any building beneath. */
  minChildDepth?: number;
}

/**
 * visibleAt decides whether a site is drawn at a given display depth.
 *
 * A building is drawn while `depth <= filter`. A container is drawn while
 * `depth <= filter < minChildDepth` — deep enough to be in view, but before the
 * buildings it summarises are drawn beside it.
 *
 * The second half is not a refinement, it is the correction of a real defect.
 * Measured with a plain `depth <= filter` rule, `internal` and its ten packages
 * were both on screen at filter 2: a tower standing on the plate of the things
 * it stands for. The two sites describe the same bytes, so drawing both is not
 * merely crowded, it is the map double-counting.
 *
 * The three special places carry depth 0 and no minChildDepth, so no filter can
 * hide them. An event must always have somewhere to land (ADR-0012).
 */
export function visibleAt(s: VisibleSite, filter: number): boolean {
  if (s.depth > filter) return false;
  const child = s.minChildDepth ?? 0;
  return child === 0 || filter < child;
}

/**
 * labelVisible decides whether a label is shown.
 *
 * Two things can show one: the pointer being over what it names, and the label
 * being focused by a click. Everything else is hidden, and that is the
 * correction of a real complaint rather than a tidy-up — with the top level
 * permanently labelled, one real eighteen-site town wore thirteen boards at once
 * and the map read as a wall of type rather than as a skyline.
 *
 * Focus is a *single id* rather than a flag per label, because "the label
 * disappears and shows on the thing we are focusing on instead" is a statement
 * about one label being lit. A boolean per label can hold two focuses at once,
 * and clearing the previous one is then something every call site has to
 * remember rather than something the model cannot express.
 *
 * Hover is deliberately weaker than focus: it applies only while the pointer is
 * on the object, so moving off restores the focused label and drops a preview.
 * A preview and a focus can therefore both be lit, which is the behaviour a
 * reader wants — pointing at a second building to read its name does not throw
 * away the one they clicked.
 */
export function labelVisible(id: string, hovered: string | null, focused: string | null): boolean {
  return id === focused || id === hovered;
}

/**
 * landBox is the picture-space box the town's land occupies.
 *
 * The ground a town stands on does not come and go with the detail filter: the
 * field is there whether or not a deep directory inside it is being drawn. So
 * this is a function of the layout's own extent and the tile pad `drawGround`
 * paints, and takes no filter.
 *
 * It exists because leaving it out was a real defect with a visible symptom. The
 * ground texture's canvas is sized from the box everything needs room for, while
 * `drawGround` paints this box — so a canvas sized from the *sites* alone is
 * smaller than the land it has to hold, and the town's own fields come out cut
 * off mid-tile. Measured here: the canvas reached picture-x 308 where the land
 * reached 522.
 *
 * Every corner is projected and the extremes taken, rather than a hand-picked
 * pair. That is not defensive: the leftmost point of a projected rectangle is its
 * `(x0, y1)` corner, not its `(x0, y0)` one, so picking two corners silently
 * loses half the rectangle's span on one axis. The first version of the fix did
 * exactly that and lost 353 pixels off the left of the town.
 */
export function landBox(
  width: number,
  height: number,
  pad: number,
  project: (x: number, y: number) => { x: number; y: number },
): { minX: number; maxX: number; minY: number; maxY: number } {
  const corners = [
    project(-pad, -pad),
    project(width + pad, -pad),
    project(-pad, height + pad),
    project(width + pad, height + pad),
  ];
  return {
    minX: Math.min(...corners.map((c) => c.x)),
    maxX: Math.max(...corners.map((c) => c.x)),
    minY: Math.min(...corners.map((c) => c.y)),
    maxY: Math.max(...corners.map((c) => c.y)),
  };
}

/**
 * boxContains reports whether outer encloses inner, within a pixel of slack.
 *
 * The slack is for the rounding on both sides rather than tolerance for a real
 * gap: the two boxes are computed by different code paths, and a fraction of a
 * pixel must not read as a missing edge.
 */
export function boxContains(
  outer: { minX: number; maxX: number; minY: number; maxY: number },
  inner: { minX: number; maxX: number; minY: number; maxY: number },
): boolean {
  return (
    outer.minX <= inner.minX + 1 &&
    outer.maxX >= inner.maxX - 1 &&
    outer.minY <= inner.minY + 1 &&
    outer.maxY >= inner.maxY - 1
  );
}
