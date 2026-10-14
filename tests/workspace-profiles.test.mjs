import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../electron/store.mjs';
import { Vault } from '../electron/vault.mjs';
import { Workspace } from '../electron/workspace.mjs';
import {
  ensureProfiles,
  profileAction,
  profileSettings,
  profileAllows,
} from '../electron/profiles.mjs';
import { exportBackup, inspectBackup, restoreBackup } from '../electron/backup.mjs';
import { ExternalEvents, updateWake } from '../electron/automation.mjs';
import { CognitionMatrix } from '../electron/matrix.mjs';
import { EventEmitter } from 'node:events';
import { Agent } from '../electron/agent.mjs';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-workspace-')),
    store = new Store(directory),
    vault = new Vault(store),
    workspace = new Workspace(store, vault);
  t.after(() => {
    workspace.close();
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { directory, store, vault, workspace };
}
test('profiles migrate identity, derive ratings, bind conversations and enforce intersected live scopes', (t) => {
  const { store } = fixture(t);
  store.setSettings({ model: 'original-model', agentName: 'User name', personality: 'User voice' });
  const first = ensureProfiles(store)[0];
  assert.equal(first.title, 'User name');
  assert.ok(first.data.personality.startsWith('User voice'));
  assert.ok(first.data.personality.includes('Help the user accomplish their request'));
  assert.equal(first.data.systemPrompt, '');
  const second = profileAction(store, {
    action: 'save',
    title: 'Researcher',
    data: {
      provider: 'lmstudio',
      model: 'profile-model',
      personality: 'Precise',
      ratings: { intelligence: 5, knowledge: 4, toolUse: 3, longTasks: 2 },
      toolGroups: ['workspace', 'connections'],
      skillIds: [],
      connectionIds: ['server-one'],
    },
  });
  assert.equal(second.data.performance, 3.5);
  profileAction(store, { action: 'select', id: second.id });
  const conversation = store.mutate({ kind: 'conversation', title: 'Profile chat' }),
    settings = profileSettings(store, conversation);
  assert.equal(conversation.data.agentProfile, second.id);
  assert.equal(settings.model, 'profile-model');
  assert.equal(settings.agentName, 'Researcher');
  const connections = {
    registry: new Map([
      ['mcp_one', { id: 'server-one' }],
      ['mcp_two', { id: 'server-two' }],
    ]),
  };
  assert.equal(profileAllows(store, settings, 'mcp_one', connections), true);
  assert.equal(profileAllows(store, settings, 'mcp_two', connections), false);
  assert.equal(profileAllows(store, settings, 'terminal', connections), false);
  profileAction(store, {
    action: 'save',
    id: second.id,
    revision: second.revision,
    title: second.title,
    data: { connectionIds: [] },
  });
  assert.equal(profileAllows(store, settings, 'mcp_one', connections), false);
  assert.throws(
    () =>
      profileAction(store, {
        action: 'save',
        id: second.id,
        revision: second.revision,
        title: 'Stale',
      }),
    /changed/,
  );
  assert.throws(
    () =>
      profileAction(store, {
        action: 'save',
        title: 'Invalid',
        data: { ratings: { knowledge: 6 } },
      }),
    /stars/,
  );
  profileAction(store, { action: 'select', id: first.id });
  assert.equal(profileSettings(store, conversation).model, 'profile-model');
  profileAction(store, { action: 'delete', id: second.id });
  assert.ok(store.get(conversation.id));
  assert.equal(profileAllows(store, settings, 'list_items', connections), false);
});
test('history restoration preserves current identity, parents, grants and creates a fresh revision; stale restores fail', async (t) => {
  const { store, vault, workspace } = fixture(t),
    notebook = store.all().find((e) => e.kind === 'notebook');
  const note = store.mutate({
    kind: 'note',
    title: 'Original',
    parent: notebook.id,
    data: { content: 'Old text', access: false },
  });
  const changed = store.mutate({
    id: note.id,
    title: 'Current name',
    data: { content: 'New text', access: true },
  });
  const restored = await workspace.action({
    action: 'restore',
    id: note.id,
    version: note.revision,
    revision: changed.revision,
  });
  assert.equal(restored.data.content, 'Old text');
  assert.equal(restored.title, 'Current name');
  assert.equal(restored.data.access, true);
  assert.equal(restored.parent, notebook.id);
  assert.equal(restored.revision, changed.revision + 1);
  await assert.rejects(
    workspace.action({
      action: 'restore',
      id: note.id,
      version: note.revision,
      revision: changed.revision,
    }),
    /changed/,
  );
  const file = vault.create({ title: 'File', content: 'Original bytes' }),
    saved = vault.update({ id: file.id, revision: file.revision, content: 'Updated bytes' });
  await workspace.action({
    action: 'restore',
    id: file.id,
    version: file.revision,
    revision: saved.revision,
  });
  assert.equal(vault.read(file.id).data.content, 'Original bytes');
});
test('branches preserve complete prefix and original messages, reset compaction and mark shared memory prefixes', async (t) => {
  const { store, workspace } = fixture(t),
    c = store.mutate({
      kind: 'conversation',
      title: 'Original',
      data: { temporary: true, compaction: { summary: 'old' }, chatMetrics: { count: 9 } },
    });
  store.message(c.id, 'user', 'Original question');
  const m = store.message(c.id, 'assistant', 'Original answer');
  store.message(c.id, 'user', 'Later question');
  const branch = await workspace.action({
    action: 'branch',
    id: c.id,
    message: m.id,
    model: 'alternate-model',
  });
  assert.equal(store.messages(c.id).length, 3);
  assert.equal(store.messages(branch.id).length, 2);
  assert.equal(branch.data.temporary, true);
  assert.equal(branch.data.compaction, undefined);
  assert.equal(branch.data.chatMetrics, undefined);
  assert.equal(branch.data.branchModel, 'alternate-model');
  assert.ok(store.messages(branch.id).every((v) => v.data.sharedPrefix));
  const unfinished = store.message(c.id, 'assistant', '', {
    tool: true,
    modelMessage: { tool_calls: [{ id: 'call' }] },
  });
  await assert.rejects(
    workspace.action({ action: 'branch', id: c.id, message: unfinished.id }),
    /complete/,
  );
});
test('bulk actions deduplicate ancestry, reject stale selection before effects and roll back metadata groups', async (t) => {
  const { store, workspace } = fixture(t),
    notebook = store.mutate({ kind: 'notebook', title: 'Bulk parent' }),
    child = store.mutate({ kind: 'note', parent: notebook.id, title: 'Child' });
  const result = await workspace.action({
    action: 'bulk',
    operation: 'trash',
    items: [notebook, child].map((e) => ({ id: e.id, revision: e.revision })),
  });
  assert.equal(result.length, 1);
  assert.equal(store.get(child.id), null);
  const a = store.mutate({ kind: 'skill', title: 'A' }),
    b = store.mutate({ kind: 'skill', title: 'B' });
  store.mutate({ id: b.id, title: 'Changed' });
  await assert.rejects(
    workspace.action({
      action: 'bulk',
      operation: 'trash',
      items: [a, b].map((e) => ({ id: e.id, revision: e.revision })),
    }),
    /changed/,
  );
  assert.ok(store.get(a.id));
  for (let i = 0; i < 150; i++) await workspace.action({ action: 'visit', id: a.id });
  assert.equal(store.settings().recentItems.length, 1);
  for (let i = 0; i < 600; i++) workspace.record('test', a.id, 'Bounded');
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM activity').get().n, 500);
});
test('backup round trips app data and assets, excludes credentials/vectors, verifies hashes and retains recovery', async (t) => {
  const { directory, store, vault } = fixture(t);
  ensureProfiles(store);
  store.setSettings({ notebookLook: 'folio', language: 'ro' });
  const file = vault.create({ title: 'Știință', content: 'Original user work' });
  store.db
    .prepare('INSERT INTO search_credentials VALUES(?,?)')
    .run('secret', Buffer.from('protected-key'));
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-backup-test-'));
  t.after(() => fs.rmSync(destination, { recursive: true, force: true }));
  const exported = await exportBackup(store, destination),
    preview = await inspectBackup(exported.directory);
  assert.ok(preview.counts.some((v) => v.kind === 'vault-file'));
  vault.update({ id: file.id, revision: file.revision, content: 'Changed after export' });
  store.setSettings({ notebookLook: 'spiral' });
  const restored = await restoreBackup(store, exported.directory);
  assert.ok(fs.existsSync(path.join(restored.recovery, 'intelligence.sqlite')));
  assert.equal(vault.read(file.id).data.content, 'Original user work');
  assert.equal(store.settings().notebookLook, 'folio');
  assert.equal(store.settings().language, 'ro');
  assert.equal(store.settings().backgroundPaused, true);
  const manifestPath = path.join(exported.directory, 'manifest.json'),
    manifest = JSON.parse(fs.readFileSync(manifestPath));
  manifest.files[0].path = '../escape';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  await assert.rejects(inspectBackup(exported.directory), /Unsafe/);
});
test('local external events require authentication, stay bounded and close when paused', async (t) => {
  const { store } = fixture(t);
  let count = 0;
  const credentials = {
    token: '',
    get() {
      return this.token;
    },
    save(v) {
      this.token = v;
    },
  };
  const service = new ExternalEvents(store, credentials, () => ({ queued: ++count }));
  t.after(() => service.close());
  store.setSettings({ externalEventsEnabled: true, externalEventsPort: 32791 });
  await service.refresh();
  const url = 'http://127.0.0.1:32791/events/test';
  assert.equal((await fetch(url, { method: 'POST' })).status, 401);
  assert.equal(count, 0);
  assert.equal(
    (
      await fetch(url, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + credentials.token },
      })
    ).status,
    200,
  );
  assert.equal(count, 1);
  store.setSettings({ backgroundPaused: true });
  await service.refresh();
  assert.equal(service.server, null);
});
test('backup restore rolls back both database and filesystem if a verified schema is incomplete', async (t) => {
  const { store, vault } = fixture(t),
    file = vault.create({ title: 'Rollback', content: 'Exported bytes' });
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-rollback-'));
  t.after(() => fs.rmSync(destination, { recursive: true, force: true }));
  const exported = await exportBackup(store, destination);
  vault.update({ id: file.id, revision: file.revision, content: 'Current bytes must survive' });
  const dbPath = path.join(exported.directory, 'intelligence.sqlite'),
    db = new DatabaseSync(dbPath);
  db.exec('DROP TABLE versions');
  db.close();
  const manifestPath = path.join(exported.directory, 'manifest.json'),
    manifest = JSON.parse(fs.readFileSync(manifestPath)),
    entry = manifest.files.find((v) => v.path === 'intelligence.sqlite');
  entry.bytes = fs.statSync(dbPath).size;
  entry.sha256 = createHash('sha256').update(fs.readFileSync(dbPath)).digest('hex');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  await assert.rejects(restoreBackup(store, exported.directory), /versions/);
  assert.equal(vault.read(file.id).data.content, 'Current bytes must survive');
});
test('pending host approval cannot outlive a revoked agent profile scope', async (t) => {
  const { store } = fixture(t),
    profile = ensureProfiles(store)[0];
  const settings = profileSettings(store),
    c = store.mutate({ kind: 'conversation', title: 'Approval' });
  const agent = new Agent(store, {}, { tools: () => [], registry: new Map() }, () => {});
  agent.runProfiles.set(c.id, settings);
  agent.currentTools.set(c.id, 'run_command');
  const promise = agent.approval(
    c.id,
    'Test approval',
    'No command is executed',
    new AbortController().signal,
    { type: 'host-command' },
  );
  profileAction(store, {
    action: 'save',
    id: profile.id,
    revision: profile.revision,
    title: profile.title,
    data: { toolGroups: [] },
  });
  agent.approve([...agent.approvals.keys()][0], true);
  assert.equal(await promise, false);
  assert.equal(agent.approvals.size, 0);
});
test('excluded profile skills are suppressed in discovery/search and cannot be read through generic tools', async (t) => {
  const { store } = fixture(t),
    profile = ensureProfiles(store)[0];
  const skill = store.mutate({
    kind: 'skill',
    title: 'Private to this profile',
    data: { access: true, content: 'Hidden skill body' },
  });
  profileAction(store, {
    action: 'save',
    id: profile.id,
    revision: profile.revision,
    title: profile.title,
    data: { skillIds: [] },
  });
  const agent = new Agent(store, {}, { tools: () => [], registry: new Map() }, () => {}),
    ctx = {
      project: null,
      signal: new AbortController().signal,
      profileSettings: profileSettings(store),
    };
  const overview = await agent.execute('workspace_overview', {}, ctx);
  assert.equal(overview.categories.find((v) => v.kind === 'skill').count, 0);
  assert.equal(
    (await agent.execute('search_items', { query: 'Private' }, ctx)).some((v) => v.id === skill.id),
    false,
  );
  await assert.rejects(agent.execute('read_item', { id: skill.id }, ctx), /profile scope/);
});
test('optional model-cache backup stays explicit and verifies cached bytes', async (t) => {
  const { store, directory } = fixture(t),
    destination = fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-cache-backup-'));
  t.after(() => fs.rmSync(destination, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'models'));
  fs.writeFileSync(path.join(directory, 'models', 'fixture-model.bin'), 'Test cache bytes');
  const plain = await exportBackup(store, destination);
  assert.equal(fs.existsSync(path.join(plain.directory, 'models')), false);
  const cached = await exportBackup(store, destination, { includeModelCaches: true });
  assert.equal((await inspectBackup(cached.directory)).includeModelCaches, true);
  fs.writeFileSync(path.join(cached.directory, 'models', 'fixture-model.bin'), 'Changed');
  await assert.rejects(inspectBackup(cached.directory), /verification/);
});
test('missed recurring Matrix occurrences require the selected policy even after prior successful work', (t) => {
  const { store } = fixture(t),
    agent = new EventEmitter();
  agent.active = new Map();
  agent.stop = () => {};
  const matrix = new CognitionMatrix(store, agent, () => {});
  t.after(() => matrix.close());
  store.mutate({ id: 'matrix-core', data: { integrated: true } });
  const due = new Date(Date.now() - 2 * 3600000).toISOString(),
    task = store.mutate({
      kind: 'matrix-task',
      parent: 'matrix-core',
      title: 'Missed recurrence',
      data: {
        status: 'queued',
        lastRun: new Date(Date.now() - 86400000).toISOString(),
        schedule: { start: due, repeat: 'daily' },
      },
    });
  assert.equal(matrix.eligible(task), false);
  assert.equal(store.get(task.id).data.status, 'needs_input');
  matrix.queue(task.id);
  assert.equal(matrix.eligible(store.get(task.id)), true);
});
test('Matrix pause, system/external edges and RTC ownership respect access and preserve other alarms', (t) => {
  const { store, directory } = fixture(t),
    agent = new EventEmitter();
  agent.active = new Map();
  agent.stop = () => {};
  agent.providerRuntime = () => ({});
  const matrix = new CognitionMatrix(store, agent, () => {});
  t.after(() => matrix.close());
  const list = store.get('matrix-core');
  store.mutate({ id: list.id, data: { integrated: true } });
  const machine = store.mutate({
    kind: 'machine',
    title: 'Machine',
    data: { access: true, permission: 'read' },
  });
  const task = store.mutate({
    kind: 'matrix-task',
    parent: list.id,
    title: 'Threshold',
    data: {
      trigger: {
        kind: 'system',
        source: machine.id,
        metric: 'memory',
        threshold: 80,
        cooldownSeconds: 5,
      },
      status: 'queued',
    },
  });
  assert.equal(matrix.runnable(task), false);
  matrix.triggers.scanSystem({ memory: 70, cpu: 0 });
  matrix.triggers.scanSystem({ memory: 90, cpu: 0 });
  assert.equal(store.get(task.id).data.triggerPending, true);
  store.setSettings({ backgroundPaused: true });
  matrix.refresh();
  assert.equal(matrix.timer, null);
  assert.equal(matrix.triggers.systemTimer, null);
  const alarm = path.join(directory, 'test-alarm');
  fs.writeFileSync(alarm, '1234567899');
  store.setSettings({ wakeForTasks: true, backgroundPaused: false });
  updateWake(store, { available: true, alarm });
  assert.equal(fs.readFileSync(alarm, 'utf8'), '1234567899');
});
