import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { backup, DatabaseSync } from 'node:sqlite';
import { kinds, validateOptionalModules } from './store.mjs';
import { validateProfile } from './profiles.mjs';
import { validateEvent, validateReportTemplate } from './planning-schema.mjs';
import {
  moduleCatalog,
  moduleEngineId,
  moduleModelDefinition,
  moduleModelStorageId,
} from './optional-modules.mjs';
const maximumBackupBytes = 128 * 1024 ** 3;
const roots = ['assets', 'Vault', 'matrix-files'];
async function digest(file) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}
async function walk(directory, prefix = '', allowModuleLinks = false) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink() && !allowModuleLinks)
      throw Error('Symbolic links cannot be included in a backup');
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isDirectory())
      result.push(...(await walk(path.join(directory, entry.name), relative, allowModuleLinks)));
    else if (entry.isFile() || (entry.isSymbolicLink() && allowModuleLinks)) result.push(relative);
    if (result.length > 100000) throw Error('Backup has too many files');
  }
  return result;
}
export async function exportBackup(
  store,
  destination,
  { includeModelCaches = false, includeModules = false } = {},
) {
  const base = await fs.realpath(destination),
    appRoot = await fs.realpath(store.directory);
  if (base === appRoot || base.startsWith(appRoot + path.sep))
    throw Error('Choose a backup folder outside app data');
  let expectedBytes = (await fs.stat(path.join(store.directory, 'intelligence.sqlite'))).size,
    fileCount = 1;
  for (const root of [
    ...roots,
    ...(includeModelCaches ? ['models'] : []),
    ...(includeModules ? ['modules'] : []),
  ]) {
    const source = path.join(store.directory, root);
    if (!(await fs.stat(source).catch(() => null))) continue;
    for (const name of await walk(source, '', root === 'modules')) {
      expectedBytes += (await fs.stat(path.join(source, name))).size;
      fileCount++;
      if (expectedBytes > maximumBackupBytes || fileCount > 100000)
        throw Error('Backup exceeds supported limits');
    }
  }
  const space = await fs.statfs(base);
  if (space.bavail * space.bsize < expectedBytes + 16 * 1024 ** 2)
    throw Error('Not enough space for this backup');
  const target = path.join(
    base,
    'Intelligence-backup-' +
      new Date().toISOString().replace(/[:.]/g, '-') +
      '-' +
      randomUUID().slice(0, 6),
  );
  await fs.mkdir(target);
  await backup(store.db, path.join(target, 'intelligence.sqlite'));
  const copy = new DatabaseSync(path.join(target, 'intelligence.sqlite'));
  try {
    copy.exec(
      `DELETE FROM search_credentials; DELETE FROM vectors; UPDATE entities SET data=json_remove(data,'$.resourceGrants') WHERE kind='agent-profile'; CREATE TABLE IF NOT EXISTS activity(id TEXT PRIMARY KEY,created TEXT NOT NULL,type TEXT NOT NULL,entity TEXT,summary TEXT NOT NULL,data TEXT NOT NULL,read INTEGER DEFAULT 0);`,
    );
  } finally {
    copy.close();
  }
  for (const root of [
    ...roots,
    ...(includeModelCaches ? ['models'] : []),
    ...(includeModules ? ['modules'] : []),
  ])
    if (await fs.stat(path.join(store.directory, root)).catch(() => null))
      await fs.cp(path.join(store.directory, root), path.join(target, root), {
        recursive: true,
        dereference: false,
      });
  if (includeModules && (await fs.stat(path.join(target, 'modules')).catch(() => null))) {
    const sourceModules = path.join(store.directory, 'modules'),
      targetModules = path.join(target, 'modules');
    for (const relative of await walk(sourceModules, '', true)) {
      const original = path.join(sourceModules, relative),
        stat = await fs.lstat(original);
      if (!stat.isSymbolicLink()) continue;
      const resolved = await fs.realpath(original);
      if (!resolved.startsWith(sourceModules + path.sep))
        throw Error('Module backup link escaped app module storage');
      const copied = path.join(targetModules, relative),
        originalLink = await fs.readlink(original),
        lexicalTarget = path.resolve(path.dirname(original), originalLink),
        newTarget = path.join(targetModules, path.relative(sourceModules, lexicalTarget));
      await fs.unlink(copied);
      await fs.symlink(path.relative(path.dirname(copied), newTarget), copied);
    }
  }
  const files = [];
  for (const relative of await walk(target, '', includeModules)) {
    const full = path.join(target, relative),
      stat = await fs.lstat(full);
    if (stat.isSymbolicLink()) {
      if (!relative.startsWith('modules/'))
        throw Error('Only verified module links can be backed up');
      const link = await fs.readlink(full);
      files.push({
        path: relative,
        bytes: 0,
        type: 'symlink',
        link,
        sha256: createHash('sha256').update(link).digest('hex'),
      });
    } else files.push({ path: relative, bytes: stat.size, sha256: await digest(full) });
  }
  const manifest = {
    format: 'Intelligence backup',
    version: includeModules ? 2 : 1,
    created: new Date().toISOString(),
    schema: 1,
    files,
    excluded: [
      'credentials',
      'agent resource grants',
      'module trust key',
      ...(includeModules ? [] : ['optional modules']),
      ...(includeModelCaches ? [] : ['model caches']),
      'external project directories',
      'external ZIM directories',
      'models managed by other apps',
    ],
    includeModelCaches,
    includeModules,
    totals: { files: files.length, bytes: files.reduce((n, f) => n + f.bytes, 0) },
  };
  await fs.writeFile(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { directory: target, ...manifest };
}
export async function inspectBackup(directory) {
  const root = await fs.realpath(directory),
    stat = await fs.stat(path.join(root, 'manifest.json'));
  if (stat.size > 20 * 1024 * 1024) throw Error('Backup manifest is too large');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
  if (
    manifest.format !== 'Intelligence backup' ||
    ![1, 2].includes(manifest.version) ||
    manifest.schema !== 1 ||
    !Array.isArray(manifest.files) ||
    manifest.files.length > 100000
  )
    throw Error('Unsupported backup format');
  let total = 0;
  const seen = new Set();
  for (const entry of manifest.files) {
    if (
      typeof entry.path !== 'string' ||
      /[\\:\x00]/.test(entry.path) ||
      entry.path.split('/').some((p) => !p || p === '..' || p === '.') ||
      path.isAbsolute(entry.path) ||
      !/^(intelligence\.sqlite$|assets\/|Vault\/|matrix-files\/|models\/|modules\/)/.test(
        entry.path,
      ) ||
      seen.has(entry.path)
    )
      throw Error('Unsafe backup path');
    seen.add(entry.path);
    total += entry.bytes;
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || total > maximumBackupBytes)
      throw Error('Backup exceeds supported limits');
    if (entry.path.startsWith('modules/') && !manifest.includeModules)
      throw Error('Backup contains unexpected modules');
    if (entry.type === 'symlink') {
      if (
        !entry.path.startsWith('modules/') ||
        typeof entry.link !== 'string' ||
        path.isAbsolute(entry.link) ||
        entry.bytes !== 0
      )
        throw Error('Unsafe module backup link');
      const location = path.join(root, entry.path),
        target = path.resolve(path.dirname(location), entry.link);
      if (
        !target.startsWith(path.join(root, 'modules') + path.sep) ||
        !(await fs.lstat(location)).isSymbolicLink() ||
        (await fs.readlink(location)) !== entry.link ||
        createHash('sha256').update(entry.link).digest('hex') !== entry.sha256
      )
        throw Error('Unsafe module backup link');
      continue;
    }
    const file = path.join(root, entry.path),
      real = await fs.realpath(file);
    if (real !== root && !real.startsWith(root + path.sep))
      throw Error('Backup path escapes its directory');
    const stat = await fs.lstat(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size !== entry.bytes ||
      (await digest(file)) !== entry.sha256
    )
      throw Error('Backup file failed verification');
  }
  if (!seen.has('intelligence.sqlite')) throw Error('Backup database is missing');
  const db = new DatabaseSync(path.join(root, 'intelligence.sqlite'), { readOnly: true });
  try {
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok')
      throw Error('Backup database is damaged');
    if (db.prepare('SELECT count(*) AS n FROM search_credentials').get().n)
      throw Error('Backup contains protected credentials');
    const counts = db
      .prepare('SELECT kind,count(*) AS count FROM entities WHERE deleted=0 GROUP BY kind')
      .all();
    const configured = JSON.parse(
      db.prepare("SELECT value FROM settings WHERE key='optionalModules'").get()?.value || '{}',
    );
    validateOptionalModules(configured);
    const artifacts = new Map(manifest.files.map((file) => [file.path, file.sha256]));
    const offlineModules = Object.entries(configured)
      .filter(([, config]) => config?.enabled)
      .map(([id, config]) => {
        const engineId = moduleEngineId(id, config),
          definition = moduleCatalog.modules.find((module) => module.id === engineId),
          missing = [];
        if (!definition) return { id, status: 'unknown', missing: ['Unknown module'] };
        const model = moduleModelDefinition(definition, config),
          modelId = moduleModelStorageId(definition, config);
        if (config.adapter === 'compatible')
          return {
            id,
            status: 'remote',
            missing: ['Remote APIs require a connection and credentials'],
          };
        if (!manifest.includeModules) missing.push('Installed modules are excluded');
        else {
          for (const [name, file] of [
            ['uv.tar.gz', moduleCatalog.runtime.uv],
            ['python.tar.gz', moduleCatalog.runtime.python],
          ])
            if (artifacts.get('modules/downloads/' + name) !== file.sha256) missing.push(name);
          for (const file of definition.wheels)
            if (
              artifacts.get('modules/downloads/wheels/' + engineId + '/' + file.name) !==
              file.sha256
            )
              missing.push(file.name);
        }
        if (model) {
          if (!manifest.includeModelCaches) missing.push('Model / voice downloads are excluded');
          else
            for (const file of model.files)
              if (artifacts.get('models/optional/' + modelId + '/' + file.name) !== file.sha256)
                missing.push(file.name);
        }
        return {
          id,
          status: missing.length ? 'incomplete' : 'ready',
          missing,
          platform: 'Linux x64',
          ...(id === 'zim' ? { archiveDirectory: config.directory || '' } : {}),
        };
      });
    if (db.prepare('SELECT count(*) AS n FROM entities').get().n > 100000)
      throw Error('Backup has too many items');
    const profiles = db
      .prepare("SELECT data FROM entities WHERE kind='agent-profile' AND deleted=0")
      .all();
    if (profiles.length > 40) throw Error('Backup has too many agent profiles');
    for (const profile of profiles) validateProfile(JSON.parse(profile.data));
    for (const row of db
      .prepare("SELECT kind,data FROM entities WHERE kind IN ('calendar-event','report-template')")
      .all())
      (row.kind === 'calendar-event' ? validateEvent : validateReportTemplate)(
        JSON.parse(row.data),
      );
    const metadata = db.prepare('SELECT id,kind,parent,revision FROM entities').all(),
      byId = new Map(metadata.map((e) => [e.id, e]));
    for (const e of metadata) {
      if (!kinds.includes(e.kind) || !Number.isInteger(e.revision) || e.revision < 1)
        throw Error('Unsupported backup entity');
      const seen = new Set([e.id]);
      let parent = e.parent;
      while (parent) {
        if (seen.has(parent) || !byId.has(parent)) throw Error('Invalid backup hierarchy');
        seen.add(parent);
        parent = byId.get(parent).parent;
      }
    }
    if (db.prepare('SELECT count(*) AS n FROM entities WHERE NOT json_valid(data)').get().n)
      throw Error('Invalid backup metadata');
    return {
      directory: root,
      created: manifest.created,
      files: seen.size,
      bytes: total,
      counts,
      excluded: manifest.excluded,
      includeModelCaches: manifest.includeModelCaches === true,
      includeModules: manifest.includeModules === true,
      offlineModules,
    };
  } finally {
    db.close();
  }
}
export async function restoreBackup(store, directory) {
  const preview = await inspectBackup(directory);
  const manifest = JSON.parse(
    await fs.readFile(path.join(preview.directory, 'manifest.json'), 'utf8'),
  );
  const staged = path.join(store.directory, 'restore-stage-' + randomUUID());
  await fs.mkdir(staged);
  for (const entry of [...manifest.files].sort(
    (a, b) => Number(a.type === 'symlink') - Number(b.type === 'symlink'),
  )) {
    if (entry.type === 'symlink') {
      const target = path.resolve(staged, entry.path),
        linked = path.resolve(path.dirname(target), entry.link);
      if (
        !target.startsWith(path.join(staged, 'modules') + path.sep) ||
        !linked.startsWith(path.join(staged, 'modules') + path.sep)
      )
        throw Error('Unsafe module backup link');
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.symlink(entry.link, target);
      continue;
    }
    const source = await fs.realpath(path.join(preview.directory, entry.path));
    if (!source.startsWith(preview.directory + path.sep))
      throw Error('Backup source changed during restore');
    const target = path.resolve(staged, entry.path);
    if (!target.startsWith(staged + path.sep)) throw Error('Unsafe backup path');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
    if ((await digest(target)) !== entry.sha256) throw Error('Backup changed during restore');
  }
  const recovery = path.join(store.directory, 'recovery-' + Date.now());
  await fs.mkdir(recovery);
  await backup(store.db, path.join(recovery, 'intelligence.sqlite'));
  const swapped = [];
  try {
    for (const root of [
      ...roots,
      ...(preview.includeModelCaches ? ['models'] : []),
      ...(preview.includeModules ? ['modules'] : []),
    ]) {
      const target = path.resolve(store.directory, root),
        previous = path.resolve(recovery, root);
      if (
        !target.startsWith(path.resolve(store.directory) + path.sep) ||
        !previous.startsWith(path.resolve(recovery) + path.sep)
      )
        throw Error('Restore storage is outside app data');
      const existed = !!(await fs.stat(target).catch(() => null));
      if (existed) await fs.rename(target, previous);
      swapped.push({ target, previous, existed });
      if (await fs.stat(path.join(staged, root)).catch(() => null))
        await fs.cp(path.join(staged, root), target, { recursive: true });
      else await fs.mkdir(target);
    }
  } catch (error) {
    for (const entry of swapped.reverse()) {
      if (await fs.stat(entry.target).catch(() => null))
        await fs.rename(entry.target, entry.previous + '-failed');
      if (entry.existed) await fs.rename(entry.previous, entry.target);
    }
    throw Error(
      'Restore failed; original files retained. Recovery: ' + recovery + '. ' + error.message,
    );
  }
  let attached = false,
    transaction = false;
  try {
    store.db.prepare('ATTACH DATABASE ? AS restored').run(path.join(staged, 'intelligence.sqlite'));
    attached = true;
    store.db.exec('BEGIN');
    transaction = true;
    for (const table of [
      'settings',
      'entities',
      'versions',
      'messages',
      'runs',
      'consolidation',
      'memory_tombstones',
      'activity',
    ]) {
      store.db.exec(
        `DELETE FROM main.${table}; INSERT INTO main.${table} SELECT * FROM restored.${table}`,
      );
    }
    store.db.exec(
      "DELETE FROM vectors; DELETE FROM search; DELETE FROM message_search; UPDATE entities SET data=json_set(data,'$.resourceGrants',json('[]')) WHERE kind='agent-profile'; UPDATE entities SET data=json_set(data,'$.status','needs_input','$.result','Restored run requires review.') WHERE kind IN ('card','matrix-task') AND json_extract(data,'$.status')='running'; UPDATE entities SET data=json_set(data,'$.enabled',json('false')) WHERE kind='connection'; UPDATE runs SET status='needs_input',end=strftime('%Y-%m-%dT%H:%M:%fZ','now'),result='Restored run requires review.' WHERE status='running'",
    );
    store.db.exec(
      "INSERT INTO search SELECT id,title,coalesce(json_extract(data,'$.content'),json_extract(data,'$.description'),'') FROM entities WHERE deleted=0; INSERT INTO message_search SELECT id,conversation,content FROM messages WHERE role IN ('user','assistant') AND coalesce(json_extract(data,'$.tool'),0)=0",
    );
    for (const table of ['execution_ledger', 'report_occurrences'])
      if (store.db.prepare('SELECT 1 FROM main.sqlite_master WHERE name=?').get(table)) {
        store.db.exec('DELETE FROM main.' + table);
        if (store.db.prepare('SELECT 1 FROM restored.sqlite_master WHERE name=?').get(table))
          store.db.exec('INSERT INTO main.' + table + ' SELECT * FROM restored.' + table);
      }
    store.db.exec(
      "UPDATE entities SET data=json_set(data,'$.status','interrupted','$.error','Restored report requires review.') WHERE kind='report' AND json_extract(data,'$.status')='running'",
    );
    store.db.exec(
      "UPDATE entities SET data=json_set(data,'$.enabled',json('false'),'$.manualRequested',NULL,'$.attention','Restored schedule requires review before enabling.') WHERE kind='report-template'",
    );
    if (store.db.prepare("SELECT 1 FROM main.sqlite_master WHERE name='execution_ledger'").get())
      store.db.exec(
        "UPDATE execution_ledger SET status='interrupted' WHERE status='running'; UPDATE report_occurrences SET state='interrupted' WHERE state='running'",
      );
    store.db.exec('COMMIT');
    transaction = false;
  } catch (e) {
    if (transaction) store.db.exec('ROLLBACK');
    for (const entry of swapped.reverse()) {
      if (await fs.stat(entry.target).catch(() => null))
        await fs.rename(entry.target, entry.previous + '-failed');
      if (entry.existed) await fs.rename(entry.previous, entry.target);
    }
    throw e;
  } finally {
    if (attached) store.db.exec('DETACH DATABASE restored');
  }
  const restoredModules = store.settings().optionalModules || {};
  store.setSettings({
    backgroundPaused: true,
    optionalModules: Object.fromEntries(
      Object.entries(restoredModules).map(([id, configuration]) => [
        id,
        { ...configuration, enabled: false },
      ]),
    ),
  });
  store.emit('changed', { restored: true });
  return { restored: true, recovery, preview, modulesToReconnect: restoredModules };
}
