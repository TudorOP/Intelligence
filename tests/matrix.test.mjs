import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../electron/store.mjs';
import { CognitionMatrix } from '../electron/matrix.mjs';

function fixture(t, behavior) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-matrix-'));
  const store = new Store(directory);
  store.setSettings({ model: 'fixture', semanticSearch: false, autoConsolidation: false });
  const calls = [];
  const agent = {
    active: new Map(),
    stop() {},
    async chat(request) {
      calls.push(request.task);
      this.active.set(request.conversation, true);
      try {
        if (behavior) await behavior(request, matrix, agent);
        else
          matrix.outcome(
            {
              id: request.task,
              status: 'done',
              message: 'Fixture complete',
              verification: 'Fixture checked',
            },
            { task: request.task, conversation: request.conversation },
          );
      } finally {
        this.active.delete(request.conversation);
      }
    },
  };
  const matrix = new CognitionMatrix(store, agent, undefined, {
    residentModel: async (settings) => settings.model,
    prepareModel: async (settings) => settings.model,
  });
  t.after(() => {
    matrix.close();
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const add = (parent = 'matrix-core', title = 'Task') =>
    store.mutate({
      kind: 'matrix-task',
      parent,
      title,
      data: { content: 'Fixture instructions', status: 'queued', enabled: true },
    });
  const integrate = (id = 'matrix-core', integrated = true) =>
    store.mutate({ id, data: { integrated } });
  return { store, matrix, agent, calls, add, integrate };
}

test('Matrix has exactly three global lists; validates names, topology and configuration', (t) => {
  const f = fixture(t);
  assert.deepEqual(
    f.matrix.lists().map((e) => e.title),
    ['Core', 'Secondary', 'Tertiary'],
  );
  assert.ok(f.matrix.lists().every((e) => e.project === null));
  assert.equal(
    f.store.listItems({ kind: 'matrix-list', project: 'another-project' }).items.length,
    3,
  );
  assert.throws(
    () => f.store.mutate({ kind: 'matrix-list', title: 'Fourth', data: {} }),
    /exactly three/,
  );
  assert.throws(() => f.store.mutate({ id: 'matrix-core', title: 'Renamed' }), /Core keeps/);
  assert.throws(() => f.store.mutate({ id: 'matrix-core', action: 'trash' }), /permanent/);
  assert.throws(
    () =>
      f.store.mutate({
        kind: 'matrix-task',
        parent: 'matrix-core',
        project: 'some-project',
        title: 'Bad',
      }),
    /global/,
  );
  f.store.mutate({ id: 'matrix-secondary', title: 'Research', data: { description: 'Context' } });
  assert.equal(f.store.get('matrix-secondary').title, 'Research');
  const parent = f.add(),
    child = f.add(parent.id);
  assert.throws(() => f.store.mutate({ id: parent.id, parent: child.id }), /eight levels/);
  for (const value of [0, 0.5, NaN, 3601])
    assert.throws(() => f.store.setSettings({ matrixPollSeconds: value }), /integer/);
  assert.throws(() => f.store.setSettings({ matrixDoneColor: 'red' }), /six-digit/);
  f.store.setSettings({
    matrixPollSeconds: 2,
    matrixDoneColor: '#00aaff',
    matrixScheduling: 'priority',
  });
  assert.equal(f.store.settings().matrixPollSeconds, 2);
});

test('round-robin claims once, fairly serves all lists, and never repeats completed work', async (t) => {
  const f = fixture(t);
  const core1 = f.add(),
    core2 = f.add('matrix-core', 'Second'),
    secondary = f.add('matrix-secondary'),
    tertiary = f.add('matrix-tertiary');
  for (const list of f.matrix.lists()) f.integrate(list.id);
  for (let i = 0; i < 8; i++) await f.matrix.tick();
  assert.deepEqual(f.calls, [core1.id, secondary.id, tertiary.id, core2.id]);
  assert.equal(f.store.snapshot().runs.length, 4);
  assert.ok(f.calls.every((id) => f.store.get(id).data.status === 'done'));
});

test('priority queue respects integration, tool access and foreground activity', async (t) => {
  const f = fixture(t);
  const core1 = f.add(),
    core2 = f.add(),
    secondary = f.add('matrix-secondary');
  await f.matrix.tick();
  assert.equal(f.calls.length, 0);
  f.integrate();
  f.integrate('matrix-secondary');
  f.store.setSettings({ matrixScheduling: 'priority' });
  f.agent.active.set('foreground', true);
  await f.matrix.tick();
  assert.equal(f.calls.length, 0);
  f.agent.active.clear();
  f.store.setSettings({ matrixAccess: false });
  await f.matrix.tick();
  assert.equal(f.calls.length, 0);
  f.store.setSettings({ matrixAccess: true });
  for (let i = 0; i < 3; i++) await f.matrix.tick();
  assert.deepEqual(f.calls, [core1.id, core2.id, secondary.id]);
});

test('subtasks run first and a parent cannot finish with incomplete children', async (t) => {
  const f = fixture(t);
  f.integrate();
  const parent = f.add(),
    child = f.add(parent.id);
  const conversation = f.store.mutate({
    kind: 'conversation',
    title: 'Scoped',
    data: { matrixTask: parent.id },
  });
  assert.throws(
    () =>
      f.matrix.outcome(
        { id: parent.id, status: 'done', message: 'Done', verification: 'Test' },
        { task: parent.id, conversation: conversation.id },
      ),
    /subtasks/,
  );
  await f.matrix.tick();
  await f.matrix.tick();
  assert.deepEqual(f.calls, [child.id, parent.id]);
  assert.equal(f.matrix.taskData(child.id).ancestors[0].id, parent.id);
});

test('input requests and failures do not retry; a user reply queues a new attempt', async (t) => {
  let attempt = 0;
  const f = fixture(t, (request, matrix) =>
    matrix.outcome(
      {
        id: request.task,
        status: attempt++ ? 'done' : 'needs_input',
        message: attempt === 1 ? 'Which date range?' : 'Finished',
        verification: 'Checked fixture',
      },
      { task: request.task, conversation: request.conversation },
    ),
  );
  const task = f.add();
  f.integrate();
  await f.matrix.tick();
  await f.matrix.tick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.store.get(task.id).data.status, 'needs_input');
  f.matrix.reply(task.id, 'Use the last month');
  await f.matrix.tick();
  assert.equal(f.calls.length, 2);
  assert.equal(f.store.get(task.id).data.status, 'done');
  assert.ok(
    f.store.children(task.id).some((e) => e.kind === 'matrix-entry' && e.data.role === 'user'),
  );
  const failed = f.add();
  f.store.mutate({ id: failed.id, data: { status: 'failed' } });
  await f.matrix.tick();
  assert.equal(f.calls.length, 2);
});

