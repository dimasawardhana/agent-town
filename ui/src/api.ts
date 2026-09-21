// Talking to the daemon.
//
// Both endpoints are same-origin: the daemon serves this UI and its API from
// one process (ADR-0013), so there is no base URL to configure and no CORS.

import type { AgentEvent, Layout, Live, Town } from "./store";

export interface TownResponse {
  // path is the project this town belongs to. The daemon serves a registry
  // (ADR-0014), so a response without one would be ambiguous.
  path: string;
  analyzed: boolean;
  error?: string;
  town: Town | null;
  layout: Layout | null;
  live?: Live;
}

export interface ProjectEntry {
  path: string;
  name: string;
  analyzed: boolean;
  error?: string;
}

// fetchProjects lists the registry, which is what the switcher draws.
export async function fetchProjects(): Promise<ProjectEntry[]> {
  const res = await fetch("/api/projects");
  if (!res.ok) {
    throw new Error(`daemon returned ${res.status} for /api/projects`);
  }
  const body = (await res.json()) as { projects?: ProjectEntry[] };
  return body.projects ?? [];
}

// fetchTown reads one project's town. An empty project names none, which the
// daemon answers with every project it serves.
export async function fetchTown(project = ""): Promise<TownResponse> {
  const url = project
    ? `/api/town?project=${encodeURIComponent(project)}`
    : "/api/town";
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`daemon returned ${res.status} for /api/town`);
  }
  return (await res.json()) as TownResponse;
}

// fetchAllTowns reads every project at once, so the switcher can show one
// without a second round trip.
export async function fetchAllTowns(): Promise<Record<string, TownResponse>> {
  const res = await fetch("/api/town");
  if (!res.ok) {
    throw new Error(`daemon returned ${res.status} for /api/town`);
  }
  const body = (await res.json()) as {
    projects?: Record<string, TownResponse>;
  };
  return body.projects ?? {};
}

// Frame is one message from the stream. The daemon sends the whole live town
// on every event rather than the raw event alone, because worker movement is
// the product and recomputing it in the browser would make the UI a second
// authority on where things are.
type Frame =
  | { kind: "live"; live: Live }
  | { kind: "event"; event: AgentEvent };

// subscribe opens the event stream and calls back on every frame.
//
// EventSource reconnects on its own, so the only thing to handle here is
// surfacing connection state — and re-fetching the town after a reconnect,
// because frames missed during the gap are not replayed.
export function subscribe(
  onLive: (l: Live) => void,
  onEvent: (e: AgentEvent) => void,
  onState: (connected: boolean) => void,
  onReconnect: () => void,
  project = "",
): () => void {
  let hadOpened = false;
  // Naming the project scopes the stream to it. Without it the client would
  // receive every project's snapshots and redraw the wrong town, because the
  // daemon filters rather than the browser.
  const url = project
    ? `/stream?project=${encodeURIComponent(project)}`
    : "/stream";
  const es = new EventSource(url);

  es.onopen = () => {
    onState(true);
    // A reconnect means we may have missed events; the town state is the
    // authority, so re-read it rather than trusting a partial feed.
    if (hadOpened) onReconnect();
    hadOpened = true;
  };

  es.onerror = () => onState(false);

  es.onmessage = (m) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m.data);
    } catch {
      return; // A malformed frame is not worth tearing the stream down for.
    }
    const f = parsed as Partial<Frame> & Partial<Live>;
    // The daemon publishes a live snapshot when it has a town to interpret,
    // and a bare event when it does not.
    if (f && Array.isArray((f as Live).workers)) {
      onLive(f as Live);
    } else {
      onEvent(parsed as AgentEvent);
    }
  };

  return () => es.close();
}
