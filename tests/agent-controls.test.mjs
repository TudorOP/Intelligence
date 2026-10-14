import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../electron/store.mjs';
import { Agent } from '../electron/agent.mjs';
import { Workspace } from '../electron/workspace.mjs';
import { profileSettings, ensureProfiles } from '../electron/profiles.mjs';
import { InferenceCredentials, disconnectProvider } from '../electron/inference-providers.mjs';
import { completion } from '../electron/provider.mjs';
import { modelHistory } from '../electron/chat-history.mjs';
import { matrixInference } from '../electron/matrix-config.mjs';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-controls-'));
  const store = new Store(directory);
  t.after(() => {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  store.setSettings({
    provider: 'lmstudio',
    model: 'fixture',
    autoCompact: false,
    autoConsolidation: false,
  });
  ensureProfiles(store);
  const chat = store.mutate({ kind: 'conversation', title: 'Controls' });
  const agent = new Agent(
    store,
    { search: async () => [], index: async () => {} },
    { tools: () => [] },
    () => {},
  );
  return { store, agent, chat };
}
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const answer = (delta) =>
  new Response('data: ' + JSON.stringify({ choices: [{ delta }] }) + '\n\ndata: [DONE]\n');
const calls = () => ({
  tool_calls: [0, 1].map((index) => ({
    index,
    id: 'call_' + index,
    function: { name: 'workspace_overview', arguments: '{}' },
  })),
});

test('task snapshots use inherited native access, child exceptions, read-only and global revocation', (t) => {
  const { store } = fixture(t);
  const board = store.all().find((e) => e.kind === 'board');
  const list = store.children(board.id)[0];
  const card = store.mutate({
    kind: 'card',
    parent: list.id,
    title: 'Manual notes',
    data: { content: 'Știință', assigned: true },
  });
  const view = () => store.snapshot().entities.find((e) => e.id === card.id);
  assert.equal(view().agentAccess, true);
  assert.equal(view().agentAssigned, true);
  store.mutate({ id: board.id, data: { access: false } });
  assert.equal(view().agentAccess, false);
  store.mutate({ id: card.id, data: { access: true, permission: 'read' } });
  assert.equal(view().agentAccess, true);
  assert.equal(view().agentEditable, false);
  assert.equal(view().agentAssigned, false);
  store.setSettings({ kanbanAccess: false });
  assert.equal(view().agentAccess, false);
  assert.equal(store.get(card.id).data.content, 'Știință');
});

test('multiple providers route conversation choices independently and disconnect removes every scoped key without fallback', async (t) => {
  const { store, chat } = fixture(t);
  store.setSettings({ provider: 'openrouter', model: 'frontier' });
  store.setSettings({ provider: 'llamacpp', model: 'same-id' });
  store.setSettings({ provider: 'lmstudio', model: 'same-id' });
  const workspace = new Workspace(store);
  await workspace.action({
    action: 'conversation-model',
    id: chat.id,
    provider: 'openrouter',
    model: 'frontier',
  });
  assert.equal(profileSettings(store, store.get(chat.id)).endpoint, 'https://openrouter.ai/api/v1');
  assert.equal(store.settings().provider, 'lmstudio');
  store.setSettings({ endpoint: 'http://127.0.0.1:1239/v1' });
  assert.equal(
    matrixInference(profileSettings(store, store.get(chat.id)), {
      provider: 'lmstudio',
      model: 'same-id',
    }).endpoint,
    'http://127.0.0.1:1239/v1',
  );
  const secure = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s),
    decryptString: (b) => b.toString(),
  };
  const credentials = new InferenceCredentials(store, secure, 'win32');
  const api = profileSettings(store, store.get(chat.id));
  credentials.save(api, 'fixture-secret');
  credentials.save({ ...api, endpoint: 'https://other.example/v1' }, 'other-secret');
  disconnectProvider(store, credentials, 'openrouter');
  assert.equal(credentials.get(api), '');
  assert.equal(credentials.get({ ...api, endpoint: 'https://other.example/v1' }), '');
  assert.equal(store.settings().model, 'same-id');
  assert.ok(store.settings().connectedProviders.includes('llamacpp'));
  let sent = false;
  await assert.rejects(
    completion(profileSettings(store, store.get(chat.id)), [], [], () => {}, null, {
      fetch: async () => {
        sent = true;
      },
    }),
    /disconnected/,
  );
  assert.equal(sent, false);
  await assert.rejects(
    workspace.action({ action: 'active-model', provider: 'openrouter', model: 'frontier' }),
    /disconnected/,
  );
  store.setSettings({ provider: 'openrouter' });
  assert.ok(store.settings().connectedProviders.includes('openrouter'));
  assert.equal(store.settings().model, '');
  const branch = workspace.branch({
    id: chat.id,
    message: store.message(chat.id, 'assistant', 'Completed').id,
  });
  assert.equal(profileSettings(store, branch).provider, 'openrouter');
});