test('missing model and unrecorded outcomes require attention; verified completion is explicit', async (t) => {
  const f = fixture(t, () => {});
  const task = f.add();
  f.integrate();
  f.store.setSettings({ model: '' });
  await f.matrix.tick();
  assert.equal(f.store.get(task.id).data.status, 'needs_input');
  assert.equal(f.calls.length, 0);
  f.store.setSettings({ model: 'fixture' });
  f.matrix.queue(task.id);
  await f.matrix.tick();
  assert.equal(f.store.get(task.id).data.status, 'needs_input');
  const ctx = { task: task.id, conversation: f.store.get(task.id).data.conversation };
  assert.throws(
    () => f.matrix.outcome({ id: task.id, status: 'done', message: 'Done' }, ctx),
    /verification/,
  );
  assert.throws(
    () =>
      f.matrix.outcome(
        {
          id: f.add('matrix-secondary').id,
          status: 'done',
          message: 'Done',
          verification: 'Checked',
        },
        ctx,
      ),
    /outside/,
  );
});

test('one in-flight claim survives duplicate polls and integration revocation aborts it', async (t) => {
  let release;
  const waiting = new Promise((_, reject) => {
    release = () => reject(new Error('Stopped'));
  });
  const f = fixture(t, () => waiting);
  f.agent.stop = () => release();
  const task = f.add();
  f.integrate();
  const running = f.matrix.tick();
  await f.matrix.tick();
  await f.matrix.tick();
  assert.equal(f.calls.length, 1);
  f.integrate('matrix-core', false);
  await f.matrix.tick();
  await running;
  assert.equal(f.store.get(task.id).data.status, 'paused');
  f.integrate();
  await f.matrix.tick();
  assert.equal(f.calls.length, 1);
});

test('whole-list attention blocks that list while others continue', async (t) => {
  const f = fixture(t, (request, matrix) =>
    matrix.outcome(
      {
        id: request.task,
        status: 'needs_input',
        scope: 'list',
        message: 'Search server is offline',
      },
      { task: request.task, conversation: request.conversation },
    ),
  );
  f.add();
  f.add();
  f.add('matrix-secondary');
  f.integrate();
  f.integrate('matrix-secondary');
  await f.matrix.tick();
  await f.matrix.tick();
  await f.matrix.tick();
  assert.equal(f.calls.length, 2);
  assert.ok(f.store.get('matrix-core').data.attention);
});

test('restart requires review of running tasks and preserves terminal states', (t) => {
  const f = fixture(t);
  const task = f.add(),
    done = f.add();
  f.store.mutate({ id: task.id, data: { status: 'running' } });
  f.store.mutate({ id: done.id, data: { status: 'done' } });
  const recovered = new CognitionMatrix(f.store, f.agent);
  assert.equal(f.store.get(task.id).data.status, 'needs_input');
  assert.equal(f.store.get(done.id).data.status, 'done');
  recovered.close();
});
