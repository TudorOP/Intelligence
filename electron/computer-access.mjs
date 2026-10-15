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
  if (typeof input !== 'string' || !input || input.length > 16000)
    throw Error('Choose a file path');
  const target = await canonicalTarget(
    path.resolve(project?.data.directory || os.homedir(), input),
  );
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
