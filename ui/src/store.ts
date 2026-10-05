// Shared state between Phaser and React (ADR-0002).
//
// Phaser writes: its camera moves, its scene loads a town.
// React reads: the sidebar renders whatever the store holds.
//
// One-way flow, game to UI. React never writes scene state, which is what
// keeps the two renderers from fighting over the same pixels.

import { create } from "zustand";

import { type DayPhase, normaliseDay, stepDay } from "./daylight";
import { type ViewMode, isViewMode } from "./plan";
import { workerLabelId } from "./visibility";

// `Renderer` is the one thing the solid model exports that the store needs, and
// the arrow points this way on purpose: the model imports `Layout` and `Site` as
// *types* from here, which erases at build time, so this is not a runtime cycle.
// The alternative — restating the union in the store — would be two spellings of
// one fact, and the two would eventually disagree about what a renderer is.
import { isRenderer, type Renderer } from "./solid/model";

// SITE_ID_BUILDING_PREFIX mirrors analyzer.SiteIDBuildingPrefix.
//
// It is the join key between a worker's resolved Place and the building's
// position. The two definitions cannot be shared across the language
// boundary, so this one points at the other rather than restating the reason.
export const SITE_ID_BUILDING_PREFIX = "building:";

export interface Road {
  x: number; y: number; w: number; h: number;
  /** "row", "district" or "containment" — which rule produced the band.
   *  "import" was here and the analyzer stopped emitting it: a dependency is a
   *  property of a building now, and the panel is its only reader. */
  kind: string;
  /** The two ends of a band's centre line, in world units, for the road kinds
   *  that join two places.
   *
   *  Absent on "row" and "district" — those are areas rather than joins — and
   *  absent on any payload serialized before this field existed. When present,
   *  these are the road: `x/y/w/h` is its bounding box, for the camera bounds
   *  and the turn, and the line is what is painted. */
  ax?: number;
  ay?: number;
  bx?: number;
  by?: number;
}

export interface Site {
  id: string;
  kind: "building" | "container" | "workshop" | "yard" | "depot";
  label: string;
  district?: string;
  districtKind?: "source" | "test";
  path?: string;
  files: number;
  /** The buildings whose source this one names, sorted. The panel lists them,
   *  because the panel has room for exact names. The map does not read this at
   *  all: it was drawn on for a while and read as a smudge, so nothing on the
   *  map says *whether* a building imports — only what it is called. Absent
   *  when the building imports nothing. */
  imports?: string[];
  /** Path segments below the repo root: 1 for `internal`, 3 for
   *  `internal/web/static`. The three special places carry 0, so a filter
   *  keyed on depth can never hide the Yard.
   *
   *  Sent rather than derived, because the layout is the single source of
   *  truth for geometry (ADR-0012) and a second derivation would drift. */
  depth: number;

  /** What the repository declared this building to be, or undefined when it
   *  declared nothing. Undefined is the normal case and means "hash the path".
   *
   *  Sent rather than read from the manifest in the browser: a declaration is
   *  one fact, which is the split ADR-0012 exists to prevent. */
  archetype?: string;

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
  roads?: Road[];
  districts: PlacedDistrict[];

  /**
   * How many relative imports named something the analyzer found no building for,
   * and so drew no road.
   *
   * The map shows fewer roads than the code has dependencies whenever this is
   * non-zero, and without the count the absence reads as a fact about the
   * repository rather than a limit of the scanner. A bare specifier is a package
   * elsewhere by definition and is not counted — a number that cries wolf is
   * worse than no number.
   *
   * Optional, because a layout serialized before this field existed does not have
   * it, and reading it must not be a way for an old payload to fail.
   */
  unresolvedImports?: number;
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
  /** Whether a test has passed here and nothing has failed since. A condition
   *  beside `damaged`, never a stage: the two are mutually exclusive and
   *  together exhaustive, so a building is known-good, known-broken, or
   *  unknown. The daemon owns this; the renderer only draws it. */
  verified: boolean;
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

  /**
   * Which way round the town is drawn: a quarter turn, 0 to 3.
   *
   * A view preference like `depth`, and never sent to the daemon. Turning the
   * view does not move anything — the layout is the daemon's and is turned on the
   * way *out* of it — so a turn cannot change what the town says, only how the
   * reader is looking at it.
   */
  turn: number;

  /**
   * Which way the town is drawn: isometric, or straight down.
   *
   * A view preference like `depth` and `turn`, and never sent to the daemon.
   *
   * **The plan view is not a camera.** The isometric art has the 2:1 skew
   * baked into its pixels — every wall face, window, chimney and machine is drawn
   * as seen from the side and above — so a top-down rendering of *that* art is not
   * a transform, it is a re-authoring of all 1145 cels. The plan view is
   * therefore a second drawing of the same **layout**: every plot as the
   * rectangle it actually is, its name on it, districts outlined, roads as bands.
   * It reads the town's structure, and it costs no atlas and no bake.
   *
   * What it cannot show is height, and height is how this town encodes size —
   * a directory's file count becomes its floors. The plan view carries that
   * explicitly instead: the storey count is printed on the plot and the fill
   * brightness follows the construction stage. Without that the map would be
   * lying by omission.
   */
  view: ViewMode;

