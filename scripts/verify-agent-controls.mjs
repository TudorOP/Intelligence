import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { Store } from '../electron/store.mjs';
import { ensureProfiles } from '../electron/profiles.mjs';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { pickValue } from './ui-pickers.mjs';

const pending = [];
const requests = [];
const server = http.createServer((req, res) => {
  if (req.method === 'GET') {
    res.end(JSON.stringify({ data: [{ id: 'shared-model' }, { id: 'other-model' }] }));
    return;
  }
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    requests.push(JSON.parse(body));
    pending.push(res);
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const directory = path.resolve('.test-data/agent-controls-' + Date.now());
const store = new Store(path.join(directory, 'data'));
const endpoint = 'http://127.0.0.1:' + server.address().port + '/v1';
store.setSettings({
  provider: 'lmstudio',
  endpoint,
  model: 'shared-model',
  theme: 'day',
  onboardingComplete: true,
  semanticSearch: false,
  autoConsolidation: false,
  autoCompact: false,
  backgroundPaused: true,
});
store.setSettings({ provider: 'llamacpp', endpoint, model: 'shared-model' });
store.setSettings({ provider: 'lmstudio' });
ensureProfiles(store);
const board = store.all().find((e) => e.kind === 'board');
const list = store.children(board.id)[0];
const card = store.mutate({
  kind: 'card',
  parent: list.id,
  title: 'Contextual controls',
  data: { content: 'Conținut păstrat — Știință', assigned: true },
});
store.close();
const env = {
  ...process.env,
  INTELLIGENCE_TEST: '1',
  INTELLIGENCE_DATA_DIR: path.join(directory, 'data'),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.INTELLIGENCE_DEV_URL;
let app;
const captures = [];
const reply = (text) => {
  const response = pending.shift();
  assert.ok(response);
  response.setHeader('Content-Type', 'text/event-stream');
  response.end(
    'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\ndata: [DONE]\n',
  );
};
try {
  app = await electron.launch({ executablePath: electronPath, args: ['.', '--disable-gpu'], env });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.locator('.sidebar').waitFor();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const resize = async (width, height) => {
    await app.evaluate(
      ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size),
      [width, height],
    );
    await page.waitForTimeout(100);
  };
  const shot = async (name) => {
    await page.mouse.move(900, 20);
    await app.evaluate(async ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].capturePage(undefined, {
        stayHidden: true,
        stayAwake: true,
      }),
    );
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
    captures.push(name);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  };
  const nav = (name) => page.locator('.sidebar').getByRole('button', { name, exact: true }).click();
  await resize(1920, 1080);
  await nav('Tasks');
  await page
    .getByRole('button', { name: /Contextual controls/ })
    .first()
    .click();
  await page.locator('.task-actions').waitFor();
  await shot('task-agent-1080');
  await page.evaluate(
    (id) => window.intelligence.mutate({ id, data: { access: false } }),
    board.id,
  );
  await page.locator('.task-actions').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.task-agent-report').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Choose agent', exact: true }).count(), 0);
  assert.equal(
    await page.getByPlaceholder('What should be done?').inputValue(),
    'Conținut păstrat — Știință',
  );
  await shot('task-manual-1080');
  await page.evaluate((id) => window.intelligence.mutate({ id, data: { access: true } }), card.id);
  await page.locator('.task-actions').waitFor();
  await page.evaluate(() => window.intelligence.settings({ kanbanAccess: false }));
  await page.locator('.task-actions').waitFor({ state: 'detached' });
  await page.evaluate(() => window.intelligence.settings({ kanbanAccess: true }));
  await page.locator('.task-actions').waitFor();

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .locator('.settings-navigation')
    .getByRole('button', { name: 'Model & providers', exact: true })
    .click();
  await page.locator('.connected-providers > summary').click();
  assert.equal(await page.locator('.provider-connection-row').count(), 3);
  await page.getByLabel('Tool-step limit per response').fill('30');
  await page.getByLabel('Tool-step limit per response').blur();
  await page.waitForFunction(
    async () => (await window.intelligence.bootstrap()).settings.toolStepLimit === 30,
  );
  await shot('providers-1080');
  await resize(1366, 768);
  await page.getByLabel('Inference provider', { exact: true }).selectOption('openrouter');
  await shot('providers-short');
  await page.getByLabel('Inference provider', { exact: true }).selectOption('lmstudio');
  await page.keyboard.press('Escape');
  await nav('Chat');
  const mainChat = page.locator('.chat-surface:not(.compact)');
  await mainChat.getByRole('button', { name: 'Choose model', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.search-picker-panel .picker-group').length === 4,
  );
  await page.keyboard.press('Escape');
  await pickValue(page, 'Choose model', JSON.stringify(['llamacpp', 'shared-model']), mainChat);
  await page.waitForFunction(
    async () => (await window.intelligence.bootstrap()).settings.provider === 'llamacpp',
  );
  const composer = page.getByRole('textbox', { name: 'Message Intelligence', exact: true });
  await composer.fill('Start the work.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByRole('button', { name: 'Steer response', exact: true }).waitFor();
  await composer.fill('Use the Romanian document.');
  await page.getByRole('button', { name: 'Steer response', exact: true }).click();
  await page
    .getByText('Correction pending · delivered after the current model or tool step.', {
      exact: true,
    })
    .waitFor();
  await shot('steering-short');
  reply('Initial response.');
  await page.waitForTimeout(200);
  assert.equal(requests.at(-1).messages.at(-1).content, 'Use the Romanian document.');
  reply('Applied the correction.');
  await page.getByText('Applied the correction.', { exact: true }).waitFor();
  await page
    .getByRole('button', { name: 'Steer response', exact: true })
    .waitFor({ state: 'detached' });
  const snapshot = await page.evaluate(() => window.intelligence.bootstrap());
  const conversation = snapshot.entities.find(
    (e) => e.kind === 'conversation' && !e.data.temporary,
  );
  await pickValue(page, 'Choose model', JSON.stringify(['lmstudio', 'other-model']), mainChat);
  await page.waitForFunction(
    async (id) =>
      (await window.intelligence.bootstrap()).entities.find((e) => e.id === id)?.data
        .branchProvider === 'lmstudio',
    conversation.id,
  );
  await page.evaluate(() =>
    window.intelligence.inferenceKey({ action: 'disconnect', provider: 'llamacpp' }),
  );
  await mainChat.getByRole('button', { name: 'Choose model', exact: true }).click();
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('.search-picker-panel .picker-group')].some(
        (e) => e.textContent === 'llama.cpp',
      ),
  );
  await page.keyboard.press('Escape');
  await page.reload();
  await page.locator('.sidebar').waitFor();
  const restored = await page.evaluate(() => window.intelligence.bootstrap());
  assert.equal(restored.settings.toolStepLimit, 30);
  assert.ok(!restored.settings.connectedProviders.includes('llamacpp'));
  assert.equal(
    restored.entities.find((e) => e.id === conversation.id).data.branchProvider,
    'lmstudio',
  );
  await page.evaluate(() =>
    window.intelligence.workspace({
      action: 'active-model',
      provider: 'lmstudio',
      model: 'shared-model',
    }),
  );

  await nav('Tasks');
  await page
    .getByRole('button', { name: /Contextual controls/ })
    .first()
    .click();
  await page
    .getByRole('button', { name: /Ask Intelligence/ })
    .first()
    .click();
  const panel = page.locator('.chat-surface.compact');
  await panel
    .getByRole('textbox', { name: 'Message contextual assistant' })
    .fill('Help with this card.');
  await panel.getByRole('button', { name: 'Send message', exact: true }).click();
  await panel.getByRole('button', { name: 'Steer response', exact: true }).waitFor();
  await panel
    .getByRole('textbox', { name: 'Message contextual assistant' })
    .fill('Keep the original wording.');
  await panel.getByRole('textbox', { name: 'Message contextual assistant' }).press('Enter');
  await panel
    .getByText('Correction pending · delivered after the current model or tool step.', {
      exact: true,
    })
    .waitFor();
  await resize(1920, 1080);
  await shot('panel-steering-1080');
  reply('Working on the card.');
  await page.waitForTimeout(200);
  assert.equal(requests.at(-1).messages.at(-1).content, 'Keep the original wording.');
  reply('Original wording preserved.');
  await panel.getByText('Original wording preserved.', { exact: true }).waitFor();
  for (const [width, height] of [
    [2560, 1440],
    [3440, 1440],
  ]) {
    await resize(width, height);
    await shot('panel-' + width);
  }
  await page.evaluate(() => window.intelligence.settings({ language: 'ro' }));
  await shot('panel-ro');
  assert.equal(await panel.getByRole('button', { name: 'Send message', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Setări', exact: true }).click();
  await page
    .locator('.settings-navigation')
    .getByRole('button', { name: 'Model și furnizori', exact: true })
    .click();
  await resize(1920, 1080);
  await shot('providers-ro-1080');
  await page.keyboard.press('Escape');
  await panel.locator('textarea').fill('A final request for the disconnect check.');
  await panel.locator('textarea').press('Enter');
  await page.waitForTimeout(250);
  await shot('disconnect-running-ro');
  await panel.getByRole('button', { name: 'Ghidează răspunsul', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Setări', exact: true }).click();
  await page
    .locator('.settings-navigation')
    .getByRole('button', { name: 'Model și furnizori', exact: true })
    .click();
  await page.locator('.connected-providers > summary').click();
  await page
    .locator('.provider-connection-row')
    .filter({ hasText: 'LM Studio' })
    .getByRole('button', { name: 'Deconectează', exact: true })
    .click();
  await page.waitForFunction(async () => {
    const snapshot = await window.intelligence.bootstrap();
    return (
      !snapshot.settings.connectedProviders.includes('lmstudio') &&
      !snapshot.activeConversations.length
    );
  });
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(JSON.stringify({ directory, captures, requests: requests.length, errors }, null, 2));
} finally {
  for (const response of pending) response.destroy();
  await app?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
