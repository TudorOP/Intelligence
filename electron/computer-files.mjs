import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { computerPath, computerAccessInfo } from './computer-access.mjs';
import { extractDocument } from './document-extract.mjs';
import { computerImageReference } from './computer-images.mjs';
const str = { type: 'string' };
export const computerFileTool = {
  type: 'function',
  function: {
    name: 'computer_files',
    description:
      'Use action=access (no path) for live file scope, home and working directory. List/read/write/move/trash host files, including outside projects when scope=system. Paths: absolute, ~/home-relative, or working-directory-relative. Follow offsets; overwrites require the read revision. Folder access and write approvals are separate. Trash is recoverable. Intelligence storage is protected.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['access', 'list', 'read', 'write', 'move', 'trash'] },
        path: str,
        destination: str,
        content: str,
        revision: str,
        offset: { type: 'integer' },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
};
export async function authorizeFile(agent, input, ctx, edit = false, destructive = false) {
  const options = {
    project: ctx.project,
    settings: ctx.profileSettings || agent.store.settings(),
    edit,
  };
  const original = await computerPath(agent.store, input, options);
  const fingerprint = JSON.stringify([
    agent.store.settings().computerScope,
    agent.store.settings().computerFolders,
    agent.store.get(options.settings.profileId)?.revision,
  ]);
  if (!original.allowed || edit) {
    if (
      !(await agent.approval(
        ctx.conversation,
        original.allowed
          ? destructive
            ? 'Move file to Trash'
            : 'Change computer file'
          : 'Access outside authorized folders',
        original.file,
        ctx.signal,
        {
          type: 'computer-file',
          inScope: original.allowed,
          destructive,
          requiresReview: !original.allowed,
        },
      ))
    )
      throw Error('Computer file access was not approved');
  }
  ctx.signal?.throwIfAborted();
  const latest = await computerPath(agent.store, input, options);
  if (
    latest.file !== original.file ||
    (original.allowed && !latest.allowed) ||
    fingerprint !==
      JSON.stringify([
        agent.store.settings().computerScope,
        agent.store.settings().computerFolders,
        agent.store.get(options.settings.profileId)?.revision,
      ])
  )
    throw Error('Computer access changed; request access again');
  return latest.file;
}
export async function computerFiles(agent, args, ctx) {
  if (args.action === 'access')
    return computerAccessInfo(agent.store, {
      project: ctx.project,
      settings: ctx.profileSettings || agent.store.settings(),
    });
  const edit = ['write', 'move', 'trash'].includes(args.action);
  const options = {
    project: ctx.project,
    settings: ctx.profileSettings || agent.store.settings(),
    edit,
  };
  const stamp = () =>
    JSON.stringify([
      agent.store.settings().computerScope,
      agent.store.settings().computerFolders,
      agent.store.get(options.settings.profileId)?.revision,
    ]);
  const binding = stamp(),
    original = await computerPath(agent.store, args.path, options);
  const file = await authorizeFile(agent, args.path, ctx, edit, args.action === 'trash');
  const revalidate = async (...targets) => {
    ctx.signal?.throwIfAborted();
    if (stamp() !== binding) throw Error('Computer access changed during this action');
    for (const target of targets) {
      const current = await computerPath(agent.store, target, options);
      if (current.file !== target || (target === file && original.allowed && !current.allowed))
        throw Error('Computer access changed during this action');
    }
  };
  if (args.action === 'list') {
    const entries = (await fs.readdir(file, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const offset = Math.max(0, args.offset || 0);
    await revalidate(file);
    return {
      path: file,
      items: entries
        .slice(offset, offset + 100)
        .map((e) => ({ name: e.name, directory: e.isDirectory(), symlink: e.isSymbolicLink() })),
      nextOffset: entries.length > offset + 100 ? offset + 100 : null,
    };
  }
  if (args.action === 'read') {
    const extension = path.extname(file).toLowerCase(),
      image = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
      }[extension];
    if (image) {
      if (ctx.profileSettings?.visionEnabled === false)
        throw Error('Image input is disabled for this model');
      if ((await fs.stat(file)).size > 10 * 1024 * 1024)
        throw Error('Vision images must be smaller than 10 MB');
      const bytes = await fs.readFile(file);
      await revalidate(file);
      return {
        path: file,
        visionImage: computerImageReference(
          agent.store,
          bytes,
          image,
          ctx.conversation,
          agent.active?.get(ctx.conversation) || { signal: ctx.signal },
        ),
      };
    }
    const document = ['.pdf', '.docx'].includes(path.extname(file).toLowerCase());
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > (document ? 25 : 2) * 1024 * 1024)
      throw Error('Choose a text file up to 2 MiB or a PDF/DOCX up to 25 MB');
    if (document) {
      const text = await extractDocument(file, ctx.signal),
        offset = Math.max(0, args.offset || 0);
      await revalidate(file);
      return {
        path: file,
        content: text.slice(offset, offset + 16000),
        nextOffset: text.length > offset + 16000 ? offset + 16000 : null,
      };
    }
    const bytes = await fs.readFile(file);
    if (bytes.includes(0)) throw Error('Attach this document to extract its content');
    await revalidate(file);
    const offset = Math.max(0, args.offset || 0),
      text = bytes.toString('utf8');
    return {
      path: file,
      content: text.slice(offset, offset + 16000),
      nextOffset: text.length > offset + 16000 ? offset + 16000 : null,
      revision: createHash('sha256').update(bytes).digest('hex'),
    };
  }
  if (args.action === 'write') {
    if (typeof args.content !== 'string' || Buffer.byteLength(args.content) > 2 * 1024 * 1024)
      throw Error('Write requires text up to 2 MiB');
    const existing = await fs.stat(file).catch((e) => {
      if (e.code === 'ENOENT') return null;
      throw e;
    });
    if (existing && (!existing.isFile() || existing.size > 2 * 1024 * 1024))
      throw Error('Choose a text file up to 2 MiB');
    const original = await fs.readFile(file).catch((e) => {
      if (e.code === 'ENOENT') return null;
      throw e;
    });
    if (original && createHash('sha256').update(original).digest('hex') !== args.revision)
      throw Error('File changed; read the latest revision before editing');
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = file + '.intelligence-' + randomUUID() + '.tmp';
    try {
      await fs.writeFile(temporary, args.content, { flag: 'wx' });
      const latest = await fs.readFile(file).catch((e) => {
        if (e.code === 'ENOENT') return null;
        throw e;
      });
      if (original ? !latest || !latest.equals(original) : latest)
        throw Error('File changed before saving');
      await revalidate(file);
      if (original) await fs.copyFile(file, file + '.intelligence-backup-' + Date.now());
      await revalidate(file);
      await fs.rename(temporary, file);
      agent.matrix?.triggers.inbox.noteOutput(file);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
    return {
      written: true,
      path: file,
      revision: createHash('sha256').update(args.content).digest('hex'),
    };
  }
  if (args.action === 'move') {
    const destination = await authorizeFile(agent, args.destination, ctx, true);
    const source = await fs.stat(file);
    if (!source.isFile()) throw Error('Choose a file to move');
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await revalidate(file, destination);
    // Atomic destination creation prevents a concurrent arrival being overwritten.
    // Across filesystems, retain the source if it changes while copying.
    try {
      await fs.link(file, destination);
    } catch (error) {
      if (error.code !== 'EXDEV') throw error;
      await fs.copyFile(file, destination, constants.COPYFILE_EXCL);
    }
    await revalidate(file, destination);
    const latest = await fs.stat(file);
    if (
      latest.dev !== source.dev ||
      latest.ino !== source.ino ||
      latest.size !== source.size ||
      latest.mtimeMs !== source.mtimeMs
    )
      throw Error('Source changed during move; both copies were retained');
    await fs.unlink(file);
    agent.matrix?.triggers.inbox.noteOutput(destination);
    return { moved: true, path: file, destination };
  }
  if (args.action === 'trash') {
    const directory = path.join(path.dirname(file), '.intelligence-trash');
    await fs.mkdir(directory, { recursive: true });
    const destination = path.join(directory, randomUUID() + '-' + path.basename(file));
    await revalidate(file, destination);
    await fs.rename(file, destination);
    await fs.writeFile(
      destination + '.restore.json',
      JSON.stringify({ original: file, deletedAt: new Date().toISOString() }),
    );
    return { trashed: true, path: file, recoveryPath: destination };
  }
  throw Error('Unsupported computer file action');
}
