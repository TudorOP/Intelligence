import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Store } from '../electron/store.mjs';
import { ensureProfiles } from '../electron/profiles.mjs';
const directory = path.resolve('.test-data/speech-report-ui-' + Date.now()),
  data = path.join(directory, 'data');
fs.mkdirSync(data, { recursive: true });
const spoken = [],
  prompts = [];
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  if (req.url === '/v1/audio/speech') {
    spoken.push(JSON.parse(body));
    res.setHeader('Content-Type', 'audio/pcm');
    // Real PCM decoding and Web Audio playback through the isolated desktop bridge.
    const pcm = Buffer.alloc(24000);
    for (let i = 0; i < pcm.length / 2; i++)
      pcm.writeInt16LE(Math.round(Math.sin((i * 2 * Math.PI * 220) / 24000) * 3000), i * 2);
    res.end(pcm);
    return;
  }
  if (req.url === '/api/show') {
    res.end(JSON.stringify({ model_info: { 'fixture.context_length': 32768 } }));
    return;
  }
  if (req.url === '/api/tags') {
    res.end(JSON.stringify({ models: [{ name: 'fixture' }] }));
    return;
  }
  if (req.method === 'GET') {
    res.end(JSON.stringify({ models: [] }));
    return;
  }
  prompts.push(JSON.parse(body));
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.end(
    JSON.stringify({
      message: {
        role: 'assistant',
        content: '**Completed reply ' + prompts.length + '**. A readable result.',
        thinking: 'Returned reasoning.',
      },
      done: true,
    }) + '\n',
  );
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const endpoint = 'http://127.0.0.1:' + server.address().port;
const store = new Store(data);
store.setSettings({
  onboardingComplete: true,
  semanticSearch: false,
  autoConsolidation: false,
  tools: false,
  provider: 'ollama',
  endpoint,
  model: 'fixture',
  theme: 'autumn',
  showThinking: true,
  optionalModules: {
    tts: { enabled: true, adapter: 'compatible', endpoint: endpoint + '/v1', voice: 'fixture' },
  },
});
ensureProfiles(store);
const report = store.mutate({
  kind: 'report',
  title: 'Recovered morning briefing',
  data: {
    access: true,
    status: 'done',
    agentName: 'Intelligence',
    summary: '',
    sections: [
      {
        title: 'Report',
        content:
          'Now returning the final JSON report:\n```json\n' +
          JSON.stringify({
            summary: 'A concise overview.',
            sections: [
              { title: 'Your day', content: 'No scheduled events.' },
              {
                title: 'Science brief',
                content:
                  '**Scientific findings**\n\n' + 'Readable scientific result.\n\n'.repeat(110),
              },
              {
                title: 'Technology brief',
                content: 'A separate technology brief.\n\n[Article](https://example.org/article)',
              },
            ],
          }) +
          '\n```',
      },
    ],
    webSources: [{ title: 'Retrieved article', url: 'https://example.org/article' }],
  },
});
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
  await page.locator('.sidebar').waitFor();
  const size = async (w, h) =>
    app.evaluate(
      ({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h),
      [w, h],
    );
  const shot = async (name) => {
    await page.mouse.move(10, 10);
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
  await size(1920, 1080);
  await page.locator('.welcome-orbit .theme-banner').waitFor();
  assert.equal(await page.locator('.suggestions').count(), 0);
  await page.waitForTimeout(400);
  assert.ok(
    await page.locator('.chat-scroll').evaluate((e) => e.scrollHeight <= e.clientHeight + 2),
    'Empty Chat must fit at 1080p',
  );
  assert.notEqual(
    await page
      .locator('.welcome-orbit .theme-banner')
      .evaluate((e) => getComputedStyle(e).maskImage),
    'none',
  );
  await shot('autumn-fade-1920');
  const toggle = page.getByRole('button', {
    name: 'Automatically read replies aloud',
    exact: true,
  });
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  await toggle.click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="Automatically read replies aloud"]')
        ?.getAttribute('aria-pressed') === 'true',
  );
  const input = page.locator('.composer textarea');
  await input.fill('First response');
  await input.press('Enter');
  await page.getByText('Completed reply 1', { exact: false }).first().waitFor();
  await page.waitForFunction(
    () => document.querySelector('.speak-message')?.getAttribute('aria-label') === 'Read aloud',
  );
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].input, 'Completed reply 1. A readable result.');
  await page.getByRole('button', { name: 'Read aloud', exact: true }).click();
  await page.waitForTimeout(900);
  assert.equal(spoken.length, 2);
  await page.getByRole('button', { name: 'Read aloud', exact: true }).waitFor();
  await toggle.click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="Automatically read replies aloud"]')
        ?.getAttribute('aria-pressed') === 'false',
  );
  await input.fill('Second response');
  await input.press('Enter');
  await page.getByText('Completed reply 2', { exact: false }).first().waitFor();
  await page.waitForTimeout(300);
  assert.equal(spoken.length, 2);
  await shot('speech-controls-1920');
  await page.locator('.sidebar').getByRole('button', { name: 'Reports', exact: true }).click();
  await page.locator('.report-library-row').first().locator('button').first().click();
  const nav = page.locator('.report-reader-layout nav'),
    article = page.locator('.report-reader .report-scroll');
  await article.getByText('A concise overview.', { exact: true }).waitFor();
  assert.deepEqual(await nav.locator('button').allTextContents(), [
    'Overview',
    'Report',
    'Source references',
    'Your day',
    'Science brief',
    'Technology brief',
  ]);
  await nav.getByRole('button', { name: 'Report', exact: true }).click();
  assert.match(await article.innerText(), /No scheduled events/);
  assert.match(await article.innerText(), /separate technology/);
  assert.doesNotMatch(await article.innerText(), /"sections"|Now returning/);
  assert.ok(await article.evaluate((e) => e.scrollHeight > e.clientHeight));
  await article.evaluate((e) => (e.scrollTop = 500));
  await nav.getByRole('button', { name: 'Technology brief', exact: true }).click();
  assert.equal(await article.evaluate((e) => e.scrollTop), 0);
  assert.doesNotMatch(await article.innerText(), /Scientific findings/);
  await nav.getByRole('button', { name: 'Source references', exact: true }).click();
  await article.getByRole('link', { name: 'Retrieved article' }).waitFor();
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  assert.equal(
    await nav.getByRole('button', { name: 'Report', exact: true }).getAttribute('aria-current'),
    'page',
  );
  await page.getByRole('button', { name: 'Copy report', exact: true }).click();
  assert.match(await app.evaluate(({ clipboard }) => clipboard.readText()), /## Technology brief/);
  for (const [w, h] of [
    [1920, 1080],
    [2560, 1440],
    [3440, 1440],
    [1366, 768],
  ]) {
    await size(w, h);
    assert.ok(await article.evaluate((e) => e.scrollWidth <= e.clientWidth + 2));
    await shot('report-' + w);
  }
  await size(1920, 1080);
  for (const theme of ['day', 'ink', 'night', 'summer', 'autumn', 'winter']) {
    await page.evaluate((theme) => window.intelligence.settings({ theme }), theme);
    await shot('report-' + theme);
  }
  await page.evaluate(() => window.intelligence.settings({ language: 'ro' }));
  await page.getByRole('heading', { name: 'Capitole', exact: true }).waitFor();
  await shot('report-romanian');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.intelligence.settings({ language: 'en' }));
  await page.locator('.sidebar').getByRole('button', { name: 'Chat', exact: true }).click();
  await page.reload();
  await page.locator('.sidebar').waitFor();
  assert.equal(
    await page
      .getByRole('button', { name: 'Automatically read replies aloud', exact: true })
      .getAttribute('aria-pressed'),
    'false',
  );
  await page.waitForTimeout(500);
  assert.equal(spoken.length, 2);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        passed: true,
        directory,
        spoken: spoken.length,
        checks:
          'Automatic/manual speech, no replay, JSON recovery, full report, isolated chapters, sources, copy, scrolling, four sizes, six themes, Romanian, Autumn fade',
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
