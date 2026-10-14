# Native agent tool routing

Mandatory harness guidance and tool schemas define these routes independently of editable personality preferences. Entity kinds and parent IDs determine the destination; user-authored titles do not.

| User intent | Destination and tool | Key boundary |
| --- | --- | --- |
| Organize personal/shared work in Tasks | `board → list → card`; `create_item`, `edit_item`, `move_item` | Kanban is the Tasks screen. Access and agent assignment are separate. |
| Queue work for the agent in Cognition Matrix | `matrix-list → matrix-task`; `create_item` for an unscheduled task, `schedule_task` for approved schedules/triggers | Matrix is agent-only; integration/enabled/access/runner checks still gate execution. |
| Record the assigned agent's outcome | `task_result` for a Tasks card; `matrix_outcome` for Matrix | Tasks results go to review; Matrix done requires verification. |
| Write a notebook guide | `note` under a `chapter` or `notebook`; `create_item`/`edit_item` | Chapters are containers. Body content belongs in child notes; writes commit immediately. |
| Write a Vault document | `vault-file` under a `vault-folder`; `vault_create`/`vault_write` | Folders cannot hold document content. `vault_read` returns current disk content/revision. |
| Work with project/host files | `project_files`; bounded host `read_file`/`write_file` where appropriate | Files are distinct from notebook notes and Vault storage; native host/resource checks remain enforced. |
| Plan a Calendar event | `calendar_action(save)` | Creates/edits an event, not a Tasks card or Matrix task. |
| Prepare a report | `reports_action(save)` for a template; `run` for execution | A saved template is not a completed report. |
| Connect a user-requested MCP server | `connection_action`, then `discover_connection_tools` | Explicit native review, current revisions and live profile connection scope; no self-grant expansion or secret arguments. |
| Change inference providers/models | User-facing Model & providers settings | MCP connections supply tools, not chat inference models. |

`read_item` identifies the requested root and labels every returned row with its own kind, ID and revision. Follow pagination and use the revision for the exact item being edited. Creation kinds are enumerated; rejected wrong-parent/container-content calls return actionable errors instead of storing invisible content.

A chapter-body edit does not create a note. Existing chapter bodies remain recoverable in **Saved chapter content**. **Create note from this content** copies the body without rewriting its source and rejects stale revisions. Completed agent writes become visible during the response and remain saved after Stop; reasoning and unexecuted tool calls are not saved work.

The bundled [MCP setup skill](../electron/builtin-skills/mcp-setup/SKILL.md) explains supported transports, native review, discovery, verification and failure recovery. The existing SDK transports follow the [MCP transport specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-11-25/basic/transports.mdx); authentication/installation remain user-managed and are not implied by setup requests.
