import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { Store } from '../electron/store.mjs';
import { Workspace } from '../electron/workspace.mjs';
import { importBackgroundImage, themeIds } from '../electron/appearance-settings.mjs';
import { exportBackup, restoreBackup } from '../electron/backup.mjs';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-appearance-'));
  const store = new Store(directory);
  const workspace = new Workspace(store, {});
  t.after(() => {
    workspace.close();
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { store, directory };
}
test('all themes persist independently of background layers, validate choices and preserve Night return', (t) => {
  const { store } = fixture(t);
  for (const theme of themeIds) {
    store.setSettings({ theme, backgroundArtwork: 'astral', backgroundBlur: 8 });
    assert.equal(store.settings().theme, theme);
    assert.equal(store.settings().backgroundArtwork, 'astral');
    assert.equal(store.settings().backgroundBlur, 8);
  }
  store.setSettings({ theme: 'marble' });
  store.setSettings({ theme: 'night' });
  assert.equal(store.settings().returnTheme, 'marble');
  const before = store.settings();
  for (const setting of [
    { theme: 'invalid' },
    { backgroundArtwork: 'https://example.org/pixel' },
    { backgroundImage: 'file:///private/image.png' },
    { backgroundBlur: NaN },
    { backgroundBlur: -1 },
    { backgroundBlur: 25 },
    { backgroundOpacity: 90 },
  ])
    assert.throws(() => store.setSettings(setting));
  assert.deepEqual(store.settings(), before);
});
test('custom backgrounds are decoded, bounded, metadata-free and preserved by backup and shared-asset deletion', async (t) => {
  const { store, directory } = fixture(t);
  const image = path.join(directory, 'wide.png');
  await sharp({ create: { width: 4000, height: 2000, channels: 3, background: '#557766' } })
    .png()
    .toFile(image);
  const reference = await importBackgroundImage(image, directory);
  const asset = path.join(directory, 'assets', reference.split('/').at(-1));
  const metadata = await sharp(fs.readFileSync(asset)).metadata();
  assert.equal(metadata.width, 2560);
  assert.equal(metadata.height, 1280);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.format, 'webp');
  store.setSettings({
    backgroundArtwork: 'custom',
    backgroundImage: reference,
    backgroundBlur: 12,
  });
  const note = store.mutate({
    kind: 'note',
    parent: store.all().find((e) => e.kind === 'notebook').id,
    title: 'Shared image',
    data: { content: `![Image](${reference})` },
  });
  store.mutate({ id: note.id, action: 'trash' });
  store.deleteTrash(note.id);
  assert.ok(fs.existsSync(asset), 'Settings still reference this image');
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-background-backup-'));
  t.after(() => fs.rmSync(destination, { recursive: true, force: true }));
  const backup = await exportBackup(store, destination);
  store.setSettings({ backgroundImage: '', backgroundArtwork: 'theme', backgroundBlur: 0 });
  await restoreBackup(store, backup.directory);
  assert.equal(store.settings().backgroundImage, reference);
  assert.equal(store.settings().backgroundBlur, 12);
  assert.ok(fs.existsSync(asset));
  const corrupt = path.join(directory, 'broken.png');
  fs.writeFileSync(corrupt, 'not an image');
  const before = fs.readdirSync(path.join(directory, 'assets')).length;
  await assert.rejects(importBackgroundImage(corrupt, directory), /decoded safely/);
  assert.equal(fs.readdirSync(path.join(directory, 'assets')).length, before);
});

test('retired motion preferences in old data and backups are inert without losing still artwork', (t) => {
  const { store } = fixture(t);
  for (const [key, value] of Object.entries({
    animatedBackground: 'fireplace',
    animationOpacity: 70,
    backgroundMotionPaused: false,
  }))
    store.db
      .prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)')
      .run(key, JSON.stringify(value));
  store.setSettings({ backgroundArtwork: 'festive', backgroundBlur: 0 });
  assert.equal(store.settings().backgroundArtwork, 'festive');
  assert.equal(store.settings().backgroundBlur, 0);
  assert.equal(store.settings().animatedBackground, undefined);
  assert.equal(store.settings().animationOpacity, undefined);
  assert.equal(store.settings().backgroundMotionPaused, undefined);
});
