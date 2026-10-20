import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
const directory = path.resolve('.test-data/search-desktop-' + Date.now());
fs.mkdirSync(directory, { recursive: true });
let searches = 0;
const modelRequests = [];
const server = createServer(async (req, res) => {
  if (req.url.startsWith('/search')) {
    searches++;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        results: [
          {
            title: 'Primary fixture source',
            url: 'https://example.org/source',
            content: 'Current fixture evidence for a global search.',
          },
        ],
      }),
    );
    return;
  }
  let text = '';
  for await (const part of req) text += part;
  if (!text) {
    res.end(JSON.stringify({ data: [{ id: 'search-fixture' }], models: [] }));
    return;
  }
  const body = JSON.parse(text);
  modelRequests.push(body);
  const delta =
    modelRequests.length === 1
      ? {
          tool_calls: [
            {
              index: 0,
              id: 'search',
              type: 'function',
              function: { name: 'search_web', arguments: '{"query":"research for a notebook"}' },
            },
          ],
        }
      : {
          content:
            'The source reports current fixture evidence. [Source](https://example.org/source)',
        };
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.end('data: ' + JSON.stringify({ choices: [{ delta }] }) + '\n\ndata: [DONE]\n\n');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const endpoint = 'http://127.0.0.1:' + server.address().port;
const env = { ...process.env, INTELLIGENCE_TEST: '1', INTELLIGENCE_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;

let desktop;
try {
  desktop = await electron.launch({
    executablePath: electronPath,
    args: ['.', '--disable-gpu'],
    env,
    timeout: 30000,
  });
  await desktop.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1920, 1080),
  );
  const page = await desktop.firstWindow();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const capture = async (name) => {
    const encoded = await desktop.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      await win.capturePage(undefined, { stayHidden: true, stayAwake: true });
      await new Promise((resolve) => setTimeout(resolve, 150));
      return (await win.capturePage(undefined, { stayHidden: true, stayAwake: true }))
        .toPNG()
        .toString('base64');
    });
    fs.writeFileSync(path.join(directory, name), Buffer.from(encoded, 'base64'));
  };
  await page.getByRole('button', { name: /^Settings/ }).click();
  await page.getByRole('button', { name: 'Search providers', exact: true }).click();
  assert.equal(await page.getByLabel('Search provider').count(), 1);
  const address = page.getByLabel('SearXNG address');
  await address.fill(endpoint);
  await address.press('Tab');
  await page.waitForFunction(
    async (value) => (await window.intelligence.bootstrap()).settings.searxngEndpoint === value,
    endpoint,
  );
  await page.getByRole('button', { name: 'Test provider', exact: true }).click();
  await page.getByText('SearXNG: connection ready · 1 results', { exact: true }).waitFor();
  assert.equal(searches, 1);
  await capture('search-searxng-night-1080.png');
  await page.getByLabel('Search provider').selectOption('brave');
  await page.getByLabel('Brave API key').waitFor();
  const fixtureKey = 'fixture-secret-for-desktop-verification';
  await page.getByLabel('Brave API key').fill(fixtureKey);
  await page.getByRole('button', { name: 'Save key', exact: true }).click();
  await page.waitForFunction(
    async () => (await window.intelligence.bootstrap()).search.braveKey.configured,
  );
  await page.waitForFunction(
    () => document.querySelector('input[aria-label="Brave API key"]').value === '',
  );
  assert.equal(await page.getByLabel('Brave API key').inputValue(), '');
  const metadata = await page.evaluate(() => window.intelligence.bootstrap());
  assert.ok(!JSON.stringify(metadata).includes(fixtureKey));
  await capture('search-brave-night-1080.png');
  await page.getByRole('button', { name: 'Remove key', exact: true }).click();
  await page.waitForFunction(
    async () => !(await window.intelligence.bootstrap()).search.braveKey.configured,
  );
  await page.getByLabel('Search provider').selectOption('searxng');
  await page.getByLabel('SearXNG address').waitFor();
  assert.equal(await page.getByLabel('SearXNG address').inputValue(), endpoint);
  await page.getByLabel('Enable web search').uncheck();
  await page.waitForFunction(
    async () => !(await window.intelligence.bootstrap()).settings.searchEnabled,
  );
  assert.equal(
    await page.getByRole('button', { name: 'Test provider', exact: true }).isEnabled(),
    false,
  );
  await page.getByLabel('Enable web search').check();
  await page.waitForFunction(
    async () => (await window.intelligence.bootstrap()).settings.searchEnabled,
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Switch theme', exact: true }).click();
  await page.getByRole('button', { name: /^Settings/ }).click();
  await page.getByRole('button', { name: 'Search providers', exact: true }).click();
  await capture('search-searxng-day-1080.png');
  await page.keyboard.press('Escape');
  await page.evaluate(
    (endpoint) =>
      window.intelligence.settings({
        provider: 'lmstudio',
        endpoint,
        model: 'fixture',
        matrixAccess: false,
        semanticSearch: false,
        autoConsolidation: false,
      }),
    endpoint,
  );
  await page
    .getByRole('textbox', { name: 'Message Intelligence', exact: true })
    .fill('Research for my notebook using the global search tool.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByText('The source reports current fixture evidence.', { exact: false }).waitFor();
  assert.equal(modelRequests.length, 2);
  assert.equal(searches, 2);
  assert.ok(modelRequests[0].tools.some((tool) => tool.function.name === 'search_web'));
  assert.ok(modelRequests[0].messages[0].content.includes('Web search is a global capability'));
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(
    JSON.stringify({
      result: 'passed',
      directory,
      checks: [
        '1920x1080 search settings',
        'SearXNG connection',
        'provider menu',
        'protected key save/remove',
        'key excluded from bootstrap',
        'search enable toggle',
        'global chat tool with Matrix disabled',
        'source citation',
        'both themes',
        'no renderer errors',
      ],
    }),
  );
} finally {
  await desktop?.close();
  await new Promise((resolve) => server.close(resolve));
}
