import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Store } from '../electron/store.mjs';
import { CognitionMatrix } from '../electron/matrix.mjs';
import { residentModel, prepareModel } from '../electron/model-residency.mjs';
import { completion } from '../electron/provider.mjs';
import { nextOccurrence } from '../electron/schedule.mjs';
import { ContextManager } from '../electron/context.mjs';

const pause = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition) {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await pause();
  }
  assert.fail('Condition timed out');
}
function fixture(t, runtime = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-wake-'));
  const store = new Store(path.join(root, 'data'));
  store.setSettings({ model: 'chat-model', semanticSearch: false, autoConsolidation: false });
  const calls = [],
    loads = [];
  const agent = {
    active: new Map(),
    stop() {},
    async chat(request) {
      calls.push(request);
      matrix.outcome(
        { id: request.task, status: 'done', message: 'Done', verification: 'Checked' },
        { task: request.task, conversation: request.conversation },
      );
    },
  };
  const matrix = new CognitionMatrix(store, agent, undefined, {
    residentModel: async () => 'resident',
    prepareModel: async (profile) => {
      loads.push(profile);
      return profile.model;
    },
    ...runtime,
  });
  const add = (data = {}, parent = 'matrix-core') =>
    store.mutate({
      kind: 'matrix-task',
      parent,
      title: 'Fixture task',
      data: { enabled: true, status: 'queued', ...data },
    });
  t.after(() => {
    matrix.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, store, matrix, agent, calls, loads, add };
}

test('per-list inference stays fixed when preparation is off, without changing chat', async (t) => {
  const f = fixture(t);
  f.store.setSettings({
    provider: 'lmstudio',
    endpoint: 'http://localhost:5678',
    model: 'lm-chat',
  });
  f.store.setSettings({ provider: 'ollama', model: 'chat-model' });
  f.store.mutate({
    id: 'matrix-core',
    data: { integrated: true, modelProfile: { provider: 'lmstudio', model: 'list-model' } },
  });
  f.add();
  await f.matrix.tick();
  assert.equal(f.calls[0].inference.model, 'list-model');
  assert.equal(f.calls[0].inference.endpoint, 'http://localhost:5678');
  assert.equal(f.store.settings().model, 'chat-model');
  f.store.setSettings({ matrixPreload: false });
  f.add();
  await f.matrix.tick();
  assert.equal(f.calls[1].inference.model, 'list-model');
  assert.equal(f.calls[1].inference.provider, 'lmstudio');
  assert.equal(f.loads.length, 0);
});

test('loaded-only mode never prepares an unloaded model and reports the skipped execution', async (t) => {
  const f = fixture(t, { residentModel: async () => null });
  f.store.setSettings({ matrixPreload: false });
  f.store.mutate({ id: 'matrix-core', data: { integrated: true } });
  const task = f.add();
  await f.matrix.tick();
  assert.equal(f.calls.length, 0);
  assert.equal(f.loads.length, 0);
  assert.equal(f.store.get(task.id).data.status, 'needs_input');
  assert.match(f.store.get(task.id).data.result, /not loaded/);
});

test('preparation is serialized, foreground chat cancels it, and late completion cannot dispatch', async (t) => {
  let release, entered;
  const waiting = new Promise((r) => {
    release = r;
  });
  const ready = new Promise((r) => {
    entered = r;
  });
  const f = fixture(t, {
    residentModel: async () => null,
    prepareModel: async (_profile, signal) => {
      entered(signal);
      await waiting;
    },
  });
  f.store.mutate({ id: 'matrix-core', data: { integrated: true } });
  f.add();
  const run = f.matrix.tick();
  const signal = await ready;
  await f.matrix.tick();
  assert.ok(f.matrix.preparation);
  f.agent.active.set('foreground', true);
  f.matrix.refresh();
  assert.equal(signal.aborted, true);
  release();
  await run;
  assert.equal(f.calls.length, 0);
  assert.equal(f.matrix.prepared.size, 0);
  assert.equal(f.matrix.preparation, null);
});

test('nearest deadline prepares once; no model calls before the lead window or during foreground work', async (t) => {
  const f = fixture(t);
  f.store.mutate({ id: 'matrix-core', data: { integrated: true } });
  const task = f.add({
    schedule: { start: new Date(Date.now() + 8 * 60000).toISOString(), repeat: 'none' },
  });
  await f.matrix.tick();
  assert.equal(f.loads.length, 0);
  f.store.mutate({
    id: task.id,
    data: { schedule: { start: new Date(Date.now() + 4 * 60000).toISOString() } },
  });
  f.agent.active.set('foreground', true);
  await f.matrix.tick();
  assert.equal(f.loads.length, 0);
  f.agent.active.clear();
  await f.matrix.tick();
  await f.matrix.tick();
  assert.equal(f.loads.length, 1);
  assert.equal(f.calls.length, 0);
  f.matrix.start();
  await pause(100);
  assert.ok(f.matrix.timer);
  assert.equal(f.loads.length, 1);
});

test('unavailable server records feedback, never replays that occurrence, and retains future recurrence', async (t) => {
  const f = fixture(t, {
    residentModel: async () => {
      throw Error('Server unavailable');
    },
  });
  f.store.mutate({ id: 'matrix-core', data: { integrated: true } });
  const task = f.add({
    schedule: { start: new Date(Date.now() - 1000).toISOString(), repeat: 'daily' },
  });
  await f.matrix.tick();
  assert.equal(f.calls.length, 0);
  assert.match(f.store.get(task.id).data.result, /Server unavailable/);
  assert.ok(Date.parse(f.store.get(task.id).data.schedule.start) > Date.now());
  f.matrix.runtime.residentModel = async () => 'now-available';
  await f.matrix.tick();
  assert.equal(f.calls.length, 0);
});

test('verified completion triggers once, ignores unverified outcomes, and rejects dependency cycles', async (t) => {
  const f = fixture(t);
  f.store.mutate({ id: 'matrix-core', data: { integrated: true } });
  const source = f.add({ status: 'done' });
  const dependent = f.add({ trigger: { kind: 'completion', source: source.id } });
  await f.matrix.tick();
  assert.equal(f.calls.length, 0);
  f.store.mutate({
    id: source.id,
    data: { verification: 'Checked', completedAt: new Date().toISOString() },
  });
  await f.matrix.tick();
  await f.matrix.tick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].task, dependent.id);
  assert.throws(
    () =>
      f.store.mutate({
        id: source.id,
        data: { trigger: { kind: 'completion', source: dependent.id } },
      }),
    /cycle/,
  );
  assert.throws(
    () =>
      f.store.mutate({
        id: source.id,
        data: { trigger: { kind: 'completion', source: source.id } },
      }),
    /another task/,
  );
});

