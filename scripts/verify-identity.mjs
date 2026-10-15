import { settingsSection } from './ui-pickers.mjs';
import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createPackageFromFiles } from '@electron/asar';
const directory = path.resolve('.test-data/identity-' + Date.now());
fs.mkdirSync(directory, { recursive: true });
const env = { ...process.env, INTELLIGENCE_TEST: '1', INTELLIGENCE_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
delete env.INTELLIGENCE_DEV_URL;
const desktop = await electron.launch({
  executablePath: electronPath,
  args: ['.', '--disable-gpu'],
  env,
});
try {
  const page = await desktop.firstWindow();
  await page.getByRole('heading', { name: /Make yourself/ }).waitFor();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await desktop.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1920, 1080),
  );
  const archive = path.join(directory, 'icons.asar');
  const files = ['build/icon.png', 'build/icon-prism.png', 'build/icon-aurora.png'].map((p) =>
    path.resolve(p),
  );
  await createPackageFromFiles(path.resolve('.'), archive, files);
  const icons = await desktop.evaluate(
    ({ nativeImage }, paths) =>
      paths.map((p) => {
        const icon = nativeImage.createFromPath(p).resize({ width: 24, height: 24 }),
          bitmap = icon.toBitmap();
        let visible = 0,
          colored = 0;
        for (let i = 0; i < bitmap.length; i += 4) {
          if (bitmap[i + 3] > 80) {
            visible++;
            if (
              Math.max(bitmap[i], bitmap[i + 1], bitmap[i + 2]) -
                Math.min(bitmap[i], bitmap[i + 1], bitmap[i + 2]) >
              35
            )
              colored++;
          }
        }
        return { size: icon.getSize(), empty: icon.isEmpty(), visible, colored };
      }),
    files.map((p) => path.join(archive, path.relative(path.resolve('.'), p))),
  );
  assert.ok(icons.every((i) => !i.empty && i.visible > 100));
  assert.ok(icons.slice(1).every((i) => i.colored > 80));
  await page
    .getByRole('button', { name: /Settings/ })
    .last()
    .click();
  await page.getByRole('button', { name: 'Look & feel', exact: true }).click();
  const previews = await page.locator('.theme-options .theme-art').evaluateAll(async (elements) =>
    Promise.all(
      elements.map(async (e) => {
        const src = getComputedStyle(e).backgroundImage.slice(5, -2);
        const image = new Image();
        image.src = src;
        await image.decode();
        return image.naturalWidth;
      }),
    ),
  );
  assert.equal(previews.length, 11);
  assert.ok(previews.every((width) => width > 100));
  await page.locator('.theme-options button').filter({ hasText: 'Summer' }).click();
  assert.equal(await page.getByLabel('Layout', { exact: true }).count(), 0);
  await settingsSection(page, 'Icons & identity');
  await page.getByLabel('App window icon', { exact: true }).selectOption('prism');
  await page.getByLabel('Tray icon', { exact: true }).selectOption('aurora');
  await page.getByLabel('In-app logo', { exact: true }).selectOption('aurora');
  await page.waitForTimeout(300);
  assert.match(await page.locator('.agent-profile img').getAttribute('src'), /icon-aurora/);
  assert.equal(await page.locator('nav .theme-art').count(), 0);
  await page.waitForTimeout(120);
  await desktop.evaluate(async ({ BrowserWindow }) => {
    await BrowserWindow.getAllWindows()[0].capturePage(undefined, {
      stayHidden: true,
      stayAwake: true,
    });
  });
  await page.waitForTimeout(100);
  const image = await desktop.evaluate(async ({ BrowserWindow }) =>
    (
      await BrowserWindow.getAllWindows()[0].capturePage(undefined, {
        stayHidden: true,
        stayAwake: true,
      })
    )
      .toPNG()
      .toString('base64'),
  );
  fs.writeFileSync(path.join(directory, 'appearance.png'), Buffer.from(image, 'base64'));
  const values = await page.evaluate(() => window.intelligence.bootstrap());
  assert.equal(values.settings.theme, 'summer');
  assert.equal(values.settings.layout, 'studio');
  assert.equal(values.settings.appIcon, 'prism');
  assert.equal(values.settings.trayIcon, 'aurora');
  await page.reload();
  await page.getByRole('heading', { name: /Take your time/ }).waitFor();
  assert.equal(await page.locator('html').getAttribute('data-layout'), 'studio');
  console.log(JSON.stringify({ directory, icons, result: 'passed' }));
} finally {
  await desktop.close();
}
