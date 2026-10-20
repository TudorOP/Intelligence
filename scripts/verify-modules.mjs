import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Store } from '../electron/store.mjs';
import { Workspace } from '../electron/workspace.mjs';
import { ensureProfiles } from '../electron/profiles.mjs';
const directory = path.resolve('.test-data/modules-ui-' + Date.now()),
  data = path.join(directory, 'data'),
  projectDirectory = path.join(directory, 'project');
fs.mkdirSync(projectDirectory, { recursive: true });
fs.writeFileSync(path.join(projectDirectory, 'readme.txt'), 'A real editable project file.');
fs.writeFileSync(
  path.join(projectDirectory, 'example.pdf'),
  Buffer.from('%PDF-1.4\nBinary PDF fixture\0'),
);
const modelServer = createServer(async (req, res) => {
  if (req.url === '/api/tags' || req.url === '/v1/models') {
    res.end(
      JSON.stringify(
        req.url === '/api/tags' ? { models: [{ name: 'fixture' }] } : { data: [{ id: 'fixture' }] },
      ),
    );
    return;
  }
  if (req.url === '/api/show') {
    res.end(JSON.stringify({ model_info: { 'fixture.context_length': 32768 } }));
    return;
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  res.setHeader('Content-Type', 'application/x-ndjson');
  for (let i = 0; i < 18; i++) {
    res.write(
      JSON.stringify({
        message: {
          role: 'assistant',
          thinking:
            'A returned reasoning line ' + i + '. Checking the requested result carefully.\n',
        },
        done: false,
      }) + '\n',
    );
    await new Promise((r) => setTimeout(r, 80));
  }
  res.end(
    JSON.stringify({
      message: { role: 'assistant', content: 'The fixture response is complete.' },
      done: true,
    }) + '\n',
  );
});
await new Promise((r) => modelServer.listen(0, '127.0.0.1', r));
const endpoint = 'http://127.0.0.1:' + modelServer.address().port;
const store = new Store(data);
const workspace = new Workspace(store);
store.setSettings({
  theme: 'day',
  onboardingComplete: true,
  semanticSearch: false,
  autoConsolidation: false,
  tools: false,
  provider: 'ollama',
  endpoint,
  model: 'fixture',
  showThinking: true,
});
ensureProfiles(store);
const conversation = store.mutate({
  kind: 'conversation',
  title: '2.6 reasoning fixture',
  data: { access: true },
});
store.message(conversation.id, 'user', 'Explain the result');
store.message(conversation.id, 'assistant', 'A completed fixture answer.', {
  modelMessage: {
    role: 'assistant',
    content: 'A completed fixture answer.',
    thinking: Array.from(
      { length: 32 },
      (_, i) => 'Saved reasoning line ' + i + '. This is provider-returned fixture text.',
    ).join('\n'),
  },
});
const project = store.mutate({
  kind: 'project',
  title: 'Browse fixture',
  data: { directory: projectDirectory, access: true, permission: 'edit' },
});
store.mutate({
  kind: 'skill',
  title: 'Wide skill fixture',
  data: {
    content:
      '---\nname: wide-skill-fixture\n---\n' +
      'Readable instructions with a comfortably long line and preserved user content.\n'.repeat(35),
  },
});
for (let i = 0; i < 65; i++) {
  const item = store.mutate({
    kind: 'skill',
    title: 'Trashed fixture ' + i,
    data: { content: 'Trash fixture' },
  });
  store.mutate({ id: item.id, action: 'trash' });
}
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
  await app.evaluate(({ BrowserWindow, shell }) => {
    BrowserWindow.getAllWindows()[0].setSize(1920, 1080);
    globalThis.__supportLinks = [];
    shell.openExternal = async (url) => {
      globalThis.__supportLinks.push(url);
    };
  });
  const shot = async (name) => {
    await page.mouse.move(10, 10);
    await page.waitForTimeout(500);
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
    const file = path.join(directory, name + '.png');
    fs.writeFileSync(file, Buffer.from(png, 'base64'));
    captures.push(file);
    console.log('Captured ' + name);
  };
  const settings = async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('.settings-dialog').waitFor();
  };
  const nav = async (name) => {
    await page.locator('.settings-navigation').getByRole('button', { name, exact: true }).click();
  };
  await settings();
  await nav('Your profile');
  await page.getByLabel('Your name', { exact: true }).fill('Octavian');
  await page
    .getByLabel('Describe yourself (optional)', { exact: true })
    .fill('A short profile, available only when needed.');
  await shot('profile-1920');
  await nav('Optional Modules');
  await page.getByText('Text to speech · English only', { exact: true }).waitFor();
  assert.equal(await page.locator('.optional-module-card').count(), 3);
  await shot('modules-1920');
  await page.getByRole('link', { name: 'Support me on Ko-fi', exact: true }).click();
  assert.deepEqual(await app.evaluate(() => globalThis.__supportLinks), [
    'https://ko-fi.com/B0B5KQRRD',
  ]);
  assert.equal((await app.windows()).length, 1);
  await page.locator('.settings-help-menu').getByText('Licenses', { exact: true }).click();
  await page.getByRole('button', { name: 'Read licenses & notices', exact: true }).click();
  await page
    .locator('.license-text')
    .getByText('GNU GENERAL PUBLIC LICENSE', { exact: false })
    .waitFor();
  assert.ok((await page.locator('.license-text').textContent()).includes('Version 3'));
  await shot('licenses-1920');
  await page.locator('.license-reader').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await app.evaluate(
    ({ BrowserWindow }, id) =>
      BrowserWindow.getAllWindows()[0].webContents.send('intelligence:event', {
        type: 'navigate',
        id,
      }),
    conversation.id,
  );
  await page.getByText('A completed fixture answer.', { exact: true }).waitFor();
  const thinking = page.locator('.thinking-panel').first();
  assert.equal(await thinking.locator('button').getAttribute('aria-expanded'), 'false');
  const measure = await thinking.locator('pre').evaluate((e) => ({
    height: e.clientHeight,
    line: parseFloat(getComputedStyle(e).lineHeight),
  }));
  assert.ok(measure.height <= measure.line * 3 + 2, JSON.stringify(measure));
  await shot('thinking-vignette-1920');
  await thinking.locator('button').click();
  assert.equal(await thinking.locator('button').getAttribute('aria-expanded'), 'true');
  await shot('thinking-expanded-1920');
  assert.equal(await page.getByText('Response context', { exact: true }).count(), 0);
  assert.equal(await page.getByLabel('Model ID for branch').count(), 0);
  await page
    .getByLabel('Message Intelligence', { exact: true })
    .fill('Please stream a reasoning fixture');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const live = page.locator('.thinking-panel.live');
  await live.getByRole('button').waitFor();
  await live.getByRole('button').focus();
  await live.getByRole('button').press('Space');
  await page.getByText('The fixture response is complete.', { exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[aria-label="Stop response"]'));
  assert.equal(
    await page.locator('.thinking-panel').last().getByRole('button').getAttribute('aria-expanded'),
    'true',
  );
  await shot('thinking-stream-saved-1920');
  await page.getByRole('button', { name: 'Branch from here', exact: true }).first().click();
  await page.waitForTimeout(300);
  const snapshot = await page.evaluate(() => window.intelligence.bootstrap());
  const branch = snapshot.entities.find((e) => e.data.branchOf === conversation.id);
  assert.ok(branch);
  assert.equal(branch.data.branchModel, 'fixture');
  await settings();
  await nav('Your data');
  await page.getByRole('button', { name: 'Open Trash ↗', exact: true }).click();
  await page.getByRole('button', { name: /Empty Trash/ }).click();
  assert.ok((await page.locator('.trash-dialog').textContent()).includes('65'));
  await page.locator('.trash-dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByLabel('Search Trash').fill('Trashed fixture 6');
  await page.getByRole('button', { name: 'Select results', exact: true }).click();
  await page.getByRole('button', { name: /Delete selected/ }).click();
  await page
    .locator('.trash-dialog')
    .getByRole('button', { name: 'Delete permanently', exact: true })
    .click();
  await page.waitForTimeout(250);
  assert.equal((await page.evaluate(() => window.intelligence.trash())).length, 59);
  await shot('trash-bulk-1920');
  await page.getByRole('button', { name: 'Close Trash', exact: true }).click();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.getByRole('button', { name: 'Skills', exact: true }).click();
  await page
    .locator('.resource-card')
    .filter({ hasText: 'Wide skill fixture' })
    .getByRole('button', { name: 'Open instructions ↗', exact: true })
    .click();
  const skillWidth = await page
    .locator('.skill-editor-dialog')
    .evaluate((e) => e.getBoundingClientRect().width);
  assert.ok(skillWidth >= 900, String(skillWidth));
  await shot('skill-editor-1920');
  await page
    .locator('.skill-editor-dialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Browse files', exact: true }).click();
  await page.locator('.project-browser').waitFor();
  await page.waitForFunction(() => document.activeElement?.classList.contains('project-browser'));
  await page.getByRole('button', { name: '▧ example.pdf', exact: true }).click();
  await page.getByRole('button', { name: 'Open in default app', exact: true }).waitFor();
  await shot('project-browse-1920');
  for (const [width, height] of [
    [2560, 1440],
    [3440, 1440],
    [1366, 768],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, { width, height }) =>
        BrowserWindow.getAllWindows()[0].setSize(width, height),
      { width, height },
    );
    await settings();
    await nav('Optional Modules');
    const overflow = await page
      .locator('.settings-content')
      .evaluate((e) => e.scrollWidth - e.clientWidth);
    assert.ok(overflow <= 2, String(overflow));
    await shot('modules-' + width);
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1920, 1080));
  for (const theme of ['day', 'ink', 'night', 'summer', 'autumn', 'winter']) {
    await page.evaluate((theme) => window.intelligence.settings({ theme }), theme);
    await settings();
    await nav('Your profile');
    await shot('profile-' + theme);
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  }
  await page.evaluate(() => window.intelligence.settings({ language: 'ro' }));
  await page.getByRole('button', { name: 'Setări', exact: true }).click();
  await page
    .locator('.settings-navigation')
    .getByRole('button', { name: 'Module opționale', exact: true })
    .click();
  await page.getByText('Sinteză vocală · Numai în engleză', { exact: true }).waitFor();
  await shot('modules-romanian-1920');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, directory, captures }, null, 2));
} finally {
  await app?.close();
  modelServer.closeAllConnections();
  await new Promise((r) => modelServer.close(r));
}
