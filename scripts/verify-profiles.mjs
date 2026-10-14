import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { Store } from '../electron/store.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const directory = path.resolve('.test-data/profiles-' + Date.now()),
  projectDirectory = path.join(directory, '..', 'v2-project-' + Date.now());
fs.mkdirSync(projectDirectory, { recursive: true });
fs.writeFileSync(path.join(projectDirectory, 'readme.txt'), 'First line\nOriginal second line\n');
const store = new Store(directory);
store.setSettings({
  theme: 'day',
  semanticSearch: false,
  autoConsolidation: false,
  model: 'fixture-model',
});
const project = store.mutate({
  kind: 'project',
  title: 'UI project',
  data: { directory: projectDirectory, access: false },
});
const note = store.all().find((e) => e.kind === 'note');
store.mutate({ id: note.id, data: { content: '# Earlier version\n\nOriginal text' } });
store.mutate({ id: note.id, data: { content: '# Current version\n\nUpdated text' } });
const c = store.mutate({ kind: 'conversation', title: 'Branch fixture' });
store.message(c.id, 'user', 'Question');
store.message(c.id, 'assistant', 'Answer', {
  receipt: {
    context: [{ id: note.id, revision: note.revision }],
    tools: ['read_item'],
    model: 'fixture-model',
    provider: 'ollama',
  },
});
store.close();
const env = { ...process.env, INTELLIGENCE_TEST: '1', INTELLIGENCE_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
// Preserve an explicitly selected dev preview; otherwise use the built interface.
const app = await electron.launch({
  executablePath: electronPath,
  args: ['.', '--disable-gpu'],
  env,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('heading', { name: /Make yourself/ }).waitFor();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const resize = (w, h) =>
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
  };
  await resize(1920, 1080);
  await page.locator('.agent-profile').click();
  await page
    .locator('.agent-profile-grid')
    .getByRole('button', { name: 'Edit profile', exact: true })
    .first()
    .click();
  await page.getByRole('heading', { name: 'Intelligence', exact: true }).waitFor();
  for (const [label, value] of [
    ['Intelligence', 5],
    ['Knowledge', 4],
    ['Tool-use', 3],
    ['Long Tasks', 2],
  ])
    await page.getByRole('button', { name: label + ' ' + value, exact: true }).click();
  assert.match(await page.locator('.agent-performance').innerText(), /3\.5/);
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await capture('agent-1080');
  await page.getByRole('button', { name: 'Agent Profiles', exact: true }).click();
  await page.getByRole('button', { name: 'Create agent profile', exact: true }).click();
  await page.getByLabel('Agent name', { exact: true }).fill('Writer');
  await page
    .getByLabel('Personality & preferences', { exact: true })
    .fill('A calm precise writing companion.');
  await page.getByLabel('Model ID', { exact: true }).fill('writer-model');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await page.getByRole('button', { name: 'Agent Profiles', exact: true }).click();
  const writer = page
    .locator('.agent-profile-grid article')
    .filter({ has: page.getByRole('heading', { name: 'Writer', exact: true }) });
  await writer.getByRole('button', { name: 'Use this agent', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('.agent-profile')?.textContent.includes('Writer'),
  );
  await capture('profiles-1080');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Look & feel', exact: true }).click();
  for (const look of ['bound', 'paperback', 'spiral', 'index', 'folio']) {
    await page.getByLabel('Notebook look').selectOption(look);
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await page.locator('.sidebar').getByRole('button', { name: 'Notebooks', exact: true }).click();
    await capture('notebooks-' + look);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Look & feel', exact: true }).click();
  }
  await page.getByRole('switch', { name: /Subtle background artwork/ }).uncheck();
  await page.waitForFunction(
    () => document.querySelector('.app-shell').dataset.backgrounds === 'false',
  );
  await page.getByLabel('Search settings').fill('backup');
  assert.equal(
    await page
      .locator('.settings-dialog > aside')
      .getByRole('button', { name: 'Your data', exact: true })
      .count(),
    1,
  );
  await page.getByRole('button', { name: 'Your data', exact: true }).click();
  await page.getByLabel('Search settings').fill('');
  await capture('settings-data-1080');
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.getByRole('separator', { name: 'Resize sidebar', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() =>
    window.intelligence.bootstrap().then((s) => s.settings.paneWidths.sidebar === 258),
  );
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Escape');
  const splitterBox = await page
    .getByRole('separator', { name: 'Resize sidebar', exact: true })
    .boundingBox();
  await page.mouse.move(splitterBox.x + 3, splitterBox.y + 200);
  await page.mouse.down();
  await page.mouse.move(splitterBox.x + 33, splitterBox.y + 200, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(() =>
    window.intelligence.bootstrap().then((s) => s.settings.paneWidths.sidebar === 288),
  );
  await page.evaluate(() =>
    window.intelligence.settings({ paneWidths: { sidebar: 258, navigator: 265, assistant: 390 } }),
  );
  await page.keyboard.press('Control+k');
  await page.getByLabel('Global search').fill('pause');
  await page.getByRole('button', { name: /Pause background AI.*Command/ }).click();
  await page.waitForFunction(() =>
    window.intelligence.bootstrap().then((s) => s.settings.backgroundPaused),
  );
  await page.getByRole('button', { name: 'Resume background AI', exact: true }).click();
  await page.locator('.sidebar').getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Browse files', exact: true }).click();
  await page
    .locator('.project-browser')
    .getByRole('button', { name: '▧ readme.txt', exact: true })
    .click();
  await page.getByLabel('Project file content').fill('First line\nChanged second line\n');
  await page.locator('.project-browser summary').filter({ hasText: 'Preview changes' }).click();
  await page.locator('.line-diff ins').waitFor();
  await page.getByRole('button', { name: 'Save file', exact: true }).click();
  await capture('project-editor-1080');
  assert.equal(
    fs.readFileSync(path.join(projectDirectory, 'readme.txt'), 'utf8'),
    'First line\nChanged second line\n',
  );
  await page
    .locator('.sidebar')
    .getByRole('button', { name: 'Cognition Matrix', exact: true })
    .click();
  const core = page.locator('.matrix-list').first();
  await core.getByRole('switch', { name: 'Integrate Matrix Core', exact: true }).waitFor();
  assert.equal(
    await core.getByRole('switch', { name: 'Integrate Matrix Core', exact: true }).count(),
    1,
  );
  await core.locator('.matrix-configuration > summary').click();
  await core.getByLabel('List description for Core').waitFor({ state: 'attached' });
  await capture('matrix-configuration-1080');
  await page.locator('.sidebar').getByRole('button', { name: 'Notebooks', exact: true }).click();
  await page.getByLabel('Active project').selectOption('');
  const books = page.locator('.book-notebook');
  await books
    .nth(0)
    .locator('.book-cover')
    .click({ modifiers: ['Control'] });
  await books
    .nth(1)
    .locator('.book-cover')
    .click({ modifiers: ['Shift'] });
  assert.equal(await page.locator('.book-notebook[data-selected="true"]').count(), 2);
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await page.locator('.book-notebook').first().locator('summary').click();
  await page.locator('.floating-actions').getByRole('button', { name: 'Pin', exact: true }).click();
  await page.locator('.sidebar-pins').waitFor();
  await page.getByRole('button', { name: 'Recent conversations', exact: true }).click();
  await page
    .locator('.conversation-library')
    .getByRole('button', { name: /Branch fixture/ })
    .first()
    .click();
  assert.equal(await page.locator('.response-receipt').count(), 0);
  await page.getByRole('button', { name: 'Branch from here', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('.chat-top')?.textContent.includes('Branch fixture · Branch'),
  );
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await page.locator('.activity-panel').waitFor();
  await capture('activity-1080');
  await page.getByRole('button', { name: 'Close activity', exact: true }).click();
  for (const theme of ['ink', 'day', 'night', 'summer', 'autumn', 'winter']) {
    await page.evaluate((theme) => window.intelligence.settings({ theme }), theme);
    await page.waitForFunction((theme) => document.documentElement.dataset.theme === theme, theme);
    await page.locator('.agent-profile').click();
    await resize(2560, 1440);
    await capture('agent-' + theme + '-1440');
  }
  await resize(1366, 768);
  await capture('agent-compact');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Your data', exact: true }).click();
  await page.locator('.settings-help-menu > summary').filter({ hasText: 'Help & setup' }).click();
  await page.getByRole('button', { name: 'Review setup', exact: true }).first().click();
  await page.getByRole('dialog', { name: 'Getting started', exact: true }).waitFor();
  await capture('guide-compact');
  await page.getByRole('button', { name: 'Start setup', exact: true }).click();
  for (let i = 0; i < 3; i++)
    await page
      .locator('.onboarding')
      .getByRole('button', { name: 'Continue', exact: true })
      .click();
  await capture('guide-memory-compact');
  await page.getByRole('button', { name: 'Close guide', exact: true }).click();
  await page.locator('.onboarding').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await resize(1920, 1080);
  await page.evaluate(() => {
    document.body.style.zoom = '1.25';
  });
  await capture('agent-text-scale-125');
  assert.ok(await page.locator('.sidebar').evaluate((e) => e.scrollWidth <= e.clientWidth + 1));
  await page.evaluate(() => {
    document.body.style.zoom = '';
  });
  await page.evaluate(() => window.intelligence.settings({ language: 'ro' }));
  await page.waitForFunction(() => document.documentElement.lang === 'ro');
  await capture('agent-romanian');
  await page.reload();
  await page.waitForFunction(() =>
    window.intelligence
      .bootstrap()
      .then((s) => s.settings.notebookLook === 'folio' && s.settings.paneWidths.sidebar === 258),
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      result: 'passed',
      directory,
      checks: [
        'profiles/ratings',
        'five notebook looks',
        'Settings/search/switches',
        'background toggle',
        'splitter pointer/keyboard/persistence',
        'palette pause',
        'private project editor/diff',
        'Matrix configuration',
        'Ctrl/Shift selection',
        'pins',
        'branch/receipt',
        'activity',
        'six themes',
        '1366/1920/2560',
        'guide/theme setup',
        '125% text scaling',
        'Romanian',
        'no renderer errors',
      ],
    }),
  );
} finally {
  await app.close();
}
