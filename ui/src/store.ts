// Shared state between Phaser and React (ADR-0002).
//
// Phaser writes: its camera moves, its scene loads a town.
// React reads: the sidebar renders whatever the store holds.
//
// One-way flow, game to UI. React never writes scene state, which is what
// keeps the two renderers from fighting over the same pixels.

import { create } from "zustand";

// SITE_ID_BUILDING_PREFIX mirrors analyzer.SiteIDBuildingPrefix.
//
// It is the join key between a worker's resolved Place and the building's
// position. The two definitions cannot be shared across the language
// boundary, so this one points at the other rather than restating the reason.
export const SITE_ID_BUILDING_PREFIX = "building:";

export interface Site {
  id: string;
  kind: "building" | "container" | "workshop" | "yard" | "depot";
  label: string;
  district?: string;
  districtKind?: "source" | "test";
  path?: string;
  files: number;
  /** Path segments below the repo root: 1 for `internal`, 3 for
   *  `internal/web/static`. The three special places carry 0, so a filter
   *  keyed on depth can never hide the Yard.
   *
   *  Sent rather than derived, because the layout is the single source of
   *  truth for geometry (ADR-0012) and a second derivation would drift. */
  depth: number;
  /** Total source bytes, and the storeys derived from them. Distinct from
   *  `files`, which drives the footprint: `files` is how many parts a building
   *  is divided into, `bytes` is how much there is of it. Sent by the daemon
   *  rather than computed here, because the layout is the single source of
   *  truth for geometry (ADR-0012). */
  bytes: number;
  floors: number;
  /** For a container: the shallowest depth of any building beneath it. A
   *  container is drawn while `depth <= filter < minChildDepth`, so it stands
   *  in for its subtree exactly while that subtree is hidden and steps aside the
   *  moment it appears beside it. Absent (0) on a building, which is simply
   *  drawn while `depth <= filter`.
   *
   *  Sent rather than derived: working it out needs the whole tree, which the
   *  daemon has and the renderer does not. */
  minChildDepth?: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedDistrict {
  name: string;
  kind: "source" | "test";
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  sites: Site[];
  districts: PlacedDistrict[];
  width: number;
  height: number;
}

export interface Town {
  root: string;
  name: string;
  districts: { name: string; kind: string; buildings: number; files: number }[];
  buildings: unknown[];
}

export type Action =
  | "reading" | "hammering" | "building" | "demolishing"
  | "testing" | "commanding" | "planning" | "celebrating";

export interface Worker {
  id: string;
  session: string;
  agent: string;
  tier: "chief" | "sub";
  action: Action;
  place: string;
  placeKind: "building" | "workshop" | "yard" | "depot";
  label: string;
  since: number;
}

export interface BuildingState {
  path: string;
  touches: number;
  /** The running count of failures here: history, never cleared. */
  problems: number;
  /** Whether the building is currently damaged. A condition, not a stage. */
  damaged: boolean;
  lastAgent: string;
  // The construction ladder, mirroring internal/town's Status values in order.
  // Kept as a union rather than a string so a stage the daemon can emit but the
  // renderer cannot draw is a type error rather than a blank building.
  status:
    | "planned"
    | "foundation"
    | "framed"
    | "walled"
    | "roofed"
    | "glazed"
    | "doored"
    | "completed";
  updated: number;
}

export interface Live {
  workers: Worker[];
  buildings: BuildingState[];
  events: AgentEvent[];
}

export interface AgentEvent {
  id: string;
  session_id: string;
  agent: string;
  type: string;
  tool: string;
  target: { path: string };
  result: string;
  timestamp: number;
}

export interface ProjectRef {
  path: string;
  name: string;
  analyzed: boolean;
  // state is the project's lifecycle (CONTEXT.md). A project that is
  // registered but not yet analyzed still accepts events; the label says so
  // rather than leaving the developer wondering why the town is empty.
  state?: string;
  error?: string;
}

interface State {
  // projects is the registry the daemon serves (ADR-0014), and current is the
  // one being viewed. Switching projects changes only what is drawn: every
  // registered project keeps folding events in the daemon, because a town is
  // the result of real work and switching away must not pause someone's build.
  projects: ProjectRef[];
  current: string;

