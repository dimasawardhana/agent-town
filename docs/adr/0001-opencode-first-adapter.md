# OpenCode-first adapter integration

## Context

AI Town requires agent adapters to subscribe to AI coding agent events. The PRD specifies OpenCode as the first integration target, citing its plugin system, typed events (session, file, shell, permission, tool), HTTP server/API, and ACP server.

## Decision

Adopt OpenCode as the first adapter, using its official `@opencode-ai/plugin` SDK and `opencode serve` HTTP server (OpenAPI 3.1 spec). Do not scrape terminal output.

## Why

All five claims from the PRD Section 24 have been verified against OpenCode's official documentation:

1. Plugin system exists via `@opencode-ai/plugin` SDK
2. 13 event categories confirmed (session, file, shell, permission, tool, command, installation, lsp, message, server, todo, tui)
3. `opencode serve` provides an HTTP server with OpenAPI 3.1 spec
4. `opencode acp` runs an Agent Client Protocol server via nd-JSON JSON-RPC over stdio
5. CLI supports `-f json` and `--format json` for machine-readable output

This gives three integration paths (plugin, HTTP server, ACP), making the adapter resilient to any single mechanism failing.

## Consequences

- The unified event schema will be designed around OpenCode's event categories, which are sufficiently granular to map to the construction activity model
- If OpenCode's plugin API changes, the adapter layer absorbs the change
- The default adapter fallback mechanism needs to be defined (see domain-modeling session)
- The event normalization layer becomes the critical interface — it must handle OpenCode's specific event shapes while remaining agent-agnostic
