import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { Store } from '../electron/store.mjs';
import { importBackgroundImage } from '../electron/appearance-settings.mjs';
const directory = path.resolve('.test-data/ui-polish-' + Date.now());
fs.mkdirSync(directory, { recursive: true });
const store = new Store(path.join(directory, 'data'));
const custom = await importBackgroundImage('public/assets/welcome-marble.webp', store.directory);
store.setSettings({
  onboardingComplete: true,
  semanticSearch: false,
  autoConsolidation: false,
  backgroundPaused: true,
  theme: 'marble',
  backgroundArtwork: 'festive',
  backgroundOpacity: 16,
  backgroundBlur: 0,
});
// Real previously saved settings must not bring the retired renderer back.
for (const [key, value] of Object.entries({
  animatedBackground: 'fireplace',
  animationOpacity: 70,
  backgroundMotionPaused: false,
}))
  store.db
    .prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)')
    .run(key, JSON.stringify(value));
store.close();
const env = {
  ...process.env,
  INTELLIGENCE_TEST: '1',
  INTELLIGENCE_DATA_DIR: path.join(directory, 'data'),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: electronPath,
  args: ['.', '--disable-gpu'],
  env,
});
const results = { directory, captures: [], controls: [] };
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.locator('.sidebar').waitFor();
  const size = async (w, h) => {
    await app.evaluate(
      ({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].setSize(...s),
      [w, h],
    );
    await page.waitForTimeout(150);
  };
  const shot = async (name) => {
    await page.mouse.move(10, 10);
    await app.evaluate(async ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].capturePage(undefined, {
        stayHidden: true,
        stayAwake: true,
      }),
    );
    await page.waitForTimeout(200);
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
  };
  const settings = async (value) => {
    await page.evaluate((v) => window.intelligence.settings(v), value);
    await page.waitForTimeout(160);
  };
  const noMotion = async () => {
    assert.equal(await page.locator('.app-background-motion').count(), 0);
    assert.equal(await page.getByRole('button', { name: /background animation/ }).count(), 0);
  };
  await size(1920, 1080);
  await noMotion();
  const resume = page.getByRole('button', { name: 'Resume background AI', exact: true });
  const control = await resume.evaluate((e) => ({
    height: e.getBoundingClientRect().height,
    font: getComputedStyle(e).fontSize,
  }));
  assert.equal(control.height, 32);
  assert.equal(control.font, '11px');
  await resume.click();
  await page.getByRole('button', { name: 'Pause background AI', exact: true }).waitFor();
  assert.equal(
    (await page.evaluate(() => window.intelligence.bootstrap())).settings.backgroundPaused,
    false,
  );
  await page.getByRole('button', { name: 'Pause background AI', exact: true }).click();
  await resume.waitFor();
  assert.equal(
    (await page.evaluate(() => window.intelligence.bootstrap())).settings.backgroundPaused,
    true,
  );
  for (const theme of ['festive', 'tech', 'astral', 'marble']) {
    await settings({ theme, backgroundArtwork: 'theme', backgroundBlur: 0 });
    await page.waitForFunction((t) => document.documentElement.dataset.theme === t, theme);
    await noMotion();
    const metadata = await sharp(`public/assets/background-detail-${theme}.webp`).metadata();
    assert.ok(metadata.width >= 1600 && metadata.height >= 900);
    assert.equal(
      await page.locator('.app-background-art').evaluate((e) => getComputedStyle(e).filter),
      'none',
    );
    await shot(theme + '-clear-1920');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page
      .locator('.settings-navigation')
      .getByRole('button', { name: 'Look & feel', exact: true })
      .click();
    const blur = page.getByRole('slider', { name: 'Background blur', exact: true });
    await blur.waitFor();
    assert.equal(await page.getByLabel('Animated overlay', { exact: true }).count(), 0);
    await blur.focus();
    await blur.press('End');
    await page.waitForFunction(
      () => document.querySelector('.app-background-art')?.style.filter === 'blur(24px)',
    );
    assert.equal(
      (await page.evaluate(() => window.intelligence.bootstrap())).settings.backgroundBlur,
      24,
    );
    await shot(theme + '-blur-settings');
    await page.getByRole('button', { name: 'Remove blur', exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('.app-background-art')?.style.filter === 'none',
    );
    const geometry = await page
      .locator('.settings-content')
      .evaluate((e) => ({ scroll: e.scrollHeight, height: e.clientHeight }));
    assert.ok(geometry.scroll <= geometry.height + 2, JSON.stringify(geometry));
    await shot(theme + '-settings-1920');
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  }
  await settings({ backgroundArtwork: 'custom', backgroundImage: custom, backgroundBlur: 7 });
  assert.ok(
    (await page.locator('.app-background-art').getAttribute('style')).includes(
      'intelligence-media',
    ),
  );
  await shot('custom-image-blur');
  await page.reload();
  await page.locator('.sidebar').waitFor();
  assert.equal(
    await page.locator('.app-background-art').evaluate((e) => getComputedStyle(e).filter),
    'blur(7px)',
  );
  await noMotion();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .locator('.settings-navigation')
    .getByRole('button', { name: 'Search providers', exact: true })
    .click();
  const provider = page.getByLabel('Search provider', { exact: true });
  assert.deepEqual(await provider.locator('option').allTextContents(), [
    'DuckDuckGo',
    'Ecosia',
    'SearXNG',
    'Brave Search',
  ]);
  for (const id of ['duckduckgo', 'ecosia']) {
    await provider.selectOption(id);
    await page.getByLabel('SearXNG address', { exact: true }).waitFor();
    assert.ok((await page.locator('.search-settings').textContent()).includes('not a direct'));
    await shot('search-' + id);
  }
  await provider.selectOption('brave');
  await page.getByLabel('Brave API key', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('SearXNG address', { exact: true }).count(), 0);
  await shot('search-brave');
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  for (const [w, h] of [
    [2560, 1440],
    [3440, 1440],
    [1366, 768],
  ]) {
    await size(w, h);
    await settings({ backgroundArtwork: 'theme', backgroundBlur: 0 });
    await shot('toolbar-' + w);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    await noMotion();
  }
  await size(1920, 1080);
  await settings({ language: 'ro' });
  await page.getByRole('button', { name: 'Setări', exact: true }).click();
  await page
    .locator('.settings-navigation')
    .getByRole('button', { name: 'Aspect și stil', exact: true })
    .click();
  await page.getByRole('slider', { name: 'Estomparea fundalului', exact: true }).waitFor();
  await shot('romanian-settings');
  assert.deepEqual(errors, []);
  results.passed = true;
  fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await app.close();
}
