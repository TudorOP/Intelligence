import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../electron/store.mjs';
import { Vault } from '../electron/vault.mjs';
import { imageData, visionMessage } from '../electron/vision.mjs';
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-vault-'));
  const store = new Store(directory),
    vault = new Vault(store);
  t.after(() => {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { store, vault, directory };
}
test('Vault creates real Markdown, edits atomically, detects external edits and survives restart', (t) => {
  const { store, vault } = fixture(t),
    folder = vault.create({ kind: 'vault-folder', title: 'Cercetare' }),
    file = vault.create({
      parent: folder.id,
      title: 'Idei',
      content: '# Știință\n\n|A|B|\n|-|-|\n|1|2|',
    });
  assert.equal(fs.readFileSync(vault.location(file), 'utf8'), file.data.content);
  const saved = vault.update({ id: file.id, revision: file.revision, content: '# Actualizat' });
  assert.equal(fs.readFileSync(vault.location(saved), 'utf8'), '# Actualizat');
  fs.writeFileSync(vault.location(saved), 'Extern');
  assert.throws(
    () => vault.update({ id: saved.id, revision: saved.revision, content: 'overwrite' }),
    /changed on disk/,
  );
  assert.equal(vault.read(saved.id).data.content, 'Extern');
  assert.throws(
    () => vault.update({ id: file.id, revision: file.revision, content: 'old' }),
    /changed/,
  );
  const again = new Vault(store);
  assert.equal(again.read(file.id).data.content, 'Extern');
});
test('folder moves preserve descendants and Trash restores or permanently removes real files', (t) => {
  const { store, vault } = fixture(t),
    a = vault.create({ kind: 'vault-folder', title: 'A' }),
    b = vault.create({ kind: 'vault-folder', title: 'B' }),
    nested = vault.create({ kind: 'vault-folder', title: 'Inner', parent: a.id }),
    file = vault.create({ title: 'note.md', parent: nested.id, content: 'Keep' });
  vault.update({ id: a.id, revision: a.revision, parent: b.id, title: 'Moved' });
  assert.equal(vault.read(file.id).data.path, 'B/Moved/Inner/note.md');
  assert.throws(
    () => vault.update({ id: b.id, revision: b.revision, parent: nested.id }),
    /itself/,
  );
  vault.trash(a.id);
  const disk = vault.location(store.get(file.id, true));
  assert.ok(fs.existsSync(disk));
  assert.equal(store.get(file.id), null);
  vault.restore(a.id);
  assert.equal(vault.read(file.id).data.content, 'Keep');
  vault.trash(a.id);
  vault.destroy(a.id);
  store.deleteTrash(a.id);
  assert.equal(store.get(file.id, true), null);
  assert.equal(fs.existsSync(disk), false);
});
test('Vault prevents traversal, symlink storage, duplicate names and unauthorized descendant mutations', (t) => {
  const { store, vault, directory } = fixture(t),
    folder = vault.create({ kind: 'vault-folder', title: 'Allowed' }),
    file = vault.create({ parent: folder.id, title: 'Secret' });
  assert.throws(() => vault.create({ title: '../escape' }), /name/);
  assert.throws(() => vault.create({ title: 'CON' }), /name/);
  assert.throws(() => vault.create({ title: 'Secret', parent: folder.id }), /already exists/);
  assert.throws(() => store.mutate({ id: file.id, data: { content: 'bypass' } }), /Vault actions/);
  vault.update({ id: file.id, revision: file.revision, access: false });
  assert.throws(() => vault.read(file.id, { agent: true }), /access/);
  assert.throws(
    () =>
      vault.update({ id: folder.id, revision: folder.revision, title: 'Move' }, { agent: true }),
    /access/,
  );
  store.setSettings({ vaultAccess: false });
  assert.throws(() => vault.create({ title: 'Blocked' }, { agent: true }), /disabled/);
  const external = path.join(directory, 'external');
  fs.mkdirSync(external);
  const link = path.join(vault.root, 'Link');
  fs.symlinkSync(external, link, 'junction');
  assert.throws(() => vault.safe(path.join(link, 'file.md')), /Symbolic/);
});
test('Vault image references are local, vision output is bounded and revoked sources are not replayed', (t) => {
  const { store, vault, directory } = fixture(t);
  const source = path.join(directory, 'input.png');
  fs.copyFileSync('public/assets/icon-prism.png', source);
  const image = vault.image(source),
    file = vault.create({
      title: 'Picture',
      content: '![A colorful icon](' + image.markdown + ')',
    }),
    result = vault.readImage(file.id);
  assert.match(imageData(store, image.url).image_url.url, /^data:image\/png;base64/);
  assert.equal(visionMessage(store, result.visionImage).content.length, 2);
  assert.throws(() => imageData(store, 'file:///etc/passwd'), /imported/);
  vault.update({ id: file.id, revision: file.revision, access: false });
  assert.match(visionMessage(store, result.visionImage).content, /outside current access/);
});
