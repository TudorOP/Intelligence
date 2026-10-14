import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../electron/store.mjs';
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-test-'));
  const store = new Store(directory);
  t.after(() => store.close());
  return store;
}

test('permanent deletion removes a trashed collection and its saved revisions and indexes', (t) => {
  const store = fixture(t);
  const notebook = store.all().find((e) => e.kind === 'notebook' && e.data.access);
  const note = store.children(notebook.id, true).find((e) => e.kind === 'note');
  store.mutate({ id: note.id, data: { content: 'purgefixture content' } });
  store.vector(note.id, 'fixture', [1, 2], store.get(note.id).revision);
  const unrelated = store.mutate({ kind: 'notebook', title: 'Keep me', data: {} });
  assert.throws(() => store.deleteTrash(notebook.id), /in Trash/);
  const expectedIds = [notebook, ...store.children(notebook.id, true)].map((e) => e.id);
  store.mutate({ id: notebook.id, action: 'trash' });
  assert.deepEqual(store.deleteTrash(notebook.id).deleted.sort(), expectedIds.sort());
  for (const id of expectedIds) {
    assert.equal(store.get(id, true), null);
    assert.equal(store.history(id).length, 0);
    for (const table of ['search', 'vectors'])
      assert.equal(
        store.db.prepare(`SELECT count(*) AS count FROM ${table} WHERE id=?`).get(id).count,
        0,
      );
  }
  assert.ok(store.get(unrelated.id));
  assert.throws(() => store.mutate({ id: notebook.id, action: 'restore' }), /no longer exists/);
});

test('deleting a trashed conversation removes messages, runs, cursors and derived automatic memories', (t) => {
  const store = fixture(t);
  const conversation = store.mutate({ kind: 'conversation', title: 'Remove chat', data: {} });
  store.message(conversation.id, 'user', 'purgechat fixture');
  store.message(conversation.id, 'assistant', 'Fixture answer');
  const automatic = store.mutate({
    kind: 'memory',
    title: 'Summary to remove',
    data: { auto: true, sources: [conversation.id], content: 'purgechat summary' },
  });
  const derived = store.mutate({
    kind: 'memory',
    title: 'Derived summary',
    data: { auto: true, sources: [automatic.id] },
  });
  const independent = store.mutate({
    kind: 'memory',
    title: 'Independent fact',
    data: { content: 'Keep this' },
  });
  store.db.prepare('INSERT INTO consolidation VALUES(?,?,?)').run(conversation.id, 'cursor', 'now');
  store.db
    .prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?)')
    .run('fixture-run', 'card', 'done', 'now', 'now', 'result', conversation.id);
  store.mutate({ id: conversation.id, action: 'trash' });
  const result = store.deleteTrash(conversation.id);
  assert.ok(result.deleted.includes(automatic.id) && result.deleted.includes(derived.id));
  assert.equal(store.messages(conversation.id).length, 0);
  assert.equal(store.consolidationCursor(conversation.id), undefined);
  assert.equal(
    store.db
      .prepare('SELECT count(*) AS count FROM message_search WHERE conversation=?')
      .get(conversation.id).count,
    0,
  );
  assert.equal(store.snapshot().runs.length, 0);
  assert.ok(store.get(independent.id));
});

test('permanent deletion is atomic when a database operation fails', (t) => {
  const store = fixture(t);
  const conversation = store.mutate({ kind: 'conversation', title: 'Keep on failure', data: {} });
  store.message(conversation.id, 'user', 'Atomic fixture');
  store.mutate({ id: conversation.id, action: 'trash' });
  store.db.exec(
    "CREATE TEMP TRIGGER prevent_entity_delete BEFORE DELETE ON entities BEGIN SELECT RAISE(ABORT, 'fixture failure'); END",
  );
  assert.throws(() => store.deleteTrash(conversation.id), /fixture failure/);
  assert.ok(store.get(conversation.id, true));
  assert.equal(store.messages(conversation.id).length, 1);
  assert.equal(
    store.db
      .prepare('SELECT count(*) AS count FROM message_search WHERE conversation=?')
      .get(conversation.id).count,
    1,
  );
});

test('permanently deleted memory retains only a hash that prevents automatic recreation', (t) => {
  const store = fixture(t);
  const conversation = store.mutate({ kind: 'conversation', title: 'Memory evidence', data: {} });
  const message = store.message(conversation.id, 'user', 'Durable fixture fact');
  const fact = {
    key: 'fixture.fact',
    content: 'Durable fixture fact',
    evidence: message.content,
    messageIds: [message.id],
  };
  store.commitConsolidation(conversation.id, 'first', '', [fact], [message.id], []);
  const memory = store.all().find((e) => e.kind === 'memory' && e.data.auto);
  store.mutate({ id: memory.id, action: 'trash' });
  store.deleteTrash(memory.id);
  assert.equal(store.get(memory.id, true), null);
  store.commitConsolidation(conversation.id, 'second', '', [fact], [message.id], []);
  assert.equal(store.get(memory.id, true), null);
  assert.deepEqual(
    store.db
      .prepare('SELECT * FROM memory_tombstones')
      .all()
      .map((row) => Object.keys(row)),
    [['id']],
  );
});

