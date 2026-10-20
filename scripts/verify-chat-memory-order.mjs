import { pickChoice } from './ui-pickers.mjs';
import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { Store } from '../electron/store.mjs';
import { ensureProfiles } from '../electron/profiles.mjs';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify({
      models: [{ name: 'fixture-one' }, { name: 'fixture-two-with-a-long-model-name' }],
    }),
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const directory = path.resolve('.test-data/chat-memory-order-' + Date.now()),
  data = path.join(directory, 'data');
const store = new Store(data);
store.setSettings({
  onboardingComplete: true,
  semanticSearch: false,
  autoConsolidation: true,
  backgroundPaused: true,
  theme: 'day',
  model: 'fixture-one',
  endpoint: 'http://127.0.0.1:' + server.address().port,
  optionalModules: {
    tts: { enabled: true, adapter: 'compatible' },
    stt: { enabled: true, adapter: 'compatible' },
  },
});
ensureProfiles(store);
const conversation = store.mutate({ kind: 'conversation', title: 'Linux and writing preferences' });
const user = store.message(
  conversation.id,
  'user',
  'I use CachyOS. Please preserve my Romanian notes and show compact microphone controls.',
);
const assistant = store.message(
  conversation.id,
  'assistant',
  'I will preserve the Romanian notes and keep the chat controls compact.',
);
store.commitConsolidation(
  conversation.id,
  user.id + ':0',
  'A brief factual summary of the provided conversation excerpts.',
  [],
  [user.id, assistant.id],
  [],
);
store.commitConsolidation(
  conversation.id,
  assistant.id + ':0',
  'The user uses CachyOS and requested compact microphone controls while preserving Romanian notes.',
  [
    {
      key: 'user.os',
      content: 'The user uses CachyOS.',
      evidence: 'I use CachyOS.',
      messageIds: [user.id],
    },
  ],
  [user.id, assistant.id],
  [],
);
store.mutate({
  kind: 'memory',
  title: 'Writing preference',
  data: { content: 'Keep examples in Romanian.', origin: 'user' },
});
const board = store.all().find((e) => e.kind === 'board'),
  lists = store.children(board.id);
