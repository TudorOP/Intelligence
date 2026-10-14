import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Store } from '../electron/store.mjs';
import { ensureProfiles } from '../electron/profiles.mjs';
const directory = path.resolve('.test-data/chat-tools-ui-' + Date.now());
const data = path.join(directory, 'data');
fs.mkdirSync(data, { recursive: true });
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  if (req.url === '/v1/audio/speech') {
    res.setHeader('Content-Type', 'audio/pcm');
    res.end(Buffer.alloc(24000 * 2 * 4));
  } else if (req.url === '/api/chat') {
    res.setHeader('Content-Type', 'application/x-ndjson');
    const request = JSON.parse(body);
    const needsTools = request.messages.at(-1).role === 'user';
    res.end(
      JSON.stringify({
        message: needsTools
          ? {
              role: 'assistant',
              content: '',
              thinking: 'Inspecting available boards and Matrix lists.',
              tool_calls: ['board', 'matrix-list'].map((kind) => ({
                function: { name: 'list_items', arguments: { kind } },
              })),
            }
          : { role: 'assistant', content: 'Panel fixture completed.' },
        done: true,
      }) + '\n',
    );
  } else
    res.end(
      JSON.stringify({
        models: [{ name: 'fixture' }],
        model_info: { 'fixture.context_length': 32768 },
      }),
    );
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const endpoint = 'http://127.0.0.1:' + server.address().port;
const store = new Store(data);
store.setSettings({
  onboardingComplete: true,
  semanticSearch: false,
  autoConsolidation: false,
  backgroundPaused: true,
  tools: true,
  provider: 'ollama',
  model: 'fixture',
  endpoint,
  showThinking: true,
  theme: 'night',
  optionalModules: {
    tts: { enabled: true, adapter: 'compatible', endpoint: endpoint + '/v1', voice: 'fixture' },
  },
});
ensureProfiles(store);
const conversation = store.mutate({ kind: 'conversation', title: 'Compound calls fixture' });
store.message(conversation.id, 'user', 'Please move the three cards.');
for (let i = 0; i < 3; i++) {
  store.message(conversation.id, 'assistant', '', {
    modelOnly: true,
    tool: true,
    modelMessage: {
      role: 'assistant',
      thinking: `Reasoning for tool step ${i + 1}.`,
      tool_calls: [],
    },
  });
  const result =
    i === 1
      ? { error: 'Item not found. Refresh discovery and copy the exact ID before retrying.' }
      : { moved: true };
  store.message(conversation.id, 'assistant', 'move_item: ' + JSON.stringify(result), {
    tool: true,
    name: 'move_item',
    modelMessage: { role: 'tool', content: JSON.stringify(result) },
  });
}
store.message(conversation.id, 'assistant', 'Two moves succeeded; one requires a refreshed ID.');
store.close();
const env = {
  ...process.env,
  INTELLIGENCE_TEST: '1',
  INTELLIGENCE_DATA_DIR: data,
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ executablePath: electronPath, args: ['.', '--disable-gpu'], env });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.locator('.sidebar').waitFor();
  } catch (e) {
    console.log(
      JSON.stringify({ url: page.url(), errors, body: await page.locator('body').innerText() }),
    );
    throw e;
  }
  const resize = (w, h) =>
    app.evaluate(
      ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size),
      [w, h],
    );
  const shot = async (name) => {
    // A hidden fixture window must paint once before its screenshot is current.
    await app.evaluate(async ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].capturePage(undefined, {
        stayHidden: true,
        stayAwake: true,
      }),
    );
    await page.waitForTimeout(250);
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
  await app.evaluate(
    ({ BrowserWindow }, id) =>
      BrowserWindow.getAllWindows()[0].webContents.send('intelligence:event', {
        type: 'navigate',
        id,
      }),
    conversation.id,
  );
  await page
    .getByText('Two moves succeeded; one requires a refreshed ID.', { exact: true })
    .waitFor();
  assert.equal(await page.locator('.tool-group').count(), 1);
  assert.match(
    await page.locator('.tool-group > summary').textContent(),
    /Tool calls · 3.*Failed: 1/,
  );
  assert.equal(await page.locator('.tool-call').count(), 3);
  const main = page.locator('.chat-surface:not(.compact)');
  const checkControls = async (surface) => {
    const branch = await surface.locator('.branch-control').boundingBox();
    const speak = await surface.locator('.speak-message').boundingBox();
    assert.equal(branch.width, 32);
    assert.equal(branch.height, 32);
    assert.equal(speak.width, branch.width);
    assert.equal(speak.height, branch.height);
    assert.equal(await surface.locator('.branch-control .symbol-icon').count(), 1);
    assert.equal(await surface.locator('.speak-message').textContent(), '');
  };
  await checkControls(main);
  await page.keyboard.press('Tab');
  await main.getByRole('button', { name: 'Branch from here', exact: true }).focus();
  await page.getByRole('tooltip').waitFor();
  await shot('main-collapsed-tooltip-1920');
  await page.locator('.tool-group > summary').click();
  await page.locator('.tool-call').nth(1).locator('summary').click();
  await page.locator('.tool-call').nth(1).locator('pre').waitFor();
  await page.locator('.tool-group .thinking-toggle').first().click();
  await shot('main-expanded-failure-1920');
  await main.getByRole('button', { name: 'Read aloud', exact: true }).click();
  await main.getByRole('button', { name: 'Stop audio', exact: true }).waitFor();
  await checkControls(main);
  await main.getByRole('button', { name: 'Stop audio', exact: true }).click();
  await main.getByRole('button', { name: 'Read aloud', exact: true }).waitFor();
  await main.getByRole('button', { name: 'Branch from here', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('.chat-top')?.textContent.includes('· Branch'),
  );
  assert.equal(await page.locator('.tool-group').count(), 1);
  // Open the global assistant on another screen, then branch within that pane.
  await page.locator('.sidebar').getByRole('button', { name: 'Notebooks', exact: true }).click();
  await page.locator('.assistant-toggle').click();
  const panel = page.locator('.chat-surface.compact');
  await panel.locator('textarea').fill('Panel request');
  await panel.locator('textarea').press('Enter');
  await panel.getByText('Panel fixture completed.', { exact: true }).waitFor();
  await page.waitForFunction(
    () => !document.querySelector('.compact [aria-label="Stop response"]'),
  );
  await checkControls(panel);
  assert.equal(await panel.locator('.tool-group').count(), 1);
  assert.equal(await panel.locator('.tool-call').count(), 2);
  const before = await page.evaluate(() => window.intelligence.bootstrap());
  await panel.getByRole('button', { name: 'Branch from here', exact: true }).click();
  await page.waitForFunction(
    async (n) =>
      (await window.intelligence.bootstrap()).entities.filter((e) => e.kind === 'conversation')
        .length > n,
    before.entities.filter((e) => e.kind === 'conversation').length,
  );
  const snapshot = await page.evaluate(() => window.intelligence.bootstrap());
  const branch = snapshot.entities
    .filter(
      (e) => e.kind === 'conversation' && e.data.branchOf && e.data.branchOf !== conversation.id,
    )
    .at(-1);
  assert.ok(branch, 'Panel branch must be saved');
  assert.equal(await panel.locator('.tool-group').count(), 1);
  for (const [w, h] of [
    [1920, 1080],
    [2560, 1440],
    [3440, 1440],
    [1366, 768],
  ]) {
    await resize(w, h);
    for (const theme of ['ink', 'day', 'night', 'summer', 'autumn', 'winter']) {
      await page.evaluate((theme) => window.intelligence.settings({ theme }), theme);
      await page.waitForFunction(
        (theme) => document.documentElement.dataset.theme === theme,
        theme,
      );
      await shot(`panel-${theme}-${w}`);
    }
  }
  await resize(1920, 1080);
  await page.evaluate(() => window.intelligence.settings({ language: 'ro' }));
  await panel.getByRole('button', { name: 'Citește cu voce tare', exact: true }).first().waitFor();
  await shot('panel-romanian-1920');
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        passed: true,
        directory,
        checks:
          'Grouped calls/failures/reasoning, equal symbolic controls, keyboard tooltip, speech Stop, main/panel branching, four sizes, six themes, Romanian',
      },
      null,
      2,
    ),
  );
} finally {
  await app?.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
