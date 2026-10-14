import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { Store } from '../electron/store.mjs';
import { Vault } from '../electron/vault.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const directory = path.resolve('.test-data/organization-' + Date.now());
const store = new Store(directory),
  vault = new Vault(store);
store.setSettings({ theme: 'day', semanticSearch: false, autoConsolidation: false });
const notebook = store.mutate({
  kind: 'notebook',
  title: 'Cover fixture',
  data: { cover: '#355b49', icon: '✳' },
});
const board = store.all().find((e) => e.kind === 'board'),
  lists = store.children(board.id);
const cards = ['Drag One', 'Drag Two', 'Drag Three'].map((title) =>
  store.mutate({ kind: 'card', parent: lists[0].id, title }),
);
const a = vault.create({ title: 'Alpha', content: 'Preserve user text — Știință' }),
  folder = vault.create({ title: 'Folder', kind: 'vault-folder' }),
  b = vault.create({ title: 'Beta' });
store.close();
const env = { ...process.env, INTELLIGENCE_TEST: '1', INTELLIGENCE_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
// Preserve an explicitly selected dev preview; otherwise use the built interface.
const app = await electron.launch({
  executablePath: electronPath,
  args: ['.', '--disable-gpu'],
  env,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('heading', { name: /Make yourself/ }).waitFor();
  const resize = (w, h) =>
    app.evaluate(
      ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size),
      [w, h],
    );
  const snapshot = () => page.evaluate(() => window.intelligence.bootstrap());
  const capture = async (name) => {
    await app.evaluate(async ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].capturePage(undefined, {
        stayHidden: true,
        stayAwake: true,
      }),
    );
    await page.waitForTimeout(150);
    const png = await app.evaluate(async ({ BrowserWindow }) =>
      (
        await BrowserWindow.getAllWindows()[0].capturePage(undefined, {
          stayHidden: true,
          stayAwake: true,
        })
      )
        .toPNG()
        .toString('base64'),
    );
    fs.writeFileSync(path.join(directory, name + '.png'), Buffer.from(png, 'base64'));
  };
  await resize(1920, 1080);
  await page.getByRole('button', { name: 'Notebooks', exact: true }).click();
  const book = page
    .locator('.book-notebook')
    .filter({ has: page.getByRole('button', { name: notebook.title, exact: true }) });
  assert.equal(
    await book.locator('.book-cover').evaluate((e) => getComputedStyle(e).backgroundColor),
    'rgb(53, 91, 73)',
  );
  assert.equal(await book.locator('.book-cover img,.book-cover .book-theme-art').count(), 0);
  await book.locator('summary').click();
  await page
    .locator('.floating-actions')
    .getByRole('button', { name: /Customize/ })
    .click();
  const dialog = page.getByRole('dialog');
  assert.equal(await dialog.locator('.cover-swatches button').count(), 10);
  await dialog.getByRole('button', { name: 'Rose', exact: true }).click();
  await capture('cover-picker-1080');
  await dialog.getByLabel('Custom cover color').fill('#123456');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.waitForFunction(
    (id) =>
      window.intelligence
        .bootstrap()
        .then((s) => s.entities.find((e) => e.id === id).data.cover === '#123456'),
    notebook.id,
  );
  await page.getByRole('button', { name: notebook.title, exact: true }).click();
  assert.equal(
    await page.locator('.notebook-banner').evaluate((e) => getComputedStyle(e).backgroundColor),
    'rgb(18, 52, 86)',
  );
  assert.equal(await page.locator('.notebook-banner img').count(), 0);
  await page.getByRole('button', { name: 'Vault', exact: true }).click();
  const row = (title) =>
    page
      .locator('.vault-tree-row')
      .filter({ has: page.getByRole('button', { name: 'Open ' + title, exact: true }) });
  const data = await page.evaluateHandle(() => new DataTransfer());
  await row(b.title).locator('.vault-open').dispatchEvent('dragstart', { dataTransfer: data });
  const box = await row(a.title).boundingBox();
  await row(a.title).dispatchEvent('dragover', { dataTransfer: data, clientY: box.y + 2 });
  await page.locator('.vault-drop-before').waitFor();
  await capture('vault-drop-1080');
  await row(a.title).dispatchEvent('drop', { dataTransfer: data });
  await page.waitForFunction(
    (id) => document.querySelector('.vault-tree-row .vault-open')?.textContent.includes(id),
    b.title,
  );
  await page.getByLabel('Vault sort order').selectOption('name');
  await page.waitForFunction(() =>
    document.querySelector('.vault-tree-row .vault-open')?.textContent.includes('Alpha'),
  );
  await page.getByLabel('Vault sort order').selectOption('manual');
  await page.waitForFunction(() =>
    document.querySelector('.vault-tree-row .vault-open')?.textContent.includes('Beta'),
  );
  await row(b.title).locator('summary').focus();
  await page.keyboard.press('Enter');
  await page
    .locator('.floating-actions')
    .getByRole('button', { name: 'Move down', exact: true })
    .click();
  await page.waitForFunction(() =>
    document.querySelector('.vault-tree-row .vault-open')?.textContent.includes('Alpha'),
  );
  await row(folder.title)
    .locator('.vault-open')
    .dragTo(row(a.title), { targetPosition: { x: 40, y: 2 } });
  await page.waitForFunction(() =>
    document.querySelector('.vault-tree-row .vault-open')?.textContent.includes('Folder'),
  );
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  const task = (id) => page.locator(`[data-card-id="${id}"]`);
  await task(cards[2].id).locator('.task-card').dispatchEvent('dragstart', { dataTransfer: data });
  const target = await task(cards[0].id).boundingBox();
  await page
    .locator('.kanban-list')
    .first()
    .dispatchEvent('dragover', { dataTransfer: data, clientY: target.y + 2 });
  await task(cards[0].id).and(page.locator('.card-drop-before')).waitFor();
  await capture('card-drop-1080');
  await page.locator('.kanban-list').first().dispatchEvent('drop', { dataTransfer: data });
  await page.waitForFunction(
    (id) => document.querySelector('.task-card-shell')?.dataset.cardId === id,
    cards[2].id,
  );
  assert.equal(await page.locator('.card-drop-before,.card-drop-end,.card-drop-list').count(), 0);
  // Actual mouse-driven native HTML drag, into an empty list.
  await task(cards[2].id)
    .locator('.task-card')
    .dragTo(page.locator('.kanban-list').nth(1).locator('.add-card'));
  await page.waitForFunction(
    ({ card, parent }) =>
      window.intelligence
        .bootstrap()
        .then((s) => s.entities.find((e) => e.id === card).parent === parent),
    { card: cards[2].id, parent: lists[1].id },
  );
  await task(cards[0].id).locator('.task-card').dispatchEvent('dragstart', { dataTransfer: data });
  await page
    .locator('.kanban-list')
    .nth(1)
    .dispatchEvent('dragover', { dataTransfer: data, clientY: 10000 });
  await page.locator('.card-drop-end').waitFor();
  await task(cards[0].id).locator('.task-card').dispatchEvent('dragend', { dataTransfer: data });
  assert.equal(await page.locator('.card-drop-end,.card-drop-list').count(), 0);
  for (const theme of ['ink', 'day', 'night', 'summer', 'autumn', 'winter']) {
    await page.evaluate((theme) => window.intelligence.settings({ theme }), theme);
    await page.waitForFunction((theme) => document.documentElement.dataset.theme === theme, theme);
    await resize(2560, 1440);
    await capture('cards-' + theme + '-1440');
  }
  await resize(1366, 768);
  await capture('cards-compact');
  await page.reload();
  await page.getByRole('button', { name: 'Vault', exact: true }).click();
  assert.equal(await page.getByLabel('Vault sort order').inputValue(), 'manual');
  const saved = await snapshot();
  assert.equal(saved.entities.find((e) => e.id === notebook.id).data.cover, '#123456');
  assert.equal(saved.entities.find((e) => e.id === cards[2].id).parent, lists[1].id);
  assert.equal(
    (await page.evaluate((id) => window.intelligence.vault({ action: 'read', id }), a.id)).data
      .content,
    a.data.content,
  );
  await page.evaluate(() => window.intelligence.settings({ language: 'ro' }));
  await page.getByLabel('Ordinea în Vault').waitFor();
  await resize(1920, 1080);
  await capture('vault-romanian');
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      directory,
      sizes: ['1920×1080', '2560×1440', '1366×768'],
      themes: 6,
      drag: 'Vault and cards; native card mouse drag',
      persistence: true,
      errors,
    }),
  );
} finally {
  await app.close();
}