test('permanent deletion cleans up attached images and preserves shared images and revision references', (t) => {
  const store = fixture(t);
  const assets = path.join(store.directory, 'assets');
  fs.mkdirSync(assets);
  for (const name of ['remove.png', 'shared.png', 'revision.png', 'avatar.png'])
    fs.writeFileSync(path.join(assets, name), 'fixture');
  const notebook = store.all().find((e) => e.kind === 'notebook');
  const note = store.mutate({
    kind: 'note',
    parent: notebook.id,
    title: 'Images to remove',
    data: {
      content: ['remove.png', 'shared.png', 'revision.png', 'avatar.png']
        .map((name) => `![Image](intelligence-media://asset/${name})`)
        .join('\n'),
    },
  });
  store.setSettings({ avatar: 'intelligence-media://asset/avatar.png' });
  const retained = store.mutate({
    kind: 'note',
    parent: notebook.id,
    title: 'Keep image',
    data: {
      content: '![Image](intelligence-media://asset/revision.png)',
      cover: 'intelligence-media://asset/shared.png',
    },
  });
  store.mutate({ id: retained.id, data: { content: 'Current content' } });
  store.mutate({ id: note.id, action: 'trash' });
  assert.equal(store.deleteTrash(note.id).retainedAssets, 0);
  assert.equal(fs.existsSync(path.join(assets, 'remove.png')), false);
  for (const name of ['shared.png', 'revision.png', 'avatar.png'])
    assert.equal(fs.existsSync(path.join(assets, name)), true);
});
test('child exclusions filter search and read/edit scope without changing siblings', (t) => {
  const store = fixture(t),
    notebook = store.all().find((e) => e.kind === 'notebook' && e.data.access);
  const a = store.mutate({
    kind: 'note',
    parent: notebook.id,
    title: 'Accessible lantern',
    data: { content: 'lantern visible' },
  });
  const b = store.mutate({
    kind: 'note',
    parent: notebook.id,
    title: 'Private lantern',
    data: { content: 'lantern secret', access: false },
  });
  assert.equal(store.access(a.id), true);
  assert.equal(store.access(b.id), false);
  assert.ok(store.search('lantern', { agent: true }).some((e) => e.id === a.id));
  assert.ok(!store.search('lantern', { agent: true }).some((e) => e.id === b.id));
  store.mutate({ id: a.id, data: { permission: 'read' } });
  assert.equal(store.access(a.id), true);
  assert.equal(store.access(a.id, true), false);
  assert.throws(
    () => store.mutate({ id: a.id, data: { content: 'overwrite' } }, { agent: true }),
    /edit access/,
  );
});
test('task access does not imply assignment, and explicit manual cards override board assignment', (t) => {
  const store = fixture(t),
    board = store.all().find((e) => e.kind === 'board'),
    list = store.all().find((e) => e.parent === board.id);
  const card = store.mutate({ kind: 'card', parent: list.id, title: 'Do a thing', data: {} });
  assert.equal(store.access(card.id, true), true);
  assert.equal(store.assigned(card.id), false);
  store.mutate({ id: board.id, data: { assigned: true } });
  assert.equal(store.assigned(card.id), true);
  store.mutate({ id: card.id, data: { assigned: false } });
  assert.equal(store.assigned(card.id), false);
  assert.throws(
    () => store.mutate({ id: card.id, data: { assigned: true } }, { agent: true }),
    /Only the user/,
  );
});
test('stale edits are rejected, versions survive restart, and trash restores a notebook hierarchy', (t) => {
  const store = fixture(t),
    notebook = store.all().find((e) => e.kind === 'notebook' && e.data.access);
  const note = store.children(notebook.id, true).find((e) => e.kind === 'note');
  store.mutate({ id: note.id, revision: note.revision, data: { content: 'Changed' } });
  assert.throws(
    () => store.mutate({ id: note.id, revision: note.revision, data: { content: 'Stale' } }),
    /changed/,
  );
  assert.equal(store.history(note.id)[0].data.data.content, note.data.content);
  store.mutate({ id: notebook.id, action: 'trash' });
  assert.equal(store.get(note.id), null);
  assert.equal(store.search('Changed', { agent: true }).length, 0);
  store.mutate({ id: notebook.id, action: 'restore' });
  assert.equal(store.get(note.id).data.content, 'Changed');
});
test('invalid relationships and unsupported policy values are rejected', (t) => {
  const store = fixture(t),
    note = store.all().find((e) => e.kind === 'note');
  assert.throws(() => store.mutate({ id: note.id, parent: note.id }), /valid parent/);
  assert.throws(() => store.mutate({ id: note.id, data: { access: 'yes' } }), /Invalid policy/);
  assert.throws(() => store.setSettings({ provider: 'cloud' }), /Invalid provider/);
});
test('revoking a source removes derived memory from agent retrieval', (t) => {
  const store = fixture(t),
    source = store.all().find((e) => e.kind === 'note');
  const memory = store.mutate({
    kind: 'memory',
    title: 'Derived lantern',
    data: { content: 'lantern summary', sources: [source.id] },
  });
  assert.equal(store.access(memory.id), true);
  store.mutate({ id: source.id, data: { access: false } });
  assert.equal(store.access(memory.id), false);
  assert.ok(!store.search('lantern', { agent: true }).some((e) => e.id === memory.id));
});
