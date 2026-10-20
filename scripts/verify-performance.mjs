import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const label = process.argv[2] || 'current';
const applicationRoot = path.resolve(process.argv[3] || '.');
assert(/^[a-z0-9-]+$/.test(label));
const directory = path.resolve('.test-data/performance-' + label + '-' + Date.now());
fs.mkdirSync(directory, { recursive: true });
const env = { ...process.env, INTELLIGENCE_TEST: '1', INTELLIGENCE_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
delete env.INTELLIGENCE_DEV_URL;
const started = performance.now();
const app = await electron.launch({
  executablePath: electronPath,
  args: [applicationRoot, '--disable-gpu'],
  env,
});
try {
  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Settings', exact: true }).waitFor();
  const startupMs = Math.round(performance.now() - started);
  await page.waitForTimeout(1500);
  await app.evaluate(({ app }) => app.getAppMetrics());
  await page.waitForTimeout(1000);
  const idleBefore = await app.evaluate(({ app }) =>
    app.getAppMetrics().map((p) => ({
      type: p.type,
      cpu: p.cpu.percentCPUUsage,
      workingSetKB: p.memory.workingSetSize,
    })),
  );
  const settingsTimes = [],
    settingsCommitMs = [];
  for (let i = 0; i < 5; i++) {
    const open = performance.now();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor();
    settingsTimes.push(Math.round(performance.now() - open));
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  }
  for (let i = 0; i < 5; i++) {
    settingsCommitMs.push(
      await page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const start = performance.now();
            const observer = new MutationObserver(() => {
              const dialog = document.querySelector('.settings-dialog');
              if (!dialog) return;
              dialog.getBoundingClientRect();
              observer.disconnect();
              clearTimeout(timer);
              resolve(Math.round((performance.now() - start) * 10) / 10);
            });
            const timer = setTimeout(() => {
              observer.disconnect();
              reject(Error('Settings did not open'));
            }, 5000);
            observer.observe(document.body, { childList: true, subtree: true });
            document.querySelector('button[aria-label="Settings"]').click();
          }),
      ),
    );
    await page.evaluate(() =>
      document.querySelector('button[aria-label="Close settings"]').click(),
    );
    await page
      .getByRole('dialog', { name: 'Settings', exact: true })
      .waitFor({ state: 'detached' });
  }
  await page.waitForTimeout(1500);
  const idleAfter = await app.evaluate(({ app }) =>
    app.getAppMetrics().map((p) => ({
      type: p.type,
      cpu: p.cpu.percentCPUUsage,
      workingSetKB: p.memory.workingSetSize,
    })),
  );
  const manifestPath = path.join(applicationRoot, 'dist', '.vite', 'manifest.json');
  const assetNames = fs.existsSync(manifestPath)
    ? [
        ...new Set(
          Object.values(JSON.parse(fs.readFileSync(manifestPath, 'utf8'))).map(
            (entry) => entry.file,
          ),
        ),
      ].filter((f) => f.endsWith('.js'))
    : fs
        .readdirSync(path.join(applicationRoot, 'dist/assets'))
        .filter((f) => f.endsWith('.js'))
        .map((f) => 'assets/' + f);
  const assets = assetNames.map((file) => ({
    name: path.basename(file),
    bytes: fs.statSync(path.join(applicationRoot, 'dist', file)).size,
  }));
  const result = {
    label,
    startupMs,
    settingsOpenMs: settingsTimes,
    settingsCommitMs,
    idleBefore,
    idleAfter,
    javascriptBytes: assets.reduce((n, f) => n + f.bytes, 0),
    assets,
  };
  fs.writeFileSync(path.join(directory, 'metrics.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ directory, ...result }));
} finally {
  await app.close();
}
