// Talking to the daemon.
//
// Both endpoints are same-origin: the daemon serves this UI and its API from
// one process (ADR-0013), so there is no base URL to configure and no CORS.

import type { AgentEvent, Layout, Live, Town } from "./store";

export interface TownResponse {
  town: Town;
  layout: Layout;
  live?: Live;
}

export async function fetchTown(): Promise<TownResponse> {
  const res = await fetch("/api/town");
  if (!res.ok) {
    throw new Error(`daemon returned ${res.status} for /api/town`);
  }
  return (await res.json()) as TownResponse;
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
): () => void {
  let hadOpened = false;
  const es = new EventSource("/stream");

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
