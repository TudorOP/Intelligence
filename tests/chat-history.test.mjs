import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../electron/store.mjs';
import { modelHistory, snapshotContext, resultSources } from '../electron/chat-history.mjs';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-history-'));
  const store = new Store(directory);
  t.after(() => {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const conversation = store.mutate({ kind: 'conversation', title: 'History', data: {} });
  return { store, conversation };
}

test('history replays snapshots unchanged but removes revoked sources and memory', (t) => {
  const { store, conversation } = fixture(t);
  const note = store.all().find((e) => e.kind === 'note' && store.access(e.id));
  const memory = store.mutate({
    kind: 'memory',
    title: 'Fact',
    data: { content: 'Recalled fixture', access: true },
  });
  store.message(conversation.id, 'user', 'First', {
    promptContext: snapshotContext([note], [memory]),
  });
  const original = modelHistory(store, conversation.id)[0].content;
  store.mutate({ id: note.id, data: { content: 'New revision' } });
  assert.equal(modelHistory(store, conversation.id)[0].content, original);
  store.setSettings({ memoryAccess: false });
  assert.ok(!modelHistory(store, conversation.id)[0].content.includes('Recalled fixture'));
  store.mutate({ id: note.id, data: { access: false } });
  assert.ok(!modelHistory(store, conversation.id)[0].content.includes(note.title));
});

test('history bounds complete turns and drops incomplete tool calls after cancellation', (t) => {
  const { store, conversation } = fixture(t);
  for (let i = 0; i < 13; i++) {
    store.message(conversation.id, 'user', 'Turn ' + i);
    const answer = {
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 'reused_id', type: 'function', function: { name: 'read_item', arguments: '{}' } },
      ],
    };
    store.message(conversation.id, 'assistant', '', {
      tool: true,
      modelOnly: true,
      modelMessage: answer,
    });
    if (i < 12)
      store.message(conversation.id, 'assistant', 'read_item: {}', {
        tool: true,
        name: 'read_item',
        modelMessage: { role: 'tool', tool_call_id: 'reused_id', content: '{}' },
      });
  }
  store.message(conversation.id, 'assistant', 'Response stopped.', { error: true });
  const history = modelHistory(store, conversation.id);
  assert.equal(history[0].content, 'Turn 1');
  assert.equal(history.filter((m) => m.role === 'user').length, 12);
  assert.equal(history.at(-1).content, 'Turn 12');
  assert.ok(!history.some((m) => m.content === 'Response stopped.'));
  for (const m of history.filter((m) => m.tool_calls))
    assert.ok(history.some((r) => r.tool_call_id === m.tool_calls[0].id));
});

test('historical tool results respect revoked access to nested source entities', (t) => {
  const { store, conversation } = fixture(t);
  const note = store.all().find((e) => e.kind === 'note' && store.access(e.id));
  const result = { items: [{ id: note.id, content: 'Private historical fixture' }] };
  store.message(conversation.id, 'user', 'Read');
  store.message(conversation.id, 'assistant', '', {
    tool: true,
    modelMessage: {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'read', function: { name: 'read_item', arguments: '{}' } }],
    },
  });
  store.message(conversation.id, 'assistant', 'read_item', {
    tool: true,
    name: 'read_item',
    modelMessage: { role: 'tool', tool_call_id: 'read', content: JSON.stringify(result) },
    modelSources: resultSources(store, result),
  });
  assert.ok(
    JSON.stringify(modelHistory(store, conversation.id)).includes('Private historical fixture'),
  );
  store.mutate({ id: note.id, data: { access: false } });
  const history = modelHistory(store, conversation.id);
  assert.ok(!JSON.stringify(history).includes('Private historical fixture'));
  assert.equal(history[2].tool_call_id, 'read');
});

test('turn skill metadata obeys live exclusions and old ungranted selections lose their names', (t) => {
  const { store, conversation } = fixture(t);
  const skill = store.mutate({
    kind: 'skill',
    title: 'Procedure metadata',
    data: { access: true, content: 'Load only on demand' },
  });
  const note = store.all().find((e) => e.kind === 'note');
  store.mutate({ id: note.id, data: { access: false } });
  const first = store.message(conversation.id, 'user', 'Inspect selection', {
    promptContext: {
      ...snapshotContext([], []),
      permissionSelections: [{ id: note.id, title: note.title, kind: note.kind }],
      skills: [{ id: skill.id, title: skill.title, revision: skill.revision }],
    },
  });
  const initial = modelHistory(store, conversation.id)[0].content;
  assert.ok(initial.includes(note.title));
  assert.ok(initial.includes(skill.title));
  assert.ok(!initial.includes('Load only on demand'));
  store.message(conversation.id, 'user', 'Continue', { promptContext: snapshotContext([], []) });
  assert.ok(!modelHistory(store, conversation.id)[0].content.includes(note.title));
  store.mutate({ id: skill.id, data: { access: false } });
  assert.ok(!modelHistory(store, conversation.id)[0].content.includes(skill.title));
  assert.ok(
    store.messages(conversation.id).find((m) => m.id === first.id).data.promptContext.skills.length,
  );
});

test('screen focus stays with its user turn, changes across navigation and loses revoked titles on replay', (t) => {
  const { store, conversation } = fixture(t);
  const note = store.all().find((e) => e.kind === 'note' && store.access(e.id));
  const board = store.all().find((e) => e.kind === 'board');
  store.mutate({ id: board.id, data: { access: true } });
  for (const [section, entity] of [
    ['notebooks', note],
    ['tasks', board],
  ])
    store.message(conversation.id, 'user', 'Summarize this', {
      promptContext: {
        ...snapshotContext([entity], []),
        screenFocus: {
          section,
          mode: 'screen',
          entities: [{ id: entity.id, title: entity.title }],
        },
      },
    });
  store.message(conversation.id, 'user', 'Explore work', {
    promptContext: {
      ...snapshotContext([], []),
      screenFocus: { section: 'reports', mode: 'all', entities: [] },
    },
  });
  const history = modelHistory(store, conversation.id);
  assert.match(history[0].content, /"section":"notebooks"/);
  assert.match(history[1].content, /"section":"tasks"/);
  assert.match(history[2].content, /"mode":"all"/);
  store.mutate({ id: note.id, data: { access: false } });
  assert.ok(!modelHistory(store, conversation.id)[0].content.includes(note.title));
});
