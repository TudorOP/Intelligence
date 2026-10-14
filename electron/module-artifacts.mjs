import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
export const digestBytes = (value) => createHash('sha256').update(value).digest('hex');
export function insidePath(root, relative) {
  if (
    typeof relative !== 'string' ||
    relative.includes('\0') ||
    relative.includes('\\') ||
    path.isAbsolute(relative) ||
    relative.split('/').includes('..')
  )
    throw Error('Unsafe module path');
  const target = path.resolve(root, relative);
  if (target !== path.resolve(root) && !target.startsWith(path.resolve(root) + path.sep))
    throw Error('Module path escaped storage');
  return target;
}
export async function downloadArtifact(
  artifact,
  target,
  signal,
  progress = () => {},
  fetcher = fetch,
) {
  if (!/^https:\/\//.test(artifact.url) || !/^[a-f0-9]{64}$/.test(artifact.sha256))
    throw Error('Unverified module artifact');
  try {
    if (digestBytes(await fs.readFile(target)) === artifact.sha256) return target;
  } catch {}
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = target + '.' + randomUUID() + '.part';
  const response = await fetcher(artifact.url, { signal, redirect: 'follow' });
  if (!response.ok || !response.body)
    throw Error('Module download returned HTTP ' + response.status);
  const finalURL = new URL(response.url || artifact.url);
  if (finalURL.protocol !== 'https:') {
    await response.body.cancel();
    throw Error('Module download requires HTTPS');
  }
  const file = await fs.open(temp, 'wx'),
    hash = createHash('sha256');
  let bytes = 0;
  try {
    for await (const chunk of response.body) {
      signal?.throwIfAborted();
      bytes += chunk.length;
      if (bytes > Math.min(512 * 1024 ** 2, (artifact.bytes || 512 * 1024 ** 2) + 1024))
        throw Error('Module download exceeds expected size');
      hash.update(chunk);
      await file.write(chunk);
      progress(bytes, artifact.bytes);
    }
    if (hash.digest('hex') !== artifact.sha256 || (artifact.bytes && bytes !== artifact.bytes))
      throw Error('Module download failed verification');
    await file.close();
    await fs.rename(temp, target);
    return target;
  } catch (e) {
    await file.close().catch(() => {});
    await fs.rm(temp, { force: true });
    throw e;
  }
}
function tarEntries(compressed) {
  const data = gunzipSync(compressed, { maxOutputLength: 512 * 1024 ** 2 }),
    entries = [];
  let nextPath,
    nextLink,
    pax = {};
  const str = (b) => b.toString('utf8').replace(/\0.*$/s, '');
  for (let offset = 0; offset + 512 <= data.length;) {
    const header = data.subarray(offset, offset + 512);
    if (header.every((v) => v === 0)) break;
    const rawSize = str(header.subarray(124, 136)).trim();
    const size = parseInt(rawSize || '0', 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > data.length)
      throw Error('Invalid module archive');
    const type = str(header.subarray(156, 157)),
      content = data.subarray(offset + 512, offset + 512 + size);
    let name = str(header.subarray(0, 100)),
      prefix = str(header.subarray(345, 500));
    if (prefix) name = prefix + '/' + name;
    if (type === 'L') nextPath = str(content).trim();
    else if (type === 'K') nextLink = str(content).trim();
    else if (type === 'x' || type === 'g') {
      for (const line of content.toString('utf8').split('\n')) {
        const m = line.match(/^\d+ ([^=]+)=(.*)$/);
        if (m) pax[m[1]] = m[2];
      }
    } else {
      name = pax.path || nextPath || name;
      const link = pax.linkpath || nextLink || str(header.subarray(157, 257));
      nextPath = nextLink = undefined;
      pax = {};
      name = name.replace(/^\.\//, '').replace(/\/$/, '');
      if (name)
        entries.push({
          name,
          link,
          type,
          content,
          mode: parseInt(str(header.subarray(100, 108)).trim() || '644', 8) & 0o777,
        });
    }
    offset += 512 + Math.ceil(size / 512) * 512;
    if (entries.length > 30000) throw Error('Module archive has too many files');
  }
  return entries;
}
export async function unpackVerifiedTar(
  artifact,
  archive,
  destination,
  { verifyOnly = false, signal } = {},
) {
  const bytes = await fs.readFile(archive);
  if (digestBytes(bytes) !== artifact.sha256) throw Error('Runtime archive failed verification');
  const entries = tarEntries(bytes);
  if (verifyOnly) {
    const allowed = new Set();
    for (const entry of entries) {
      insidePath(destination, entry.name);
      const parts = entry.name.split('/');
      for (let count = 1; count <= parts.length; count++)
        allowed.add(parts.slice(0, count).join('/'));
    }
    const inspect = async (name) => {
      if (!allowed.has(name))
        throw Error('Runtime contains unexpected files; reinstall before running');
      const file = insidePath(destination, name),
        stat = await fs.lstat(file);
      if (stat.isDirectory() && !stat.isSymbolicLink())
        for (const child of await fs.readdir(file)) await inspect(name + '/' + child);
    };
    for (const root of new Set(entries.map((entry) => entry.name.split('/')[0])))
      await inspect(root);
  }
  for (const entry of entries) {
    signal?.throwIfAborted();
    const file = insidePath(destination, entry.name);
    const relative = path.relative(path.resolve(destination), path.dirname(file));
    let parent = path.resolve(destination);
    for (const part of relative.split(path.sep).filter(Boolean)) {
      parent = path.join(parent, part);
      const st = await fs.lstat(parent).catch(() => null);
      if (st?.isSymbolicLink()) throw Error('Module archive parent is a symbolic link');
    }
    if (entry.type === '5') {
      if (!verifyOnly) await fs.mkdir(file, { recursive: true });
      continue;
    }
    if (entry.type === '2' || entry.type === '1') {
      const linked =
        entry.type === '1'
          ? insidePath(destination, entry.link)
          : path.resolve(path.dirname(file), entry.link);
      if (!linked.startsWith(path.resolve(destination) + path.sep))
        throw Error('Module archive link escaped storage');
      if (verifyOnly) {
        if (entry.type === '2') {
          if ((await fs.readlink(file)) !== entry.link)
            throw Error('Runtime link failed verification');
        } else {
          const stat = await fs.lstat(file);
          if (
            !stat.isFile() ||
            stat.isSymbolicLink() ||
            digestBytes(await fs.readFile(file)) !== digestBytes(await fs.readFile(linked))
          )
            throw Error('Runtime hard link failed verification');
        }
      } else {
        await fs.mkdir(path.dirname(file), { recursive: true });
        if (entry.type === '2') await fs.symlink(entry.link, file);
        else await fs.link(insidePath(destination, entry.link), file);
      }
      continue;
    }
    if (!['', '0', '7'].includes(entry.type)) throw Error('Unsupported module archive entry');
    if (verifyOnly) {
      const stat = await fs.lstat(file);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        digestBytes(await fs.readFile(file)) !== digestBytes(entry.content)
      )
        throw Error('Runtime files failed verification');
    } else {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, entry.content, { flag: 'wx', mode: entry.mode });
    }
  }
  return entries.length;
}
