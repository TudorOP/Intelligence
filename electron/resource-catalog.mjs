export const resourceKinds = new Set([
  'notebook',
  'chapter',
  'note',
  'board',
  'list',
  'card',
  'project',
  'calendar',
  'calendar-event',
  'vault-folder',
  'vault-file',
  'report',
  'report-template',
  'memory',
  'conversation',
]);
export function resourceLabel(kind) {
  return (
    {
      notebook: 'Notebook',
      chapter: 'Chapter',
      note: 'Note',
      board: 'Task board',
      list: 'Task list',
      card: 'Task',
      project: 'Project',
      calendar: 'Calendar',
      'calendar-event': 'Calendar event',
      'vault-folder': 'Vault folder',
      'vault-file': 'Markdown file',
      report: 'Report',
      'report-template': 'Report template',
      memory: 'Saved memory',
      conversation: 'Conversation',
    }[kind] || kind
  );
}
export function conversationSources(conversation, messages) {
  return [
    ...new Set([
      ...(conversation.data.context || []),
      ...messages.flatMap((m) => [
        ...(m.data.context || []),
        ...(m.data.scopedSources || []).filter((id) => id !== conversation.id),
      ]),
    ]),
  ];
}
export function resourceGroup(item) {
  return item.kind.startsWith('calendar')
    ? 'calendar'
    : item.kind.startsWith('report')
      ? 'reports'
      : item.kind === 'project'
        ? 'projects'
        : ['memory', 'conversation'].includes(item.kind)
          ? 'memory'
          : 'workspace';
}
export function resourceGate(item) {
  return item.kind.startsWith('vault-')
    ? 'vaultAccess'
    : ['board', 'list', 'card'].includes(item.kind)
      ? 'kanbanAccess'
      : item.kind.startsWith('calendar')
        ? 'calendarAccess'
        : item.kind.startsWith('report')
          ? 'reportsAccess'
          : ['memory', 'conversation'].includes(item.kind)
            ? 'memoryAccess'
            : ['notebook', 'chapter', 'note'].includes(item.kind)
              ? 'notebookAccess'
              : null;
}
