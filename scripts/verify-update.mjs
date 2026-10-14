import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { createServer } from 'node:http';
import { Store } from '../electron/store.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const directory = path.resolve('.test-data/update-' + Date.now());
const server = createServer(async (req, res) => {
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify(
        req.url === '/api/v1/models'
          ? {
              models: [
                {
                  key: 'model-a',
                  loaded_instances: [{ id: 'model-a', config: { context_length: 8192 } }],
                  max_context_length: 131072,
                },
              ],
            }
          : { data: ['model-a', 'model-b', 'model-c'].map((id) => ({ id })) },
      ),
    );
    return;
  }
  let text = '';
  for await (const bytes of req) text += bytes;
  const body = JSON.parse(text),
    summary = body.messages[0]?.content?.startsWith('Summarize historical');
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write(
    'data: ' +
      JSON.stringify({
        choices: [{ delta: { reasoning_content: 'Visible model reasoning fixture.' } }],
      }) +
      '\n\n',
  );
  res.write(
    'data: ' +
      JSON.stringify({
        choices: [
          {
            delta: {
              content: summary
                ? 'Historical summary retaining the user requests.'
                : 'A copied reply from the selected model.',
            },
          },
        ],
      }) +
      '\n\n',
  );
  res.end(
    'data: ' +
      JSON.stringify({ choices: [], usage: { prompt_tokens: 500, completion_tokens: 12 } }) +
      '\n\ndata: [DONE]\n\n',
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const store = new Store(directory);
store.setSettings({
  provider: 'lmstudio',
  endpoint: 'http://127.0.0.1:' + server.address().port,
  model: 'model-a',
  semanticSearch: false,
  autoConsolidation: false,
  autoCompact: false,
  showThinking: true,
});
const c = store.mutate({ kind: 'conversation', title: 'Compaction chat' });
for (let i = 0; i < 5; i++) {
  store.message(c.id, 'user', 'Old user turn ' + i + ' ' + 'A past discussion. '.repeat(90));
  store.message(c.id, 'assistant', 'Old answer ' + i);
}
const board = store.all().find((e) => e.kind === 'board'),
  list = store.children(board.id)[0];
const card = store.mutate({
  kind: 'card',
  parent: list.id,
  title: 'Menu test card',
  data: { content: 'An editable brief' },
});
store.close();
const env = { ...process.env, INTELLIGENCE_TEST: '1', INTELLIGENCE_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
delete env.INTELLIGENCE_DEV_URL;
const app = await electron.launch({
  executablePath: electronPath,
  args: ['.', '--disable-gpu'],
  env,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('heading', { name: /Make yourself/ }).waitFor();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const resize = async (w, h) =>
    app.evaluate(
      ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size),
      [w, h],
    );
  const capture = async (name) => {
    await app.evaluate(async ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].capturePage(undefined, {
        stayHidden: true,
        stayAwake: true,
      }),
    );
    await page.waitForTimeout(100);
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
  await page.locator('.sidebar-utilities button').filter({ hasText: 'Settings' }).click();
  await page.getByRole('button', { name: 'Look & feel', exact: true }).click();
  const before = await page
    .getByRole('button', { name: 'Close settings', exact: true })
    .boundingBox();
  await page.locator('.settings-content').evaluate((e) => (e.scrollTop = e.scrollHeight));
  const after = await page
    .getByRole('button', { name: 'Close settings', exact: true })
    .boundingBox();
  assert.equal(Math.round(before.y), Math.round(after.y));
  await page.locator('.settings-content').evaluate((e) => (e.scrollTop = 0));
  assert.equal(
    await page
      .locator('.theme-options .theme-banner')
      .evaluateAll((elements) =>
        elements.every(
          (e) =>
            getComputedStyle(e).backgroundSize === 'cover' &&
            !getComputedStyle(e).backgroundImage.includes('theme-day.webp'),
        ),
      ),
    true,
  );
  await capture('settings-preview');
  await page.getByRole('button', { name: 'Model & providers', exact: true }).click();
  await page.getByRole('button', { name: /Test connection/ }).click();
  assert.equal(await page.getByLabel('Selected model').locator('option').count(), 4);
  await page.getByLabel('Selected model').selectOption('model-b');
  assert.equal(await page.getByLabel('Selected model').locator('option').count(), 4);
  await page.getByLabel('Selected model').selectOption('model-a');
  await page.getByRole('button', { name: 'Chat & context', exact: true }).click();
  await page.getByLabel('Chat width').selectOption('wide');
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.getByRole('button', { name: 'Recent conversations', exact: true }).click();
  await page
    .locator('.conversation-library-row')
    .filter({ hasText: 'Compaction chat' })
    .locator('button')
    .first()
    .click();
  assert.ok((await page.locator('.compose-wrap').boundingBox()).width > 1300);
  await page.getByLabel('Choose model').selectOption('model-b');
  await page.getByLabel('Choose model').selectOption('model-a');
  await page.getByRole('button', { name: 'Compact context', exact: true }).click();
  await page.getByRole('button', { name: 'Compact context', exact: true }).waitFor();
  assert.ok(
    (
      await page.evaluate(
        (id) =>
          window.intelligence
            .bootstrap()
            .then((s) => s.entities.find((e) => e.id === id).data.compaction),
        c.id,
      )
    ).summary,
  );
  await page.getByLabel('Message Intelligence').fill('A short reply please');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByText('A copied reply from the selected model.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Copy message' }).last().click();
  assert.equal(
    await app.evaluate(({ clipboard }) => clipboard.readText()),
    'A copied reply from the selected model.',
  );
  assert.ok(await page.getByText('Thinking', { exact: true }).count());
  await page.getByRole('button', { name: 'Show thinking', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.model-thinking').length === 0);
  await page.getByLabel('Command approvals').selectOption('auto');
  assert.equal(
    (await page.evaluate(() => window.intelligence.bootstrap())).settings.approvalMode,
    'auto',
  );
  await capture('wide-chat');
  // Approval arrival must follow the latest item, independent of previous near-bottom geometry.
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows()[0].webContents.send('intelligence:event', {
      type: 'approval',
      id: 'follow-fixture',
      conversation: id,
      summary: 'Fixture approval',
      details: 'Read-only fixture\n'.repeat(25),
    });
  }, c.id);
  await page.getByText('Fixture approval', { exact: true }).waitFor();
  assert.ok(
    await page
      .locator('.chat-scroll')
      .evaluate((e) => e.scrollHeight - e.scrollTop - e.clientHeight < 3),
    'Approval broke follow latest',
  );
  await page.evaluate(() => window.intelligence.settings({ followLatest: false }));
  await page.waitForTimeout(120);
  await page.locator('.chat-scroll').evaluate((e) => (e.scrollTop = 0));
  await app.evaluate(
    ({ BrowserWindow }, id) =>
      BrowserWindow.getAllWindows()[0].webContents.send('intelligence:event', {
        type: 'approval',
        id: 'off-fixture',
        conversation: id,
        summary: 'Another fixture approval',
        details: 'Read-only fixture',
      }),
    c.id,
  );
  await page.getByText('Another fixture approval', { exact: true }).waitFor();
  assert.equal(await page.locator('.chat-scroll').evaluate((e) => e.scrollTop), 0);
  await app.evaluate(({ BrowserWindow }) => {
    for (const id of ['follow-fixture', 'off-fixture'])
      BrowserWindow.getAllWindows()[0].webContents.send('intelligence:event', {
        type: 'approval-resolved',
        id,
      });
  });
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.getByRole('button', { name: 'Menu test card', exact: false }).click();
  await page.getByLabel('More options').last().click();
  const bounds = await page.locator('.floating-actions').boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 1920);
  await capture('card-menu');
  await page.keyboard.press('Escape');
  await page.locator('.card-status').click({ button: 'right' });
  await page.locator('.floating-actions').waitFor();
  assert.ok(
    await page
      .locator('.floating-actions')
      .getByRole('button', { name: 'Move to Trash', exact: true })
      .count(),
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Chat', exact: true }).first().click();
  await page.getByRole('button', { name: 'Recent conversations', exact: true }).click();
  await page
    .locator('.conversation-library-row')
    .filter({ hasText: 'Compaction chat' })
    .locator('summary')
    .click();
  await page
    .locator('.floating-actions')
    .getByRole('button', { name: 'Move to Trash', exact: true })
    .click();
  await page.waitForFunction(
    () =>
      !document
        .querySelector('.conversation-library-list')
        ?.textContent.includes('Compaction chat'),
    c.id,
  );
  await page
    .getByRole('dialog', { name: 'Recent conversations' })
    .getByRole('button', { name: 'Close', exact: true })
    .first()
    .click();
  for (const [w, h] of [
    [1366, 768],
    [2560, 1440],
  ]) {
    await resize(w, h);
    await page.locator('.sidebar nav button').nth(8).click();
    await page.locator('.machine-resource-layout').waitFor();
    assert.ok(
      await page.locator('.main-canvas').evaluate((e) => e.scrollWidth <= e.clientWidth + 2),
    );
    await capture(w + '-machine');
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      result: 'passed',
      directory,
      checks: [
        'stationary Settings close',
        'unstretched theme preview crops',
        'complete model choices',
        'wide chat',
        'manual compaction preserves originals',
        'native clipboard',
        'thinking toggle',
        'approval mode persistence',
        'viewport-safe and right-click card menus',
        'direct conversation Trash',
        'responsive machine resources',
      ],
    }),
  );
} finally {
  await app.close();
  await new Promise((resolve) => server.close(resolve));
}
