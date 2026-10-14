import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const workspace = path.resolve('.'),
  baseline = path.resolve(process.argv[2] || '.test-data/performance-baseline');
if (!baseline.startsWith(path.join(workspace, '.test-data') + path.sep))
  throw Error('Use an isolated baseline checkout under .test-data');
const result = [];
for (let round = 0; round < 4; round++)
  for (const [version, root] of round % 2
    ? [
        ['2.1', workspace],
        ['2.0', baseline],
      ]
    : [
        ['2.0', baseline],
        ['2.1', workspace],
      ]) {
    const { Store } = await import(pathToFileURL(path.join(root, 'electron/store.mjs'))),
      directory = path.join(
        workspace,
        '.test-data',
        'startup-' + version + '-' + round + '-' + Date.now(),
      ),
      store = new Store(directory);
    store.setSettings({
      theme: 'day',
      semanticSearch: false,
      autoConsolidation: false,
      backgroundPaused: true,
    });
    store.close();
    const env = { ...process.env, INTELLIGENCE_TEST: '1', INTELLIGENCE_DATA_DIR: directory };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.INTELLIGENCE_DEV_URL;
    const begin = performance.now(),
      app = await electron.launch({
        executablePath: electronPath,
        args: [root, '--disable-gpu'],
        env,
      });
    try {
      const page = await app.firstWindow();
      await page.locator('.sidebar').waitFor();
      const startupMs = performance.now() - begin;
      await page
        .locator('.sidebar')
        .getByRole('button', { name: 'Notebooks', exact: true })
        .click();
      await page.locator('.book-notebook').first().locator('.book-cover').click();
      const editorBegin = performance.now();
      await page.locator('.note-nav-row').first().locator('button').first().click();
      const clicked = performance.now();
      await page.locator('.tiptap[contenteditable=true]').waitFor();
      const firstEditorMs = performance.now() - editorBegin;
      const editorClickMs = clicked - editorBegin,
        editorLoadMs = performance.now() - clicked;
      const metrics = await app.evaluate(({ app }) =>
        app
          .getAppMetrics()
          .filter((p) => ['Browser', 'Tab'].includes(p.type))
          .map((p) => ({
            type: p.type,
            memoryKiB: p.memory.workingSetSize,
            cpu: p.cpu.percentCPUUsage,
          })),
      );
      result.push({
        version,
        round,
        startupMs: Math.round(startupMs),
        firstEditorMs: Math.round(firstEditorMs),
        editorClickMs: Math.round(editorClickMs),
        editorLoadMs: Math.round(editorLoadMs),
        metrics,
      });
    } finally {
      await app.close();
    }
  }
const median = (values) => {
    const v = values.sort((a, b) => a - b);
    return (v[1] + v[2]) / 2;
  },
  summary = {};
for (const v of ['2.0', '2.1']) {
  const rows = result.filter((r) => r.version === v);
  summary[v] = {
    startupMedianMs: median(rows.map((r) => r.startupMs)),
    editorMedianMs: median(rows.map((r) => r.firstEditorMs)),
  };
}
fs.writeFileSync(
  '.test-data/startup-comparison.json',
  JSON.stringify(
    {
      result,
      summary,
      scope:
        'Windows hidden Electron fixture, alternating warm-up launches; not Linux/model performance',
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ result, summary }));
assert.ok(
  summary['2.1'].startupMedianMs <= summary['2.0'].startupMedianMs * 1.25,
  'Startup regression exceeds fixture budget',
);
