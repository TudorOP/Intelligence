import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { Store } from '../electron/store.mjs';
import { ensureProfiles } from '../electron/profiles.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
const directory = path.resolve('.test-data/settings-' + Date.now());
const store = new Store(directory);
assert.equal(store.settings().onboardingComplete, false);
store.setSettings({
  theme: 'day',
  onboardingComplete: true,
  semanticSearch: false,
  autoConsolidation: false,
});
ensureProfiles(store);
store.close();
const env = { ...process.env, INTELLIGENCE_TEST: '1', INTELLIGENCE_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
// Preserve an explicitly selected dev preview; otherwise use the built interface.
const app = await electron.launch({
  executablePath: electronPath,
  args: ['.', '--disable-gpu'],
  env,
});
const captures = [],
  geometry = [];
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.locator('.sidebar').waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1920, 1080));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const shot = async (name) => {
    await page.mouse.move(900, 25);
    await page.waitForTimeout(150);
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
    console.log('Captured ' + name);
  };
  const open = async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('.settings-dialog').waitFor();
  };
  await open();
  const nav = async (name) => {
    await page.locator('.settings-navigation').getByRole('button', { name, exact: true }).click();
    await page.waitForTimeout(100);
  };
  const fit = async (name, strict = true) => {
    const g = await page.locator('.settings-content').evaluate((e) => ({
      section: e.dataset.section,
      height: e.clientHeight,
      content: e.scrollHeight,
      overflow: e.scrollWidth - e.clientWidth,
    }));
    geometry.push({ name, ...g });
    assert.ok(g.overflow <= 2, JSON.stringify(g));
    if (strict) assert.ok(g.content <= g.height + 2, JSON.stringify(g));
    const heights = await page
      .locator('.settings-content input[type=number]')
      .evaluateAll((items) => items.map((e) => e.getBoundingClientRect().height));
    assert.ok(
      heights.every((h) => h <= 51),
      JSON.stringify(heights),
    );
    const dialog = await page.locator('.settings-dialog').boundingBox();
    assert.ok(
      dialog.y >= 0 && dialog.y + dialog.height <= (await page.evaluate(() => innerHeight)) + 2,
    );
  };
  if (!process.argv.includes('--captures-only')) {
    assert.equal(
      await page
        .locator('.settings-content')
        .getByRole('button', { name: 'Getting started', exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page.getByRole('button', { name: 'Getting started', exact: true }).count(),
      0,
    );
    const sections = [
      'Your profile',
      'Model & providers',
      'Chat & context',
      'Look & feel',
      'Icons & identity',
      'Agent access',
      'Background & automation',
      'Cognition Matrix',
      'Search providers',
      'Your data',
    ];
    for (const name of sections) {
      await nav(name);
      await shot('1080-' + name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-'));
      await fit(name);
    }
    await nav('Model & providers');
    assert.equal(
      await page
        .locator('.settings-content')
        .getByRole('button', { name: 'Open Agent screen', exact: true })
        .count(),
      1,
    );
    const positions = await page.locator('.models-settings').evaluate((e) => ({
      button: e.querySelector('.settings-related-action button').getBoundingClientRect().top,
      model: e.querySelector('.model-picker').getBoundingClientRect().bottom,
    }));
    assert.ok(positions.button > positions.model);
    for (const provider of ['openai', 'mistral', 'qwen', 'openrouter']) {
      await page.getByLabel('Inference provider', { exact: true }).selectOption(provider);
      await shot('provider-' + provider);
      await fit(provider);
    }
    await page.getByLabel('Inference provider', { exact: true }).selectOption('ollama');
    await page.getByRole('button', { name: 'Model ID', exact: true }).click();
    await fit('manual model');
    await shot('manual-model');
    await page.getByRole('button', { name: 'Open Agent screen', exact: true }).click();
    await page.getByRole('heading', { name: 'Agent Profiles', exact: true }).waitFor();
    assert.equal(await page.locator('.settings-dialog').count(), 0);
    await open();
    await nav('Background & automation');
    const port = page.getByLabel('Event port', { exact: true });
    await port.fill('3');
    await page.getByRole('button', { name: 'Save event port', exact: true }).click();
    await page
      .getByRole('alert')
      .getByText('Enter a whole number from 1024 to 65535.', { exact: true })
      .waitFor();
    await port.fill('31096');
    await port.press('Enter');
    await page.waitForFunction(
      async () => (await window.intelligence.bootstrap()).settings.externalEventsPort === 31096,
    );
    await fit('port saved');
    await page.getByLabel('Local external events', { exact: true }).check();
    await shot('events-enabled');
    await fit('events enabled');
    await page.getByRole('button', { name: 'Reveal event token', exact: true }).click();
    await page.getByLabel('Event token', { exact: true }).waitFor();
    await fit('event token');
    await nav('Search providers');
    await page.getByLabel('Search provider', { exact: true }).selectOption('brave');
    await shot('search-brave');
    await fit('Brave');
    await page.getByLabel('Search provider', { exact: true }).selectOption('searxng');
    await page.locator('.settings-help-menu > summary').filter({ hasText: 'Help & setup' }).click();
    await page.getByRole('button', { name: 'Review setup', exact: true }).click();
    await page.locator('.onboarding').waitFor();
    await page.getByRole('button', { name: 'Explore first', exact: true }).click();
    await page.locator('.onboarding').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.settings-dialog').count(), 1);
    await nav('Your profile');
    await page.getByLabel('Your name', { exact: true }).fill('Ada');
    await page.waitForFunction(
      async () => (await window.intelligence.bootstrap()).settings.preferredName === 'Ada',
    );
    await nav('Look & feel');
    await page.getByLabel('Notebook look', { exact: true }).selectOption('folio');
    await page.waitForFunction(
      async () => (await window.intelligence.bootstrap()).settings.notebookLook === 'folio',
    );
    for (const theme of ['ink', 'day', 'night', 'summer', 'autumn', 'winter']) {
      await page.evaluate((theme) => window.intelligence.settings({ theme }), theme);
      await nav('Look & feel');
      await shot('appearance-' + theme);
      await fit(theme);
    }
    await page.evaluate(() => window.intelligence.settings({ theme: 'day' }));
    for (const [w, h] of [
      [2560, 1440],
      [1366, 768],
    ]) {
      await app.evaluate(
        ({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].setSize(...s),
        [w, h],
      );
      for (const name of sections) {
        await nav(name);
        await fit(name + '-' + w, w === 2560);
      }
      await shot('settings-' + w);
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1920, 1080));
    await page.evaluate(() => (document.documentElement.style.zoom = '1.25'));
    for (const name of sections) {
      await nav(name);
      await fit(name + '-scaled', false);
    }
    await shot('settings-125percent');
    await page.evaluate(() => (document.documentElement.style.zoom = '1'));
    await page.evaluate(() => window.intelligence.settings({ language: 'ro' }));
    await page.waitForTimeout(200);
    await page
      .locator('.settings-navigation')
      .getByRole('button', { name: 'Fundal și automatizare', exact: true })
      .click();
    await shot('automation-ro');
    await fit('automation-ro');
    await page.evaluate(() => window.intelligence.settings({ language: 'en' }));
  } else {
    for (const [name, capture] of [
      ['Icons & identity', '1080-icons-identity'],
      ['Search providers', '1080-search-providers'],
      ['Look & feel', '1080-look-feel'],
    ]) {
      await nav(name);
      await fit(name);
      await shot(capture);
    }
    await nav('Look & feel');
    await page.evaluate(() => (document.documentElement.style.zoom = '1.25'));
    await fit('scaled', false);
    assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
    await shot('settings-125percent');
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    assert.equal(await page.evaluate(() => document.body.style.overflow), '');
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(directory, 'result.json'),
    JSON.stringify({ directory, captures, geometry, errors }, null, 2),
  );
  console.log(
    JSON.stringify({
      result: 'passed',
      directory,
      captures: captures.length,
      checks: process.argv.includes('--captures-only')
        ? 'final icon/search spacing and modal scroll containment'
        : 'ten sections fit at 1080p/larger, local/API variants, callbacks/port/token/guide, six themes, RO, shorter/scaled accessibility',
      errors,
    }),
  );
} catch (e) {
  console.error(e);
  throw e;
} finally {
  const timer = setTimeout(() => app.process().kill(), 10000);
  try {
    await app.close();
  } finally {
    clearTimeout(timer);
  }
}
