import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
export const inside = (root, file) => {
  const relative = path.relative(root, file);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
  );
};
export function resolveComputerPath(input, project = null) {
  if (typeof input !== 'string' || !input || input.length > 16000)
    throw Error('Choose a file path');
  // Tools receive paths, not shell expressions. Expand only the current user's home.
  if (/^~[^/\\]/.test(input)) throw Error('Use ~ or ~/ for your home, not ~username');
  if (input === '~') return os.homedir();
  if (/^~[/\\]/.test(input)) return path.resolve(os.homedir(), input.slice(2));
  return path.resolve(project?.data.directory || os.homedir(), input);
}
export function computerAccessInfo(store, { project = null, settings = store.settings() } = {}) {
  const global = store.settings();
  const live = store.get(settings.profileId);
  const scopes = [settings.profileScope, live?.data].filter(Boolean);
  const enabled =
    global.tools !== false &&
    settings.tools !== false &&
    (!settings.profileId || !!live) &&
    scopes.every((s) => !s.toolGroups || s.toolGroups.includes('projects'));
  if (!enabled)
    return {
      scope: 'disabled',
      notice:
        'Enable agent tools and this agent’s Computer & project files category to use file tools.',
    };
  const scope = scopes.some((s) => s.computerAccess === 'projects')
    ? 'projects'
    : global.computerScope || 'projects';
  return {
    scope,
    home: os.homedir(),
    project: project?.id || null,
    workingDirectory: project
      ? store.access(project.id)
        ? project.data.directory
        : null
      : os.homedir(),
    projects: store
      .all(false, true)
      .filter((e) => e.kind === 'project' && store.access(e.id))
      .slice(0, 20)
      .map((e) => ({
        id: e.id,
        directory: e.data.directory,
        permission: store.access(e.id, true) ? 'edit' : 'read',
      })),
    folders: scope === 'folders' ? global.computerFolders || [] : [],
    writeApproval: global.approvalMode || 'ask',
    askDestructive: global.askDestructive !== false,
    terminalEnabled:
      !!global.terminalAccess &&
      scopes.every((s) => !s.toolGroups || s.toolGroups.includes('terminal')),
    notice:
      scope === 'system'
        ? 'Any file on the computer that the OS account can access, including outside projects. List/read need no extra folder approval. Writes follow native action approvals.'
        : 'Use authorized projects' +
          (scope === 'folders'
            ? ' and the listed folders (read/edit as shown).'
            : '. This agent or the global setting limits access to projects.'),
    boundaries:
      'OS permissions, excluded/read-only projects and protected Intelligence storage still apply. No administrator elevation. Terminal access is separate. Project directories show up to 20 accessible roots; discover more with workspace_overview. Call computer_files(action=access) for live scope; tool calls always enforce current access.',
  };
}
export async function canonicalTarget(file) {
  try {
    return await fs.realpath(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = path.dirname(file);
    if (parent === file) throw error;
    return path.join(await canonicalTarget(parent), path.basename(file));
  }
}
export function validateComputerSettings(value) {
  if (
    value.computerScope !== undefined &&
    !['projects', 'folders', 'system'].includes(value.computerScope)
  )
    throw Error('Invalid computer file scope');
  if (value.askDestructive !== undefined && typeof value.askDestructive !== 'boolean')
    throw Error('Invalid destructive action policy');
  if (
    value.computerFolders !== undefined &&
    (!Array.isArray(value.computerFolders) ||
      value.computerFolders.length > 100 ||
      value.computerFolders.some(
        (f) =>
          !f ||
          typeof f.directory !== 'string' ||
          !path.isAbsolute(f.directory) ||
          !['read', 'edit'].includes(f.permission),
      ))
  )
    throw Error('Choose absolute folders and read or edit access');
}
export async function computerPath(
  store,
  input,
  { project = null, settings = store.settings(), edit = false } = {},
) {
  const target = await canonicalTarget(resolveComputerPath(input, project));
  if (inside(await fs.realpath(store.directory), target))
    throw Error('Use structured tools for Intelligence data');
  const global = store.settings();
  const scopes = [settings.profileScope, store.get(settings.profileId)?.data].filter(Boolean);
  let allowedProject;
  for (const candidate of store.all(false, true).filter((e) => e.kind === 'project')) {
    let root;
    try {
      root = await fs.realpath(candidate.data.directory);
    } catch {
      continue;
    }
    if (inside(root, target)) {
      if (!store.access(candidate.id)) throw Error('Project is outside agent access');
      if (edit && !store.access(candidate.id, true)) throw Error('Project is read-only');
      allowedProject = candidate.id;
    }
  }
  if (allowedProject) return { file: target, allowed: true, project: allowedProject };
  if (scopes.some((s) => s.computerAccess === 'projects'))
    throw Error('This agent is restricted to authorized project folders');
  if (global.computerScope === 'system') return { file: target, allowed: true };
  if (global.computerScope === 'folders')
    for (const folder of global.computerFolders || []) {
      try {
        if (inside(await fs.realpath(folder.directory), target)) {
          if (edit && folder.permission !== 'edit') throw Error('This folder is read-only');
          return { file: target, allowed: true };
        }
      } catch (error) {
        if (error.message === 'This folder is read-only') throw error;
      }
    }
  return { file: target, allowed: false };
}
export function commandRisk(command) {
  const text = String(command || '').trim();
  const readOnly =
    /^(pwd|ls(?: -[alh]+)?(?: \.)?|git status(?: --short)?|git diff(?: --stat)?|git log -[1-9][0-9]? --oneline)$/.test(
      text,
    );
  return { readOnly, destructive: !readOnly, uncertain: !readOnly };
}
