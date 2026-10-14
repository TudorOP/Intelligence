import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../electron/store.mjs';
import { Vault } from '../electron/vault.mjs';
test('permanent Vault deletion removes unreferenced images but preserves shared image bytes', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-vault-assets-')),
    store = new Store(directory),
    vault = new Vault(store);
  t.after(() => {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const source = path.join(directory, 'source.png');
  fs.copyFileSync('public/assets/icon-prism.png', source);
  const image = vault.image(source),
    one = vault.create({ title: 'One', content: '![](' + image.markdown + ')' }),
    two = vault.create({ title: 'Two', content: '![](' + image.markdown + ')' });
  vault.trash(one.id);
  const first = vault.destroy(one.id);
  store.deleteTrash(one.id);
  vault.collectAssets(first);
  assert.ok(fs.existsSync(vault.imagePath(image.name)));
  vault.trash(two.id);
  const second = vault.destroy(two.id);
  store.deleteTrash(two.id);
  vault.collectAssets(second);
  assert.equal(fs.existsSync(vault.imagePath(image.name)), false);
});
