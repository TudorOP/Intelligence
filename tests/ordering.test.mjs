import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../electron/store.mjs';
import { Vault } from '../electron/vault.mjs';
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-order-'));
  const store = new Store(directory),
    vault = new Vault(store);
  t.after(() => {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { store, vault, directory };
}
test('Vault reorders mixed siblings durably without changing paths, bytes, grants or descendants', (t) => {
  const { store, vault, directory } = fixture(t);
  const a = vault.create({ title: 'A', content: 'User text — Știință' });
  const folder = vault.create({ title: 'Folder', kind: 'vault-folder' });
  const nested = vault.create({ parent: folder.id, title: 'Nested', content: 'Keep this' });
  const b = vault.create({ title: 'B' });
  const before = store.all();
  vault.reorder({ id: b.id, revision: b.revision, beforeId: a.id, beforeRevision: a.revision });
  assert.deepEqual(
    vault.list({ parent: null }).items.map((e) => e.id),
    [b.id, a.id, folder.id],
  );
  assert.equal(vault.read(a.id).data.content, a.data.content);
  assert.equal(vault.read(nested.id).data.path, 'Folder/Nested.md');
  for (const e of before.filter((e) => e.kind.startsWith('vault-'))) {
    assert.equal(store.get(e.id).data.access, e.data.access);
    assert.equal(store.get(e.id).parent, e.parent);
  }
  const second = new Store(directory);
  try {
    assert.deepEqual(
      new Vault(second).list({ parent: null }).items.map((e) => e.id),
      [b.id, a.id, folder.id],
    );
  } finally {
    second.close();
  }
  assert.throws(() => vault.reorder({ id: b.id, revision: b.revision }), /changed/);
  assert.throws(
    () =>
      vault.reorder({
        id: store.get(b.id).id,
        revision: store.get(b.id).revision,
        parent: folder.id,
      }),
    /current folder/,
  );
});
test('card insertion handles same-list, cross-list, append and stale/foreign destinations atomically', (t) => {
  const { store } = fixture(t);
  const board = store.all().find((e) => e.kind === 'board'),
    lists = store.children(board.id);
  const cards = ['One', 'Two', 'Three'].map((title) =>
    store.mutate({ kind: 'card', parent: lists[0].id, title, data: { content: title } }),
  );
  const order = (id) =>
    store
      .children(id)
      .filter((e) => e.kind === 'card')
      .sort(
        (a, b) => (a.data.order ?? Date.parse(a.created)) - (b.data.order ?? Date.parse(b.created)),
      );
  const move = (id, parent, beforeId = null) =>
    store.mutate({
      action: 'reorder',
      id,
      revision: store.get(id).revision,
      parent,
      beforeId,
      beforeRevision: store.get(beforeId)?.revision,
    });
  move(cards[2].id, lists[0].id, cards[0].id);
  assert.deepEqual(
    order(lists[0].id)
      .slice(0, 3)
      .map((e) => e.title),
    ['Three', 'One', 'Two'],
  );
  move(cards[2].id, lists[1].id);
  assert.equal(order(lists[1].id).at(-1).id, cards[2].id);
  move(cards[0].id, lists[1].id, cards[2].id);
  assert.deepEqual(
    order(lists[1].id)
      .slice(-2)
      .map((e) => e.title),
    ['One', 'Three'],
  );
  const snapshot = JSON.stringify(store.all());
  assert.throws(
    () => store.mutate({ action: 'reorder', id: cards[0].id, revision: 1, parent: lists[0].id }),
    /changed/,
  );
  assert.throws(() => move(cards[0].id, lists[0].id, cards[2].id), /destination changed/);
  assert.equal(JSON.stringify(store.all()), snapshot);
  for (const c of cards) assert.equal(store.get(c.id).data.content, c.title);
});
test('ordering preserves agent access boundaries and validates persisted sort preferences', (t) => {
  const { store, vault } = fixture(t);
  const a = vault.create({ title: 'Allowed' }),
    b = vault.create({ title: 'Private' });
  vault.update({ id: b.id, revision: b.revision, access: false });
  assert.throws(() => vault.reorder({ id: a.id, revision: a.revision }, { agent: true }), /access/);
  assert.throws(
    () => store.mutate({ action: 'reorder', id: a.id, revision: a.revision }),
    /Vault actions/,
  );
  store.setSettings({ vaultSort: 'folders' });
  assert.equal(store.settings().vaultSort, 'folders');
  assert.throws(() => store.setSettings({ vaultSort: 'arbitrary' }), /sort order/);
});

test('board lists reorder durably with revisions while retaining cards, grants and fixed Matrix lists', (t) => {
  const { store, directory } = fixture(t);
  const board = store.all().find((e) => e.kind === 'board'),
    lists = store.children(board.id);
  const ordered = (db) =>
    db
      .children(board.id)
      .sort(
        (a, b) => (a.data.order ?? Date.parse(a.created)) - (b.data.order ?? Date.parse(b.created)),
      );
  const before = store.all().filter((e) => e.kind === 'card');
  const move = (item, destination) =>
    store.mutate({
      action: 'reorder',
      id: item.id,
      revision: item.revision,
      beforeId: destination?.id ?? null,
      beforeRevision: destination?.revision,
    });
  move(lists[2], lists[0]);
  assert.deepEqual(
    ordered(store).map((e) => e.id),
    [lists[2].id, lists[0].id, lists[1].id],
  );
  assert.deepEqual(
    store.all().filter((e) => e.kind === 'card'),
    before,
  );
  for (const list of lists) {
    assert.equal(store.get(list.id).data.access, list.data.access);
    assert.equal(store.get(list.id).data.assigned, list.data.assigned);
  }
  const second = new Store(directory);
  try {
    assert.equal(ordered(second)[0].id, lists[2].id);
  } finally {
    second.close();
  }
  assert.throws(() => move(lists[2], lists[0]), /changed/);
  const otherBoard = store.mutate({ kind: 'board', title: 'Other board' });
  assert.throws(
    () =>
      store.mutate({
        action: 'reorder',
        id: lists[0].id,
        revision: store.get(lists[0].id).revision,
        parent: otherBoard.id,
      }),
    /current board/,
  );
  store.mutate({ id: lists[1].id, data: { access: false } });
  assert.throws(
    () =>
      store.mutate(
        { action: 'reorder', id: lists[0].id, revision: store.get(lists[0].id).revision },
        { agent: true },
      ),
    /access/,
  );
  const foreign = store.mutate({ kind: 'list', parent: otherBoard.id, title: 'Other list' });
  assert.throws(() => move(store.get(lists[0].id), foreign), /destination changed/);
  assert.throws(
    () => store.mutate({ action: 'reorder', id: 'matrix-core', revision: 1 }),
    /reorder/,
  );
  move(store.get(lists[2].id), null);
  assert.equal(ordered(store).at(-1).id, lists[2].id);
});
