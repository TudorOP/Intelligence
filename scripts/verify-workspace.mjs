import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { Store } from '../electron/store.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const baseline = process.env.INTELLIGENCE_WORKSPACE_BASELINE === '1';
const directory = path.resolve('.test-data/workspace-' + Date.now());
const store = new Store(directory);
store.setSettings({
  semanticSearch: false,
  autoConsolidation: false,
  model: 'fixture/vision-model',
});
for (let i = 0; i < 12; i++)
  store.mutate({
    kind: 'memory',
    title: 'Saved memory ' + i,
    data: { content: 'A saved preference with useful context.', access: true },
  });
const insert = store.db.prepare(
  'INSERT INTO entities (id,kind,parent,title,data,deleted,created,updated) VALUES (?,?,?,?,?,1,?,?)',
);
const date = new Date().toISOString();
store.db.exec('BEGIN');
for (let i = 0; i < 2400; i++)
  insert.run(
    'trash-' + i,
    i % 2 ? 'conversation' : 'notebook',
    null,
    'Archived item ' + i,
    '{}',
    date,
    date,
  );
insert.run('trash-child', 'note', 'trash-0', 'Contained note', '{}', date, date);
store.db.exec('COMMIT');
store.db.close();
const env = { ...process.env, INTELLIGENCE_TEST: '1', INTELLIGENCE_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
// Preserve an explicitly selected dev preview; otherwise use the built interface.
const app = await electron.launch({
  executablePath: electronPath,
  args: ['.', '--disable-gpu'],
  env,
});
const results = { mode: baseline ? 'baseline' : 'updated', directory, checks: [], profiles: [] };
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('heading', { name: /Make yourself/ }).waitFor();
  const cdp = await app.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const resize = async (width, height) => {
    await app.evaluate(
      ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size),
      [width, height],
    );
  };
  const capture = async (name) => {
    await app.evaluate(async ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].capturePage(undefined, {
        stayHidden: true,
        stayAwake: true,
      }),
    );
    await page.waitForTimeout(120);
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
  const profile = async (label, selector) => {
    const before = await cdp.send('Performance.getMetrics');
    // Drive scroll at 60Hz, including the layered Settings + Trash case.
    await page.evaluate(async (selector) => {
      const target = document.querySelector(selector);
      await new Promise((resolve) => {
        let step = 0;
        const timer = setInterval(() => {
          target.scrollTop = (++step % 20) * 40;
          if (step === 90) {
            clearInterval(timer);
            resolve();
          }
        }, 16);
      });
    }, selector);
    const after = await cdp.send('Performance.getMetrics');
    const metric = (data, name) => data.metrics.find((m) => m.name === name)?.value ?? 0;
    results.profiles.push({
      label,
      taskMs: Math.round((metric(after, 'TaskDuration') - metric(before, 'TaskDuration')) * 1000),
      layoutMs: Math.round(
        (metric(after, 'LayoutDuration') - metric(before, 'LayoutDuration')) * 1000,
      ),
      nodes: (await cdp.send('Memory.getDOMCounters')).nodes,
    });
  };
  await resize(1920, 1080);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Look & feel', exact: true }).click();
  await profile('settings', '.settings-content');
  await page.getByRole('button', { name: 'Your data', exact: true }).click();
  await page.getByRole('button', { name: 'Open Trash ↗', exact: true }).click();
  await page.getByRole('button', { name: 'Restore Archived item 0', exact: true }).waitFor();
  await profile('settings + 2401 trashed items', baseline ? '.trash-dialog' : '.trash-list');
  if (!baseline) {
    assert.ok((await page.locator('.trash-list > div').count()) <= 60);
    assert.equal(
      await page
        .locator('.modal-backdrop')
        .evaluateAll((elements) =>
          elements.every((e) => getComputedStyle(e).backdropFilter === 'none'),
        ),
      true,
    );
    await page.getByLabel('Search Trash').fill('Archived item 2399');
    await page.getByRole('button', { name: 'Restore Archived item 2399', exact: true }).click();
    await page.getByText('No items in this category.', { exact: true }).waitFor();
    await page.getByLabel('Search Trash').fill('');
    await page.getByLabel('Search Trash').fill('Contained note');
    assert.equal(
      await page.getByRole('button', { name: 'Restore Contained note', exact: true }).isDisabled(),
      true,
    );
    await page.getByLabel('Search Trash').fill('');
    await page
      .getByRole('button', { name: 'Delete permanently Archived item 0', exact: true })
      .click();
    await page.getByText(/and its 1 contained items/).waitFor();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await page.getByRole('button', { name: 'Previous page', exact: true }).click();
    results.checks.push(
      'Bounded Trash rows, search across all pages, restore, pagination, descendant preview, no backdrop blur',
    );
  }
  await capture('trash');
  await page.getByRole('button', { name: 'Close Trash', exact: true }).click();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  if (!baseline) {
    for (const [width, height] of [
      [1920, 1080],
      [2560, 1440],
      [1600, 900],
      [1366, 768],
    ]) {
      await resize(width, height);
      await page.evaluate(() => window.intelligence.settings({ theme: 'ink', layout: 'studio' }));
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'ink');
      const composer = await page.locator('.composer-bottom').evaluate((e) => {
        const model = e.querySelector('.chat-model-select').getBoundingClientRect(),
          attach = e.querySelector('.attach-image').getBoundingClientRect(),
          send = e.querySelector('.send').getBoundingClientRect(),
          rect = e.getBoundingClientRect();
        return {
          leftGap: model.left - rect.left,
          spacing: attach.left - model.right,
          sendGap: rect.right - send.right,
          bottom: rect.bottom,
          viewport: innerHeight,
        };
      });
      assert.ok(
        composer.leftGap <= 2 &&
          composer.spacing >= 0 &&
          composer.sendGap <= 2 &&
          composer.bottom < composer.viewport,
        JSON.stringify(composer),
      );
      await capture(width + '-ink-chat');
      await page.locator('.sidebar .nav-item').nth(8).click();
      await page.locator('.machine-readings').waitFor();
      const geometry = await page.locator('.machine-page').evaluate((e) => {
        const main = e.closest('.main-canvas'),
          rect = e.getBoundingClientRect();
        return {
          pageWidth: rect.width,
          availableWidth: main.clientWidth,
          horizontalOverflow: main.scrollWidth - main.clientWidth,
        };
      });
      assert.ok(
        geometry.pageWidth >= geometry.availableWidth - 2 && geometry.horizontalOverflow <= 2,
        JSON.stringify(geometry),
      );
      await capture(width + '-ink-machine');
      for (const index of [1, 2, 4, 5, 7, 8, 9]) {
        await page
          .locator('.sidebar .nav-item')
          .nth({ 1: 1, 2: 2, 4: 4, 5: 7, 7: 9, 8: 10, 9: 11 }[index])
          .click();
        assert.ok(
          await page.locator('.main-canvas').evaluate((e) => e.scrollWidth <= e.clientWidth + 2),
          'Overflow at ' + width + '/' + index,
        );
        if (index !== 5) {
          const header = await page.locator('.overview-heading').evaluate((e) => {
            const rect = e.getBoundingClientRect();
            const action = e.querySelector('.heading-actions button')?.getBoundingClientRect();
            return { height: rect.height, top: rect.top, actionTop: action?.top };
          });
          assert.ok(
            header.height <= 140 && header.top < 160,
            'Tall introduction: ' + JSON.stringify(header),
          );
          if (header.actionTop !== undefined)
            assert.ok(header.actionTop < 240, 'Creation action too low');
          if (index === 2) {
            const top = await page
              .locator('.notebook-grid')
              .evaluate((e) => e.getBoundingClientRect().top);
            assert.ok(top < 310, 'Notebook grid too low: ' + top);
          }
          if (index === 7) {
            const top = await page
              .locator('.memory-list')
              .evaluate((e) => e.getBoundingClientRect().top);
            const viewport = await page.evaluate(() => innerHeight);
            if (viewport >= 900)
              assert.ok(top < viewport - 180, 'Memories leave no visible reading area: ' + top);
            assert.equal(
              await page
                .locator('.memory-status-grid')
                .evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length),
              2,
            );
          }
        }
        if (width === 1920) await capture('1920-section-' + index);
      }
      await page.locator('.sidebar').getByRole('button', { name: 'Chat', exact: true }).click();
      results.checks.push(
        width +
          '×' +
          height +
          ': composer alignment, machine fills canvas, section widths, compact overview headers and top creation controls',
      );
    }
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Your data', exact: true }).click();
    await page.getByRole('button', { name: 'Open Trash ↗', exact: true }).click();
    await page.getByRole('button', { name: 'Next page', exact: true }).waitFor();
    assert.ok(
      await page
        .locator('.trash-dialog > footer')
        .evaluate((e) => e.getBoundingClientRect().bottom < innerHeight),
      'Trash footer outside short work area',
    );
    await page.getByRole('button', { name: 'Close Trash', exact: true }).click();
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    results.checks.push('Trash pagination and Close visible at 1366×768');
    await resize(1920, 1080);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Look & feel', exact: true }).click();
    await page.locator('.theme-options button').filter({ hasText: /Day$/ }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'day');
    await page.locator('.theme-options button').filter({ hasText: 'Ink · Apple white' }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'ink');
    await capture('appearance');
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'ink');
    assert.deepEqual(errors, []);
    results.checks.push(
      'Day and Ink independently selectable; Ink persists after reload; no renderer errors',
    );
  }
  fs.writeFileSync(path.join(directory, 'profile.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await app.close();
}
