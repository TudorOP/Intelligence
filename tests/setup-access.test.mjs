import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../electron/store.mjs';
import { Agent } from '../electron/agent.mjs';
import { ensureProfiles, profileSettings, profileAction } from '../electron/profiles.mjs';
import { initialSetup, validateSetup } from '../electron/onboarding.mjs';
import { normalizeResourceGrants } from '../electron/agent-access.mjs';
import { InferenceCredentials } from '../electron/inference-providers.mjs';
import { exportBackup, restoreBackup } from '../electron/backup.mjs';
import { Workspace } from '../electron/workspace.mjs';
import { modelHistory, resultSources } from '../electron/chat-history.mjs';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-setup-'));
  const store = new Store(root);
  ensureProfiles(store);
  const workspace = new Workspace(store, null);
  t.after(() => {
    workspace.close();
    store.close();
    assert(root.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const profile = store.get(store.settings().activeAgent);
  store.mutate({ id: profile.id, data: { resourcePolicy: 'ask', resourceGrants: [] } });
  const conversation = store.mutate({
    kind: 'conversation',
    title: 'Setup fixture',
    data: { agentProfile: profile.id },
  });
  const events = [];
  const agent = new Agent(store, {}, { tools: () => [], registry: new Map() }, (e) =>
    events.push(e),
  );
  const controller = new AbortController(),
    settings = profileSettings(store, conversation);
  agent.active.set(conversation.id, controller);
  agent.runProfiles.set(conversation.id, settings);
  agent.requestContexts.set(conversation.id, []);
  const ctx = {
    conversation: conversation.id,
    project: null,
    signal: controller.signal,
    profileSettings: settings,
    readOnlyMachineSession: false,
  };
  t.after(() => {
    controller.abort();
    agent.accessRequests.end(conversation.id);
  });
  return { root, store, profile, conversation, agent, ctx, controller, events };
}
function selected(f, item) {
  f.agent.requestContexts.set(f.conversation.id, [item.id]);
}
test('scoped material cannot escape through saved memory or conversation recall, and newly created entries can request reviewed access', async (t) => {
  const f = fixture(t),
    book = f.store.mutate({ kind: 'notebook', title: 'Private source', data: { access: false } });
  const note = f.store.mutate({
    kind: 'note',
    parent: book.id,
    title: 'Private fact',
    data: { content: 'Scoped sentence' },
  });
  f.store.setSettings({ memoryAccess: true });
  selected(f, book);
  await approve(
    f,
    f.agent.execute(
      'request_access',
      { id: book.id, permission: 'read', reason: 'Read selected source' },
      f.ctx,
    ),
  );
  const read = await f.agent.execute('read_item', { id: note.id }, f.ctx);
  f.controller.readSources = new Set(resultSources(f.store, read));
  const memory = await f.agent.execute(
    'remember',
    { content: 'Scoped derived fact', sources: [] },
    f.ctx,
  );
  assert(
    memory.data.sources.includes(note.id),
    'Native memory preserves actual private sources even if the model omits them',
  );
  assert(!f.store.access(memory.id), 'Another shared agent cannot see the derived memory');
  const granted = await approve(
    f,
    f.agent.execute(
      'request_access',
      { id: memory.id, permission: 'read', reason: 'Verify the newly saved entry' },
      f.ctx,
    ),
    'permanent',
  );
  assert(granted.approved, 'Creation provenance permits asking, not automatic access');
  const transcript = f.store.mutate({
    kind: 'conversation',
    title: 'Derived transcript',
    data: { agentProfile: f.profile.id },
  });
  f.store.message(transcript.id, 'assistant', 'Scoped derived sentence', {
    scopedSources: [note.id],
  });
  assert(!f.store.access(transcript.id), 'Raw conversation recall retains source restrictions');
  f.agent.accessRequests.end(f.conversation.id);
  const fresh = profileSettings(f.store, f.store.get(f.conversation.id));
  await f.store.withAgentScope(f.agent.accessRequests.scope(fresh, f.conversation.id), () =>
    assert(
      !f.store.access(memory.id),
      'A permanent entry grant does not silently persist its temporary source grant',
    ),
  );
  assert.equal(f.store.get(note.id).data.content, 'Scoped sentence');
});
test('temporary-source assistant text and tool arguments are not replayed after access expires', async (t) => {
  const f = fixture(t),
    book = f.store.mutate({ kind: 'notebook', title: 'Private source', data: { access: false } });
  selected(f, book);
  await approve(
    f,
    f.agent.execute(
      'request_access',
      { id: book.id, permission: 'read', reason: 'Read selected book' },
      f.ctx,
    ),
  );
  f.store.message(f.conversation.id, 'user', 'Read my selected source');
  f.store.message(f.conversation.id, 'assistant', 'Private profile summary', {
    profileDataRead: true,
  });
  f.store.message(f.conversation.id, 'assistant', 'Previously shared name', {
    sharedNameContext: true,
  });
  f.store.message(f.conversation.id, 'assistant', 'Derived private sentence', {
    scopedSources: [book.id],
  });
  f.store.message(f.conversation.id, 'assistant', '', {
    scopedSources: [book.id],
    modelMessage: {
      role: 'assistant',
      content: 'Private commentary',
      tool_calls: [
        {
          id: 'sensitive-call',
          type: 'function',
          function: {
            name: 'edit_item',
            arguments: JSON.stringify({ content: 'Derived private argument' }),
          },
        },
      ],
    },
  });
  f.store.message(f.conversation.id, 'assistant', 'tool result', {
    modelSources: [book.id],
    modelMessage: {
      role: 'tool',
      tool_call_id: 'sensitive-call',
      content: 'Private tool sentence',
    },
  });
  await f.store.withAgentScope(
    f.agent.accessRequests.scope(f.ctx.profileSettings, f.conversation.id),
    () => {
      assert(
        JSON.stringify(modelHistory(f.store, f.conversation.id)).includes(
          'Derived private sentence',
        ),
      );
      f.agent.accessRequests.end(f.conversation.id);
      const history = JSON.stringify(modelHistory(f.store, f.conversation.id));
      for (const text of [
        'Derived private sentence',
        'Derived private argument',
        'Private commentary',
        'Private tool sentence',
      ])
        assert(!history.includes(text));
      assert(history.includes('sensitive-call'), 'Provider tool-call/result pairing is preserved');
    },
  );
  assert(
    f.store.messages(f.conversation.id).some((m) => m.content === 'Derived private sentence'),
    'Owner transcript is preserved',
  );
  f.store.setSettings({ shareProfile: false, shareName: false });
  const profileHistory = JSON.stringify(modelHistory(f.store, f.conversation.id));
  assert(!profileHistory.includes('Private profile summary'));
  assert(!profileHistory.includes('Previously shared name'));
});
test('grants survive content edits but authorization changes cannot resurrect an old grant', async (t) => {
  const f = fixture(t),
    book = f.store.mutate({ kind: 'notebook', title: 'Exact scope', data: { access: false } });
  selected(f, book);
  await approve(
    f,
    f.agent.execute(
      'request_access',
      { id: book.id, permission: 'edit', reason: 'Edit selected book' },
      f.ctx,
    ),
    'permanent',
  );
  f.store.mutate({ id: book.id, title: 'Renamed', data: { description: 'Updated' } });
  assert.equal(f.store.get(f.profile.id).data.resourceGrants.length, 1);
  const repeated = await f.agent.execute(
    'request_access',
    { id: book.id, permission: 'edit', reason: 'Continue editing' },
    f.ctx,
  );
  assert.equal(repeated.duration, 'existing');
  assert.equal(f.agent.approvals.size, 0);
  f.store.mutate({ id: book.id, data: { access: true } });
  assert.equal(f.store.get(f.profile.id).data.resourceGrants.length, 0);
  f.store.mutate({ id: book.id, data: { access: false } });
  await assert.rejects(f.agent.execute('read_item', { id: book.id }, f.ctx));
});
test('new selected-only collections require native duration review and retain content after temporary access ends', async (t) => {
  const f = fixture(t);
  f.store.setSettings({ approvalMode: 'full' });
  const book = await approve(
    f,
    f.agent.execute('create_item', { kind: 'notebook', title: 'New private book' }, f.ctx),
  );
  assert.equal(book.data.access, false);
  assert.equal(book.accessDuration, 'temporary');
  const note = await f.agent.execute(
    'create_item',
    { kind: 'note', parent: book.id, title: 'New note', content: 'Keep this text' },
    f.ctx,
  );
  assert.equal(note.data.content, 'Keep this text');
  f.agent.accessRequests.end(f.conversation.id);
  await assert.rejects(f.agent.execute('read_item', { id: note.id }, f.ctx));
  assert.equal(f.store.get(note.id).data.content, 'Keep this text');
  const declined = await approve(
    f,
    f.agent.execute('create_item', { kind: 'board', title: 'Declined board' }, f.ctx),
    'decline',
  );
  assert(declined.error);
  assert(!f.store.all().some((e) => e.title === 'Declined board'));
  const board = await approve(
    f,
    f.agent.execute('create_item', { kind: 'board', title: 'Permanent board' }, f.ctx),
    'permanent',
  );
  assert.equal(f.store.get(f.profile.id).data.resourceGrants[0].id, board.id);
});
test('switching the conversation agent blocks tools from an earlier profile snapshot', async (t) => {
  const f = fixture(t);
  f.ctx.profileSettings.conversationId = f.conversation.id;
  const other = profileAction(f.store, { action: 'save', title: 'Replacement' });
  f.store.mutate({ id: f.conversation.id, data: { agentProfile: other.id } });
  await assert.rejects(f.agent.execute('inspect_configuration', {}, f.ctx), /profile/);
});
test('exact grants cannot bypass native read-only modes or private conversation source restrictions', async (t) => {
  const f = fixture(t),
    book = f.store.mutate({
      kind: 'notebook',
      title: 'Read-only',
      data: { access: false, permission: 'read' },
    });
  selected(f, book);
  await assert.rejects(
    f.agent.execute(
      'request_access',
      { id: book.id, permission: 'edit', reason: 'Try editing' },
      f.ctx,
    ),
    /read-only/,
  );
  await assert.rejects(f.agent.execute('edit_item', { id: book.id, title: 'Changed' }, f.ctx));
  f.store.setSettings({ memoryAccess: true });
  const conversation = f.store.mutate({
    kind: 'conversation',
    title: 'Private transcript',
    data: { agentProfile: f.profile.id, context: [book.id] },
  });
  f.agent.accessRequests.end(f.conversation.id);
  selected(f, conversation);
  await approve(
    f,
    f.agent.execute(
      'request_access',
      { id: conversation.id, permission: 'read', reason: 'Read selected transcript' },
      f.ctx,
    ),
  );
  await f.store.withAgentScope(
    f.agent.accessRequests.scope(f.ctx.profileSettings, f.conversation.id),
    () => assert(!f.store.access(conversation.id)),
  );
});
async function approve(f, promise, choice = 'temporary', before = () => {}) {
  await new Promise((r) => setImmediate(r));
  const pending = [...f.agent.approvals.values()][0];
  assert(pending, 'Native review must be pending');
  assert(pending.action.requiresReview);
  before(pending);
  f.agent.approve(pending.id, choice);
  return promise;
}
test('setup progress persists stable stages, rejects secrets and does not reset existing preferences', (t) => {
  const f = fixture(t);
  const before = f.store.settings();
  const existing = f.store.get(f.profile.id);
  profileAction(f.store, {
    action: 'save',
    id: existing.id,
    revision: existing.revision,
    data: { allowConfigurationRequests: true },
  });
  assert.equal(
    f.store.get(existing.id).title,
    existing.title,
    'Partial scope saves preserve the agent name',
  );
  const progress = {
    ...initialSetup,
    stage: 'model',
    status: 'deferred',
    outcomes: { profile: 'configured' },
  };
  f.store.setSettings({ onboarding: progress });
  assert.deepEqual(f.store.settings().onboarding, progress);
  assert.equal(f.store.settings().onboardingComplete, false);
  assert.equal(f.store.settings().provider, before.provider);
  assert.equal(f.store.settings().autoConsolidation, before.autoConsolidation);
  assert.throws(() => validateSetup({ ...progress, key: 'fixture' }), /credentials/);
  assert.throws(() => validateSetup({ ...progress, stage: 'gone' }), /progress/);
  assert.throws(() => validateSetup({ ...progress, lessons: { chat: 100 } }), /lesson/);
  f.store.setSettings({ onboarding: { ...progress, status: 'completed' } });
  assert.equal(f.store.settings().onboardingComplete, true);
});
test('temporary access enables only the selected request and preserves child exceptions and global gates', async (t) => {
  const f = fixture(t),
    book = f.store.mutate({ kind: 'notebook', title: 'Private book', data: { access: false } });
  const note = f.store.mutate({
    kind: 'note',
    parent: book.id,
    title: 'Permitted child',
    data: { content: 'One private sentence.' },
  });
  const excluded = f.store.mutate({
    kind: 'note',
    parent: book.id,
    title: 'Excluded child',
    data: { access: false, content: 'Excluded' },
  });
  selected(f, book);
  await assert.rejects(f.agent.execute('read_item', { id: note.id }, f.ctx));
  const result = await approve(
    f,
    f.agent.execute(
      'request_access',
      { id: book.id, permission: 'edit', reason: 'Organize the selected notebook' },
      f.ctx,
    ),
  );
  assert.equal(result.duration, 'temporary');
  await f.store.withAgentScope(
    f.agent.accessRequests.scope(f.ctx.profileSettings, f.conversation.id),
    async () => {
      assert(f.store.access(note.id, true));
      assert(!f.store.access(excluded.id));
      f.store.setSettings({ notebookAccess: false });
      assert(!f.store.access(note.id));
      f.store.setSettings({ notebookAccess: true });
    },
  );
  assert.equal(f.store.access(book.id), false, 'No owner/global grant was silently changed');
  f.agent.stop(f.conversation.id);
  assert.equal(f.agent.accessRequests.status().length, 0);
  await assert.rejects(f.agent.execute('read_item', { id: note.id }, f.ctx));
});
test('permanent grants persist for one profile, resolve once, and revoke live without broadening an old snapshot', async (t) => {
  const f = fixture(t),
    book = f.store.mutate({ kind: 'notebook', title: 'Exact grant', data: { access: false } });
  selected(f, book);
  const request = f.agent.execute(
    'request_access',
    { id: book.id, permission: 'read', reason: 'Read the selected source' },
    f.ctx,
  );
  const result = await approve(f, request, 'permanent', (pending) => {
    assert.throws(() => f.agent.approve(pending.id, true), /duration/);
  });
  assert.equal(result.approved, true);
  assert.equal(f.store.get(f.profile.id).data.resourceGrants.length, 1);
  await f.store.withAgentScope(
    f.agent.accessRequests.scope(f.ctx.profileSettings, f.conversation.id),
    () => {
      assert(f.store.access(book.id));
      assert(!f.store.access(book.id, true));
    },
  );
  f.agent.accessRequests.end(f.conversation.id);
  await f.store.withAgentScope(
    f.agent.accessRequests.scope(f.ctx.profileSettings, f.conversation.id),
    () =>
      assert(
        !f.store.access(book.id),
        'An old run snapshot does not inherit later permanent grants',
      ),
  );
  const fresh = profileSettings(f.store, f.store.get(f.conversation.id));
  await f.store.withAgentScope(f.agent.accessRequests.scope(fresh, f.conversation.id), () =>
    assert(f.store.access(book.id)),
  );
  const other = profileAction(f.store, {
    action: 'save',
    title: 'Other agent',
    data: { resourcePolicy: 'ask', resourceGrants: [] },
  });
  const otherSettings = profileSettings(f.store, { data: { agentProfile: other.id } });
  await f.store.withAgentScope(f.agent.accessRequests.scope(otherSettings, 'other'), () =>
    assert(!f.store.access(book.id)),
  );
  const profile = f.store.get(f.profile.id);
  profileAction(f.store, {
    action: 'save',
    id: profile.id,
    revision: profile.revision,
    data: { resourceGrants: [] },
  });
  await f.store.withAgentScope(f.agent.accessRequests.scope(fresh, f.conversation.id), () =>
    assert(!f.store.access(book.id)),
  );
});
test('access review cannot survive stale revisions, revocation, steering or cancellation, even under Full Access', async (t) => {
  for (const action of ['revision', 'scope', 'steer', 'abort']) {
    const f = fixture(t),
      book = f.store.mutate({
        kind: 'notebook',
        title: 'Stale ' + action,
        data: { access: false },
      });
    selected(f, book);
    f.store.setSettings({ approvalMode: 'full' });
    const request = f.agent.execute(
      'request_access',
      { id: book.id, permission: 'edit', reason: 'Review exact scope' },
      f.ctx,
    );
    await new Promise((r) => setImmediate(r));
    assert.equal(f.agent.approvals.size, 1);
    if (action === 'revision') f.store.mutate({ id: book.id, title: 'Changed' });
    if (action === 'scope')
      f.store.mutate({ id: f.profile.id, data: { allowConfigurationRequests: false } });
    if (action === 'steer') f.agent.steer(f.conversation.id, 'Stop changing permissions');
    if (action === 'abort') f.controller.abort();
    for (const pending of f.agent.approvals.values()) f.agent.approve(pending.id, 'permanent');
    assert.equal((await request).approved, false);
    assert.equal(f.store.get(f.profile.id).data.resourceGrants.length, 0);
    assert.equal(f.agent.accessRequests.status().length, 0);
  }
});
test('private inventory, explicit profile scopes and read-only sessions cannot be bypassed by requesting access', async (t) => {
  const f = fixture(t),
    book = f.store.mutate({
      kind: 'notebook',
      title: 'Unknown private source',
      data: { access: false },
    });
  await assert.rejects(
    f.agent.execute('request_access', { id: book.id, permission: 'read', reason: 'Read' }, f.ctx),
    /Select the resource/,
  );
  assert.equal(f.events.filter((e) => e.type === 'approval').length, 0);
  selected(f, book);
  await assert.rejects(
    f.agent.execute(
      'request_access',
      { id: book.id, permission: 'read', reason: 'Read' },
      { ...f.ctx, readOnlyMachineSession: true },
    ),
    /inspection only/,
  );
  f.store.mutate({ id: f.profile.id, data: { toolGroups: [] } });
  await assert.rejects(
    f.agent.execute('request_access', { id: book.id, permission: 'read', reason: 'Read' }, f.ctx),
    /profile blocks/,
  );
  f.store.mutate({ id: f.profile.id, data: { allowConfigurationRequests: false } });
  await assert.rejects(f.agent.execute('inspect_configuration', {}, f.ctx), /profile scope/);
});
test('declined access is not repeated during the same request and temporary revocation stops reuse', async (t) => {
  const f = fixture(t),
    book = f.store.mutate({
      kind: 'notebook',
      title: 'Selected private source',
      data: { access: false },
    });
  selected(f, book);
  const args = { id: book.id, permission: 'read', reason: 'Read selected content' };
  assert.equal(
    (await approve(f, f.agent.execute('request_access', args, f.ctx), 'decline')).approved,
    false,
  );
  assert.equal((await f.agent.execute('request_access', args, f.ctx)).approved, false);
  assert.equal(f.agent.approvals.size, 0);
  f.agent.accessRequests.end(f.conversation.id);
  await approve(f, f.agent.execute('request_access', args, f.ctx));
  f.agent.accessRequests.revoke(f.conversation.id, book.id);
  await f.store.withAgentScope(
    f.agent.accessRequests.scope(f.ctx.profileSettings, f.conversation.id),
    () => assert(!f.store.access(book.id)),
  );
});
test('configuration proposals are allowlisted, exact, native-reviewed and do not change grants or mandatory instructions', async (t) => {
  const f = fixture(t);
  f.store.setSettings({ approvalMode: 'full' });
  await assert.rejects(
    f.agent.execute(
      'propose_configuration_change',
      { changes: { terminalAccess: true }, reason: 'Enable host' },
      f.ctx,
    ),
    /Only current-agent/,
  );
  await assert.rejects(
    f.agent.execute(
      'propose_configuration_change',
      { changes: { provider: 'openai', model: 'fixture' }, reason: 'Use cloud' },
      f.ctx,
    ),
    /Connect the provider/,
  );
  const before = f.store.get(f.profile.id);
  const request = f.agent.execute(
    'propose_configuration_change',
    {
      changes: { title: 'Clear companion', personality: 'Explain clearly.' },
      reason: 'Use the style requested by the user',
    },
    f.ctx,
  );
  const result = await approve(f, request, 'save');
  assert.equal(result.applied, true);
  const saved = f.store.get(f.profile.id);
  assert.equal(saved.title, 'Clear companion');
  assert.equal(saved.data.personality, 'Explain clearly.');
  assert.deepEqual(saved.data.resourceGrants, before.data.resourceGrants);
  assert.equal(saved.data.systemPrompt, before.data.systemPrompt);
  assert.equal(
    f.store.settings().terminalAccess,
    true,
    'Only the user-selected Full Access policy enabled this before the proposal',
  );
});
test('persistent scopes retain source restrictions and cycle checks', (t) => {
  const f = fixture(t),
    source = f.store.mutate({
      kind: 'note',
      parent: f.store.all().find((e) => e.kind === 'notebook').id,
      title: 'Private source',
      data: { access: false },
    });
  const memory = f.store.mutate({
    kind: 'memory',
    title: 'Private memory',
    data: { sources: [source.id], content: 'Private' },
  });
  const profile = f.store.get(f.profile.id);
  profileAction(f.store, {
    action: 'save',
    id: profile.id,
    revision: profile.revision,
    data: {
      resourceGrants: normalizeResourceGrants(f.store, [{ id: memory.id, permission: 'read' }]),
    },
  });
  const settings = profileSettings(f.store, f.store.get(f.conversation.id));
  f.store.withAgentScope(f.agent.accessRequests.scope(settings, f.conversation.id), () =>
    assert(!f.store.access(memory.id)),
  );
  f.store.mutate({ id: memory.id, data: { sources: [memory.id] } });
  f.store.withAgentScope(f.agent.accessRequests.scope(settings, f.conversation.id), () =>
    assert(!f.store.access(memory.id)),
  );
});
test('backups do not silently restore new agent grants', async (t) => {
  const f = fixture(t),
    destination = fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-setup-backup-'));
  t.after(() => {
    assert(destination.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(destination, { recursive: true, force: true });
  });
  const book = f.store.mutate({
      kind: 'notebook',
      title: 'Portable source',
      data: { access: false },
    }),
    p = f.store.get(f.profile.id);
  profileAction(f.store, {
    action: 'save',
    id: p.id,
    revision: p.revision,
    data: { resourceGrants: [{ id: book.id, permission: 'edit' }] },
  });
  const backup = await exportBackup(f.store, destination);
  assert(backup.excluded.includes('agent resource grants'));
  await restoreBackup(f.store, backup.directory);
  assert.deepEqual(f.store.get(p.id).data.resourceGrants, []);
});
test('authenticated local servers use protected endpoint-bound tokens without changing provider kind', (t) => {
  const f = fixture(t),
    secure = {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'fixture',
      encryptString: (s) => Buffer.from('protected:' + s),
      decryptString: (b) => b.toString().slice(10),
    };
  const credentials = new InferenceCredentials(f.store, secure, 'win32'),
    local = { ...f.store.settings(), provider: 'lmstudio', endpoint: 'http://127.0.0.1:1234' };
  credentials.save(local, 'fixture-server-token');
  assert.equal(credentials.get(local), 'fixture-server-token');
  assert.equal(credentials.get({ ...local, endpoint: 'http://127.0.0.1:1235' }), '');
  assert.throws(
    () =>
      credentials.save({ ...local, endpoint: 'http://example.com:1234' }, 'fixture-server-token'),
    /HTTPS/,
  );
});
