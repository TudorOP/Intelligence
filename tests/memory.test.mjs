import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../electron/store.mjs';
import { Memory } from '../electron/memory.mjs';
import { Agent } from '../electron/agent.mjs';

function fixture(t) {
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-auto-memory-')));
  t.after(() => store.close());
  const note = store.all().find((e) => e.kind === 'note' && store.access(e.id));
  store.mutate({
    id: note.id,
    title: 'Fixture memory',
    data: { content: 'A useful fixture fact' },
  });
  return { store, note };
}
const embedder = async () => ({ data: new Float32Array([1, 0, 0]) });

test('memory-page search filters before ranking limits while general recall still includes notes', async (t) => {
  const { store, note } = fixture(t);
  store.setSettings({ semanticSearch: false });
  const saved = store.mutate({
    kind: 'memory',
    title: 'Fixture fact',
    data: { content: 'Fixture memory' },
  });
  for (let i = 0; i < 35; i++)
    store.mutate({
      kind: 'note',
      parent: note.parent,
      title: 'Fixture memory ' + i,
      data: { content: 'Fixture memory', access: true },
    });
  const memory = new Memory(store, () => {});
  assert.deepEqual(
    (await memory.search('fixture', { kind: 'memory' })).map((m) => m.id),
    [saved.id],
  );
  assert.ok((await memory.search('fixture')).some((m) => m.kind === 'note'));
  store.mutate({ id: saved.id, data: { access: false } });
  assert.deepEqual(await memory.search('fixture', { kind: 'memory' }), []);
});

test('remember saves and recalls without granting itself access; live source and memory revocations remain enforced', async (t) => {
  const { store, note } = fixture(t);
  const agent = new Agent(
    store,
    { search: async (query) => store.search(query) },
    { tools: () => [] },
    () => {},
  );
  const ctx = {
    project: null,
    readOnlyMachineSession: false,
    signal: new AbortController().signal,
  };
  const saved = await agent.execute(
    'remember',
    { content: 'Prefer Romanian examples.', sources: [note.id] },
    ctx,
  );
  assert.equal(saved.data.access, undefined);
  assert.equal(saved.data.origin, 'agent');
  assert.equal(store.access(saved.id), true);
  assert.ok(
    (await agent.execute('recall_memory', { query: 'Romanian' }, ctx)).some(
      (m) => m.id === saved.id,
    ),
  );
  assert.throws(
    () => store.mutate({ id: saved.id, data: { access: true } }, { agent: true }),
    /Only the user/,
  );
  store.mutate({ id: note.id, data: { access: false } });
  assert.equal(store.access(saved.id), false);
  await assert.rejects(
    () => agent.execute('remember', { content: 'Private source', sources: [note.id] }, ctx),
    /accessible/,
  );
  store.setSettings({ memoryAccess: false });
  await assert.rejects(
    () => agent.execute('remember', { content: 'Not allowed' }, ctx),
    /disabled/,
  );
});

test('memory inspection exposes bounded recorded evidence and current access without rewriting saved content', (t) => {
  const { store, note } = fixture(t);
  const c = store.mutate({ kind: 'conversation', title: 'My preferences' });
  const message = store.message(c.id, 'user', 'I use CachyOS. '.repeat(100));
  const memory = store.mutate({
    kind: 'memory',
    title: 'Linux preferences',
    data: {
      content: 'I use CachyOS.',
      sources: [c.id, note.id],
      conversation: c.id,
      messageIds: [message.id],
    },
  });
  const info = store.inspectMemory(memory.id);
  assert.equal(info.available, true);
  assert.equal(info.messageCount, 1);
  assert.equal(info.messages[0].content.length, 800);
  assert.equal(info.messages[0].truncated, true);
  assert.equal(info.sources[0].title, c.title);
  store.mutate({ id: c.id, data: { memoryExcluded: true } });
  assert.equal(store.inspectMemory(memory.id).available, false);
  assert.equal(store.get(memory.id).data.content, memory.data.content);
  store.mutate({ id: memory.id, data: { status: 'needs_review' } });
  assert.match(store.inspectMemory(memory.id).reason, /conflicting/);
  assert.throws(() => store.inspectMemory(note.id), /no longer exists/);
});

test('first searches provision one CPU pipeline in the user-data cache without blocking keyword results', async (t) => {
  const { store, note } = fixture(t);
  let calls = 0,
    options,
    release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const events = [];
  const memory = new Memory(store, (e) => events.push(e), {
    createPipeline: async (input) => {
      calls++;
      options = input;
      await gate;
      return embedder;
    },
  });
  assert.equal(calls, 0);
  const results = await Promise.all([memory.search('fixture'), memory.search('fixture')]);
  assert.ok(results.every((hits) => hits.some((e) => e.id === note.id)));
  assert.equal(calls, 1);
  assert.equal(options.cacheDir, path.join(store.directory, 'models'));
  assert.ok(events.some((e) => e.status.includes('downloads automatically')));
  release();
  await memory.loading;
  assert.equal(store.settings().embeddingEnabled, true);
  assert.equal(memory.status, 'Semantic + keyword search ready');
  const semantic = await memory.search('unrelated wording');
  assert.ok(semantic.some((e) => e.id === note.id));
  await memory.enable();
  assert.equal(calls, 1);
  store.mutate({ id: note.id, data: { access: false } });
  assert.ok(!(await memory.search('fixture')).some((e) => e.id === note.id));
});

test('offline provisioning preserves keyword recall and throttles automatic retries', async (t) => {
  const { store, note } = fixture(t);
  let calls = 0;
  const memory = new Memory(store, () => {}, {
    createPipeline: async () => {
      calls++;
      throw new Error('Offline fixture');
    },
  });
  assert.ok((await memory.search('fixture')).some((e) => e.id === note.id));
  await memory.loading?.catch(() => {});
  assert.ok(memory.status.includes('Keyword search ready'));
  await memory.search('fixture');
  assert.equal(calls, 1);
  memory.retryAt = 0;
  await memory.search('fixture');
  await memory.loading?.catch(() => {});
  assert.equal(calls, 2);
});

test('disabled semantic search and empty queries never provision a model', async (t) => {
  const { store } = fixture(t);
  let calls = 0;
  const memory = new Memory(store, () => {}, {
    createPipeline: async () => {
      calls++;
      return embedder;
    },
  });
  await memory.search('   ');
  store.setSettings({ semanticSearch: false });
  await memory.search('fixture');
  assert.equal(calls, 0);
  store.setSettings({ semanticSearch: true });
  await memory.search('fixture');
  await memory.loading;
  assert.equal(calls, 1);
});
