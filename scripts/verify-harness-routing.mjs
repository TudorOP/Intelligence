import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { Store } from '../electron/store.mjs';
import { ensureProfiles } from '../electron/profiles.mjs';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
const directory = path.resolve('.test-data/harness-routing-' + Date.now());
const store = new Store(path.join(directory, 'data'));
let connectedId, connectedRevision;
const held = [];
const requests = [];
const tool = (name, args) => ({
  tool_calls: [
    {
      index: 0,
      id: 'fixture_' + requests.length,
      function: { name, arguments: JSON.stringify(args) },
    },
  ],
});
const reply = (res, delta) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.end('data: ' + JSON.stringify({ choices: [{ delta }] }) + '\n\ndata: [DONE]\n');
};
const notebook = store.all().find((e) => e.kind === 'notebook' && store.access(e.id, true));
const legacy = store.mutate({
  kind: 'chapter',
  parent: notebook.id,
  title: 'Saved guide chapter',
  data: {
    content:
      '# Stream guide\n\n- [ ] Preserve this checklist\n- [ ] Știință și Linux\n\n| Topic | Plan |\n| --- | --- |\n| AI | A beginner lesson |',
  },
});
const server = http.createServer((req, res) => {
  if (req.method === 'GET') {
    res.end(JSON.stringify({ data: [{ id: 'fixture' }] }));
    return;
  }
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    const value = JSON.parse(body);
    requests.push(value);
    const user = [...value.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const last = value.messages.at(-1);
    if (user.includes('Create actual notes')) {
      if (last.role !== 'tool')
        return reply(
          res,
          tool('create_item', {
            kind: 'chapter',
            parent: notebook.id,
            title: 'Agent-created chapter',
            description: 'Contains actual child notes',
          }),
        );
      const output = JSON.parse(last.content);
      if (output.kind === 'chapter')
        return reply(
          res,
          tool('create_item', {
            kind: 'note',
            parent: output.id,
            title: 'Agent-created note',
            content: '# Saved during the run\n\n- [ ] This is a real note — Știință',
          }),
        );
      held.push(res);
      return;
    }
    if (user.includes('Disconnect fixture MCP')) {
      if (last.role !== 'tool')
        return reply(
          res,
          tool('connection_action', {
            action: 'disconnect',
            id: connectedId,
            revision: connectedRevision,
          }),
        );
      return reply(res, { content: 'MCP fixture disconnected.' });
    }
    if (user.includes('Connect fixture MCP')) {
      if (last.role !== 'tool')
        return reply(
          res,
          tool('connection_action', {
            action: 'connect',
            title: 'MCP echo fixture',
            transport: 'stdio',
            command: process.execPath,
            args: [path.resolve('scripts/fixtures/mcp-echo.mjs')],
          }),
        );
      if (last.tool_call_id) {
        const prior = value.messages.findLast((m) => m.tool_calls)?.tool_calls[0].function.name;
        if (prior === 'connection_action') {
          const result = JSON.parse(last.content);
          connectedId = result.id;
          connectedRevision = result.revision;
          return reply(res, tool('discover_connection_tools', { query: 'echo' }));
        }
        if (prior === 'discover_connection_tools') {
          const result = JSON.parse(last.content);
          return reply(res, tool(result.tools[0].function.name, { text: 'MCP verified' }));
        }
      }
      return reply(res, { content: 'MCP fixture connected and verified.' });
    }
    reply(res, { content: 'Fixture response.' });
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
store.setSettings({
  provider: 'lmstudio',
  endpoint: 'http://127.0.0.1:' + server.address().port + '/v1',
  model: 'fixture',
  onboardingComplete: true,
  theme: 'day',
  backgroundPaused: true,
  semanticSearch: false,
  autoConsolidation: false,
  autoCompact: false,
  approvalMode: 'full',
});
ensureProfiles(store);
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
  const send = async (text) => {
    await nav('Chat');
    await page.getByRole('textbox', { name: 'Message Intelligence', exact: true }).fill(text);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
  };
  await resize(1920, 1080);
  await send('Create actual notes in the notebook.');
  await page.waitForFunction(async () =>
    (await window.intelligence.bootstrap()).entities.some(
      (e) => e.kind === 'note' && e.title === 'Agent-created note',
    ),
  );
  await nav('Notebooks');
  await page.getByRole('button', { name: notebook.title, exact: true }).click();
  await page.getByRole('button', { name: 'Agent-created chapter', exact: false }).first().waitFor();
  await page
    .locator('.note-nav-row')
    .getByRole('button', { name: 'Agent-created note', exact: false })
    .click();
  await page.getByText('This is a real note — Știință', { exact: true }).waitFor();
  const active = await page.evaluate(
    async () => (await window.intelligence.bootstrap()).activeConversations,
  );
  assert.equal(active.length, 1);
  await shot('notes-visible-during-run');
  await nav('Chat');
  await page.getByRole('button', { name: 'Stop response', exact: true }).click();
  await page.waitForFunction(
    async () => !(await window.intelligence.bootstrap()).activeConversations.length,
  );
  await nav('Notebooks');
  await page.getByLabel('Note title').waitFor();
  assert.equal(await page.getByLabel('Note title').inputValue(), 'Agent-created note');
  await page.getByRole('button', { name: 'Saved guide chapter', exact: false }).first().click();
  await page.locator('.chapter-stored-content > summary').click();
  await page.getByRole('heading', { name: 'Stream guide', exact: true }).waitFor();
  await shot('legacy-chapter-guide');
  await resize(1366, 768);
  await shot('legacy-chapter-short');
  await page.getByRole('button', { name: 'Create note from this content', exact: true }).click();
  await page.getByLabel('Note title').waitFor();
  const copied = await page.evaluate(async (id) => {
    const s = await window.intelligence.bootstrap();
    return {
      chapter: s.entities.find((e) => e.id === id),
      notes: s.entities.filter((e) => e.parent === id && e.kind === 'note'),
    };
  }, legacy.id);
  assert.equal(copied.notes.length, 1);
  assert.equal(copied.notes[0].data.content, copied.chapter.data.content);
  assert.equal(copied.chapter.revision, legacy.revision);
  await shot('copied-note-short');
  await resize(1920, 1080);
  await send('Connect fixture MCP and verify echo.');
  await page.getByRole('button', { name: 'Approve action', exact: true }).waitFor();
  assert.equal(
    (await page.evaluate(() => window.intelligence.bootstrap())).settings.approvalMode,
    'full',
  );
  assert.ok((await page.locator('.approval pre').textContent()).includes('mcp-echo.mjs'));
  await shot('mcp-native-review');
  await page.getByRole('button', { name: 'Approve action', exact: true }).click();
  await page.getByText('MCP fixture connected and verified.', { exact: true }).waitFor();
  await nav('Connections');
  await page.getByRole('heading', { name: 'MCP echo fixture', exact: true }).waitFor();
  await shot('mcp-connected');
  await send('Disconnect fixture MCP.');
  await page.getByRole('button', { name: 'Approve action', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Approve action', exact: true }).click();
  await page.getByText('MCP fixture disconnected.', { exact: true }).waitFor();
  assert.equal(
    (await page.evaluate(() => window.intelligence.bootstrap())).entities.find(
      (e) => e.id === connectedId,
    ).data.enabled,
    false,
  );
  await nav('Skills');
  await page.getByText('MCP server setup', { exact: true }).first().waitFor();
  await shot('mcp-setup-skill');
  await page.reload();
  await page.locator('.sidebar').waitFor();
  const restored = await page.evaluate(() => window.intelligence.bootstrap());
  assert.ok(restored.entities.some((e) => e.kind === 'note' && e.title === 'Agent-created note'));
  assert.equal(restored.entities.find((e) => e.id === legacy.id).data.content, legacy.data.content);
  assert.equal(restored.entities.find((e) => e.id === connectedId).data.enabled, false);
  await nav('Notebooks');
  await page.getByRole('button', { name: notebook.title, exact: true }).click();
  await page.getByRole('button', { name: 'Saved guide chapter', exact: false }).first().click();
  await page.locator('.chapter-stored-content > summary').click();
  for (const [width, height] of [
    [2560, 1440],
    [3440, 1440],
  ]) {
    await resize(width, height);
    await shot('legacy-guide-' + width);
  }
  await page.evaluate(() => window.intelligence.settings({ language: 'ro' }));
  await page.getByText('Conținut salvat al capitolului', { exact: true }).waitFor();
  await resize(1920, 1080);
  await shot('legacy-guide-ro');
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(JSON.stringify({ directory, captures, requests: requests.length, errors }, null, 2));
} finally {
  for (const res of held) res.destroy();
  await app?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
