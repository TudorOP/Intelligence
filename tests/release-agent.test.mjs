import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../electron/store.mjs';
import { Agent } from '../electron/agent.mjs';
import { ensureProfiles, profileSettings } from '../electron/profiles.mjs';
import { Planning } from '../electron/planning.mjs';
import { chatRows, toolFailed } from '../src/chat-rows.ts';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-release-agent-'));
  const store = new Store(directory);
  ensureProfiles(store);
  const conversation = store.mutate({ kind: 'conversation', title: 'Release checks' });
  const connections = { tools: () => [], registry: new Map() };
  const agent = new Agent(store, {}, connections, () => {});
  const ctx = {
    conversation: conversation.id,
    project: null,
    signal: new AbortController().signal,
    profileSettings: profileSettings(store, conversation),
  };
  t.after(() => {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { store, agent, ctx, connections };
}

test('release agent moves every discovered card and preserves revision, access and destination failures', async (t) => {
  const { store, agent, ctx } = fixture(t);
  const board = store.mutate({
    kind: 'board',
    title: 'Personal',
    data: { access: true, permission: 'edit' },
  });
  const source = store.mutate({ kind: 'list', parent: board.id, title: 'Someday' });
  const cards = ['Deploy app', 'Lamp parts', 'Old lamp'].map((title) =>
    store.mutate({ kind: 'card', parent: source.id, title }),
  );
  const discovered = await agent.execute('list_items', { parent: source.id }, ctx);
  assert.equal(discovered.items.length, 3);
  assert.ok(discovered.items.every((e) => e.editable));
  const target = await agent.execute(
    'create_item',
    { kind: 'list', parent: board.id, title: 'Today' },
    ctx,
  );
  for (const card of discovered.items) {
    const moved = await agent.execute(
      'move_item',
      { id: card.id, parent: target.id, revision: card.revision },
      ctx,
    );
    assert.equal(moved.parent, target.id);
  }
  assert.equal((await agent.execute('list_items', { parent: source.id }, ctx)).items.length, 0);
  assert.equal((await agent.execute('list_items', { parent: target.id }, ctx)).items.length, 3);
  const card = store.get(cards[1].id);
  await assert.rejects(
    agent.execute('move_item', { id: card.id, parent: source.id, revision: 1 }, ctx),
    /changed/,
  );
  await assert.rejects(
    agent.execute('move_item', { id: 'mistyped-id', parent: source.id, revision: 1 }, ctx),
    /Item not found/,
  );
  await assert.rejects(
    agent.execute(
      'move_item',
      { id: card.id, parent: 'mistyped-destination', revision: card.revision },
      ctx,
    ),
    /Item not found/,
  );
  store.mutate({ id: source.id, data: { permission: 'read' } });
  await assert.rejects(
    agent.execute('move_item', { id: card.id, parent: source.id, revision: card.revision }, ctx),
    /destination.*edit access/,
  );
  store.mutate({ id: card.id, data: { access: false } });
  await assert.rejects(agent.execute('read_item', { id: card.id }, ctx), /outside agent access/);
  assert.equal(store.get(card.id).parent, target.id);
  const profile = store.get(ctx.profileSettings.profileId);
  store.mutate({ id: profile.id, data: { toolGroups: [] } });
  await assert.rejects(agent.execute('list_items', {}, ctx), /tool.*profile scope/);
});

test('release broker separates app references from external MCP IDs, supports Trash restore and gates early routes', async (t) => {
  const { store, agent, ctx, connections } = fixture(t);
  let received;
  agent.approval = async () => true;
  connections.registry.set('mcp_external', { id: 'external-server' });
  connections.call = async (name, args) => {
    received = { name, args };
    return { ok: true };
  };
  assert.deepEqual(await agent.execute('mcp_external', { id: 'server-owned-id' }, ctx), {
    ok: true,
  });
  assert.equal(received.args.id, 'server-owned-id');
  const board = store.mutate({
    kind: 'board',
    title: 'Recoverable',
    data: { access: true, permission: 'edit' },
  });
  store.mutate({ id: board.id, action: 'trash' });
  agent.approval = async () => true;
  assert.equal((await agent.execute('restore_item', { id: board.id }, ctx)).deleted, false);
  for (const name of [
    'read_item',
    'edit_item',
    'trash_item',
    'restore_item',
    'vault_read',
    'matrix_read_task',
    'project_action',
    'skill_action',
  ])
    await assert.rejects(agent.execute(name, { id: 'absent' }, ctx), /Item not found/, name);
  for (const name of ['zim_action', 'read_user_profile', 'skill_action', 'mcp_external'])
    await assert.rejects(
      agent.execute(name, {}, { ...ctx, readOnlyMachineSession: true }),
      /inspection only/,
      name,
    );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    agent.execute('read_user_profile', {}, { ...ctx, signal: controller.signal }),
    /abort/i,
  );
});

