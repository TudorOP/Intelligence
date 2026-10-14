import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../electron/store.mjs';
import { ContextManager, contextCapacity, conversationHistory } from '../electron/context.mjs';
import { automaticApproval } from '../electron/approval-policy.mjs';
import { projectFiles, projectPath } from '../electron/projects.mjs';
import { nextOccurrence } from '../electron/schedule.mjs';
import { Agent } from '../electron/agent.mjs';
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-context-'));
  const store = new Store(directory);
  t.after(() => {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { store, directory };
}
const streamed = (content) =>
  new Response(
    'data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\ndata: [DONE]\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
test('context discovery prefers loaded windows over advertised maxima and labels unknown providers', async () => {
  const settings = {
    provider: 'lmstudio',
    endpoint: 'http://localhost:1234',
    model: 'model',
    contextOverride: 0,
  };
  const loaded = await contextCapacity(settings, {
    fetch: async () =>
      Response.json({
        models: [
          {
            key: 'model',
            max_context_length: 131072,
            loaded_instances: [{ id: 'model', config: { context_length: 4096 } }],
          },
        ],
      }),
  });
  assert.equal(loaded.capacity, 4096);
  assert.equal(loaded.capacitySource, 'loaded model');
  const unknown = await contextCapacity(settings, {
    fetch: async () =>
      Response.json({
        models: [{ key: 'model', max_context_length: 131072, loaded_instances: [] }],
      }),
  });
  assert.match(unknown.capacitySource, /fallback/);
  assert.equal((await contextCapacity({ ...settings, contextOverride: 16384 })).capacity, 16384);
  const ollama = await contextCapacity(
    { ...settings, provider: 'ollama' },
    {
      fetch: async () =>
        Response.json({ models: [{ name: 'model:latest', context_length: 6144 }] }),
    },
  );
  assert.equal(ollama.capacity, 6144);
  const api = await contextCapacity(
    { ...settings, provider: 'openrouter' },
    {
      key: 'fixture',
      fetch: async () => Response.json({ data: [{ id: 'model', context_length: 65536 }] }),
    },
  );
  assert.equal(api.capacity, 65536);
});
test('manual and automatic compaction keep original messages and latest complete turns, survive restart and respect revocation', async (t) => {
  const { store, directory } = fixture(t);
  store.setSettings({ provider: 'lmstudio', model: 'fixture', contextOverride: 4096 });
  const conversation = store.mutate({ kind: 'conversation', title: 'Compact' }),
    note = store.all().find((e) => e.kind === 'note' && store.access(e.id));
  for (let i = 0; i < 5; i++) {
    store.message(conversation.id, 'user', 'Turn ' + i + ' ' + 'old text '.repeat(400), {
      promptContext: {
        selected: [{ id: note.id, title: note.title, excerpt: 'Permitted context', links: [] }],
        recalled: [],
      },
    });
    store.message(conversation.id, 'assistant', 'Answer ' + i);
  }
  const before = store.messages(conversation.id),
    requests = [];
  const manager = new ContextManager(
    store,
    () => ({
      fetch: async (url, options) => {
        requests.push(JSON.parse(options.body));
        return streamed('A factual summary of earlier requests.');
      },
    }),
    () => {},
  );
  assert.equal(await manager.compact(conversation.id, { force: false }), true);
  assert.deepEqual(store.messages(conversation.id), before);
  const history = conversationHistory(store, conversation.id);
  assert.match(history[0].content, /Compacted historical/);
  assert.match(history.at(-2).content, /Turn 4/);
  assert.ok(history.some((m) => m.content.includes('Turn 3')));
  assert.ok(!history.some((m) => m.content.includes('Turn 0')));
  assert.ok(requests.every((r) => !r.tools?.length));
  const restarted = new Store(directory);
  assert.match(conversationHistory(restarted, conversation.id)[0].content, /Compacted historical/);
  restarted.close();
  store.mutate({ id: note.id, data: { access: false } });
  assert.ok(
    !conversationHistory(store, conversation.id)[0].content.includes('Compacted historical'),
  );
  store.setSettings({ autoCompact: false });
  assert.equal(await manager.compact(conversation.id, { force: false }), false);
});
test('failed, cancelled or revoked compaction never commits a partial summary', async (t) => {
  const { store } = fixture(t);
  store.setSettings({ provider: 'lmstudio', model: 'fixture', contextOverride: 2048 });
  const c = store.mutate({ kind: 'conversation', title: 'Failure' }),
    note = store.all().find((e) => e.kind === 'note' && store.access(e.id));
  for (let i = 0; i < 4; i++)
    store.message(c.id, 'user', 'Text ' + i, {
      promptContext: { selected: [{ id: note.id, links: [], excerpt: 'Source' }], recalled: [] },
    });
  const failure = new ContextManager(
    store,
    () => ({ fetch: async () => streamed('') }),
    () => {},
  );
  await assert.rejects(failure.compact(c.id), /empty context summary/);
  assert.equal(store.get(c.id).data.compaction, undefined);
  const revoke = new ContextManager(
    store,
    () => ({
      fetch: async () => {
        store.mutate({ id: note.id, data: { access: false } });
        return streamed('Summary with source');
      },
    }),
    () => {},
  );
  await assert.rejects(revoke.compact(c.id), /Source access changed/);
  assert.equal(store.get(c.id).data.compaction, undefined);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    failure.compact(c.id, { signal: controller.signal }),
    (error) => error.name === 'AbortError',
  );
});
test('approval policies only auto-accept known safe commands or editable project writes', () => {
  assert.equal(automaticApproval('ask', { type: 'command', project: true, command: 'pwd' }), false);
  assert.equal(
    automaticApproval('auto', { type: 'command', project: true, command: 'git status --short' }),
    true,
  );
  for (const command of [
    'rm -rf .',
    'pwd; rm file',
    'git log --output=/tmp/result',
    'ls | bash',
    'ls $(whoami)',
  ])
    assert.equal(automaticApproval('auto', { type: 'command', project: true, command }), false);
  assert.equal(automaticApproval('auto', { type: 'project-write', insideProject: true }), true);
  assert.equal(automaticApproval('auto', { type: 'project-write', insideProject: false }), false);
  assert.equal(automaticApproval('full', { type: 'command', command: 'anything' }), true);
});
test('user-selected full access resolves pending approvals and auto mode enables revocable host commands', async (t) => {
  const { store } = fixture(t),
    agent = new Agent(store, {}, {}, () => {}),
    controller = new AbortController();
  const pending = agent.approval('fixture', 'A command', 'pwd', controller.signal, {
    type: 'command',
    project: true,
    command: 'pwd',
  });
  assert.equal(agent.approvals.size, 1);
  store.setSettings({ approvalMode: 'full' });
  agent.applyApprovalMode();
  assert.equal(await pending, true);
  assert.equal(agent.approvals.size, 0);
  assert.equal(store.settings().terminalAccess, true);
  store.setSettings({ terminalAccess: false });
  assert.equal(store.settings().terminalAccess, false);
});
test('project files paginate, revision-check, reject traversal/symlinks and preserve recoverable Trash', async (t) => {
  const { store, directory } = fixture(t),
    root = path.join(directory, 'project-fixture');
  fs.mkdirSync(root);
  const project = store.mutate({
    kind: 'project',
    title: 'Files',
    data: { directory: root, access: true, permission: 'edit' },
  });
  // Project fixture must be outside app storage, just like production project directories.
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-project-files-'));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  store.mutate({ id: project.id, data: { directory: external } });
  const write = await projectFiles(store, {
    action: 'write',
    project: project.id,
    path: 'notes/file.txt',
    content: 'Text '.repeat(5000),
  });
  const read = await projectFiles(store, {
    action: 'read',
    project: project.id,
    path: 'notes/file.txt',
  });
  assert.ok(read.nextOffset);
  assert.equal(read.revision, write.revision);
  await assert.rejects(
    projectFiles(store, {
      action: 'write',
      project: project.id,
      path: 'notes/file.txt',
      revision: 'old',
      content: 'Changed',
    }),
    /changed/,
  );
  await assert.rejects(projectPath(store, project.id, '../outside'), /outside/);
  fs.symlinkSync(
    directory,
    path.join(external, 'escaped'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(projectPath(store, project.id, 'escaped/intelligence.sqlite'), /outside/);
  const trash = await projectFiles(store, {
    action: 'trash',
    project: project.id,
    path: 'notes/file.txt',
  });
  assert.ok(fs.existsSync(path.join(external, trash.recoveryPath)));
  store.mutate({ id: project.id, data: { permission: 'read' } });
  await assert.rejects(
    projectFiles(store, { action: 'write', project: project.id, path: 'new.txt', content: 'No' }),
    /access/,
  );
});
test('recurrences honor the selected timezone across daylight saving changes', () => {
  const schedule = { start: '2026-03-07T06:00:00Z', repeat: 'daily', timezone: 'America/New_York' };
  assert.equal(
    nextOccurrence(schedule, new Date('2026-03-08T07:00:00Z')),
    '2026-03-09T05:00:00.000Z',
  );
});
test('scheduled Matrix tasks require approval, retain the chosen list and timezone, and cannot alter integration', async (t) => {
  const { store } = fixture(t),
    agent = new Agent(store, { search: async () => [] }, { tools: () => [] }, () => {}),
    c = store.mutate({ kind: 'conversation', title: 'Schedule' });
  agent.approval = async () => true;
  const task = await agent.execute(
    'schedule_task',
    {
      list: 'matrix-secondary',
      title: 'Daily work',
      description: 'Read the specified project and report changes',
      criteria: 'A verified report',
      start: '2026-10-10T01:00:00+03:00',
      repeat: 'daily',
      timezone: 'Europe/Bucharest',
    },
    { conversation: c.id, signal: new AbortController().signal },
  );
  assert.equal(task.parent, 'matrix-secondary');
  assert.equal(task.data.schedule.timezone, 'Europe/Bucharest');
  assert.equal(store.get('matrix-secondary').data.integrated, false);
  await assert.rejects(
    agent.execute(
      'schedule_task',
      { list: 'matrix-secondary' },
      { task: task.id, signal: new AbortController().signal },
    ),
    /ordinary user conversation/,
  );
});
