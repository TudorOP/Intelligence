import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { pickChoice, settingsSection } from './ui-pickers.mjs';
const directory = path.resolve('.test-data/workspace-automation-' + Date.now());
fs.mkdirSync(directory, { recursive: true });
for (const name of ['first', 'second', 'Downloads']) fs.mkdirSync(path.join(directory, name));
const source = path.join(directory, 'travel.txt');
fs.writeFileSync(source, 'Planuri de vacanță — păstrează originalul.');
const requests = [];
const server = createServer((req, res) => {
  if (req.url === '/api/tags') {
    res.end(
      JSON.stringify({
        models: Array.from({ length: 200 }, (_, i) => ({
          name: 'fixture-' + String(i).padStart(3, '0'),
        })),
      }),
    );
    return;
  }
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    if (body) {
      try {
        requests.push(JSON.parse(body));
      } catch {}
    }
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.end(
      JSON.stringify({
        message: { role: 'assistant', content: 'Source received. Original text preserved.' },
        done: true,
      }) + '\n',
    );
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const env = {
  ...process.env,
  INTELLIGENCE_TEST: '1',
  INTELLIGENCE_DATA_DIR: path.join(directory, 'data'),
};
delete env.ELECTRON_RUN_AS_NODE;
let app, page;
const errors = [];
const launch = async () => {
  app = await electron.launch({
    executablePath: electronPath,
    args: ['.', '--disable-gpu'],
    env,
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('.sidebar').waitFor();
  await page.emulateMedia({ reducedMotion: 'reduce' });
};
const shot = async (name) => {
  await page.waitForTimeout(150);
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    await window.capturePage(undefined, { stayHidden: true, stayAwake: true });
    await new Promise((resolve) => setTimeout(resolve, 100));
    return (await window.capturePage(undefined, { stayHidden: true, stayAwake: true }))
      .toPNG()
      .toString('base64');
  });
  fs.writeFileSync(path.join(directory, name + '.png'), Buffer.from(png, 'base64'));
};
const navigate = async (id) => {
  await app.evaluate(
    ({ BrowserWindow }, id) =>
      BrowserWindow.getAllWindows()[0].webContents.send('intelligence:event', {
        type: 'navigate',
        id,
      }),
    id,
  );
};
const selectNative = async (paths) =>
  app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths });
  }, paths);
