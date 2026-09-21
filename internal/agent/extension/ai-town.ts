// AI Town forwarder extension for omp.
//
// Runs inside the omp process and forwards agent activity to the AI Town
// daemon over loopback HTTP, so a project can be watched being built.
//
// Design constraints, all established empirically (docs/adr/0009, 0010, 0011):
//
//  1. Extensions load LAZILY, per directory instance, only where a session
//     starts. The `hello` handshake is how AI Town proves it is live.
//  2. Forwarding must survive the daemon being down. A naive
//     `fetch().catch(() => {})` discards events silently; this queue does not.
//  3. Every frame carries a monotonic `seq` so AI Town can detect gaps.
//  4. It must never forward a project AI Town is not watching. The daemon
//     rejects unknown directories with 403, and this stops on that.
//  5. It must never break the agent. ONLY observation hooks are used:
//     `tool_execution_start` / `tool_execution_end`. omp's `tool_call` hook
//     fails CLOSED — a throwing handler blocks the developer's tool.
//  6. omp's `tool_execution_end` does NOT carry `args`; only
//     `tool_execution_start` does. Args are cached at start and merged into
//     the end frame, or every event would arrive pathless.

const MAX_QUEUE = 10_000;
const AGENT = "omp";

type Frame = Record<string, unknown>;

let queue: Frame[] = [];
let seq = 0;
let draining = false;
let dropped = 0;
let disabled = false;

// toolCallId -> args, captured at tool start. Required because omp omits args
// from the end event (verified live: end keys are
// ['type','toolCallId','toolName','result','isError']).
const pendingArgs: Record<string, unknown> = {};

function target(): string {
  const base = process.env.AI_TOWN_URL;
  if (!base) return "";
  return base.replace(/\/$/, "") + "/events";
}

// RETRY_MS is how long a failed drain waits before trying again.
//
// Retrying only when the next event arrives is not enough: if the agent goes
// quiet, or the daemon comes back after the last tool call, the buffered
// events would be stranded for the life of the process. A timer makes the
// queue drain on its own, which is what "with retry" has to mean.
const RETRY_MS = 2000;

let retryTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRetry(TARGET: string): void {
  if (retryTimer || disabled) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void drain(TARGET);
  }, RETRY_MS);
  // Never hold the agent process open just to flush telemetry.
  (retryTimer as unknown as { unref?: () => void }).unref?.();
}

async function drain(TARGET: string): Promise<void> {
  if (draining) return;
  draining = true;
  let stalled = false;
  try {
    while (queue.length > 0) {
      const frame = queue[0]!;
      let res: Response;
      try {
        res = await fetch(TARGET, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(frame),
        });
      } catch {
        // Daemon unreachable. Keep the frame and retry on a timer, so a
        // restart costs latency rather than history.
        stalled = true;
        break;
      }
      if (res.status === 403) {
        // AI Town does not watch this directory. Stop entirely, so an
        // unrelated project is never shipped to the daemon.
        disabled = true;
        queue = [];
        break;
      }
      if (!res.ok) {
        stalled = true;
        break;
      }
      queue.shift();
    }
  } finally {
    draining = false;
  }
  if (stalled) scheduleRetry(TARGET);
}

function send(TARGET: string, frame: Frame): void {
  if (disabled || !TARGET) return;
  seq += 1;
  queue.push({ ...frame, seq, dropped });
  if (queue.length > MAX_QUEUE) {
    const excess = queue.length - MAX_QUEUE;
    queue.splice(0, excess);
    dropped += excess;
  }
  void drain(TARGET);
}

export default function (pi: any) {
  const TARGET = target();
  if (!TARGET) {
    // No daemon configured. Stay completely inert: the agent must behave
    // identically whether or not AI Town is installed.
    return;
  }

  pi.on("session_start", async (_event: any, ctx: any) => {
    // The handshake. AI Town treats this as proof the extension loaded, and
    // uses it to reset its sequence baseline.
    send(TARGET, {
      kind: "hello",
      directory: ctx?.cwd ?? process.cwd(),
      agent: AGENT,
      sessionID: ctx?.sessionManager?.getSessionId?.(),
      pid: process.pid,
    });
  });

  pi.on("tool_execution_start", async (e: any) => {
    if (e?.toolCallId) pendingArgs[e.toolCallId] = e?.args;
  });

  pi.on("tool_execution_end", async (e: any, ctx: any) => {
    const args = pendingArgs[e?.toolCallId] ?? e?.args;
    delete pendingArgs[e?.toolCallId];

    send(TARGET, {
      kind: "tool.after",
      directory: ctx?.cwd ?? process.cwd(),
      agent: AGENT,
      sessionID: ctx?.sessionManager?.getSessionId?.(),
      callID: e?.toolCallId,
      tool: e?.toolName,
      args,
      isError: e?.isError === true,
      // The moment the extension observed the action, in Unix milliseconds.
      // The daemon falls back to receipt time if this is absent, but sending
      // it keeps the timeline honest about when work actually happened.
      time: Date.now(),
    });
  });
}
