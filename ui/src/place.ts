// The three special places, and the plain words that explain them.
//
// The domain names are fixed by CONTEXT.md: the Yard, the Workshop and the
// Depot. They are metaphors, and a metaphor the reader has to be told is a
// metaphor that is failing — so each place carries the description it needs,
// once, here, and both the map and the panel letter themselves from this
// rather than each inventing a wording that drifts from the other.
//
// This module is vocabulary, not art and not React: the scene draws these onto
// the ground, the panel lists them in a legend, and neither owns the words.
// The blurbs are the same claims the daemon makes when it resolves an event to
// a place, so a reader who learns them here can predict where the next worker
// will walk.

import type { Site } from "./store";

/** The kinds of site that are a place rather than a building. */
export type PlaceKind = "yard" | "workshop" | "depot";

export interface PlaceInfo {
  /** The domain name, spelled as CONTEXT.md defines it. */
  name: string;
  /** What work happens here, in the words of the work rather than the
   *  metaphor. This is the sentence that makes the name mean something. */
  blurb: string;
  /** The shortest form that still identifies the place, for the ground sign
   *  where a whole sentence would not fit at the fitted zoom. */
  sign: string;
  /** Which actions land here, for the legend. Kept from `internal/town`'s own
   *  classification rather than guessed: a place advertised as taking work it
   *  never receives is worse than no legend at all. */
  takes: string;
}

export const PLACE_INFO: Record<PlaceKind, PlaceInfo> = {
  yard: {
    name: "Yard",
    blurb:
      "Site-wide work: tests, builds, git and installs act on the whole town, " +
      "not one building. Roughly half of a session happens here.",
    sign: "Tests / Builds / Git",
    takes: "tests, builds, git, installs, shell commands",
  },
  workshop: {
    name: "Workshop",
    blurb:
      "Root files: a manifest, a readme, a config. A file that sits at the " +
      "repo root belongs to no building, so it is worked in the Workshop.",
    sign: "Root Files",
    takes: "files at the repo root",
  },
  depot: {
    name: "Depot",
    blurb:
      "Meta work: planning, task dispatch, notes and evaluation — work about " +
      "the work, with no site to act on. About a third of a session is here.",
    sign: "Planning / Notes",
    takes: "planning, dispatch, notes, evaluation",
  },
};

/** Every place, in the order the map and the legend present them: the Yard
 *  first because it is where the most work lands. */
export const PLACE_ORDER: readonly PlaceKind[] = ["yard", "workshop", "depot"];

/** isPlaceKind narrows a site's kind to the places, so a caller can look up
 *  `PLACE_INFO` without a cast that would also accept a building. */
export function isPlaceKind(kind: string): kind is PlaceKind {
  return kind === "yard" || kind === "workshop" || kind === "depot";
}

/** placeInfoFor reads a site's own description, or null for a building, which
 *  is described by its stage instead. */
export function placeInfoFor(site: Pick<Site, "kind">): PlaceInfo | null {
  return isPlaceKind(site.kind) ? PLACE_INFO[site.kind] : null;
}
