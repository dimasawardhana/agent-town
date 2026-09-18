// Shared state between Phaser and React (ADR-0002).
//
// Phaser writes: its camera moves, its scene loads a town.
// React reads: the sidebar renders whatever the store holds.
//
// One-way flow, game to UI. React never writes scene state, which is what
// keeps the two renderers from fighting over the same pixels.

import { create } from "zustand";

export interface Site {
  id: string;
  kind: "building" | "workshop" | "yard" | "depot";
  label: string;
  district?: string;
  districtKind?: "source" | "test";
  path?: string;
  files: number;
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

interface State {
  town: Town | null;
  layout: Layout | null;
  selected: Site | null;
  events: AgentEvent[];
  connected: boolean;
  error: string | null;

  setTown: (t: Town, l: Layout) => void;
  select: (s: Site | null) => void;
  pushEvent: (e: AgentEvent) => void;
  setConnected: (c: boolean) => void;
  setError: (e: string | null) => void;
}

// A bounded event log. The town is the point; the feed is supporting detail,
// and an unbounded array would grow for the life of the tab.
const MAX_EVENTS = 200;

export const useTown = create<State>((set) => ({
  town: null,
  layout: null,
  selected: null,
  events: [],
  connected: false,
  error: null,

  setTown: (town, layout) => set({ town, layout, error: null }),
  select: (selected) => set({ selected }),
  pushEvent: (e) =>
    set((s) => ({ events: [e, ...s.events].slice(0, MAX_EVENTS) })),
  setConnected: (connected) => set({ connected }),
  setError: (error) => set({ error }),
}));