  town: Town | null;
  layout: Layout | null;
  live: Live;
  selected: Site | null;
  /**
   * The one object whose label is pinned open by a click.
   *
   * A single id rather than a flag per object, because "the label disappears
   * from the last thing and shows on the one we are focusing on" is a statement
   * about one label being lit. With a flag per object, two objects can be
   * focused at once and clearing the previous one becomes something every call
   * site has to remember rather than something the model cannot express.
   *
   * It holds a *site* id for a building, container or place, and a *worker* id
   * for a figure, because both are things a reader points at.
   *
   * Kept apart from `selected` deliberately: `selected` is what the detail panel
   * is describing, while this is which label is lit. Focusing a worker leaves
   * the panel where it was rather than emptying it, because a reader watching
   * one figure work has not stopped reading about the building it is in.
   */
  focused: string | null;
  /**
   * The id under the pointer, or null. The hover half of the label rule.
   *
   * In the store rather than in the scene because a worker's caption is owned by
   * `WorkerLayer` and a building's name by the scene: two owners, one rule. With
   * the hover held privately by each, pointing at a worker would light its
   * caption while leaving a building's name lit from before — the two would
   * disagree about what "the thing under the pointer" means.
   */
  hovered: string | null;
  events: AgentEvent[];
  connected: boolean;
  error: string | null;

  /**
   * How deep a building may be and still be drawn.
   *
   * A view preference, not town state: it changes what is shown and nothing
   * else. The layout is always computed in full and filtered on the way out, so
   * changing this cannot move a building — see `TownScene.draw`.
   *
   * `Infinity` means "everything", which is the right default: the failure of a
   * numerically limited default would be silently hiding work.
   */
  depth: number;

  setProjects: (p: ProjectRef[], current: string) => void;
  setCurrent: (path: string) => void;
  setTown: (t: Town | null, l: Layout | null, live?: Live) => void;
  setLive: (l: Live) => void;
  select: (s: Site | null) => void;
  /** focus pins one object's label open, or clears the focus with null. */
  focus: (id: string | null) => void;
  /** hover records what the pointer is over, or null when it leaves. */
  hover: (id: string | null) => void;
  pushEvent: (e: AgentEvent) => void;
  setConnected: (c: boolean) => void;
  setError: (e: string | null) => void;
  /** setDepth changes how much of the town is drawn, by building depth. */
  setDepth: (d: number) => void;
}

// A bounded event log. The town is the point; the feed is supporting detail,
// and an unbounded array would grow for the life of the tab.
const MAX_EVENTS = 200;

const EMPTY_LIVE: Live = { workers: [], buildings: [], events: [] };

export const useTown = create<State>((set) => ({
  projects: [],
  current: "",
  town: null,
  layout: null,
  live: EMPTY_LIVE,
  selected: null,
  events: [],
  connected: false,
  error: null,
  focused: null,
  hovered: null,
  // Everything drawn by default, for the reason in the field's own comment: a
  // numeric default's failure mode is silently hiding work.
  depth: Number.POSITIVE_INFINITY,
  setTown: (town, layout, live) =>
    set({ town, layout, live: live ?? EMPTY_LIVE, error: null }),
  setProjects: (projects, current) => set({ projects, current }),
  setCurrent: (path) =>
    set({
      current: path,
      // Clear the view so a stale town is never drawn as though it were the
      // newly chosen one while that project's state is still loading.
      town: null,
      events: [],
      selected: null,
      // The focus goes with the town: an id from the project being left names
      // nothing in the one being opened, so keeping it would light whichever new
      // label happened to reuse the id — or none, leaving a focus nothing
      // visible answers to.
      focused: null,
      hovered: null,
      error: null,
    }),
  setLive: (live) => set({ live }),
  select: (selected) => set({ selected }),
  focus: (focused) => set({ focused }),
  hover: (hovered) => set({ hovered }),
  pushEvent: (e) =>
    set((s) => ({ events: [e, ...s.events].slice(0, MAX_EVENTS) })),
  setConnected: (connected) => set({ connected }),
  setError: (error) => set({ error }),
  setDepth: (depth) => set({ depth }),
}));
