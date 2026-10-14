import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { createPackageFromFiles } from '@electron/asar';
const directory = path.resolve('.test-data/desktop-' + Date.now());
fs.mkdirSync(directory, { recursive: true });
if (fs.existsSync('.test-data/memory/models'))
  fs.cpSync('.test-data/memory/models', path.join(directory, 'models'), { recursive: true });
const server = createServer((req, res) => {
  if (req.url === '/api/tags') {
    res.end(JSON.stringify({ models: [{ name: 'intelligence-test-model' }] }));
    return;
  }
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.end(
    JSON.stringify({
      message: { role: 'assistant', content: 'Your local connection is working. 🌿' },
      done: true,
    }) + '\n',
  );
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const env = { ...process.env, INTELLIGENCE_TEST: '1', INTELLIGENCE_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
// Preserve an explicitly selected dev preview; otherwise use the built interface.
let desktop;
try {
  desktop = await electron.launch({
    executablePath: electronPath,
    args: ['.', '--disable-gpu'],
    env,
    timeout: 30000,
  });
  // Exercise the tray image through Electron's ASAR reader, as it loads in a release.
  const iconArchive = path.join(directory, 'tray-icon.asar');
  await createPackageFromFiles(path.resolve('.'), iconArchive, [path.resolve('build/icon.png')]);
  const archivedIcon = await desktop.evaluate(
    ({ nativeImage }, iconPath) => {
      const image = nativeImage.createFromPath(iconPath);
      return { empty: image.isEmpty(), size: image.resize({ width: 24, height: 24 }).getSize() };
    },
    path.join(iconArchive, 'build', 'icon.png'),
  );
  assert.equal(archivedIcon.empty, false);
  assert.deepEqual(archivedIcon.size, { width: 24, height: 24 });
  const page = await desktop.firstWindow();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const capture = async (name) => {
    await page.waitForTimeout(300);
    const encoded = await desktop.evaluate(async ({ BrowserWindow }) => {
      // A hidden window can return its previous painted frame on the first capture.
      await BrowserWindow.getAllWindows()[0].capturePage(undefined, {
        stayHidden: true,
        stayAwake: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const image = await BrowserWindow.getAllWindows()[0].capturePage(undefined, {
        stayHidden: true,
        stayAwake: true,
      });
      return image.toPNG().toString('base64');
    });
    fs.writeFileSync(path.join(directory, name), Buffer.from(encoded, 'base64'));
  };
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('heading', { name: /Make yourself/ }).waitFor();
  assert.equal(await page.getByText('Personal Workspace', { exact: true }).count(), 0);
  await capture('chat-night.png');
  await page.getByRole('button', { name: 'Notebooks', exact: false }).first().click();
  await page.getByRole('heading', { name: 'Your thoughts, collected.' }).waitFor();
  await capture('notebooks-night.png');
  await page.getByRole('button', { name: 'Switch theme' }).click();
  await capture('notebooks-day.png');
  await page.getByRole('button', { name: 'The Linux notebook', exact: true }).click();
  await page.getByRole('button', { name: 'A place to begin', exact: false }).first().click();
  const editor = page.locator('.tiptap');
  await editor.waitFor();
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('# A live heading');
  await page.keyboard.press('Enter');
  await page.keyboard.type('A saved thought.');
  await page.waitForTimeout(1000);
  assert.ok((await page.locator('.save-state').innerText()).includes('Saved'));
  const snapshot = await page.evaluate(() => window.intelligence.bootstrap());
  assert.ok(
    snapshot.entities.some(
      (e) => e.kind === 'note' && e.data.content?.includes('A saved thought.'),
    ),
  );
  await page.getByRole('button', { name: /Ask Intelligence/ }).click();
  await capture('note-assistant-day.png');
  await page.evaluate(
    (endpoint) =>
      window.intelligence.settings({
        provider: 'ollama',
        endpoint,
        model: 'intelligence-test-model',
      }),
    'http://127.0.0.1:' + server.address().port,
  );
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message Intelligence', exact: true }).fill('Say hello');
  await page.getByRole('button', { name: 'Send message', exact: true }).first().click();
  await page
    .getByText('Your local connection is working. 🌿', { exact: true })
    .waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.getByRole('button', { name: 'Add a card', exact: false }).first().click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Name', { exact: true }).fill('Explore my audio setup');
  await form
    .getByLabel('Instructions', { exact: true })
    .fill('Inspect audio devices and record useful findings.');
  await form.getByRole('button', { name: 'Create card', exact: true }).click();
  await page.getByRole('heading', { name: 'Explore my audio setup', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Attach context', exact: false }).click();
  await page
    .getByRole('dialog')
    .getByLabel('Link to', { exact: true })
    .selectOption({ label: 'A place to begin · note' });
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  const tasks = await page.evaluate(() => window.intelligence.bootstrap());
  assert.ok(tasks.entities.find((e) => e.kind === 'card')?.data.links?.length);
  await page.getByRole('button', { name: 'Back to board', exact: false }).click();
  await capture('tasks-day.png');
  await page.getByRole('button', { name: 'Explore my audio setup', exact: false }).first().click();
  await page.getByLabel('Repeat', { exact: true }).selectOption('daily');
  const taskSnapshot = await page.evaluate(() => window.intelligence.bootstrap());
  const task = taskSnapshot.entities.find((e) => e.kind === 'card');
  await page.evaluate(
    (id) =>
      window.intelligence.mutate({
        id,
        data: {
          schedule: { start: '2026-01-01T09:00:00.000Z', repeat: 'daily' },
          status: 'review',
        },
      }),
    task.id,
  );
  await page.getByRole('button', { name: 'Mark complete', exact: true }).click();
  const complete = await page.evaluate(() => window.intelligence.bootstrap());
  const recurring = complete.entities.find((e) => e.id === task.id);
  assert.equal(recurring.data.status, 'queued');
  assert.ok(Date.parse(recurring.data.schedule.start) > Date.now());
  await page.reload();
  const reloaded = await page.evaluate(() => window.intelligence.bootstrap());
  assert.ok(
    reloaded.entities.some(
      (e) => e.kind === 'note' && e.data.content?.includes('A saved thought.'),
    ),
  );
  await page.getByRole('button', { name: 'Memory', exact: true }).click();
  const prepareMemory = page.getByRole('button', { name: 'Prepare model now', exact: false });
  if (await prepareMemory.isEnabled()) await prepareMemory.click();
  await page
    .getByText('Semantic + keyword search ready', { exact: true })
    .waitFor({ timeout: 60000 });
  const memories = await page.evaluate(() =>
    window.intelligence.memorySearch('Linux configuration files'),
  );
  assert.ok(memories.some((e) => e.kind === 'note'));
  const trashFixture = await page.evaluate(async () => {
    const snapshot = await window.intelligence.bootstrap();
    const notebook = snapshot.entities.find((e) => e.kind === 'notebook');
    const note = await window.intelligence.mutate({
      kind: 'note',
      parent: notebook.id,
      title: 'Trash note fixture',
      data: { content: 'Trash note text' },
    });
    const conversation = await window.intelligence.mutate({
      kind: 'conversation',
      title: 'Trash conversation fixture',
      data: {},
    });
    await new Promise((resolve, reject) => {
      const unsubscribe = window.intelligence.onEvent((event) => {
        if (event.conversation !== conversation.id) return;
        if (event.type === 'done' || event.type === 'error') {
          unsubscribe();
          event.type === 'done' ? resolve(null) : reject(new Error(event.error));
        }
      });
      window.intelligence
        .chat({ conversation: conversation.id, text: 'Fixture to delete', context: [] })
        .catch(reject);
    });
    await window.intelligence.mutate({ id: note.id, action: 'trash' });
    await window.intelligence.mutate({ id: conversation.id, action: 'trash' });
    return { note: note.id, conversation: conversation.id };
  });
  await page.getByRole('button', { name: /^Settings/ }).click();
  await page.getByRole('button', { name: 'Your data', exact: true }).click();
  await page.getByRole('button', { name: 'Open Trash', exact: false }).click();
  let trashDialog = page.getByRole('dialog', { name: 'Trash', exact: true });
  await trashDialog
    .getByRole('button', { name: 'Restore Trash note fixture', exact: true })
    .waitFor();
  await capture('trash-day.png');
  await trashDialog
    .getByRole('button', { name: 'Delete permanently Trash conversation fixture', exact: true })
    .click();
  let confirmation = page.getByRole('dialog', { name: 'Delete permanently?', exact: true });
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.ok(
    (await page.evaluate(() => window.intelligence.trash())).some(
      (e) => e.id === trashFixture.conversation,
    ),
  );
  await trashDialog
    .getByRole('button', { name: 'Restore Trash note fixture', exact: true })
    .click();
  await trashDialog
    .getByRole('button', { name: 'Restore Trash note fixture', exact: true })
    .waitFor({ state: 'hidden' });
  assert.ok(
    (await page.evaluate(() => window.intelligence.bootstrap())).entities.some(
      (e) => e.id === trashFixture.note,
    ),
  );
  await trashDialog
    .getByRole('button', { name: 'Delete permanently Trash conversation fixture', exact: true })
    .click();
  await confirmation.getByRole('button', { name: 'Delete permanently', exact: true }).waitFor();
  await capture('trash-confirm-day.png');
  await confirmation.getByRole('button', { name: 'Delete permanently', exact: true }).click();
  await trashDialog.getByText('Trash is empty.', { exact: true }).waitFor();
  assert.equal(
    (await page.evaluate((id) => window.intelligence.messages(id), trashFixture.conversation))
      .length,
    0,
  );
  assert.ok(
    !(await page.evaluate(() => window.intelligence.bootstrap())).entities.some(
      (e) => e.id === trashFixture.conversation,
    ),
  );
  await capture('trash-empty-day.png');
  await trashDialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.keyboard.press('Escape');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(
    JSON.stringify({
      result: 'passed',
      directory,
      checks: [
        'Trash opens, restores, cancels deletion, and permanently deletes conversation messages',
        'archived tray icon decodes at 24px',
        'Electron preload + SQLite',
        'no redundant workspace label',
        'night/day notebook views',
        'live Markdown + autosave',
        'contextual assistant',
        'real streaming adapter with local fixture server',
        'task creation + note links',
        'recurring task completion',
        'CPU semantic search inside Electron',
        'persistence after reload',
        'no renderer runtime errors',
      ],
    }),
  );
} finally {
  await desktop?.close();
  await new Promise((r) => server.close(r));
}
