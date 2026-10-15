import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { Store } from '../electron/store.mjs';
import { ensureProfiles } from '../electron/profiles.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
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
    await page.locator('.main-canvas').evaluate((e) => (e.scrollTop = 0));
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
      const workspace = document.querySelector('.main-canvas');
      return {
        editor: rect(editor),
        workspace: rect(workspace),
        overflow: workspace.scrollWidth - workspace.clientWidth,
        pageScroll: workspace.scrollHeight - workspace.clientHeight,
        toolsOpen: editor.querySelector('.agent-tools-card').open,
        cards: [...editor.querySelectorAll('.agent-profile-layout > section')].map((e) => ({
          name: e.className,
          ...rect(e),
          overflow: e.scrollWidth - e.clientWidth,
        })),
        ratings: [...editor.querySelectorAll('.star-rating button')].map(rect),
        categories: [...editor.querySelectorAll('[data-tool-category]')].map(rect),
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
      assert.ok(layout.pageScroll <= 1, name + ': page must not scroll ' + layout.pageScroll);
      assert.equal(layout.toolsOpen, false, name + ': tools start collapsed');
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
    [1920, 1080, '1.25', 'ro'],
    [1366, 768, '1', 'ro'],
    [1280, 800, '1', 'en'],
  ]) {
    await resize(w, h);
    await app.evaluate(
      ({ BrowserWindow }, factor) =>
        BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(factor),
      Number(zoom),
    );
    await configure({ language });
    await capture(`profile-${w}-${h}-${zoom}-${language}`, w >= 1280);
  }
  await resize(1920, 1080);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1),
  );
  await configure({ language: 'en' });
  await page
    .getByLabel('Personality & preferences', { exact: true })
    .fill('Keep all this user-authored text. '.repeat(100));
  await capture('profile-long-preferences', true);
  await page.locator('.assistant-toggle').click();
  await capture('profile-with-assistant', true);
  await page.locator('.assistant-toggle').click();
  // Native grants remain live while the profile form has unsaved changes.
  await page.getByRole('button', { name: 'Knowledge 2', exact: true }).click();
  await page.getByRole('button', { name: 'Resource access', exact: true }).click();
  const accessDialog = page.getByRole('dialog', { name: 'Resource access', exact: true });
  await accessDialog.waitFor();
  assert.equal(await page.locator('#root').getAttribute('inert'), '');
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
  assert.equal(
    await page
      .getByRole('button', { name: 'Knowledge 2', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  await page.keyboard.press('Escape');
  await accessDialog.waitFor({ state: 'detached' });
  assert.ok(
    await page
      .getByRole('button', { name: 'Resource access', exact: true })
      .evaluate((e) => e === document.activeElement),
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
  const menu = page.locator('.agent-tools-card');
  await menu.locator(':scope > summary').focus();
  await page.keyboard.press('Enter');
  assert.equal(await menu.getAttribute('open'), '');
  await menu.locator('.agent-tool-choices > summary').click();
  await menu.getByRole('switch', { name: 'Terminal', exact: true }).uncheck();
  await page.getByRole('switch', { name: 'Create reusable skills', exact: true }).uncheck();
  const popup = await page.locator('.agent-tools-body').boundingBox();
  const viewport = page.viewportSize() || { height: 1080, width: 1920 };
  assert.ok(
    popup.y >= 32 && popup.y + popup.height <= viewport.height,
    'Tools popup within viewport',
  );
  await capture('profile-tools-open');
  await page.keyboard.press('Escape');
  assert.equal(await menu.getAttribute('open'), null);
  assert.ok(await menu.locator(':scope > summary').evaluate((e) => e === document.activeElement));
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await page.waitForFunction(async () => {
    const s = await window.intelligence.bootstrap();
    return (
      s.entities.find((e) => e.id === s.settings.activeAgent).data.allowSkillCreation === false &&
      !s.entities.find((e) => e.id === s.settings.activeAgent).data.toolGroups.includes('terminal')
    );
  });
  await capture('profile-tools-saved', true);
  for (const [w, h, language] of [
    [1920, 1080, 'en'],
    [1366, 768, 'ro'],
    [1920, 1080, 'ro'],
  ]) {
    await resize(w, h);
    await configure({ language });
    await page.locator('.agent-screen-heading button[aria-haspopup="dialog"]').click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    const bounds = await dialog.boundingBox();
    assert.ok(
      bounds.y >= 0 &&
        bounds.y + bounds.height <= h &&
        bounds.x >= 0 &&
        bounds.x + bounds.width <= w,
      'Access modal within window',
    );
    await page.keyboard.press('Shift+Tab');
    assert.ok(
      await dialog.evaluate((e) => e.contains(document.activeElement)),
      'Modal traps backward Tab',
    );
    await page.keyboard.press('Tab');
    assert.ok(
      await dialog.evaluate((e) => e.contains(document.activeElement)),
      'Modal traps forward Tab',
    );
    await app.evaluate(async ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].capturePage(undefined, {
        stayHidden: true,
        stayAwake: true,
      }),
    );
    await page.waitForTimeout(150);
    assert.ok(
      await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
      'No modal horizontal overflow',
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
    const name = 'resource-access-' + w + '-' + language;
    fs.writeFileSync(path.join(directory, name + '.png'), Buffer.from(png, 'base64'));
    results.captures.push({ name, bounds });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
  }
  assert.deepEqual(results.errors, []);
} finally {
  fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify(results, null, 2));
  await app.close();
}
console.log('Profile layout passed: ' + results.captures.length + ' captures');
