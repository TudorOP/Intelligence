import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { Store } from '../electron/store.mjs';
import { ensureProfiles } from '../electron/profiles.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { settingsSection } from './ui-pickers.mjs';
const directory = path.resolve('.test-data/profile-layout-' + Date.now());
fs.mkdirSync(directory, { recursive: true });
console.log(directory);
const store = new Store(path.join(directory, 'data'));
store.setSettings({
  onboardingComplete: true,
  semanticSearch: false,
  autoConsolidation: false,
  backgroundPaused: true,
  theme: 'day',
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
const app = await electron.launch({
  executablePath: electronPath,
  args: ['.', '--disable-gpu'],
  env,
});
const results = { captures: [], errors: [] };
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  page.on('pageerror', (e) => results.errors.push(e.message));
  await page.locator('.sidebar').waitFor();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const resize = async (width, height) => {
    await app.evaluate(
      ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size),
      [width, height],
    );
    await page.waitForTimeout(120);
  };
  const configure = async (changes) => {
    await page.evaluate((changes) => window.intelligence.settings(changes), changes);
    await page.waitForTimeout(120);
  };
  await resize(1920, 1080);
  await page.locator('.agent-profile').click();
  await page.getByRole('button', { name: 'Edit profile', exact: true }).first().click();
  await page.locator('.agent-ratings-card h2').waitFor();
  const capture = async (name, fit = false) => {
    await page.locator('.workspace').evaluate((e) => (e.scrollTop = 0));
    await page.mouse.move(250, 110);
    await page.evaluate(() => document.fonts.ready);
    const layout = await page.locator('.agent-editor').evaluate((editor) => {
      const rect = (e) => {
        const r = e.getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          right: r.right,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
        };
      };
      const workspace = document.querySelector('.workspace');
      return {
        editor: rect(editor),
        workspace: rect(workspace),
        overflow: workspace.scrollWidth - workspace.clientWidth,
        cards: [...editor.querySelectorAll('.agent-profile-column > section')].map((e) => ({
          name: e.className,
          ...rect(e),
          overflow: e.scrollWidth - e.clientWidth,
        })),
        ratings: [...editor.querySelectorAll('.star-rating button')].map(rect),
        categories: [...editor.querySelectorAll('.agent-category-grid .setting-switch')].map(rect),
      };
    });
    results.captures.push({ name, layout });
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
    assert.ok(layout.overflow <= 2, name + ': workspace overflow');
    assert.ok(
      layout.cards.every((c) => c.overflow <= 2),
      name + ': card overflow',
    );
    assert.equal(layout.ratings.length, 24);
    assert.equal(layout.categories.length, 10);
    if (fit) {
      assert.ok(
        layout.cards.every((c) => c.bottom <= layout.workspace.bottom + 1),
        name + ': profile should fit without page scrolling ' + JSON.stringify(layout.cards),
      );
      assert.ok(
        layout.ratings.every((c) => c.bottom <= layout.workspace.bottom),
        name + ': ratings visible',
      );
    }
  };
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
    await configure({ theme });
    await capture('profile-' + theme, true);
  }
  await page.getByRole('button', { name: 'Intelligence 4', exact: true }).click();
  await page.getByRole('button', { name: 'Knowledge 3', exact: true }).click();
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await page.waitForFunction(async () => {
    const s = await window.intelligence.bootstrap();
    return s.entities.find((e) => e.id === s.settings.activeAgent).data.ratings.intelligence === 4;
  });
  await page.reload();
  await page.locator('.agent-profile').click();
  await page.getByRole('button', { name: 'Edit profile', exact: true }).first().click();
  assert.equal(
    await page
      .getByRole('button', { name: 'Intelligence 4', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  await capture('profile-saved-ratings', true);
  for (const [w, h, zoom, language] of [
    [2560, 1440, '1', 'en'],
    [3440, 1440, '1', 'ro'],
    [1920, 1080, '1', 'ro'],
    [1920, 1080, '1.25', 'en'],
    [1366, 768, '1', 'ro'],
    [1280, 800, '1', 'en'],
  ]) {
    await resize(w, h);
    await page.evaluate((zoom) => (document.body.style.zoom = zoom), zoom);
    await configure({ language });
    await capture(`profile-${w}-${h}-${zoom}-${language}`, zoom === '1' && w >= 1920);
  }
  await resize(1920, 1080);
  await page.evaluate(() => (document.body.style.zoom = '1'));
  await configure({ language: 'en' });
  await page
    .getByLabel('Personality & preferences', { exact: true })
    .fill('Keep all this user-authored text. '.repeat(100));
  await capture('profile-long-preferences', true);
  await page.locator('.assistant-toggle').click();
  await capture('profile-with-assistant');
  await page.locator('.assistant-toggle').click();
  // Native grants remain live while the profile form has unsaved changes.
  await page.getByRole('textbox', { name: 'Find a resource', exact: true }).fill('');
  const grantSelect = page.locator('.resource-grants select');
  const option = await grantSelect.locator('option').nth(1).getAttribute('value');
  await grantSelect.selectOption(option);
  await page.locator('.grant-row').first().waitFor();
  await page
    .locator('.grant-row')
    .first()
    .getByRole('button', { name: 'Revoke', exact: true })
    .click();
  await page.locator('.grant-row').waitFor({ state: 'detached' });
  assert.ok(
    (await page.getByLabel('Personality & preferences', { exact: true }).inputValue()).startsWith(
      'Keep all this',
    ),
  );
  await capture('profile-grants', true);
  await page.evaluate(async () => {
    for (let i = 0; i < 20; i++) {
      await window.intelligence.mutate({
        kind: 'skill',
        title: 'Long saved procedure ' + i + ' with extra detail',
        data: { access: true, content: 'Fixture' },
      });
      await window.intelligence.mutate({
        kind: 'connection',
        title: 'Long MCP server name ' + i + ' with extra detail',
        data: { transport: 'stdio', command: 'node', args: [], enabled: false },
      });
    }
  });
  await capture('profile-long-catalog', true);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await settingsSection(page, 'Agent access');
  await page.locator('.computer-disclosure > summary').click();
  await page.getByLabel('File access scope', { exact: true }).selectOption('system');
  assert.equal(
    await page.locator('.computer-access option[value="system"]').textContent(),
    'Any file on the computer',
  );
  for (const language of ['en', 'ro']) {
    await configure({ language });
    await page.locator('.computer-access').scrollIntoViewIfNeeded();
    await page.mouse.move(250, 110);
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
    fs.writeFileSync(
      path.join(directory, 'computer-any-file-' + language + '.png'),
      Buffer.from(png, 'base64'),
    );
    if (language === 'ro')
      assert.equal(
        await page.locator('.computer-access option[value="system"]').textContent(),
        'Orice fișier de pe calculator',
      );
    results.captures.push({ name: 'computer-any-file-' + language });
  }
  assert.equal(
    (await page.evaluate(() => window.intelligence.bootstrap())).settings.computerScope,
    'system',
  );
  assert.deepEqual(results.errors, []);
} finally {
  fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify(results, null, 2));
  await app.close();
}
console.log('Profile layout passed: ' + results.captures.length + ' captures');
