import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { Store } from '../electron/store.mjs';
import { ensureProfiles } from '../electron/profiles.mjs';
import { Vault } from '../electron/vault.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { settingsSection } from './ui-pickers.mjs';

const baseline = process.argv.includes('--baseline');
const focused = process.argv.includes('--focused');
const supplemental = process.argv.includes('--supplemental');
const statesOnly = process.argv.includes('--states-only') || supplemental;
const states = (process.argv.includes('--states') || statesOnly) && !supplemental;
const directory = path.resolve(
  `.test-data/ui-repairs-${baseline ? 'before' : 'after'}-${Date.now()}`,
);
fs.mkdirSync(directory, { recursive: true });
console.log('UI review: ' + directory);
const themes = [
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
];
const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/broken')) {
    res.writeHead(503);
    res.end('{}');
    return;
  }
  res.end(
    JSON.stringify({
      models: [
        ...Array.from({ length: 360 }, (_, i) => ({
          name: 'review-model-' + String(i).padStart(3, '0'),
        })),
        {
          name: 'organization/long-model-with-a-long-provider-qualified-name-and-detailed-release-2026-10-15',
        },
      ],
    }),
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const store = new Store(path.join(directory, 'data'));
store.setSettings({
  onboardingComplete: true,
  semanticSearch: false,
  autoConsolidation: false,
  backgroundPaused: true,
  theme: 'day',
  provider: 'ollama',
  model: 'review-model-000',
  endpoint: 'http://127.0.0.1:' + server.address().port,
});
ensureProfiles(store);
const notebook = store.mutate({
  kind: 'notebook',
  title: 'UI review notebook',
  data: { access: true },
});
const chapter = store.mutate({
  kind: 'chapter',
  parent: notebook.id,
  title: 'Visual review',
  data: { content: 'Preserved chapter overview.' },
});
const note = store.mutate({
  kind: 'note',
  parent: chapter.id,
  title: 'Reading and writing',
  data: {
    content:
      '# Review notes\n\nA readable paragraph with **emphasis**.\n\n- [ ] Verify styling\n\n| Item | State |\n| --- | --- |\n| Text | Ready |',
  },
});
const board = store.all().find((e) => e.kind === 'board');
const list = store.children(board.id).find((e) => e.kind === 'list');
store.mutate({ id: board.id, data: { access: true } });
const card = store.mutate({
  kind: 'card',
  parent: list.id,
  title: 'Review the interface',
  data: { access: true, content: 'Check typography, controls and spacing.' },
});
const projectDirectory = path.join(directory, 'project');
fs.mkdirSync(projectDirectory);
fs.writeFileSync(path.join(projectDirectory, 'review.md'), '# UI review\n\nFixture content.');
store.mutate({
  kind: 'project',
  title: 'UI review project',
  data: { directory: projectDirectory, access: true, permission: 'read' },
});
store.mutate({
  kind: 'skill',
  title: 'Writing review',
  data: { content: 'Keep the text clear.', access: true },
});
store.mutate({
  kind: 'memory',
  title: 'Review preference',
  data: { content: 'Readable controls and consistent spacing.', access: true },
});
store.mutate({
  kind: 'connection',
  title: 'Disconnected review server',
  data: { transport: 'stdio', command: 'node', args: [], enabled: false },
});
store.mutate({
  kind: 'report',
  title: 'Visual findings',
  data: {
    status: 'done',
    summary: 'A fixture report.',
    content: '## Findings\n\nReadable report content.',
    sections: [{ title: 'Findings', content: 'Readable report content.' }],
  },
});
const conversation = store.mutate({ kind: 'conversation', title: 'Recorded discussion', data: {} });
store.message(conversation.id, 'user', 'How should this view read?');
store.message(
  conversation.id,
  'assistant',
  'With clear headings, readable text and consistent controls.',
);
const trash = store.mutate({
  kind: 'note',
  parent: notebook.id,
  title: 'Recoverable review draft',
  data: { content: 'Preserve this fixture.' },
});
store.mutate({ id: trash.id, action: 'trash' });
const vaultFile = new Vault(store).create({
  title: 'Visual review',
  content: '# Vault review\n\nReadable Markdown.',
  data: { access: true },
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
const results = {
  directory,
  baseline,
  captures: [],
  geometry: [],
  welcome: [],
  palettes: [],
  checks: [],
  errors: [],
};
const luminance = (hex) => {
  const value = hex.length === 4 ? [...hex.slice(1)].map((c) => c + c).join('') : hex.slice(1);
  const channels = [0, 2, 4]
    .map((i) => parseInt(value.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};
const contrast = (first, second) =>
  (Math.max(luminance(first), luminance(second)) + 0.05) /
  (Math.min(luminance(first), luminance(second)) + 0.05);
try {
  app = await electron.launch({ executablePath: electronPath, args: ['.', '--disable-gpu'], env });
  const page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  page.on('pageerror', (error) => results.errors.push(error.message));
  await page.locator('.sidebar').waitFor();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const resize = async (width, height) => {
    await app.evaluate(
      ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size),
      [width, height],
    );
    await page.waitForTimeout(100);
  };
  const settings = async (changes) => {
    await page.evaluate((changes) => window.intelligence.settings(changes), changes);
    if (changes.theme)
      await page.waitForFunction(
        (theme) => document.documentElement.dataset.theme === theme,
        changes.theme,
      );
    await page.waitForTimeout(70);
  };
  const nav = async (name) => {
    if (name === 'This device') await page.locator('.sidebar .nav-item').nth(8).click();
    else await page.locator('.sidebar').getByRole('button', { name, exact: true }).click();
    if (['Notebooks', 'Tasks'].includes(name))
      await page.locator('.breadcrumbs').getByRole('button', { name, exact: true }).click();
    await page.waitForTimeout(80);
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
    await page.waitForTimeout(100);
  };
  const shot = async (name) => {
    await page.getByText('Opening section…', { exact: true }).waitFor({ state: 'hidden' });
    await page.getByText('Opening settings…', { exact: true }).waitFor({ state: 'hidden' });
    await page.mouse.move(5, 5);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
    });
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
    results.captures.push(name);
    const geometry = await page.evaluate(() => {
      const selectors = [
        '.workspace',
        '.settings-content',
        '.agent-screen',
        '.assistant-pane',
        '.setup-dialog',
        '.report-editor',
        '.trash-dialog',
        '.license-reader',
        '.sources-dialog',
        '.feature-lesson',
        '.conversation-library',
      ];
      return selectors.flatMap((selector) =>
        [...document.querySelectorAll(selector)]
          .filter((e) => e.getBoundingClientRect().width)
          .map((e) => ({ selector, overflow: e.scrollWidth - e.clientWidth })),
      );
    });
    results.geometry.push({ name, geometry });
    if (!baseline)
      assert(
        geometry.every((g) => g.overflow <= 2),
        `${name}: ${JSON.stringify(geometry)}`,
      );
  };
  const openSettings = async (name) => {
    if (!(await page.locator('.settings-dialog').count()))
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await settingsSection(page, name);
  };
  const closeSettings = () =>
    page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await resize(1920, 1080);
  for (const theme of themes) {
    await settings({ theme });
    results.palettes.push(
      await page.evaluate((theme) => {
        const style = getComputedStyle(document.documentElement);
        return {
          theme,
          values: Object.fromEntries(
            ['bg', 'surface', 'sidebar', 'hover', 'text', 'muted', 'subtle'].map((key) => [
              key,
              style.getPropertyValue('--' + key).trim(),
            ]),
          ),
        };
      }, theme),
    );
    await nav('Chat');
    const bounds = await page.locator('.welcome-orbit').boundingBox();
    results.welcome.push({ theme, width: bounds.width, height: bounds.height });
    await shot(theme + '-chat');
  }
  if (!baseline) {
    for (const { theme, values } of results.palettes) {
      for (const foreground of ['text', 'muted', 'subtle']) {
        for (const surface of ['bg', 'surface', 'sidebar', 'hover']) {
          assert(
            contrast(values[foreground], values[surface]) >= 4.5,
            `${theme}: ${foreground}/${surface} contrast ${contrast(values[foreground], values[surface])}`,
          );
        }
      }
    }
    results.checks.push(
      'Primary, secondary and small-label text contrast >= 4.5:1 on four core surfaces in all themes',
    );
    assert(
      results.welcome.every(
        (g) =>
          Math.abs(g.width - results.welcome[0].width) < 1 &&
          Math.abs(g.height - results.welcome[0].height) < 1,
      ),
      'Welcome geometry differs between themes',
    );
    results.checks.push('Identical Chat artwork bounds in all ten themes');
  }
  await settings({ theme: 'day' });
  await openSettings('Look & feel');
  await page.locator('.settings-content').evaluate((e) => (e.scrollTop = e.scrollHeight));
  await shot('appearance-collapsed');
  await settingsSection(page, 'Icons & identity');
  await page.locator('.settings-content').evaluate((e) => (e.scrollTop = e.scrollHeight));
  await shot('appearance-expanded');
  await openSettings('Agent access');
  await shot('access');
  const disclosure = page.locator('.agent-grants-menu > summary');
  if (await disclosure.count()) await disclosure.click();
  const grants = page.locator('.resource-grants > summary');
  if (await grants.count()) await grants.click();
  if (!baseline) {
    const panel = page.locator('.agent-grants');
    await panel.locator('.resource-grants select').selectOption(notebook.id);
    await panel.locator('.grant-row').filter({ hasText: notebook.title }).waitFor();
    await page.getByRole('switch', { name: 'Notebook access', exact: true }).uncheck();
    const suspended = await page.evaluate(() => window.intelligence.bootstrap());
    assert.equal(suspended.settings.notebookAccess, false);
    assert(
      suspended.entities
        .find((e) => e.id === suspended.settings.activeAgent)
        .data.resourceGrants.some((g) => g.id === notebook.id),
    );
    await page.getByRole('switch', { name: 'Notebook access', exact: true }).check();
    await panel
      .locator('.grant-row')
      .filter({ hasText: notebook.title })
      .getByRole('button', { name: 'Revoke', exact: true })
      .click();
    await panel
      .locator('.grant-row')
      .filter({ hasText: notebook.title })
      .waitFor({ state: 'detached' });
    results.checks.push('Grant add/revoke works; global suspension preserves saved grants');
  }
  await page.locator('.agent-grants').scrollIntoViewIfNeeded();
  await shot('access-agent');
  const computer = page.locator('.computer-disclosure > summary');
  if (await computer.count()) {
    await computer.click();
    await page.locator('.computer-access').scrollIntoViewIfNeeded();
    await shot('access-computer');
  }
  await closeSettings();
  await page.locator('.agent-profile').click();
  await page.getByRole('button', { name: 'Edit profile', exact: true }).first().click();
  if (baseline) await page.locator('.agent-ratings-card > summary').click();
  else await page.locator('.agent-ratings-card h2').waitFor();
  if (!baseline) {
    const toolsDropdown = page.locator('.agent-tools-card > summary');
    if (await toolsDropdown.count()) await toolsDropdown.click();
    await page.locator('.agent-tool-choices').evaluate((e) => (e.open = true));
    const categoryCount = await page.locator('[data-tool-category]').count();
    assert.equal(
      categoryCount || (await page.locator('.agent-tool-choices .setting-switch').count()),
      10,
    );
    await shot('agent-tools-expanded');
    await page.locator('.agent-tool-choices > summary').click();
    await page.getByRole('switch', { name: 'Create reusable skills', exact: true }).uncheck();
    await page.getByRole('button', { name: 'Save profile', exact: true }).click();
    await page.waitForFunction(async () => {
      const state = await window.intelligence.bootstrap();
      return (
        state.entities.find((e) => e.id === state.settings.activeAgent).data.allowSkillCreation ===
        false
      );
    });
    if (
      (await toolsDropdown.count()) &&
      !(await toolsDropdown.locator('..').evaluate((e) => e.open))
    )
      await toolsDropdown.click();
    await page.getByRole('switch', { name: 'Create reusable skills', exact: true }).check();
    await page.getByRole('button', { name: 'Save profile', exact: true }).click();
    if (await toolsDropdown.count()) await page.keyboard.press('Escape');
    results.checks.push('Ten unique tool categories and persisted skill-creation control');
  }
  await shot('agent-expanded');
  await nav('Chat');
  const trigger = page
    .locator('.chat-surface:not(.compact)')
    .getByRole('button', { name: 'Choose model', exact: true });
  await trigger.click();
  await page.locator('.picker-option').nth(299).waitFor({ state: 'attached' });
  await shot('picker-main');
  const pickerCheck = async () => {
    const bounds = await page.locator('.search-picker-panel').evaluate((e) => {
      const list = e.querySelector('.picker-options'),
        footer = e.querySelector('.picker-footer');
      return {
        list: list.getBoundingClientRect().toJSON(),
        footer: footer.getBoundingClientRect().toJSON(),
        panel: e.getBoundingClientRect().toJSON(),
        overflow: getComputedStyle(list).overflowY,
        height: innerHeight,
      };
    });
    if (!baseline) {
      assert(
        bounds.list.bottom <= bounds.footer.top &&
          bounds.panel.bottom <= bounds.height &&
          bounds.panel.top >= 0,
        JSON.stringify(bounds),
      );
      assert.equal(bounds.overflow, 'auto');
    }
    results.checks.push({ picker: bounds });
  };
  await pickerCheck();
  await page.getByRole('textbox', { name: 'Search choices', exact: true }).press('ArrowDown');
  await page.keyboard.press('End');
  if (!baseline) {
    const focus = await page.locator('.picker-options').evaluate((e) => ({
      top: e.getBoundingClientRect().top,
      bottom: e.getBoundingClientRect().bottom,
      focus: document.activeElement.getBoundingClientRect().toJSON(),
    }));
    assert(
      focus.focus.top >= focus.top - 1 && focus.focus.bottom <= focus.bottom + 1,
      JSON.stringify(focus),
    );
  }
  await page.keyboard.press('Escape');
  assert(await trigger.evaluate((e) => e === document.activeElement));
  await trigger.click();
  await page.getByRole('textbox', { name: 'Search choices', exact: true }).fill('review-model-359');
  assert.equal(await page.locator('.picker-option').count(), 1);
  await page.locator('.picker-option').click();
  await trigger.click();
  await page.getByRole('textbox', { name: 'Search choices', exact: true }).fill('no-such-model');
  await page.getByText('No matching choices', { exact: true }).waitFor();
  await shot('picker-empty');
  await page.keyboard.press('Escape');
  await page.locator('.assistant-toggle').click();
  await page
    .locator('.assistant-pane')
    .getByRole('button', { name: 'Choose model', exact: true })
    .click();
  await page.locator('.picker-option').nth(299).waitFor({ state: 'attached' });
  await shot('picker-assistant');
  await pickerCheck();
  await page.keyboard.press('Escape');
  await page.getByLabel('Close assistant', { exact: true }).click();
  if (!baseline && !focused) {
    for (const theme of themes) {
      await settings({ theme });
      if (!statesOnly) {
        for (const name of [
          'Projects',
          'Notebooks',
          'Vault',
          'Tasks',
          'Calendar',
          'Reports',
          'Cognition Matrix',
          'This device',
          'Memory',
          'Skills',
          'Connections',
        ]) {
          await nav(name);
          await shot(theme + '-' + name.toLowerCase().replaceAll(' ', '-'));
        }
        await navigate(chapter.id);
        await shot(theme + '-chapter');
        await navigate(note.id);
        await page.locator('.tiptap').waitFor();
        await shot(theme + '-note');
        await navigate(vaultFile.id);
        await shot(theme + '-vault-document');
        await navigate(card.id);
        await shot(theme + '-task-detail');
        await navigate(conversation.id);
        await shot(theme + '-chat-populated');
        await page.locator('.agent-profile').click();
        await shot(theme + '-agent-list');
        await page.getByRole('button', { name: 'Edit profile', exact: true }).first().click();
        await shot(theme + '-agent-profile');
        if (baseline) await page.locator('.agent-ratings-card > summary').click();
        else await page.locator('.agent-ratings-card h2').waitFor();
        await shot(theme + '-agent-ratings');
        await page.locator('.assistant-toggle').click();
        await shot(theme + '-assistant');
        await page.getByLabel('Close assistant', { exact: true }).click();
        for (const name of [
          'Your profile',
          'Look & feel',
          'Icons & identity',
          'Model & providers',
          'Chat & context',
          'Search providers',
          'Optional Modules',
          'Agent access',
          'Background & automation',
          'Cognition Matrix',
          'Your data',
        ]) {
          await openSettings(name);
          await shot(theme + '-settings-' + name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-'));
        }
        await page
          .locator('.settings-help-menu > summary')
          .filter({ hasText: 'Help & setup' })
          .click();
        await page.getByRole('button', { name: 'Written guide', exact: true }).click();
        await page.locator('.help-guide').waitFor();
        await shot(theme + '-written-guide');
        await page.getByRole('button', { name: 'Feature lessons', exact: true }).click();
        await shot(theme + '-lessons');
        await closeSettings();
      }
      if (states) {
        await openSettings('Your data');
        await page.getByRole('button', { name: 'Open Trash ↗', exact: true }).click();
        await page.locator('.trash-dialog').waitFor();
        await shot(theme + '-trash');
        await page.getByRole('button', { name: 'Close Trash', exact: true }).click();
        await page.locator('.settings-help-menu > summary').filter({ hasText: 'Licenses' }).click();
        await page.getByRole('button', { name: 'Read licenses & notices', exact: true }).click();
        await page.locator('.license-text').waitFor();
        await shot(theme + '-licenses');
        await page
          .locator('.license-reader')
          .getByRole('button', { name: 'Close', exact: true })
          .click();
        const help = page.locator('.settings-help-menu').filter({ hasText: 'Review setup' });
        if (!(await help.getAttribute('open'))) await help.locator('summary').click();
        await page.getByRole('button', { name: 'Feature lessons', exact: true }).click();
        await page.getByRole('button', { name: 'Start lesson', exact: true }).first().click();
        await page.locator('.feature-lesson').waitFor();
        await shot(theme + '-feature-lesson');
        await page.getByRole('button', { name: 'Close lesson', exact: true }).click();
        if (!(await page.locator('.settings-dialog').count())) await openSettings('Your data');
        const setupHelp = page.locator('.settings-help-menu').filter({ hasText: 'Review setup' });
        if (!(await setupHelp.getAttribute('open'))) await setupHelp.locator('summary').click();
        await page.getByRole('button', { name: 'Review setup', exact: true }).click();
        const setup = page.locator('.setup-dialog');
        await setup.waitFor();
        for (let step = 0; step < 6; step++) {
          await shot(theme + '-setup-' + step);
          if (step < 5)
            await setup
              .getByRole('button', { name: step === 0 ? 'Start setup' : 'Continue', exact: true })
              .click();
        }
        await setup.getByRole('button', { name: 'Close guide', exact: true }).click();
        await setup.waitFor({ state: 'detached' });
        if (await page.locator('.settings-dialog').count()) await closeSettings();
        await nav('Reports');
        await page.getByRole('button', { name: 'New report', exact: true }).click();
        await page.locator('.report-template-library').waitFor();
        await shot(theme + '-report-templates');
        await page.getByRole('button', { name: 'New custom report', exact: true }).click();
        await page.locator('.report-editor').waitFor();
        await shot(theme + '-report-editor');
        await page
          .locator('.report-editor')
          .getByRole('button', { name: 'Cancel', exact: true })
          .click();
        await page.getByRole('button', { name: 'Recent conversations', exact: true }).click();
        await page.locator('.conversation-library').waitFor();
        await shot(theme + '-conversation-library');
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Find anything', exact: false }).click();
        await shot(theme + '-command-search');
        await page.keyboard.press('Escape');
        await nav('Chat');
        await page
          .locator('.chat-surface:not(.compact)')
          .getByRole('button', { name: 'Add sources', exact: true })
          .click();
        await page.locator('.sources-dialog').waitFor();
        await shot(theme + '-sources');
        await page.keyboard.press('Escape');
      }
      if (supplemental) {
        await nav('Notebooks');
        await page.locator('.notebook-shelf').waitFor();
        await shot(theme + '-notebook-shelf');
        await nav('Reports');
        await page.locator('.report-library-row').first().waitFor();
        await shot(theme + '-reports-populated');
        await page.locator('.report-library-row > button').first().click();
        await page.locator('.report-reader').waitFor();
        await shot(theme + '-report-reader');
        await page
          .locator('.report-reader')
          .getByRole('button', { name: 'Close', exact: true })
          .click();
        await nav('Projects');
        await page.getByRole('button', { name: 'Browse files', exact: true }).first().click();
        await page.locator('.project-browser').waitFor();
        await shot(theme + '-project-browser');
        await page.keyboard.press('Escape');
        await nav('Cognition Matrix');
        await page.locator('.matrix-configuration > summary').first().click();
        await shot(theme + '-matrix-expanded');
        await nav('Memory');
        await page.getByText('Stored details & sources', { exact: true }).first().click();
        await shot(theme + '-memory-expanded');
        await nav('Calendar');
        await page.getByRole('button', { name: 'New event', exact: true }).click();
        await page.locator('.event-editor').waitFor();
        await shot(theme + '-calendar-event');
        await page.keyboard.press('Escape');
        await openSettings('Agent access');
        await page.getByRole('button', { name: 'Notebook sharing', exact: true }).click();
        await page.locator('.access-dialog').waitFor();
        await shot(theme + '-notebook-sharing');
        await page.getByRole('button', { name: 'Close access settings', exact: true }).click();
        if (await page.locator('.settings-dialog').count()) await closeSettings();
        await nav('Chat');
        const choose = page
          .locator('.chat-surface:not(.compact)')
          .getByRole('button', { name: 'Choose model', exact: true });
        await choose.click();
        await page.getByRole('textbox', { name: 'Search choices', exact: true }).fill('long-model');
        await shot(theme + '-picker-long-name');
        await page.keyboard.press('Escape');
        await settings({ endpoint: 'http://127.0.0.1:' + server.address().port + '/broken' });
        await choose.click();
        await page
          .locator('.search-picker-panel > [role="status"]')
          .filter({ hasText: 'Models unavailable' })
          .waitFor();
        await shot(theme + '-picker-unavailable');
        await pickerCheck();
        await page.keyboard.press('Escape');
        await settings({ endpoint: 'http://127.0.0.1:' + server.address().port });
      }
      console.log('Reviewed all main views/settings: ' + theme);
    }
    await settings({ theme: 'autumn' });
    for (const [width, height, scale, language] of [
      [1366, 768, '', 'en'],
      [2560, 1440, '', 'en'],
      [1920, 1080, '1.25', 'en'],
      [1366, 768, '', 'ro'],
    ]) {
      await resize(width, height);
      await page.evaluate((zoom) => (document.body.style.zoom = zoom), scale);
      await settings({ language });
      const prefix = `${width}-${height}-${scale || '1'}-${language}`;
      await shot(prefix + '-agent');
      await page
        .getByRole('button', { name: language === 'ro' ? 'Setări' : 'Settings', exact: true })
        .click();
      for (const section of ['appearance', 'access']) {
        await page
          .locator('.settings-navigation button')
          .filter({
            hasText:
              section === 'appearance'
                ? language === 'ro'
                  ? 'Aspect'
                  : 'Look & feel'
                : language === 'ro'
                  ? 'Acces'
                  : 'Agent access',
          })
          .first()
          .click();
        await shot(prefix + '-' + section);
      }
      await page.locator('.settings-close').click();
    }
  }
  assert.deepEqual(results.errors, []);
  console.log(
    JSON.stringify({
      result: 'passed',
      directory,
      captures: results.captures.length,
      checks: results.checks,
      welcome: results.welcome,
    }),
  );
} finally {
  fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify(results, null, 2));
  if (app) await app.close();
  await new Promise((resolve) => server.close(resolve));
}
