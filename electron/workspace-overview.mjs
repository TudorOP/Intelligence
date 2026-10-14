export function workspaceOverview(store, { offset = 0, limit = 60, allowed = () => true } = {}) {
  if (!Number.isInteger(offset) || offset < 0) throw Error('Use a nonnegative overview offset');
  const items = store.all(false, true).filter((item) => store.access(item.id) && allowed(item));
  const categories = [
    ['projects', 'project'],
    ['notebooks', 'notebook'],
    ['Tasks / Kanban boards', 'board'],
    ['Vault folders', 'vault-folder'],
    ['Vault files', 'vault-file'],
    ['Cognition Matrix lists (agent work only)', 'matrix-list'],
    ['Cognition Matrix tasks (agent work only)', 'matrix-task'],
    ['calendars', 'calendar'],
    ['calendar events', 'calendar-event'],
    ['report schedules', 'report-template'],
    ['reports', 'report'],
    ['notes', 'note'],
    ['Tasks / Kanban cards (user and optional agent work)', 'card'],
    ['skills', 'skill'],
    ['connections', 'connection'],
    ['memory', 'memory'],
  ];
  const collections = items.filter((item) =>
    [
      'project',
      'notebook',
      'board',
      'matrix-list',
      'vault-folder',
      'skill',
      'connection',
      'calendar',
      'report-template',
    ].includes(item.kind),
  );
  const page = collections.slice(offset, offset + limit);
  return {
    scope: 'authorized workspace',
    categories: categories.map(([label, kind]) => ({
      label,
      kind,
      count: items.filter((item) => item.kind === kind).length,
    })),
    collections: page.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      parent: item.parent,
      project: item.project,
      editable: store.access(item.id, true),
      ...taskArea(store, item),
    })),
    totalCollections: collections.length,
    nextOffset: offset + limit < collections.length ? offset + limit : null,
    note: 'Only items the user has made accessible are counted or listed. An empty category means no accessible items; do not claim the user has no items outside your access. Task boards are the app canvas-style collections; there is no separate Canvas entity type.',
  };
}
import { taskArea } from './task-semantics.mjs';
