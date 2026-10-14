import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
const inside = (root, file) =>
  file === root ||
  (!path.relative(root, file).startsWith('..' + path.sep) &&
    path.relative(root, file) !== '..' &&
    !path.isAbsolute(path.relative(root, file)));
async function resolvedTarget(file) {
  try {
    return await fs.realpath(file);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return path.join(await resolvedTarget(path.dirname(file)), path.basename(file));
  }
}
export async function projectPath(store, id, relative, { edit = false, user = false } = {}) {
  const project = store.get(id);
  if (project?.kind !== 'project' || (!user && !store.access(id, edit)))
    throw Error('Project is outside agent access');
  const root = await fs.realpath(project.data.directory),
    file = await resolvedTarget(path.resolve(root, String(relative ?? '.'))),
    appRoot = await fs.realpath(store.directory);
  if (!inside(root, file)) throw Error('Path is outside the project');
  if (inside(appRoot, file)) throw Error('Use structured tools for Intelligence data');
  return { project, root, file };
}
export async function projectFiles(store, args, options = {}) {
  const edit = ['write', 'move', 'trash', 'restore'].includes(args.action),
    target = await projectPath(store, args.project, args.path, { edit, ...options });
  const { file, root } = target;
  if (args.action === 'list') {
    const entries = await fs.readdir(file, { withFileTypes: true });
    const list = entries
      .filter(
        (e) =>
          !['.git', 'node_modules', 'dist', 'release', '.cache', '.intelligence-trash'].includes(
            e.name,
          ) && !e.name.includes('.intelligence-backup-'),
      )
      .map((e) => ({ name: e.name, directory: e.isDirectory(), symlink: e.isSymbolicLink() }))
      .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
    const offset = Math.max(0, args.offset ?? 0);
    return {
      project: args.project,
      path: path.relative(root, file),
      items: list.slice(offset, offset + 80),
      nextOffset: offset + 80 < list.length ? offset + 80 : null,
    };
  }
  if (args.action === 'read') {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024)
      throw Error('Read requires a text file up to 2 MiB');
    const bytes = await fs.readFile(file);
    if (bytes.includes(0)) throw Error('Use an image or document attachment for binary files');
    const text = bytes.toString('utf8'),
      offset = Math.max(0, args.offset ?? 0);
    return {
      project: args.project,
      path: path.relative(root, file),
      content: text.slice(offset, offset + 16000),
      nextOffset: offset + 16000 < text.length ? offset + 16000 : null,
      revision: createHash('sha256').update(bytes).digest('hex'),
    };
  }
  if (file === root) throw Error('Choose a file within the project');
  if (args.action === 'restore') {
    if (!path.relative(root, file).startsWith('.intelligence-trash' + path.sep))
      throw Error('Choose a recoverable project Trash entry');
    const metadata = JSON.parse(await fs.readFile(file + '.restore.json', 'utf8'));
    const dest = await projectPath(store, args.project, metadata.original, {
      edit: true,
      ...options,
    });
    if (await fs.stat(dest.file).catch(() => null))
      throw Error('The original path exists; move it before restoring');
    await fs.mkdir(path.dirname(dest.file), { recursive: true });
    await fs.rename(file, dest.file);
    await fs.rm(file + '.restore.json');
    return { restored: true, project: args.project, path: metadata.original };
  }
  if (args.action === 'write') {
    if (typeof args.content !== 'string' || Buffer.byteLength(args.content) > 2 * 1024 * 1024)
      throw Error('Write requires text up to 2 MiB');
    const old = await fs.readFile(file).catch((e) => {
      if (e.code === 'ENOENT') return null;
      throw e;
    });
    if (
      (old &&
        (!args.revision || createHash('sha256').update(old).digest('hex') !== args.revision)) ||
      (old && args.expectedAbsent)
    )
      throw Error('Project file changed; read it again before editing');
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = file + '.intelligence-' + randomUUID() + '.tmp';
    if (old) await fs.copyFile(file, file + '.intelligence-backup-' + Date.now());
    try {
      await fs.writeFile(temporary, args.content, { flag: 'wx' });
      await projectPath(store, args.project, args.path, { edit: true, ...options });
      const latest = await fs.readFile(file).catch((e) => {
        if (e.code === 'ENOENT') return null;
        throw e;
      });
      if (
        old
          ? !latest ||
            createHash('sha256').update(latest).digest('hex') !==
              createHash('sha256').update(old).digest('hex')
          : latest
      )
        throw Error('Project file changed; read it again before editing');
      await fs.rename(temporary, file);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
    const backups = (await fs.readdir(path.dirname(file)))
      .filter((name) => name.startsWith(path.basename(file) + '.intelligence-backup-'))
      .sort()
      .reverse();
    for (const name of backups.slice(30)) {
      const candidate = path.join(path.dirname(file), name);
      if ((await fs.lstat(candidate)).isFile()) await fs.unlink(candidate);
    }
    store.emit('changed', {
      entity: target.project,
      fileChange: {
        path: path.relative(root, file),
        actor: options.user ? 'User' : 'Agent',
        revision: createHash('sha256').update(args.content).digest('hex'),
      },
    });
    return {
      project: args.project,
      path: path.relative(root, file),
      written: true,
      revision: createHash('sha256').update(args.content).digest('hex'),
    };
  }
  if (args.action === 'move') {
    const to = await projectPath(store, args.project, args.destination, { edit: true, ...options });
    if (to.file === root) throw Error('Choose a destination within the project');
    if (await fs.stat(to.file).catch(() => null)) throw Error('Destination already exists');
    await fs.mkdir(path.dirname(to.file), { recursive: true });
    await fs.rename(file, to.file);
    return { moved: true, project: args.project, path: path.relative(root, to.file) };
  }
  if (args.action === 'trash') {
    const trash = await projectPath(store, args.project, '.intelligence-trash', {
      edit: true,
      ...options,
    });
    await fs.mkdir(trash.file, { recursive: true });
    const to = path.join(trash.file, randomUUID() + '-' + path.basename(file));
    await fs.rename(file, to);
    await fs.writeFile(
      to + '.restore.json',
      JSON.stringify({ original: path.relative(root, file), trashedAt: new Date().toISOString() }),
    );
    return { trashed: true, project: args.project, recoveryPath: path.relative(root, to) };
  }
  throw Error('Unknown project file action');
}
export async function createProject(store, title) {
  if (typeof title !== 'string' || !title.trim()) throw Error('Give the project a name');
  const base = path.join(os.homedir(), 'Intelligence', 'Projects');
  const directory = path.join(
    base,
    title.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 80) + '-' + randomUUID().slice(0, 6),
  );
  await fs.mkdir(directory, { recursive: true });
  return store.mutate({
    kind: 'project',
    title,
    data: { directory, access: true, permission: 'edit' },
  });
}
