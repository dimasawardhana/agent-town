// Talking to the daemon.
//
// Both endpoints are same-origin: the daemon serves this UI and its API from
// one process (ADR-0013), so there is no base URL to configure and no CORS.

import type { AgentEvent, Layout, Town } from "./store";

export interface TownResponse {
  town: Town;
  layout: Layout;
}

export async function fetchTown(): Promise<TownResponse> {
  const res = await fetch("/api/town");
  if (!res.ok) {
    throw new Error(`daemon returned ${res.status} for /api/town`);
  }
  return (await res.json()) as TownResponse;
}

// subscribe opens the event stream and calls back on every event.
//
// EventSource reconnects on its own, so the only thing to handle here is
// surfacing connection state — and re-fetching the town after a reconnect,
// because events missed during the gap are not replayed.
export function subscribe(
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
    try {
      onEvent(JSON.parse(m.data) as AgentEvent);
    } catch {
      // A malformed frame is not worth tearing the stream down for.
    }
  };

  return () => es.close();
}