test('user steering during streaming cancels unstarted tool calls and preserves complete tool transport history', async (t) => {
  const { store, agent, chat } = fixture(t);
  const started = deferred(),
    release = deferred();
  let requests = 0,
    executed = 0,
    wire;
  agent.execute = async () => {
    executed++;
    return { success: true };
  };
  agent.providerRuntime = () => ({
    fetch: async (_url, options) => {
      requests++;
      if (requests === 1) {
        started.resolve();
        await release.promise;
        return answer(calls());
      }
      wire = JSON.parse(options.body).messages;
      return answer({ content: 'Following the correction.' });
    },
  });
  const run = agent.chat({ conversation: chat.id, text: 'Original task', context: [] });
  await started.promise;
  agent.steer(chat.id, 'Use the Romanian document instead.');
  release.resolve();
  await run;
  assert.equal(executed, 0);
  assert.equal(requests, 2);
  const results = wire.filter((m) => m.role === 'tool');
  assert.equal(results.length, 2);
  assert.ok(results.every((m) => JSON.parse(m.content).cancelled));
  assert.equal(wire.at(-1).content, 'Use the Romanian document instead.');
  const replay = modelHistory(store, chat.id, 0);
  assert.equal(replay.filter((m) => m.tool_calls).length, 1);
  assert.equal(replay.filter((m) => m.role === 'tool').length, 2);
  assert.deepEqual(store.get(chat.id).data.pendingSteering, []);
  assert.throws(() => agent.steer(chat.id, 'Too late'), /not running/);
});

test('steering waits for an executing tool, cancels the rest of its batch, and preserves ordered corrections', async (t) => {
  const { store, agent, chat } = fixture(t);
  const started = deferred(),
    release = deferred();
  let executed = 0,
    requests = 0,
    wire;
  agent.execute = async () => {
    executed++;
    started.resolve();
    await release.promise;
    return { completed: true };
  };
  agent.providerRuntime = () => ({
    fetch: async (_url, options) => {
      if (++requests === 1) return answer(calls());
      wire = JSON.parse(options.body).messages;
      return answer({ content: 'Corrected result.' });
    },
  });
  const run = agent.chat({ conversation: chat.id, text: 'Work', context: [] });
  await started.promise;
  agent.steer(chat.id, 'Keep the first result.');
  agent.steer(chat.id, 'Then inspect permissions.');
  release.resolve();
  await run;
  assert.equal(executed, 1);
  assert.deepEqual(
    wire.slice(-2).map((m) => m.content),
    ['Keep the first result.', 'Then inspect permissions.'],
  );
  assert.deepEqual(JSON.parse(wire.find((m) => m.role === 'tool').content), { completed: true });
});

test('tool-step setting bounds actual requests, persists, and cannot alter Matrix or report budgets', async (t) => {
  const { store, agent, chat } = fixture(t);
  for (const value of [0, 257, 1.5, NaN])
    assert.throws(() => store.setSettings({ toolStepLimit: value }), /Tool-step limit/);
  store.setSettings({ toolStepLimit: 2 });
  assert.equal(store.settings().toolStepLimit, 2);
  assert.equal(store.settings().matrixMaxSteps, 48);
  let requests = 0;
  agent.execute = async () => ({ success: true });
  agent.providerRuntime = () => ({
    fetch: async () => {
      requests++;
      return answer(calls());
    },
  });
  await agent.chat({ conversation: chat.id, text: 'Long task', context: [] });
  assert.equal(requests, 2);
  assert.match(store.messages(chat.id).at(-1).content, /tool-step limit/);
  const reopened = new Store(store.directory);
  assert.equal(reopened.settings().toolStepLimit, 2);
  reopened.close();
  const report = store.mutate({
    kind: 'conversation',
    title: 'Report budget',
    data: { reportReadOnly: true, reportMaxSteps: 3 },
  });
  requests = 0;
  await agent.chat({ conversation: report.id, text: 'Prepare report', context: [] });
  assert.equal(requests, 3);
});

test('steering declines pending host approvals and resumes with the correction without executing the old action', async (t) => {
  const { store, agent, chat } = fixture(t);
  const waiting = deferred();
  let executed = 0,
    requests = 0;
  agent.emit = (event) => {
    if (event.type === 'approval') waiting.resolve();
  };
  agent.execute = async (_name, _args, ctx) => {
    const allowed = await agent.approval(
      chat.id,
      'Old planned action',
      'Review this action',
      ctx.signal,
    );
    if (allowed) executed++;
    return { allowed };
  };
  agent.providerRuntime = () => ({
    fetch: async () =>
      ++requests === 1 ? answer(calls()) : answer({ content: 'Used the correction.' }),
  });
  const run = agent.chat({ conversation: chat.id, text: 'Plan an action', context: [] });
  await waiting.promise;
  assert.equal(agent.approvals.size, 1);
  agent.steer(chat.id, 'Do not perform that action.');
  await run;
  assert.equal(agent.approvals.size, 0);
  assert.equal(executed, 0);
  assert.equal(requests, 2);
  assert.equal(store.messages(chat.id).at(-1).content, 'Used the correction.');
});

test('stopping a streamed response preserves an accepted correction for the next response', async (t) => {
  const { store, agent, chat } = fixture(t);
  const waiting = deferred();
  agent.providerRuntime = () => ({
    fetch: async (_url, options) => {
      waiting.resolve();
      return new Promise((_resolve, reject) =>
        options.signal.addEventListener('abort', () => reject(Error('Aborted')), { once: true }),
      );
    },
  });
  const run = agent.chat({ conversation: chat.id, text: 'Original request', context: [] });
  await waiting.promise;
  agent.steer(chat.id, 'Preserve this correction.');
  agent.stop(chat.id);
  await assert.rejects(run, /Aborted/);
  const correction = store.messages(chat.id).find((m) => m.content === 'Preserve this correction.');
  assert.equal(correction.data.applied, false);
  assert.deepEqual(store.get(chat.id).data.pendingSteering, []);
  let wire;
  agent.providerRuntime = () => ({
    fetch: async (_url, options) => {
      wire = JSON.parse(options.body).messages;
      return answer({ content: 'Continued.' });
    },
  });
  await agent.chat({ conversation: chat.id, text: 'Continue', context: [] });
  assert.ok(wire.some((m) => m.role === 'user' && m.content === 'Preserve this correction.'));
});
