export const taskInstruction = `Task areas in Intelligence:
Tasks is the Kanban section: board → list → card. Kanban boards, task boards and canvases all refer to the Tasks screen. It holds the user's work and may also hold work assigned to the agent. Agent access permits reading/editing within grants; it is not an assignment to execute every card. Only native assigned=true with edit access permits agent execution. Creating/editing a card does not grant access or change assignment; existing parent assignment can apply. For user-only work, use a manual-only destination or ask the user to set Manual only if the chosen destination assigns work to the agent.
Cognition Matrix is a separate global queue exclusively for agent work: matrix-list → matrix-task (with optional matrix-task subtasks). Its three slots are Core, Secondary and Tertiary; Core keeps its name and the other two may be renamed. A Matrix task is intended for the agent even while its list is not integrated or the task is disabled/paused; execution still requires the native integration, enabled state, access and runner checks. It is never a user-only Kanban card.
Determine the destination from explicit user wording, the current screen, and discovered entity kind/parent IDs. Titles are user content: a Tasks list named Core is still a Tasks list, and a renamed Matrix list is still Matrix. When destination or who should do the work remains ambiguous, ask a focused question before creating it. Do not move or duplicate work between the two sections without the user's request.
Use create_item(kind=card,parent=list ID) for a Tasks card and create_item(kind=matrix-task,parent=matrix-list ID) for a nonscheduled Matrix task. schedule_task is Matrix-only; never use it for an ordinary Tasks card. Discover the current destination names/IDs first. Finish an assigned Tasks card with task_result (user review), and an assigned Matrix task with matrix_outcome (verification required for done). Neither reading a task nor writing an outcome grants execution permission.
Notebook chapters are containers for notes. To seed a chapter with formatted guides, create actual note entities under that chapter; editing chapter.content does not create a note. Older stored chapter body text is visible under Saved chapter content and can be copied into a note by the user. Notebook writes have no staging area: a successful create_item/edit_item saves immediately. A plan, reasoning text or incomplete tool call is not a saved note. Use returned IDs and parent IDs to verify chapters/notes in the requested notebook before claiming success. Stop preserves completed writes and cancels remaining work; report partial completion accurately.`;

export function taskArea(store, item) {
  if (['board', 'list', 'card'].includes(item?.kind))
    return {
      section: 'Tasks',
      taskPurpose: 'user-and-optional-agent-work',
      ...(item.kind === 'card' ? { assigned: store.assigned(item.id) } : {}),
    };
  if (['matrix-list', 'matrix-task'].includes(item?.kind))
    return {
      section: 'Cognition Matrix',
      taskPurpose: 'agent-work-only',
      ...(item.kind === 'matrix-list'
        ? { integrated: item.data.integrated === true }
        : { executionEnabled: store.assigned(item.id), status: item.data.status ?? 'queued' }),
    };
  return {};
}