  /**
   * The town's one key light: a phase, not a clock.
   *
   * A view preference like `depth` and `turn`, and never sent to the daemon.
   * Nothing in the analysis or the event stream says what time it is, so a
   * clock would be a value the town invented; a phase is a fact it can hold —
   * and at dusk the lit windows are the only thing on the map that says the
   * work has stopped for the day.
   */
  day: DayPhase;

  /**
   * Which renderer draws the town: the flat pixel town, or the solid one.
   *
   * **Not a `ViewMode`, and the difference is not pedantry.** `view` means
   * "which drawing of this layout" — two drawings inside one Phaser scene. A
   * renderer is a different canvas, scene graph, frame loop and asset set, and
   * folding it into `view` would bury a lifecycle difference inside a drawing
   * difference (ADR-0025 §1).
   *
   * A view preference like `depth`, `turn` and `day`, and never sent to the
   * daemon. The flat renderer is frozen (ADR-0024) and stays the default, so a
   * reader who never touches this control is unaffected by the solid town.
   */
  renderer: Renderer;

  setProjects: (p: ProjectRef[], current: string) => void;
  setCurrent: (path: string) => void;
  setTown: (t: Town | null, l: Layout | null, live?: Live) => void;
  setLive: (l: Live) => void;
  select: (s: Site | null) => void;
  /** focus pins one object's label open, or clears the focus with null. */
  focus: (id: string | null) => void;
  /** hover records what the pointer is over, or null when it leaves. */
  hover: (id: string | null) => void;
  /** follow points the camera at a machine and pins its caption open. */
  follow: (id: string) => void;
  /** unfollow releases the camera and unpins the caption following pinned. */
  unfollow: () => void;
  pushEvent: (e: AgentEvent) => void;
  setRenderer: (r: Renderer) => void;
  setConnected: (c: boolean) => void;
  setError: (e: string | null) => void;
  /** setDepth changes how much of the town is drawn, by building depth. */
  setDepth: (d: number) => void;
  /** turnBy steps the view by one quarter turn, in either direction. */
  turnBy: (delta: number) => void;
  /** setTurn selects an orientation outright, for resetting to the default. */
  setTurn: (t: number) => void;
  /** setView switches between the isometric town and the plan. */
  setView: (v: ViewMode) => void;
  /** toggleView flips it, for a single control. */
  toggleView: () => void;
  /** dayBy steps the key light through its phases, wrapping. */
  dayBy: (delta: number) => void;
  /** setDay selects a phase outright, for a control that names all three. */
  setDay: (d: DayPhase) => void;
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
  following: null,
  // Everything drawn by default, for the reason in the field's own comment: a
  // numeric default's failure mode is silently hiding work.
  depth: Number.POSITIVE_INFINITY,
  // Upright, which is the orientation the art was authored at and the one that
  // shows the daemon's own idea of the town.
  turn: 0,
  view: "iso" as ViewMode,
  day: "dusk" as DayPhase,
  // Flat first: the flat renderer is finished, verified and the default, and the
  // solid one has to earn that place rather than be given it (ADR-0024).
  renderer: "flat" as Renderer,
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
      // The follow goes with them for the same reason, and harder: a live id
      // resolves to a real machine in the town being opened only by accident, and
      // a camera pointed at an id that names nothing is a camera pointed at a
      // coordinate it remembers.
      following: null,
      error: null,
    }),
  setLive: (live) => set({ live }),
  select: (selected) => set({ selected }),
  focus: (focused) => set({ focused }),
  hover: (hovered) => set({ hovered }),
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
  pushEvent: (e) =>
    set((s) => ({ events: [e, ...s.events].slice(0, MAX_EVENTS) })),
  setConnected: (connected) => set({ connected }),
  setError: (error) => set({ error }),
  setDepth: (depth) => set({ depth }),
  turnBy: (delta) => set((s) => ({ turn: (((s.turn + delta) % 4) + 4) % 4 })),
  setTurn: (turn) => set({ turn: (((turn % 4) + 4) % 4) }),
  setView: (view) => set({ view: isViewMode(view) ? view : "iso" }),
  toggleView: () => set((s) => ({ view: s.view === "plan" ? "iso" : "plan" })),
  dayBy: (delta) => set((s) => ({ day: stepDay(s.day, delta) })),
  setDay: (day) => set({ day: normaliseDay(day) }),
  // **Switching renderer can drop the plan drawing**, because the solid town has
  // no plan: it is a flat drawing of a flat town. Dropping it here rather than at
  // the control means the invariant holds however the renderer changes — a
  // control, a stored preference, or a test — and the alternative (remembering
  // the plan and restoring it on the way back) was declined, because a reader
  // toggling to solid and back would find the flat town in a drawing they did not
  // choose with nothing on screen having said so.
  setRenderer: (renderer) => set((s) => ({
    renderer: isRenderer(renderer) ? renderer : "flat",
    view: isRenderer(renderer) && renderer === "solid" ? "iso" : s.view,
  })),
}));
