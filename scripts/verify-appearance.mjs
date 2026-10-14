import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const directory = path.resolve('.test-data/appearance-' + Date.now());
fs.mkdirSync(directory, { recursive: true });
const env = { ...process.env, INTELLIGENCE_TEST: '1', INTELLIGENCE_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
// Preserve an explicitly selected dev preview; otherwise use the built interface.
const desktop = await electron.launch({
  executablePath: electronPath,
  args: ['.', '--disable-gpu', '--js-flags=--expose-gc', '--enable-precise-memory-info'],
  env,
});
const results = [];
try {
  const page = await desktop.firstWindow();
  page.setDefaultTimeout(8000);
  const capture = async (filename) => {
    await page.waitForTimeout(120);
    await desktop.evaluate(async ({ BrowserWindow }) => {
      await BrowserWindow.getAllWindows()[0].capturePage(undefined, {
        stayHidden: true,
        stayAwake: true,
      });
    });
    await page.waitForTimeout(100);
    const encoded = await desktop.evaluate(async ({ BrowserWindow }) =>
      (
        await BrowserWindow.getAllWindows()[0].capturePage(undefined, {
          stayHidden: true,
          stayAwake: true,
        })
      )
        .toPNG()
        .toString('base64'),
    );
    fs.writeFileSync(path.join(directory, filename), Buffer.from(encoded, 'base64'));
  };
  await page.getByRole('heading', { name: /Make yourself/ }).waitFor();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.evaluate(() =>
    window.intelligence.settings({ semanticSearch: false, autoConsolidation: false }),
  );
  if (process.env.INTELLIGENCE_TEST_LANGUAGE)
    await page.evaluate(
      (language) => window.intelligence.settings({ language }),
      process.env.INTELLIGENCE_TEST_LANGUAGE,
    );
  const cdp = await desktop.context().newCDPSession(page);
  const sample = async (label) => {
    console.log('Profiling ' + label);
    const heap = await page.evaluate(() => {
      globalThis.gc?.();
      return {
        usedSize: performance.memory.usedJSHeapSize,
        totalSize: performance.memory.totalJSHeapSize,
      };
    });
    console.log('Renderer heap sampled');
    const dom = await cdp.send('Memory.getDOMCounters');
    console.log('DOM sampled');
    const main = await desktop.evaluate(() => {
      globalThis.gc?.();
      return { memory: process.memoryUsage(), resources: process.getActiveResourcesInfo() };
    });
    console.log('Main sampled');
    results.push({ label, heap, dom, main });
  };
  const settings = async (input) => {
    await page.evaluate((v) => window.intelligence.settings(v), input);
    await page.waitForTimeout(70);
  };
  await desktop.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1920, 1080),
  );
  for (const theme of process.env.INTELLIGENCE_PROFILE_ONLY
    ? []
    : ['ink', 'day', 'night', 'summer', 'autumn', 'winter']) {
    for (const layout of ['studio']) {
      await settings({ theme, layout });
      await page.locator('.sidebar nav button').nth(6).click();
      await page.locator('.machine-readings').waitFor();
      const geometry = await page.locator('.machine-page').evaluate((e) => {
        const p = e.closest('.main-canvas'),
          rect = e.getBoundingClientRect();
        return {
          height: rect.height,
          bottom: rect.bottom,
          viewport: innerHeight,
          scrollHeight: p.scrollHeight,
          clientHeight: p.clientHeight,
        };
      });
      assert.ok(
        geometry.scrollHeight <= geometry.clientHeight + 2,
        `${theme}/${layout}: ${JSON.stringify(geometry)}`,
      );
      await capture(`${theme}-${layout}-machine.png`);
      await page.locator('.sidebar nav button').nth(5).click();
      await capture(`${theme}-${layout}-matrix.png`);
      await page.locator('.sidebar nav button').nth(0).click();
      await capture(`${theme}-${layout}-chat.png`);
    }
  }
  assert.deepEqual(errors, []);
  if (process.env.INTELLIGENCE_VISUAL_ONLY)
    console.log(
      JSON.stringify({
        directory,
        result: 'passed',
        checks: [
          'six themes with Studio at 1920x1080',
          'machine overview fits without scrolling',
          'Chat and Matrix captures',
          'no renderer errors',
        ],
      }),
    );
  else {
    if (process.env.INTELLIGENCE_TEST_VAULT)
      await page.evaluate(async () => {
        await window.intelligence.vault({
          action: 'create',
          title: 'Lifecycle.md',
          content: '# Lifecycle\n\nA real Vault editor.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |',
        });
      });
    await settings({ theme: 'night', layout: 'studio' });
    await sample('warm baseline');
    for (let batch = 1; batch <= 3; batch++) {
      for (let i = 0; i < 20; i++) {
        if (i === 0) console.log('Starting cycle batch ' + batch);
        await page.getByRole('button', { name: 'Cognition Matrix', exact: true }).click();
        await page.getByRole('button', { name: 'Notebooks', exact: true }).click();
        if (process.env.INTELLIGENCE_TEST_VAULT) {
          await page.locator('.sidebar nav button').nth(3).click();
          await page.getByRole('button', { name: 'Open Lifecycle.md', exact: true }).click();
          await page.getByRole('textbox', { name: 'Vault content' }).waitFor();
        }
        await page.getByRole('button', { name: 'Chat', exact: true }).first().click();
        await settings({
          theme: ['day', 'night', 'summer', 'autumn', 'winter'][i % 5],
          layout: 'studio',
        });
      }
      await settings({ theme: 'night', layout: 'studio' });
      await page.waitForTimeout(200);
      await sample('batch ' + batch);
    }
    assert.deepEqual(errors, []);
    const first = results[0],
      last = results.at(-1);
    assert.ok(
      last.heap.usedSize - first.heap.usedSize < 12 * 1024 * 1024,
      'Renderer retained over 12 MiB after 60 cycles',
    );
    assert.ok(last.dom.nodes - first.dom.nodes < 500, 'DOM nodes accumulated');
    if (process.env.INTELLIGENCE_TEST_VAULT) {
      const warmed = results[1];
      assert.ok(
        last.heap.usedSize - warmed.heap.usedSize < 1024 * 1024,
        'Vault editors retained over 1 MiB after warm-up',
      );
      assert.ok(last.dom.nodes - warmed.dom.nodes < 30, 'Closed Vault editor nodes accumulated');
    }
    fs.writeFileSync(path.join(directory, 'profile.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ directory, results }, null, 2));
  }
} finally {
  await desktop.close();
}
