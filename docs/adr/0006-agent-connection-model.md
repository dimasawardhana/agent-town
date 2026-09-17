# Agent connection and reconnection model

## Context

AI Town connects to AI coding agents to receive events. The PRD Section 24 specifies OpenCode integration via plugin/API. Section 7 says "start or attach to the selected agent." Section 8 says "reconnect on disconnection."

## Decision

Connect to already-running agents. Heartbeat-based loss detection. Reconnect on failure, replay missed events.

## Why

Two connection modes exist:

1. **Spawn**: AI Town starts the agent process. Full control but requires managing the agent lifecycle.
2. **Attach**: Connect to an already-running agent. Less control but respects the user's existing workflow.

Attach is chosen because:
- Users already have agents running (Section 2 says "a developer may have multiple agents running")
- Spawning requires knowing the agent's CLI invocation, which varies by user setup
- Attach respects the developer's existing terminal workflow
- Reconnection handles transient disconnections naturally

## Consequences

- **Connection mechanism**: OpenCode uses `opencode serve` HTTP server (OpenAPI 3.1) for the primary connection. Fallback: `opencode acp` via stdio. Agent-specific adapters handle connection details.
- **Heartbeat**: WebSocket ping/pong or HTTP GET every 5 seconds. Missed 3 consecutive pings = "lost."
- **Reconnection**: On loss, wait 2 seconds, retry up to 3 times. On successful reconnect, query event store for events since last known event ID and replay them.
- **Agent death**: If all retries fail, worker transitions to LEAVING. Building retains last progress. No new workers spawn until user starts a new session.
- **Session persistence**: The session record persists with status DISCONNECTED or COMPLETED. The town state is not lost.
- **Default adapter**: If no custom adapter exists for an agent type, a default adapter tails the agent's terminal output or watches for file system changes as a fallback.

## Trade-off

Attaching means AI Town doesn't control when the agent starts or stops. This creates a dependency on the agent's own lifecycle management. However, it respects the developer's workflow and avoids the complexity of process management.

## Open question

The default adapter fallback mechanism needs further definition. "Tail terminal output" is vague — does it watch `~/.local/share/opencode/logs`? Use inotify on file changes? This depends on what each agent exposes. The fallback should be a last resort, not the primary mechanism.
