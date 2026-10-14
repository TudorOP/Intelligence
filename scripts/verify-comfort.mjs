import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { createServer } from 'node:http';
import { Store } from '../electron/store.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const directory = path.resolve('.test-data/comfort-' + Date.now());
const modelNames = [
  'Local model with several words and a very long descriptive name / version Q4',
  'Second detailed model name with spaces',
  'Third model',
];
const server = createServer(async (req, res) => {
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify(
        req.url === '/api/v1/models'
          ? {
              models: [
                {
                  key: modelNames[0],
                  loaded_instances: [{ id: modelNames[0], config: { context_length: 32768 } }],
                },
              ],
            }
          : { data: modelNames.map((id) => ({ id })) },
      ),
    );
    return;
  }
  for await (const _ of req) {
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write(
    'data: ' +
      JSON.stringify({
        choices: [
          {
            delta: {
              reasoning_content:
                'Live reasoning which must use the same width as the final answer. '.repeat(10),
            },
          },
        ],
      }) +
      '\n\n',
  );
  await new Promise((resolve) => setTimeout(resolve, 1800));
  res.write(
    'data: ' +
      JSON.stringify({
        choices: [
          { delta: { content: 'The final response follows Thinking and shares its width.' } },
        ],
      }) +
      '\n\n',
  );
  res.end(
    'data: ' +
      JSON.stringify({ choices: [], usage: { prompt_tokens: 1600, completion_tokens: 30 } }) +
      '\n\ndata: [DONE]\n\n',
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const store = new Store(directory);
store.setSettings({
  provider: 'lmstudio',
  endpoint: 'http://127.0.0.1:' + server.address().port,
  model: modelNames[0],
  semanticSearch: false,
  autoConsolidation: false,
  autoCompact: false,
  showThinking: true,
});
const conversation = store.mutate({ kind: 'conversation', title: 'Layout validation' });
const board = store.all().find((e) => e.kind === 'board'),
  list = store.children(board.id)[0];
store.mutate({
  kind: 'card',
  parent: list.id,
  title: 'Right click task',
  data: { content: 'A task card on the board' },
});
store.mutate({
  kind: 'project',
  title: 'First project',
  data: { directory: '/tmp/fixture-project', access: true },
});
const env = { ...process.env, INTELLIGENCE_TEST: '1', INTELLIGENCE_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
// Preserve an explicitly selected dev preview; otherwise use the built interface.
store.close();
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
  const resize = async (w, h) =>
    app.evaluate(
      ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size),
      [w, h],
    );
  const aligned = async (selectors) => {
    const rects = await page.evaluate(
      (selectors) =>
        selectors.map((selector) => {
          const e = document.querySelector(selector),
            r = e.getBoundingClientRect();
          return { selector, left: r.left, width: r.width };
        }),
      selectors,
    );
    for (const rect of rects)
      assert.ok(
        Math.abs(rect.left - rects[0].left) < 3 && Math.abs(rect.width - rects[0].width) < 3,
        JSON.stringify(rects),
      );
    return rects;
  };
  await resize(1920, 1080);
  await page.getByRole('button', { name: 'Recent conversations', exact: true }).click();
  await page
    .locator('.conversation-library-row>button:first-child')
    .filter({ hasText: 'Layout validation' })
    .click();
  for (const width of ['comfortable', 'wide']) {
    await page.evaluate((width) => window.intelligence.settings({ chatWidth: width }), width);
    await page.waitForTimeout(100);
    await page.getByLabel('Message Intelligence').fill('Check ' + width + ' alignment');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.locator('.chat-scroll > .model-thinking').waitFor();
    await aligned([
      '.chat-scroll > .message.user:last-of-type',
      '.chat-scroll > .model-thinking',
      '.composer',
    ]);
    await capture(width + '-live');
    await page
      .getByRole('button', { name: 'Stop response', exact: true })
      .waitFor({ state: 'hidden' });
    const thinking = page.locator('.message.assistant').last().locator('.model-thinking');
    await thinking.locator('.thinking-toggle').click();
    await aligned([
      '.chat-scroll > .message.assistant:last-of-type',
      '.chat-scroll > .message.assistant:last-of-type .model-thinking',
      '.composer',
    ]);
    assert.ok(
      await page
        .locator('.message.assistant')
        .last()
        .evaluate(
          (e) =>
            e.querySelector('.model-thinking').compareDocumentPosition(e.querySelector('p')) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ),
    );
    assert.equal(await page.getByText('Loaded window', { exact: false }).count(), 0);
    await page.locator('.context-meter').hover();
    await page.getByRole('tooltip').waitFor();
    assert.match(await page.getByRole('tooltip').innerText(), /1,630 \/ 32,768/);
    await page.mouse.move(0, 0);
    await capture(width + '-saved');
  }
  const modelSelect = page.getByLabel('Choose model');
  await page.waitForFunction(
    () => document.querySelector('.chat-model-select')?.querySelectorAll('option').length >= 5,
  );
  assert.equal(await modelSelect.locator('option').filter({ hasText: modelNames[1] }).count(), 1);
  const modelBounds = await modelSelect.boundingBox();
  assert.ok(modelBounds.width <= 240);
  assert.ok(
    modelBounds.x + modelBounds.width <= 1920 && modelBounds.y + modelBounds.height <= 1080,
  );
  await capture('model-selector');
  await modelSelect.selectOption(
    await modelSelect.locator('option').filter({ hasText: modelNames[1] }).getAttribute('value'),
  );
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.getByRole('button', { name: /Right click task/ }).click({ button: 'right' });
  await page
    .locator('.floating-actions')
    .getByRole('button', { name: 'Rename', exact: true })
    .waitFor();
  await capture('task-right-click');
  await page.keyboard.press('Escape');
  await page.locator('.kanban-list header').first().click({ button: 'right' });
  await page
    .locator('.floating-actions')
    .getByRole('button', { name: 'Rename', exact: true })
    .waitFor();
  assert.equal(await page.locator('.floating-actions').count(), 1);
  await page.keyboard.press('Escape');
  await page
    .locator('.tasks-page > .overview-heading')
    .click({ button: 'right', position: { x: 120, y: 20 } });
  await page
    .locator('.floating-actions')
    .getByRole('button', { name: 'Rename', exact: true })
    .waitFor();
  assert.equal(await page.locator('.floating-actions').count(), 1);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  assert.ok((await page.locator('.projects-page .resource-card').boundingBox()).width < 500);
  await capture('project-grid');
  await page.getByRole('button', { name: 'Skills', exact: true }).click();
  assert.ok((await page.locator('.skills-page .resource-card').first().boundingBox()).width < 420);
  const positions = await page.getByLabel('Skills view').boundingBox(),
    newSkill = await page.getByRole('button', { name: '＋ New skill', exact: true }).boundingBox();
  assert.ok(positions.x < newSkill.x);
  await capture('skills-cards');
  await page.getByLabel('Skills view').selectOption('list');
  await page.locator('.resource-list').waitFor();
  assert.ok((await page.locator('.skills-page .resource-card').first().boundingBox()).height < 120);
  await capture('skills-list');
  await page.getByRole('button', { name: 'Notebooks', exact: true }).click();
  await page.getByRole('button', { name: 'The Linux notebook', exact: true }).click();
  await page.getByRole('button', { name: 'A place to begin', exact: false }).first().click();
  assert.ok((await page.locator('.note-prose').boundingBox()).width > 1100);
  await capture('wide-notes');
  await page.getByRole('button', { name: /Ask Intelligence/ }).click();
  await page.getByLabel('Message contextual assistant').fill('Check contextual alignment');
  await page
    .locator('.assistant-pane')
    .getByRole('button', { name: 'Send message', exact: true })
    .click();
  await page.locator('.assistant-pane .chat-scroll > .model-thinking').waitFor();
  await aligned(['.assistant-pane .chat-scroll > .model-thinking', '.assistant-pane .composer']);
  await page
    .locator('.assistant-pane')
    .getByRole('button', { name: 'Stop response', exact: true })
    .waitFor({ state: 'hidden' });
  await page.locator('.assistant-pane .message.assistant:last-of-type').waitFor();
  await aligned(['.assistant-pane .message.assistant:last-of-type', '.assistant-pane .composer']);
  await capture('contextual-chat');
  await page.getByRole('button', { name: 'Close assistant', exact: true }).click();
  await page
    .locator('.sidebar-utilities')
    .getByRole('button', { name: 'Settings', exact: true })
    .click();
  await page.getByRole('button', { name: 'Look & feel', exact: true }).click();
  assert.equal(await page.getByLabel('Layout', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.reload();
  await page.getByRole('heading', { name: /Make yourself/ }).waitFor();
  await page.getByRole('button', { name: 'Skills', exact: true }).click();
  assert.equal(await page.getByLabel('Skills view').inputValue(), 'list');
  for (const [w, h] of [
    [2560, 1440],
    [1366, 768],
  ]) {
    await resize(w, h);
    await page.getByRole('button', { name: 'Chat', exact: true }).first().click();
    await page.getByRole('button', { name: 'Recent conversations', exact: true }).click();
    await page
      .locator('.conversation-library-row>button:first-child')
      .filter({ hasText: 'Layout validation' })
      .click();
    await page.locator('.chat-scroll > .message.assistant:last-of-type').waitFor();
    await aligned(['.chat-scroll>.message.assistant:last-of-type', '.composer']);
    assert.ok(
      await page.locator('.main-canvas').evaluate((e) => e.scrollWidth <= e.clientWidth + 2),
    );
    await capture(w + '-chat');
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      result: 'passed',
      directory,
      checks: [
        'live/saved/expanded Thinking and messages align with composer in comfortable/wide chat',
        'Thinking precedes answers',
        'compact numeric context tooltip',
        'flat full-name model menu',
        'board task right-click',
        'single-item Projects/Skills card tracks',
        'Skills list persistence',
        'wider notes',
        'Studio-only Settings',
        '1920/2560/1366 geometry',
        'no renderer errors',
      ],
    }),
  );
} finally {
  await app.close();
  await new Promise((resolve) => server.close(resolve));
}
