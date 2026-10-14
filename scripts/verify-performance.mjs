import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const label = process.argv[2] || 'current';
assert(/^[a-z0-9-]+$/.test(label));
const directory = path.resolve('.test-data/performance-' + label + '-' + Date.now());
fs.mkdirSync(directory, { recursive: true });
const env = { ...process.env, INTELLIGENCE_TEST: '1', INTELLIGENCE_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
const started = performance.now();
const app = await electron.launch({ executablePath: electronPath, args: ['.', '--disable-gpu'], env });
try {
  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Settings', exact: true }).waitFor();
  const startupMs = Math.round(performance.now() - started);
  await page.waitForTimeout(1500);
  await app.evaluate(({ app }) => app.getAppMetrics());
  await page.waitForTimeout(1000);
  const idleBefore = await app.evaluate(({ app }) => app.getAppMetrics().map(p => ({type:p.type,cpu:p.cpu.percentCPUUsage,workingSetKB:p.memory.workingSetSize})));
  const settingsTimes = [];
  for (let i = 0; i < 5; i++) {
    const open = performance.now();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('dialog', {name:'Settings', exact:true}).waitFor();
    settingsTimes.push(Math.round(performance.now() - open));
    await page.getByRole('button', {name:'Close settings',exact:true}).click();
  }
  await page.waitForTimeout(1500);
  const idleAfter = await app.evaluate(({ app }) => app.getAppMetrics().map(p => ({type:p.type,cpu:p.cpu.percentCPUUsage,workingSetKB:p.memory.workingSetSize})));
  const assets = fs.readdirSync('dist/assets').filter(f => f.endsWith('.js')).map(f => ({name:f,bytes:fs.statSync(path.join('dist/assets',f)).size}));
  const result = {label, startupMs, settingsOpenMs:settingsTimes, idleBefore, idleAfter, javascriptBytes:assets.reduce((n,f)=>n+f.bytes,0), assets};
  fs.writeFileSync(path.join(directory, 'metrics.json'), JSON.stringify(result,null,2));
  console.log(JSON.stringify({directory,...result}));
} finally { await app.close(); }
