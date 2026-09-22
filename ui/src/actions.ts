// The action vocabulary: what a worker is doing, said two ways.
//
// `Action` is the domain's own set (internal/town/action.go) and it is fixed.
// What this module adds is the two readings a reader needs from it, which are
// genuinely different jobs and cannot share one string:
//
//   - `world` is what the figure on the map is *seen* doing. It has to match
//     the animation beside it, or the town is captioning one thing while
//     drawing another — a worker mid-swing labelled "editing" reads as a
//     mistake, and "hammering" reads as the truth.
//   - `plain` is what the agent actually did, in a developer's words, for the
//     panel where there is room to be exact. "hammering" is the metaphor;
//     "editing an existing file" is the fact.
//
// Both exist because the town is a diorama of real activity: it is allowed to
// say things its own way, and it is not allowed to be unclear. A single string
// would force one of those to lose.

import type { Action } from "./store";

export interface ActionInfo {
  /** The world's word: what the figure is visibly doing. */
  world: string;
  /** The developer's word: what the agent actually did. */
  plain: string;
}

export const ACTION_INFO: Record<Action, ActionInfo> = {
  reading: { world: "Inspecting", plain: "Reading, searching or listing" },
  hammering: { world: "Hammering", plain: "Editing an existing file" },
  building: { world: "Building", plain: "Creating something new" },
  demolishing: { world: "Clearing", plain: "Deleting" },
  testing: { world: "Testing", plain: "Running tests" },
  commanding: { world: "Working", plain: "Running a shell command" },
  planning: { world: "Planning", plain: "Planning, dispatching or noting" },
  celebrating: { world: "Finished", plain: "Session finished cleanly" },
};

/** Every action, in the order the daemon's own list uses. */
export const ACTION_ORDER: readonly Action[] = [
  "reading",
  "hammering",
  "building",
  "demolishing",
  "testing",
  "commanding",
  "planning",
  "celebrating",
];

/** actionInfo reads an action's two readings, tolerating a value the daemon
 *  might add before this table learns of it: captioning an unknown action as
 *  its own raw name is honest, where throwing would take a frame down. */
export function actionInfo(action: string): ActionInfo {
  const known = ACTION_INFO[action as Action];
  if (known) return known;
  return { world: action || "Working", plain: action || "Working" };
}

/**
 * targetOf names the thing a worker is acting on.
 *
 * A building's place key is `building:<path>`, so the last segment of the path
 * is what a reader recognises — `internal/town/town.go` is "town" at a glance,
 * and the whole path is a smear at this scale. A place key that is not a
 * building (the Yard, the Workshop, the Depot) is already the name.
 */
export function targetOf(place: string, prefix: string): string {
  if (!place.startsWith(prefix)) return place;
  const path = place.slice(prefix.length).replace(/\/+$/, "");
  const cut = path.lastIndexOf("/");
  return cut >= 0 ? path.slice(cut + 1) : path;
}