test('release tool groups preserve order, reasoning, failures and turn boundaries without changing transport history', () => {
  const row = (id, data = {}, content = '') => ({ id, data, content, role: 'assistant' });
  const messages = [
    row('user', {}, 'Request'),
    row('think', { modelOnly: true }),
    row('a', { tool: true, name: 'read_item', modelMessage: { content: '{"items":[]}' } }),
    row('think2', { modelOnly: true }),
    row('b', { tool: true }, 'move_item: {"error":"Denied"}'),
    row('answer', {}, 'Partial result'),
    row('next', { tool: true, toolStatus: 'done' }),
  ];
  const before = JSON.stringify(messages),
    rows = chatRows(messages);
  assert.deepEqual(
    rows.map((r) => r.kind),
    ['message', 'tools', 'message', 'tools'],
  );
  assert.deepEqual(
    rows[1].messages.map((m) => m.id),
    ['think', 'a', 'think2', 'b'],
  );
  assert.equal(toolFailed(messages[4]), true);
  assert.equal(toolFailed(messages[2]), false);
  assert.equal(JSON.stringify(messages), before);
});

test('release Calendar and Reports restoration retains grants, conflicts and section gates', async (t) => {
  const { store, agent, ctx } = fixture(t);
  const planning = new Planning(store, agent);
  agent.planning = planning;
  agent.approval = async () => true;
  t.after(() => planning.close());
  store.setSettings({ calendarAccess: true, reportsAccess: true });
  const calendar = store.mutate({
    kind: 'calendar',
    title: 'Calendar',
    data: { access: true, permission: 'edit' },
  });
  const event = store.mutate({
    kind: 'calendar-event',
    title: 'Event',
    parent: calendar.id,
    data: {
      endLocal: '2026-10-13T10:00',
      timing: { start: '2026-10-13T09:00', timezone: 'America/Los_Angeles', repeat: 'none' },
    },
  });
  const report = store.mutate({
    kind: 'report',
    title: 'Report',
    data: { access: true, permission: 'edit' },
  });
  for (const [item, tool] of [
    [event, 'calendar_action'],
    [report, 'reports_action'],
  ]) {
    await agent.execute(tool, { action: 'trash', id: item.id }, ctx);
    assert.equal(store.access(item.id, true), false);
    await assert.rejects(
      agent.execute(
        tool,
        { action: 'restore', id: item.id, input: { revision: item.revision } },
        ctx,
      ),
      /changed/,
    );
    const restored = await agent.execute(
      tool,
      { action: 'restore', input: { id: item.id, revision: item.revision + 1 } },
      ctx,
    );
    assert.equal(restored.deleted, false);
    await agent.execute(tool, { action: 'trash', id: item.id }, ctx);
    store.setSettings({ [tool === 'calendar_action' ? 'calendarAccess' : 'reportsAccess']: false });
    await assert.rejects(
      agent.execute(tool, { action: 'restore', id: item.id }, ctx),
      /scope|access/,
    );
    assert.equal(store.get(item.id, true).deleted, true);
  }
});
