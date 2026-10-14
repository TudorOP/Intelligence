import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../electron/store.mjs';
import { Memory } from '../electron/memory.mjs';
import { Connections } from '../electron/connections.mjs';
import { completion } from '../electron/provider.mjs';
import { Agent } from '../electron/agent.mjs';
const gate = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
function fixture(t) {
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-life-')));
  t.after(() => store.close());
  return store;
}
test('disabling a pending embedding load disposes the late pipeline without reinstalling it', async (t) => {
  const store = fixture(t),
    wait = gate();
  let disposed = 0;
  const pipeline = async () => ({ data: [1, 0] });
  pipeline.dispose = async () => disposed++;
  const memory = new Memory(store, () => {}, {
    createPipeline: async () => {
      await wait.promise;
      return pipeline;
    },
  });
  const loading = memory.enable();
  await memory.release();
  store.setSettings({ semanticSearch: false });
  wait.resolve();
  await loading;
  assert.equal(memory.pipeline, null);
  assert.equal(disposed, 1);
  assert.equal(memory.embeddings.size, 0);
  await memory.close();
});
test('embedding cleanup drains active native work and coalesces concurrent indexing', async (t) => {
  const store = fixture(t),
    wait = gate();
  let calls = 0,
    disposed = 0,
    blocking = false;
  const pipeline = async () => {
    calls++;
    if (blocking) await wait.promise;
    return { data: [1, 0] };
  };
  pipeline.dispose = async () => disposed++;
  const memory = new Memory(store, () => {}, { createPipeline: async () => pipeline });
  await memory.enable();
  const note = store.all().find((e) => e.kind === 'note' && store.access(e.id));
  store.mutate({ id: note.id, data: { content: 'Changed fixture' } });
  calls = 0;
  blocking = true;
  const jobs = Array.from({ length: 20 }, () => memory.index());
  await Promise.resolve();
  assert.equal(calls, 1);
  const release = memory.release();
  assert.equal(disposed, 0);
  wait.resolve();
  await Promise.all(jobs);
  await release;
  assert.equal(disposed, 1);
  assert.equal(memory.pipeline, null);
  assert.equal(memory.embeddings.size, 0);
  assert.equal(memory.indexing, null);
});
test('MCP discovery failures close clients, concurrent connect coalesces, and disconnect clears failed close registries', async (t) => {
  const store = fixture(t);
  const entity = store.mutate({
    kind: 'connection',
    title: 'Fixture',
    data: { transport: 'http', url: 'http://localhost', enabled: true },
  });
  let created = 0,
    closed = 0,
    fail = true,
    closeFails = false;
  const connections = new Connections(store, {
    createTransport: () => ({}),
    createClient: () => {
      created++;
      return {
        connect: async () => {},
        listTools: async () => {
          if (fail) throw new Error('Discovery failed');
          return { tools: [{ name: 'example', inputSchema: { type: 'object' } }] };
        },
        close: async () => {
          closed++;
          if (closeFails) throw new Error('Close failed');
        },
      };
    },
  });
  await assert.rejects(connections.connect(entity.id), /Discovery failed/);
  assert.equal(closed, 1);
  assert.equal(connections.pending.size, 0);
  fail = false;
  await Promise.all(Array.from({ length: 20 }, () => connections.connect(entity.id)));
  assert.equal(created, 2);
  assert.equal(connections.clients.size, 1);
  closeFails = true;
  await assert.rejects(connections.disconnect(entity.id), /Close failed/);
  assert.equal(connections.registry.size, 0);
  assert.equal(connections.clients.size, 0);
  await connections.close();
});
test('MCP disconnect during discovery prevents a late client becoming live', async (t) => {
  const store = fixture(t),
    wait = gate();
  const entity = store.mutate({
    kind: 'connection',
    title: 'Fixture',
    data: { transport: 'http', url: 'http://localhost', enabled: true },
  });
  let closed = 0;
  const connections = new Connections(store, {
    createTransport: () => ({}),
    createClient: () => ({
      connect: async () => {},
      listTools: async () => {
        await wait.promise;
        return { tools: [] };
      },
      close: async () => {
        closed++;
        wait.resolve();
      },
    }),
  });
  const pending = connections.connect(entity.id);
  await new Promise((r) => setImmediate(r));
  await connections.disconnect(entity.id);
  await assert.rejects(pending, /cancelled/);
  assert.equal(connections.clients.size, 0);
  assert.equal(connections.pending.size, 0);
  assert.ok(closed >= 1);
  await connections.close();
});
test('malformed model streams cancel and release the reader instead of retaining the connection', async (t) => {
  const original = globalThis.fetch;
  let cancelled = 0;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('invalid json\n'));
    },
    cancel() {
      cancelled++;
    },
  });
  globalThis.fetch = async () => new Response(body);
  t.after(() => (globalThis.fetch = original));
  await assert.rejects(
    completion(
      { provider: 'ollama', endpoint: 'http://localhost', model: 'fixture' },
      [],
      [],
      () => {},
      new AbortController().signal,
    ),
    SyntaxError,
  );
  assert.equal(cancelled, 1);
  assert.equal(body.locked, false);
});
test('cancelled approvals remove listeners, timers and pending entries exactly once', async (t) => {
  const store = fixture(t),
    events = [];
  const agent = new Agent(store, {}, { tools: () => [] }, (e) => events.push(e));
  for (let i = 0; i < 30; i++) {
    const controller = new AbortController();
    const pending = agent.approval('fixture', 'Read file', 'fixture', controller.signal);
    controller.abort();
    assert.equal(await pending, false);
  }
  assert.equal(agent.approvals.size, 0);
  assert.equal(events.filter((e) => e.type === 'approval-resolved').length, 30);
});
