# ADR-0016: The extension may default its target address, but still fails silent

## Context

ADR-0011 requires extensions to fail **closed and silent**: if AI Town is
unreachable, the agent must behave exactly as if AI Town were not installed.
The extension currently achieves this by being inert unless `AI_TOWN_URL` is
set — but that makes the environment variable a required install step, which
is the largest single piece of setup friction.

Fixing the daemon's port makes the address guessable, so the variable is no
longer carrying information the extension cannot infer.

## Decision

The extension defaults its target to `http://127.0.0.1:7777/events` when
`AI_TOWN_URL` is unset. If that address refuses the connection or does not
answer, the extension disables itself for the session: it does not retry, does
not log, and does not surface anything to the agent.

`AI_TOWN_URL` still overrides the default, so a daemon on a non-standard port
remains reachable without reconfiguration.

## What this does not change

An unreachable daemon and an uninstalled extension stay indistinguishable from
the agent's point of view. The default is a *guess*, not a probe: no port
scanning, no discovery protocol, no fallback list. Probing several addresses
would make AI Town's presence observable through timing and log noise, which
is the behaviour the fail-closed rule exists to prevent.

The consequence is that a daemon on a non-default port needs the variable, and
a developer who sets the wrong port sees silent nothing. The daemon therefore
prints the exact `AI_TOWN_URL` for its own address on startup, and a
connection refusal is reported on stderr by `townd`, not by the extension.

## Why the 403 flag must become per-directory

The extension currently sets a process-wide `disabled = true` on a 403, on the
stated assumption that one agent process answers one directory. That
assumption is now false in two ways: a multi-project daemon will 403 a
directory it does not know, and an agent running in a subdirectory of a
watched project is 403'd today by the exact-match gate (verified).

A process-wide flag means one rejected frame blinds that agent for the rest of
its life, even after the project is registered. The flag must key on the
frame's directory, so one unwatched directory cannot silence a watched one.
This is a correctness fix independent of the default-address change.

## Consequences

- **ADR-0011's fail-closed rule is relaxed, not abandoned.** Failing silent is
  still required; requiring configuration in order to try at all is not.
- **Install becomes one step** — copy the extension — with no environment
  variable for the default case.