try {
  await launch();
  const data = await page.evaluate(
    async ({ endpoint, directory }) => {
      const api = window.intelligence;
      await api.settings({
        provider: 'ollama',
        endpoint,
        model: 'fixture-000',
        semanticSearch: false,
        autoConsolidation: false,
        background: false,
      });
      const first = await api.project({ title: 'First project', directory: directory + '/first' }),
        second = await api.project({ title: 'Second project', directory: directory + '/second' });
      const profile = await api.workspace({
        action: 'profile-save',
        title: 'Organizer',
        data: {
          provider: 'ollama',
          model: 'fixture-099',
          inheritModel: false,
          toolGroups: null,
          resourcePolicy: 'shared',
        },
      });
      const notebook = await api.mutate({
        kind: 'notebook',
        title: 'Planuri private',
        data: { access: false },
      });
      const chapter = await api.mutate({
        kind: 'chapter',
        parent: notebook.id,
        title: 'Vacanță',
        data: {},
      });
      await api.mutate({
        kind: 'note',
        parent: chapter.id,
        title: 'Itinerar',
        data: { content: 'Conținut original' },
      });
      const conversation = await api.mutate({
        kind: 'conversation',
        title: 'Sources fixture',
        project: first.id,
        data: {},
      });
      const snapshot = await api.bootstrap(),
        board = snapshot.entities.find((e) => e.kind === 'board'),
        list = snapshot.entities.find((e) => e.kind === 'list' && e.parent === board.id);
      await api.mutate({
        id: board.id,
        data: { assigned: true, assignedAgent: profile.id, access: true },
      });
      const card = await api.mutate({
        kind: 'card',
        parent: list.id,
        title: 'Organize files',
        project: first.id,
        data: { assigned: true, assignedAgent: profile.id, access: true },
      });
      const task = await api.mutate({
        kind: 'matrix-task',
        parent: 'matrix-core',
        title: 'Monitor Downloads',
        data: { status: 'queued', content: 'Organize new files without overwriting originals' },
      });
      return {
        first: first.id,
        second: second.id,
        profile: profile.id,
        conversation: conversation.id,
        card: card.id,
        task: task.id,
      };
    },
    {
      endpoint: 'http://127.0.0.1:' + server.address().port,
      directory: directory.replaceAll('\\', '/'),
    },
  );
  await page.getByLabel('Active project', { exact: true }).selectOption(data.first);
  await page.waitForFunction(
    async (id) => (await window.intelligence.bootstrap()).settings.lastProject === id,
    data.first,
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBounds({ x: 40, y: 40, width: 1100, height: 760 }),
  );
  await page.waitForTimeout(350);
  await app.close();
  app = null;
  await launch();
  assert.equal(await page.getByLabel('Active project', { exact: true }).inputValue(), data.first);
  const bounds = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getNormalBounds(),
  );
  assert.equal(bounds.width, 1100);
  assert.equal(bounds.height, 760);
  await navigate(data.conversation);
  await page.getByRole('textbox', { name: 'Message Intelligence', exact: true }).waitFor();
  const model = page
    .locator('.chat-surface:not(.compact)')
    .getByRole('button', { name: 'Choose model', exact: true });
  assert.equal(Math.round((await model.boundingBox()).width), 32);
  await model.click();
  await page.getByRole('textbox', { name: 'Search choices', exact: true }).fill('fixture-199');
  assert.equal(await page.locator('.picker-option').count(), 1);
  await shot('searchable-chat-model');
  await page.locator('.picker-option').click();
  await page.waitForFunction(
    async (id) =>
      (await window.intelligence.bootstrap()).entities.find((e) => e.id === id).data.branchModel ===
      'fixture-199',
    data.conversation,
  );
  await page.getByRole('button', { name: 'Add sources', exact: true }).click();
  const sources = page.getByRole('dialog', { name: 'Add sources', exact: true });
  await sources.getByRole('button', { name: 'Notebooks', exact: true }).click();
  await sources.getByLabel('Find a resource', { exact: true }).fill('Itinerar');
  await sources
    .locator('.source-resource')
    .filter({ hasText: 'Itinerar' })
    .getByRole('checkbox')
    .check();
  await shot('resource-tree');
  await sources.getByRole('button', { name: 'Files & images', exact: true }).click();
  await selectNative([source, path.resolve('build/icon.png')]);
  await sources.getByRole('button', { name: 'Attach files and images', exact: true }).click();
  await sources.locator('.source-file').filter({ hasText: 'travel.txt' }).waitFor();
  await sources.getByLabel('Attachment project', { exact: true }).selectOption(data.second);
  await sources
    .locator('.source-file')
    .filter({ hasText: 'travel.txt' })
    .getByRole('button', { name: 'Keep in project', exact: true })
    .click();
  await sources.getByText(/Sources\/travel.txt/).waitFor();
  await shot('attachment-retention');
  await sources.getByRole('button', { name: 'Done', exact: true }).click();
  assert.equal(
    fs.readFileSync(path.join(directory, 'second', 'Sources', 'travel.txt'), 'utf8'),
    'Planuri de vacanță — păstrează originalul.',
  );
  await page
    .getByRole('textbox', { name: 'Message Intelligence', exact: true })
    .fill('Review the sources.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByText('Source received. Original text preserved.', { exact: true }).waitFor();
  await page.waitForFunction(
    async () => !(await window.intelligence.bootstrap()).activeConversations.length,
  );
  assert.ok(
    requests.some((request) => JSON.stringify(request.messages || []).includes('travel.txt')),
  );
  assert.ok(
    requests.some((request) => request.messages?.some((message) => message.images?.length)),
  );
  await page.getByRole('button', { name: /Ask Intelligence/ }).click();
  const pane = page.locator('.assistant-pane');
  await pickChoice(page, 'Choose model', 'fixture-098', pane);
  await pane.getByRole('button', { name: 'Add sources', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Add sources', exact: true })
    .getByRole('button', { name: 'Done', exact: true })
    .click();
  await shot('compact-assistant');
  await page.getByRole('button', { name: 'Close assistant', exact: true }).click();
  await page
    .locator('.sidebar')
    .getByRole('button', { name: 'Cognition Matrix', exact: true })
    .click();
  const core = page.locator('.matrix-list').first();
  await core.locator('.matrix-configuration > summary').click();
  await pickChoice(page, 'Choose agent', 'Organizer', core);
  await page.waitForFunction(
    async (id) =>
      (await window.intelligence.bootstrap()).entities.find((e) => e.id === 'matrix-core').data
        .assignedAgent === id,
    data.profile,
  );
  await core.getByRole('button', { name: 'Choose agent', exact: true }).click();
  await shot('matrix-agent-picker');
  await page.keyboard.press('Escape');
  await core.locator('.matrix-task-title').filter({ hasText: 'Monitor Downloads' }).click();
  const trigger = core.locator('.matrix-trigger-controls');
  await trigger.locator('summary').click();
  await trigger.getByLabel('Trigger for Monitor Downloads', { exact: true }).selectOption('file');
  await selectNative([path.join(directory, 'Downloads')]);
  await trigger.getByRole('button', { name: 'Choose computer folder', exact: true }).click();
  await trigger.getByRole('button', { name: 'Save trigger', exact: true }).click();
  await page.waitForFunction(
    async (id) =>
      (await window.intelligence.bootstrap()).entities.find((e) => e.id === id).data.trigger
        ?.mode === 'inbox',
    data.task,
  );
  await shot('continuous-folder-task');
  await navigate(data.card);
  await page.getByRole('button', { name: 'Choose agent', exact: true }).waitFor();
  await pickChoice(page, 'Choose agent', 'Manual only');
  await page.waitForFunction(
    async (id) =>
      (await window.intelligence.bootstrap()).entities.find((e) => e.id === id).data.assigned ===
      false,
    data.card,
  );
  await pickChoice(page, 'Choose agent', 'Organizer');
  await shot('task-agent-assignment');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(page, 'Agent access');
  await page.locator('.computer-disclosure > summary').click();
  await page.getByLabel('File access scope', { exact: true }).selectOption('folders');
  await selectNative([path.join(directory, 'Downloads')]);
  await page.getByRole('button', { name: 'Add folder', exact: true }).click();
  await page.getByText(path.join(directory, 'Downloads'), { exact: true }).waitFor();
  await shot('computer-access');
  await page.getByLabel('File access scope', { exact: true }).selectOption('system');
  await page
    .getByRole('switch', { name: 'Ask before destructive or unclassified actions', exact: true })
    .click();
  await page.waitForFunction(async () => {
    const s = (await window.intelligence.bootstrap()).settings;
    return s.computerScope === 'system' && s.askDestructive === false;
  });
  await settingsSection(page, 'Model & providers');
  await page.getByRole('button', { name: 'Refresh models', exact: true }).click();
  await pickChoice(page, 'Selected model', 'fixture-097');
  await settingsSection(page, 'Look & feel');
  await page.locator('.theme-options button').filter({ hasText: 'Day' }).first().click();
  await page.evaluate(() => window.intelligence.settings({ language: 'ro' }));
  await shot('settings-ro-day');
  await page.getByRole('button', { name: 'Închide setările', exact: true }).click();
  await page.evaluate(() => window.intelligence.settings({ language: 'en' }));
  for (const [width, height] of [
    [1920, 1080],
    [1024, 720],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, { width, height }) =>
        BrowserWindow.getAllWindows()[0].setBounds({ width, height }),
      { width, height },
    );
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 1);
    await shot('responsive-' + width);
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      result: 'passed',
      directory,
      checks: [
        'project/window restore',
        'searchable symbolic models',
        'resource trees',
        'attachment retention',
        'assistant parity',
        'Matrix/task agents',
        'continuous trigger',
        'computer permissions',
        'Romanian/day',
        'responsive layouts',
      ],
    }),
  );
} catch (error) {
  if (page) {
    console.error(await page.locator('body').innerText());
    await shot('failure').catch(() => {});
  }
  throw error;
} finally {
  if (app) await app.close();
  await new Promise((resolve) => server.close(resolve));
}