test('file watchers share handles, bound/debounce events, avoid self-trigger loops and clean up on revocation', async (t) => {
  let live = 0,
    callback;
  const f = fixture(t, {
    watch: (_directory, _options, cb) => {
      callback = cb;
      ++live;
      const handle = new EventEmitter();
      let closed = false;
      handle.close = () => {
        if (!closed) {
          --live;
          closed = true;
        }
      };
      return handle;
    },
  });
  const directory = path.join(f.root, 'project');
  fs.mkdirSync(directory);
  const project = f.store.mutate({
    kind: 'project',
    title: 'Watched',
    data: { directory, access: true, permission: 'edit' },
  });
  const first = f.add({ trigger: { kind: 'file', source: project.id, path: '.' } });
  f.add({ trigger: { kind: 'file', source: project.id, path: '.' } });
  f.store.mutate({ id: 'matrix-core', data: { integrated: true } });
  f.matrix.start();
  await until(() => live === 1);
  assert.equal(f.matrix.timer, null);
  for (let i = 0; i < 1000; i++) callback('change', 'input.md');
  assert.equal(f.matrix.triggers.pending.size, 2);
  clearTimeout(f.matrix.triggers.timer);
  f.matrix.triggers.flush();
  await until(() => f.calls.length === 2 && !f.matrix.running);
  assert.ok(f.store.get(first.id).data.lastTriggeredAt);
  callback('change', 'input.md');
  assert.equal(f.matrix.triggers.pending.size, 0);
  for (let i = 0; i < 15; i++) {
    f.store.mutate({ id: 'matrix-core', data: { integrated: false } });
    assert.equal(live, 0);
    f.store.mutate({ id: 'matrix-core', data: { integrated: true } });
    await until(() => live === 1);
  }
  f.store.mutate({ id: project.id, data: { access: false } });
  await until(() => live === 0);
  f.matrix.close();
  assert.equal(f.matrix.triggers.pending.size, 0);
  assert.equal(f.matrix.timer, null);
  assert.equal(f.store.listenerCount('changed'), 0);
});

test('calendar weekday recurrence preserves wall time across DST and normalizes its first run', (t) => {
  assert.equal(
    nextOccurrence(
      {
        start: '2026-10-23T06:00:00Z',
        repeat: 'daily',
        timezone: 'Europe/Bucharest',
        weekdays: [1],
      },
      new Date('2026-10-23T08:00:00Z'),
    ),
    '2026-10-26T07:00:00.000Z',
  );
  assert.throws(
    () => nextOccurrence({ start: '2026-10-23T06:00:00Z', repeat: 'weekly', weekdays: [1] }),
    /daily recurrence/,
  );
  const f = fixture(t);
  const task = f.add({
    schedule: {
      start: '2026-10-23T06:00:00Z',
      repeat: 'daily',
      timezone: 'Europe/Bucharest',
      weekdays: [1],
    },
  });
  assert.equal(task.data.schedule.start, '2026-10-26T07:00:00.000Z');
});

