import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Store } from '../electron/store.mjs';
import { ensureProfiles, profileSettings } from '../electron/profiles.mjs';
import { requireAssignedAgent } from '../electron/assignments.mjs';
import { restoreWindow } from '../electron/window-state.mjs';
import { computerPath } from '../electron/computer-access.mjs';
import { authorizeFile, computerFiles } from '../electron/computer-files.mjs';
import { automaticApproval } from '../electron/approval-policy.mjs';
import { ChatFiles } from '../electron/chat-files.mjs';
import { Workspace } from '../electron/workspace.mjs';
import { CommandSessions } from '../electron/command-sessions.mjs';
import { computerImageData, clearComputerImages } from '../electron/computer-images.mjs';
import { CognitionMatrix } from '../electron/matrix.mjs';
import { exportBackup, inspectBackup, restoreBackup } from '../electron/backup.mjs';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-workspace-'));
  const store = new Store(path.join(root, 'data'));
  store.setSettings({ model: 'fixture', semanticSearch: false, autoConsolidation: false });
  t.after(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, store };
}
test('window restoration clamps disconnected displays, keeps normal size and validates persisted project selection', (t) => {
  const display = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(restoreWindow({}, [display]), {
    x: 320,
    y: 120,
    width: 1280,
    height: 800,
    maximized: false,
  });
  const restored = restoreWindow({ x: 5000, y: -600, width: 2400, height: 1800, maximized: true }, [
    display,
  ]);
  assert.deepEqual(restored, { x: 0, y: 0, width: 1920, height: 1040, maximized: true });
  const { store } = fixture(t);
  const project = store.mutate({
    kind: 'project',
    title: 'Work',
    data: { directory: process.cwd(), access: true },
  });
  store.setSettings({
    lastProject: project.id,
    windowBounds: { x: 20, y: 20, width: 1100, height: 760, maximized: false },
  });
  assert.equal(store.settings().lastProject, project.id);
  assert.throws(() => store.setSettings({ windowBounds: { width: NaN } }), /bounds/);
  assert.throws(() => store.setSettings({ lastProject: 'missing' }), /Project no longer/);
});
test('agent assignment migrates legacy Matrix models without widening profile grants or following active chat changes', (t) => {
  const { store } = fixture(t);
  store.mutate({
    id: 'matrix-secondary',
    data: { modelProfile: { provider: 'ollama', model: 'specialized' } },
  });
  const profiles = ensureProfiles(store),
    list = store.get('matrix-secondary');
  const assigned = store.get(list.data.assignedAgent);
  assert.equal(assigned.data.model, 'specialized');
  assert.equal(assigned.data.inheritModel, false);
  assert.equal(list.data.modelProfile, null);
  assert.equal(list.data.legacyModelProfile.model, 'specialized');
  const first = store.settings().activeAgent;
  const another = store.mutate({
    kind: 'agent-profile',
    title: 'Other',
    data: { inheritModel: false, provider: 'ollama', model: 'other', toolGroups: [] },
  });
  store.setSettings({ activeAgent: another.id });
  const task = store.mutate({ kind: 'matrix-task', parent: list.id, title: 'Monitor', data: {} });
  assert.equal(requireAssignedAgent(store, task), assigned.id);
  const copiedCount = profiles.length;
  ensureProfiles(store);
  assert.equal(store.all().filter((e) => e.kind === 'agent-profile').length, copiedCount + 1);
  store.mutate({ id: assigned.id, action: 'trash' });
  assert.throws(() => requireAssignedAgent(store, task), /unavailable/);
  assert.notEqual(first, another.id);
});
test('computer scope protects application data, read-only folders, symlink boundaries and live revocations', async (t) => {
  const { root, store } = fixture(t);
  ensureProfiles(store);
  const folder = path.join(root, 'allowed'),
    outside = path.join(root, 'outside');
  fs.mkdirSync(folder);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(folder, 'note.txt'), 'A');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'B');
  store.setSettings({
    computerScope: 'folders',
    computerFolders: [{ directory: folder, permission: 'read' }],
  });
  assert.equal((await computerPath(store, path.join(folder, 'note.txt'))).allowed, true);
  await assert.rejects(
    computerPath(store, path.join(folder, 'note.txt'), { edit: true }),
    /read-only/,
  );
  assert.equal((await computerPath(store, path.join(outside, 'secret.txt'))).allowed, false);
  fs.symlinkSync(outside, path.join(folder, 'link'), 'junction');
  assert.equal((await computerPath(store, path.join(folder, 'link', 'secret.txt'))).allowed, false);
  store.setSettings({ computerScope: 'system' });
  assert.equal((await computerPath(store, path.join(outside, 'secret.txt'))).allowed, true);
  await assert.rejects(
    computerPath(store, path.join(store.directory, 'intelligence.sqlite')),
    /structured tools/,
  );
  const settings = profileSettings(store),
    controller = new AbortController();
  const agent = {
    store,
    approval: async () => {
      store.setSettings({ computerScope: 'projects' });
      return true;
    },
  };
  await assert.rejects(
    authorizeFile(
      agent,
      path.join(outside, 'secret.txt'),
      { conversation: 'fixture', profileSettings: settings, signal: controller.signal },
      true,
    ),
    /access changed/,
  );
  assert.equal(automaticApproval('full', { destructive: true }, { askDestructive: true }), false);
  assert.equal(automaticApproval('full', { destructive: true }, { askDestructive: false }), true);
  assert.equal(
    automaticApproval(
      'auto',
      { type: 'project-mutation', insideProject: true, destructive: false },
      { askDestructive: true },
    ),
    true,
  );
  assert.equal(
    automaticApproval(
      'auto',
      { type: 'project-mutation', insideProject: true, destructive: true },
      { askDestructive: true },
    ),
    false,
  );
  assert.equal(
    automaticApproval('full', { requiresReview: true }, { askDestructive: false }),
    false,
  );
});
test('computer writes reject stale revisions and preserve originals before successful replacement', async (t) => {
  const { root, store } = fixture(t);
  ensureProfiles(store);
  store.setSettings({ computerScope: 'system' });
  const file = path.join(root, 'notes.txt');
  fs.writeFileSync(file, 'original');
  const agent = { store, approval: async () => true },
    ctx = {
      conversation: 'fixture',
      signal: new AbortController().signal,
      profileSettings: profileSettings(store),
    };
  const read = await computerFiles(agent, { action: 'read', path: file }, ctx);
  await assert.rejects(
    computerFiles(agent, { action: 'write', path: file, content: 'new', revision: 'stale' }, ctx),
    /File changed/,
  );
  await computerFiles(
    agent,
    { action: 'write', path: file, content: 'new', revision: read.revision },
    ctx,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), 'new');
  assert.ok(fs.readdirSync(root).some((name) => name.startsWith('notes.txt.intelligence-backup-')));
  const destination = path.join(root, 'organized', 'notes.txt');
  fs.mkdirSync(path.dirname(destination));
  fs.writeFileSync(destination, 'another download');
  await assert.rejects(
    computerFiles(agent, { action: 'move', path: file, destination }, ctx),
    /EEXIST/,
  );
  assert.equal(fs.readFileSync(destination, 'utf8'), 'another download');
  assert.equal(fs.existsSync(file), true);
  fs.unlinkSync(destination);
  await computerFiles(agent, { action: 'move', path: file, destination }, ctx);
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.readFileSync(destination, 'utf8'), 'new');
  const trashed = await computerFiles(agent, { action: 'trash', path: destination }, ctx);
  assert.equal(fs.readFileSync(trashed.recoveryPath, 'utf8'), 'new');
  assert.equal(fs.existsSync(destination), false);
});
test('authorized computer images are bounded to their response and cannot survive cancellation', async (t) => {
  const { root, store } = fixture(t);
  ensureProfiles(store);
  store.setSettings({ computerScope: 'system' });
  const file = path.join(root, 'image.png');
  fs.copyFileSync('build/icon.png', file);
  const controller = new AbortController(),
    agent = { store, active: new Map([['images', controller]]), approval: async () => true },
    ctx = {
      conversation: 'images',
      signal: controller.signal,
      profileSettings: profileSettings(store),
    };
  const result = await computerFiles(agent, { action: 'read', path: file }, ctx);
  assert.match(
    computerImageData(store, result.visionImage).image_url.url,
    /^data:image\/png;base64,/,
  );
  assert.throws(
    () => computerImageData(store, { ...result.visionImage, conversation: 'other' }),
    /no longer/,
  );
  clearComputerImages(store, controller);
  assert.throws(() => computerImageData(store, result.visionImage), /no longer/);
});
test('attachments extract text, share branch references, retain project copies and collect only unused conversation copies', async (t) => {
  const { root, store } = fixture(t);
  ensureProfiles(store);
  const attachments = new ChatFiles(store);
  const source = path.join(root, 'source.txt');
  fs.writeFileSync(source, 'Vacation plans in October');
  const conversation = store.mutate({ kind: 'conversation', title: 'Travel', data: {} });
  const imported = await attachments.import(conversation.id, [source]);
  const id = imported.added[0];
  assert.equal((await attachments.read(conversation.id, id)).text, 'Vacation plans in October');
  assert.equal(store.get(conversation.id).data.attachmentPrivate, true);
  const user = store.message(conversation.id, 'user', 'Review this');
  store.messageData(user.id, {
    promptContext: { selected: [], recalled: [], attachments: [{ id, name: 'source.txt' }] },
  });
  const reply = store.message(conversation.id, 'assistant', 'Reviewed');
  const branch = new Workspace(store, {}).branch({ id: conversation.id, message: reply.id });
  assert.equal(attachments.list(branch.id)[0].id, id);
  const directory = path.join(root, 'project');
  fs.mkdirSync(directory);
  const project = store.mutate({
    kind: 'project',
    title: 'Research',
    data: { directory, access: true },
  });
  await attachments.keep(branch.id, id, project.id, 'Sources/source.txt', { user: true });
  await assert.rejects(
    attachments.keep(branch.id, id, project.id, 'Sources/source.txt', { user: true }),
    /EEXIST/,
  );
  const stored = (await attachments.file(branch.id, id)).file;
  store.mutate({ id: conversation.id, action: 'trash' });
  store.deleteTrash(conversation.id);
  await attachments.collect();
  assert.equal(fs.existsSync(stored), true);
  store.mutate({ id: branch.id, action: 'trash' });
  store.deleteTrash(branch.id);
  await attachments.collect();
  assert.equal(fs.existsSync(stored), false);
  assert.equal(
    fs.readFileSync(path.join(directory, 'Sources/source.txt'), 'utf8'),
    'Vacation plans in October',
  );
  assert.equal(fs.existsSync(source), true);
});
test('portable backups include conversation attachments with verified manifest bytes', async (t) => {
  const { root, store } = fixture(t);
  ensureProfiles(store);
  const files = new ChatFiles(store),
    source = path.join(root, 'source.txt');
  fs.writeFileSync(source, 'backup me');
  const conversation = store.mutate({ kind: 'conversation', title: 'Backup', data: {} });
  const workspace = new Workspace(store, {});
  t.after(() => workspace.close());
  await files.import(conversation.id, [source]);
  store.setSettings({ computerScope: 'system', askDestructive: false });
  const destination = path.join(root, 'backups');
  fs.mkdirSync(destination);
  const result = await exportBackup(store, destination);
  const directory = typeof result === 'string' ? result : result.directory || result.path;
  const preview = await inspectBackup(directory);
  assert.ok(result.files.some((f) => f.path.startsWith('chat-files/')));
  assert.ok(preview.files >= 2);
  const id = files.list(conversation.id)[0].id;
  await files.remove(conversation.id, id);
  assert.equal(files.list(conversation.id).length, 0);
  await restoreBackup(store, directory);
  assert.equal((await files.read(conversation.id, id)).text, 'backup me');
  assert.equal(store.settings().computerScope, 'projects');
  assert.equal(store.settings().askDestructive, true);
});
test('managed commands enforce ownership, expose completion and cancel processes with their run', async (t) => {
  const sessions = new CommandSessions();
  t.after(() => sessions.close());
  const controller = new AbortController(),
    owner = { conversation: 'a', controller, profile: 'agent' };
  const id = sessions.start({
    ...owner,
    executable: process.execPath,
    args: ['-e', "process.stdout.write('ready');setTimeout(()=>process.stdout.write('done'),40)"],
    cwd: process.cwd(),
    timeout: 5000,
  });
  await assert.rejects(sessions.read(id, { ...owner, conversation: 'other' }), /outside/);
  let result,
    output = '';
  for (let i = 0; i < 15; i++) {
    result = await sessions.read(id, owner, 100);
    output += result.output;
    if (result.status !== 'running') break;
  }
  assert.equal(result.status, 'done');
  assert.equal(output, 'readydone');
  const long = sessions.start({
    ...owner,
    executable: process.execPath,
    args: ['-e', 'setInterval(()=>{},1000)'],
    cwd: process.cwd(),
    timeout: 5000,
  });
  sessions.closeRun(owner.conversation, controller);
  assert.equal(sessions.sessions.has(long), false);

  const child = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  let killed = false;
  child.kill = () => {
    killed = true;
    child.exitCode = 0;
  };
  const inputClosed = new CommandSessions({ launch: () => child, platform: 'win32' });
  t.after(() => inputClosed.close());
  const inputJob = inputClosed.start({ ...owner, command: 'fixture', cwd: process.cwd() });
  child.stdin.emit('error', new Error('EPIPE'));
  assert.equal((await inputClosed.read(inputJob, owner)).status, 'running');
  inputClosed.closeRun(owner.conversation, controller);
  assert.equal(killed, true, 'closing stdin must not detach a still-running process');
});
test('durable inbox monitoring settles downloads, queues arrivals during a run and catches up after restart', async (t) => {
  const { root, store } = fixture(t);
  ensureProfiles(store);
  let time = Date.now();
  const inbox = path.join(root, 'Downloads');
  fs.mkdirSync(inbox);
  fs.writeFileSync(path.join(inbox, 'existing.txt'), 'existing');
  store.setSettings({
    computerScope: 'folders',
    computerFolders: [{ directory: inbox, permission: 'edit' }],
  });
  store.mutate({ id: 'matrix-core', data: { integrated: true } });
  const task = store.mutate({
    kind: 'matrix-task',
    parent: 'matrix-core',
    title: 'Inbox',
    data: {
      content: 'Organize downloads',
      status: 'queued',
      trigger: { kind: 'file', mode: 'inbox', directory: inbox, cooldownSeconds: 5 },
    },
  });
  let matrix, release, started;
  let first = true;
  const startedPromise = new Promise((resolve) => (started = resolve));
  const calls = [];
  const agent = {
    active: new Map(),
    stop() {},
    async chat(request) {
      calls.push(store.get(task.id).data.watchBatch);
      if (first) {
        first = false;
        started();
        await new Promise((resolve) => (release = resolve));
      }
      matrix.outcome(
        { id: task.id, status: 'done', message: 'Processed', verification: 'Verified' },
        { task: task.id, conversation: request.conversation },
      );
    },
  };
  const runtime = {
    now: () => time,
    watch: () => {
      const handle = new EventEmitter();
      handle.close = () => {};
      return handle;
    },
    residentModel: async (settings) => settings.model,
    prepareModel: async (settings) => settings.model,
  };
  matrix = new CognitionMatrix(store, agent, () => {}, runtime);
  t.after(() => matrix.close());
  await matrix.triggers.inbox.reconcile([task]);
  assert.equal(matrix.triggers.inbox.targets.size, 1, store.get(task.id).data.result);
  assert.equal(matrix.triggers.inbox.history(task.id)[0].state, 'ignored');
  fs.writeFileSync(path.join(inbox, 'pending.crdownload'), 'partial');
  fs.writeFileSync(path.join(inbox, 'one.txt'), 'first');
  await matrix.triggers.inbox.scan();
  time += 6000;
  await matrix.triggers.inbox.scan();
  assert.equal(matrix.triggers.inbox.history(task.id).filter((e) => e.state === 'ready').length, 1);
  const run = matrix.tick();
  await startedPromise;
  fs.writeFileSync(path.join(inbox, 'two.txt'), 'second');
  await matrix.triggers.inbox.scan();
  time += 6000;
  await matrix.triggers.inbox.scan();
  assert.equal(matrix.triggers.inbox.history(task.id).filter((e) => e.state === 'ready').length, 1);
  release();
  await run;
  time += 6000;
  await matrix.triggers.inbox.scan();
  await matrix.tick();
  assert.equal(calls.length, 2);
  assert.ok(calls[0][0].path.endsWith('one.txt'));
  assert.ok(calls[1][0].path.endsWith('two.txt'));
  matrix.close();
  fs.writeFileSync(path.join(inbox, 'offline.txt'), 'offline');
  matrix = new CognitionMatrix(store, agent, () => {}, runtime);
  await matrix.triggers.inbox.reconcile([store.get(task.id)]);
  time += 6000;
  await matrix.triggers.inbox.scan();
  await matrix.tick();
  assert.equal(calls.length, 3);
  assert.ok(calls[2][0].path.endsWith('offline.txt'));
  assert.ok(
    !matrix.triggers.inbox.history(task.id).some((e) => e.file.endsWith('pending.crdownload')),
  );
});
