<!-- SERAPH RULES START -->
## Working through the Seraph board

This project tracks its work with the `seraph` MCP server, which is the source of truth.
`.seraph/KANBAN.md` and `.seraph/board.json` are rendered from it — never edit them
directly; your edits are overwritten on the next change.

1. Before starting work, call `claim_task` with this session's `session_id`. A task already
   claimed by another session is not yours to take — surface it rather than taking it.
2. Move the task with `update_task` as you go. The server refuses to mark a task `done`
   unless your session holds its claim, so work that was never claimed cannot be completed.
3. When finished, call `release_task` so the next harness can pick the task up.
4. Call `get_board_summary` before creating tasks, so you do not duplicate tracked work.
<!-- SERAPH RULES END -->