test('provider residency and preload use official routes and bounded TTL, without generating in Ollama', async () => {
  for (const provider of ['ollama', 'lmstudio']) {
    const requests = [];
    let loaded = false;
    const settings = { provider, endpoint: 'http://fixture', model: 'fixture-model' };
    const runtime = {
      fetch: async (url, options) => {
        requests.push({ url, body: options.body && JSON.parse(options.body) });
        if (options.method === 'POST') {
          loaded = true;
          return Response.json({});
        }
        return Response.json(
          provider === 'ollama'
            ? { models: loaded ? [{ name: 'fixture-model:latest' }] : [] }
            : {
                models: [
                  {
                    key: 'fixture-model',
                    loaded_instances: loaded ? [{ id: 'fixture-model' }] : [],
                  },
                ],
              },
        );
      },
    };
    assert.equal(await residentModel(settings, undefined, runtime), null);
    await prepareModel(settings, undefined, runtime);
    const post = requests.find((r) => r.body);
    if (provider === 'ollama') {
      assert.equal(post.body.keep_alive, '15m');
      assert.equal(post.body.prompt, undefined);
    } else {
      assert.equal(post.body.ttl, 900);
      assert.equal(post.body.max_tokens, 1);
    }
  }
});

test('loaded-only guard checks every completion and fails closed on absent or unsupported metadata', async () => {
  const requests = [];
  await assert.rejects(
    completion(
      {
        provider: 'lmstudio',
        endpoint: 'http://fixture',
        model: 'fixture',
        matrixLoadedOnly: true,
      },
      [],
      [],
      () => {},
      new AbortController().signal,
      {
        fetch: async (url) => {
          requests.push(url);
          return Response.json({ models: [{ key: 'fixture', loaded_instances: [] }] });
        },
      },
    ),
    /no longer loaded/,
  );
  assert.equal(requests.length, 1);
  assert.ok(requests.every((url) => !url.includes('completions')));
});

test('a blocked list has no retry timer and completed-source bursts respect cooldown', async (t) => {
  const f = fixture(t);
  f.store.mutate({
    id: 'matrix-core',
    data: { integrated: true, attention: { message: 'Review first' } },
  });
  f.add();
  f.matrix.start();
  await pause(100);
  assert.equal(f.matrix.timer, null);
  assert.equal(f.calls.length, 0);
  f.store.mutate({ id: 'matrix-core', data: { integrated: false, attention: null } });
  f.store.mutate({ id: 'matrix-secondary', data: { integrated: true } });
  const source = f.add(
    { status: 'done', verification: 'Checked', completedAt: '2026-10-01T00:00:00Z' },
    'matrix-secondary',
  );
  const dependent = f.add(
    { trigger: { kind: 'completion', source: source.id, cooldownSeconds: 60 } },
    'matrix-secondary',
  );
  await until(() => f.calls.length === 1 && !f.matrix.running);
  f.store.mutate({ id: source.id, data: { completedAt: '2026-10-02T00:00:00Z' } });
  await pause(100);
  assert.equal(f.calls.length, 1);
  assert.ok(f.matrix.timer);
  f.store.mutate({
    id: dependent.id,
    data: { lastTriggeredAt: new Date(Date.now() - 61000).toISOString() },
  });
  await until(() => f.calls.length === 2);
});

test('quit cancels an in-flight preparation and prevents late state installation or execution', async (t) => {
  let release, entered;
  const wait = new Promise((r) => {
    release = r;
  });
  const ready = new Promise((r) => {
    entered = r;
  });
  const f = fixture(t, {
    residentModel: async () => null,
    prepareModel: async (_settings, signal) => {
      entered(signal);
      await wait;
    },
  });
  f.store.mutate({ id: 'matrix-core', data: { integrated: true } });
  f.add();
  const run = f.matrix.tick(),
    signal = await ready;
  f.matrix.close();
  assert.equal(signal.aborted, true);
  release();
  await run;
  assert.equal(f.calls.length, 0);
  assert.equal(f.matrix.prepared.size, 0);
  assert.equal(f.matrix.preparation, null);
  assert.equal(f.store.listenerCount('changed'), 0);
});

test('Matrix context and manual compaction select the list model and retain loaded-only policy when off', (t) => {
  const f = fixture(t);
  const task = f.add();
  f.store.mutate({
    id: 'matrix-core',
    data: { modelProfile: { provider: 'lmstudio', model: 'list-specific' } },
  });
  const conversation = f.store.mutate({
    kind: 'conversation',
    title: 'Task chat',
    data: { matrixTask: task.id },
  });
  const context = new ContextManager(f.store);
  assert.equal(context.settingsFor(conversation.id).model, 'list-specific');
  assert.equal(context.settingsFor(conversation.id).provider, 'lmstudio');
  f.store.setSettings({ matrixPreload: false });
  assert.equal(context.settingsFor(conversation.id).model, 'chat-model');
  assert.equal(context.settingsFor(conversation.id).matrixLoadedOnly, true);
  assert.equal(f.store.settings().model, 'chat-model');
});