const card = store.mutate({
  kind: 'card',
  parent: lists[0].id,
  title: 'Preserve this task',
  data: { content: 'User-authored task text — Știință' },
});
store.close();
const env = {
  ...process.env,
  INTELLIGENCE_TEST: '1',
  INTELLIGENCE_DATA_DIR: data,
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
const captures = [];
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
    await page.waitForTimeout(150);
  };
  const shot = async (name) => {
    await page.mouse.move(900, 20);
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
    captures.push(name);
  };
  const nav = async (name) => {
    await page.locator('.sidebar').getByRole('button', { name, exact: true }).click();
  };
  const checkControls = async (surface) => {
    assert.deepEqual(
      await surface
        .locator('.composer-tools')
        .evaluate((el) => [...el.children].map((node) => node.getAttribute('aria-label'))),
      [
        'Choose model',
        'Add sources',
        'Show thinking',
        'Automatically read replies aloud',
        'Dictate',
        'Command approvals',
      ],
    );
    for (const button of await surface.locator('.composer-tools > button').all()) {
      const box = await button.boundingBox();
      assert.equal(box.width, 32);
      assert.equal(box.height, 32);
    }
    assert.equal(await surface.locator('.dictate-button .symbol-icon').count(), 1);
    assert.equal(await surface.locator('.dictate-button').textContent(), '');
    const box = await surface.locator('.composer').boundingBox();
    for (const control of await surface.locator('.composer-tools > *').all()) {
      const c = await control.boundingBox();
      assert.ok(c.x >= box.x && c.x + c.width <= box.x + box.width + 1);
    }
  };
  await resize(1920, 1080);
  await app.evaluate(
    ({ BrowserWindow }, id) =>
      BrowserWindow.getAllWindows()[0].webContents.send('intelligence:event', {
        type: 'navigate',
        id,
      }),
    conversation.id,
  );
  const main = page.locator('.chat-surface:not(.compact)');
  await main
    .getByText('I will preserve the Romanian notes and keep the chat controls compact.', {
      exact: true,
    })
    .waitFor();
  await checkControls(main);
  await pickChoice(page, 'Choose model', 'fixture-two-with-a-long-model-name', main);
  await page.waitForFunction(
    (id) =>
      window.intelligence
        .bootstrap()
        .then(
          (s) =>
            s.entities.find((e) => e.id === id).data.branchModel ===
            'fixture-two-with-a-long-model-name',
        ),
    conversation.id,
  );
  await main.getByLabel('Command approvals').selectOption('auto');
  await page.waitForFunction(() =>
    window.intelligence.bootstrap().then((s) => s.settings.approvalMode === 'auto'),
  );
  await main.getByRole('button', { name: 'Show thinking', exact: true }).click();
  await shot('chat-1920');
  await page.locator('.assistant-toggle').click();
  const panel = page.locator('.assistant-pane .chat-surface');
  await checkControls(panel);
  await shot('chat-and-panel-1920');
  await page.getByLabel('Close assistant').click();
  await nav('Tasks');
  const order = () =>
    page.locator('[data-list-id]').evaluateAll((nodes) => nodes.map((node) => node.dataset.listId));
  assert.deepEqual(
    await order(),
    lists.map((list) => list.id),
  );
  await page
    .locator('.list-drag-handle')
    .nth(2)
    .dragTo(page.locator('[data-list-id]').first(), { targetPosition: { x: 20, y: 18 } });
  await page.waitForFunction(
    (id) => document.querySelector('[data-list-id]')?.dataset.listId === id,
    lists[2].id,
  );
  assert.deepEqual(await order(), [lists[2].id, lists[0].id, lists[1].id]);
  await page.locator('[data-list-id]').first().locator('summary').click();
  await page.getByRole('button', { name: 'Move list right', exact: true }).click();
  await page.waitForFunction(
    (id) => document.querySelector('[data-list-id]')?.dataset.listId === id,
    lists[0].id,
  );
  const target = page.locator(`[data-list-id="${lists[1].id}"]`);
  await page
    .getByRole('button', { name: /Preserve this task/ })
    .dragTo(target, { targetPosition: { x: 100, y: 120 } });
  await page.waitForFunction(
    (ids) =>
      window.intelligence
        .bootstrap()
        .then((s) => s.entities.find((e) => e.id === ids[0]).parent === ids[1]),
    [card.id, lists[1].id],
  );
  await shot('board-1920');
  const durableOrder = await order();
  await page.reload();
  await page.locator('.sidebar').waitFor();
  await nav('Tasks');
  assert.deepEqual(await order(), durableOrder);
  await nav('Memory');
  const generic = page
    .locator('.memory-list article')
    .filter({ hasText: 'A brief factual summary' });
  await generic.getByText('Stored details & sources', { exact: true }).click();
  await generic
    .getByText(
      'I use CachyOS. Please preserve my Romanian notes and show compact microphone controls.',
      { exact: true },
    )
    .waitFor();
  assert.match(await generic.textContent(), /no specific details/);
  assert.equal(
    await page
      .locator('.memory-overview strong')
      .allTextContents()
      .then((values) => values.join(',')),
    '2,2,0',
  );
  await shot('memory-details-1920');
  await page.getByLabel('Search memories').fill('CachyOS');
  await page.locator('.memory-search').getByRole('button', { name: 'Search', exact: true }).click();
  await page.waitForTimeout(200);
  assert.ok((await page.locator('.memory-list article').count()) > 0);
  await page.locator('.memory-search').getByRole('button', { name: 'Clear', exact: true }).click();
  for (const theme of [
    'ink',
    'day',
    'night',
    'summer',
    'autumn',
    'winter',
    'festive',
    'tech',
    'astral',
    'marble',
  ]) {
    await page.evaluate((theme) => window.intelligence.settings({ theme }), theme);
    await shot('memory-' + theme);
  }
  for (const [w, h] of [
    [2560, 1440],
    [3440, 1440],
    [1366, 768],
  ]) {
    await resize(w, h);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await shot(`memory-${w}`);
    await nav('Chat');
    await page.locator('.assistant-toggle').click();
    await checkControls(page.locator('.assistant-pane .chat-surface'));
    await shot(`chat-panel-${w}`);
    await page.getByLabel('Close assistant').click();
    await nav('Memory');
  }
  await resize(1920, 1080);
  await page.evaluate(() => window.intelligence.settings({ language: 'ro' }));
  await page.getByText('Rezumate ale conversațiilor', { exact: true }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await shot('memory-romanian');
  await nav('Conversații');
  await page.getByLabel('Alege modelul').waitFor();
  await shot('chat-romanian');
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        directory,
        captures,
        checks: [
          'shared control order, dimensions, native model/approval changes',
          'list drag, keyboard menu, card move and reload persistence',
          'real stored memory, source excerpts, legacy generic hint, counts',
          'ten themes, three responsive sizes, Romanian',
          'no renderer errors',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await app?.close();
  await new Promise((resolve) => server.close(resolve));
}
