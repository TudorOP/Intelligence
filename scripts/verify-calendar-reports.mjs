import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { Store } from '../electron/store.mjs';
import { Planning } from '../electron/planning.mjs';
import { Workspace } from '../electron/workspace.mjs';
import { ensureProfiles } from '../electron/profiles.mjs';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
const requests = [];
const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  if (req.url === '/api/tags') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ models: [{ name: 'fixture-model' }] }));
  }
  if (req.url === '/api/chat') {
    const value = JSON.parse(body);
    requests.push(value);
    res.setHeader('Content-Type', 'application/x-ndjson');
    return res.end(
      JSON.stringify({
        message: {
          role: 'assistant',
          content: JSON.stringify({
            summary: 'A short verified briefing.',
            sections: [
              {
                title: 'Your day',
                content:
                  '# Your day\n\nA saved calendar event and recorded task state.\n\n' +
                  'A long readable paragraph. '.repeat(100),
              },
              { title: 'Sources', content: 'Source data was supplied by the app.' },
            ],
          }),
        },
        done: true,
        prompt_eval_count: 100,
        eval_count: 60,
        eval_duration: 1000000000,
      }) + '\n',
    );
  }
  res.setHeader('Content-Type', 'application/json');
  res.end('{}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const directory = path.resolve('.test-data/next-' + Date.now()),
  store = new Store(directory);
store.setSettings({
  theme: 'day',
  semanticSearch: false,
  autoConsolidation: false,
  model: 'fixture-model',
  endpoint: 'http://127.0.0.1:' + server.address().port,
  preferredName: 'Octavian',
  shareName: true,
  reportAnimations: true,
});
ensureProfiles(store);
const planning = new Planning(store),
  calendar = store.all().find((e) => e.kind === 'calendar'),
  board = store.all().find((e) => e.kind === 'board'),
  list = store.children(board.id)[0];
store.mutate({ id: calendar.id, data: { access: true, permission: 'edit' } });
const d = new Date();
d.setHours(10, 0, 0, 0);
const local = new Date(+d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16),
  end = new Date(+d + 3600000);
await planning.action({
  action: 'calendar-save',
  calendarId: calendar.id,
  title: 'Design review',
  data: {
    timing: {
      start: local,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      repeat: 'none',
    },
    endLocal: new Date(+end - end.getTimezoneOffset() * 60000).toISOString().slice(0, 16),
    owner: 'user',
    description: 'Preserve this event.',
  },
});
await planning.action({
  action: 'calendar-save',
  calendarId: calendar.id,
  title: 'Agent research',
  data: {
    timing: {
      start: local,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      repeat: 'none',
    },
    endLocal: new Date(+end - end.getTimezoneOffset() * 60000).toISOString().slice(0, 16),
    owner: 'agent',
    agentProfile: store.settings().activeAgent,
  },
});
const card = store.mutate({
  kind: 'card',
  title: 'Greece short story',
  parent: list.id,
  data: {
    content: 'Write a short story about traveling to Greece.',
    result: 'The Light of Santorini. ' + 'A saved story. '.repeat(100),
    access: true,
    permission: 'edit',
    status: 'review',
  },
});
for (let i = 0; i < 6; i++) {
  const c = store.mutate({ kind: 'conversation', title: 'Chat ' + i });
  store.message(c.id, 'user', 'User content ' + i);
}
const template = await planning.action({
  action: 'reports-save',
  title: 'Morning briefing',
  data: {
    enabled: false,
    agentProfile: store.settings().activeAgent,
    access: true,
    timing: {
      start: local,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      repeat: 'daily',
    },
    sections: [
      { type: 'calendar', title: 'Your day', sources: [calendar.id], calendarMode: 'combined' },
      { type: 'tasks', title: 'Task progress', sources: [board.id] },
    ],
  },
});
const workspace = new Workspace(store, {});
workspace.record('done', card.id, 'Task ready for review');
workspace.record('changed', calendar.id, 'Calendar prepared');
workspace.close();
planning.close();
store.close();
const env = { ...process.env, INTELLIGENCE_TEST: '1', INTELLIGENCE_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
// Preserve an explicitly selected dev preview; otherwise use the built interface.
const started = performance.now(),
  app = await electron.launch({ executablePath: electronPath, args: ['.', '--disable-gpu'], env });
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.locator('.sidebar').waitFor();
  const startupMs = Math.round(performance.now() - started);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1920, 1080));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const screenshot = async (name) => {
    await app.evaluate(async ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].capturePage(undefined, {
        stayHidden: true,
        stayAwake: true,
      }),
    );
    await page.waitForTimeout(150);
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
  await page.getByRole('button', { name: 'Recent conversations', exact: true }).click();
  await page
    .locator('.conversation-library-row')
    .nth(0)
    .locator('button')
    .first()
    .click({ modifiers: ['Control'] });
  await page
    .locator('.conversation-library-row')
    .nth(2)
    .locator('button')
    .first()
    .click({ modifiers: ['Shift'] });
  assert.match(await page.locator('.bulk-bar').innerText(), /3 selected/);
  assert.equal(await page.getByLabel('Bulk move destination').count(), 0);
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Recent conversations', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .first()
    .click();
  assert.equal(await page.locator('.sidebar-recent').count(), 0);
  await page.locator('.sidebar').getByRole('button', { name: 'Tasks', exact: true }).click();
  await page
    .getByRole('button', { name: /Greece short story/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Expand Report', exact: false }).waitFor();
  assert.equal(
    await page
      .locator('.workspace-top')
      .getByRole('button', { name: 'Select items', exact: true })
      .count(),
    0,
  );
  const reportBox = await page.locator('.task-agent-report').boundingBox(),
    formBox = await page.locator('.task-detail-form').boundingBox();
  assert.ok(reportBox.x > formBox.x + formBox.width);
  assert.ok(reportBox.y < 600);
  await screenshot('task-report-1080');
  await page.getByRole('button', { name: 'Expand Report', exact: false }).click();
  await page.getByRole('dialog', { name: /Agent Report/ }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await page.locator('.activity-row').first().waitFor();
  await page.locator('.activity-row').first().click({ button: 'right' });
  await page.getByRole('button', { name: 'Delete entry', exact: true }).click();
  await page.locator('.activity-undo').waitFor();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Clear history', exact: true }).click();
  await page.getByText('No activity yet.', { exact: true }).waitFor();
  await screenshot('task-and-activity');
  await page.getByRole('button', { name: 'Close activity', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .locator('.settings-navigation')
    .getByRole('button', { name: 'Cognition Matrix', exact: true })
    .click();
  const geometry = await page.locator('.matrix-preload-control').evaluate((e) => {
    const input = e.querySelector('input'),
      range = document.createRange();
    const text = [...e.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
    if (!text) return true;
    range.selectNodeContents(text);
    return input.getBoundingClientRect().right <= range.getBoundingClientRect().left;
  });
  assert.ok(geometry);
  assert.equal(
    await page.getByRole('button', { name: 'Quit Intelligence', exact: true }).count(),
    0,
  );
  await page.getByRole('button', { name: 'Your profile', exact: true }).click();
  assert.equal(await page.getByLabel('Your name', { exact: true }).inputValue(), 'Octavian');
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.locator('.agent-profile').click();
  await page
    .locator('.agent-profile-grid')
    .getByRole('button', { name: 'Edit profile', exact: true })
    .first()
    .click();
  await page.getByLabel('Personality & preferences', { exact: true }).waitFor();
  assert.equal(await page.getByText('System instructions', { exact: true }).count(), 0);
  await screenshot('agent-profile-1080');
  await page.locator('.sidebar').getByRole('button', { name: 'Calendar', exact: true }).click();
  await page.getByLabel('Calendar mode').waitFor();
  await page.getByText('Design review', { exact: true }).waitFor();
  await screenshot('calendar-1080');
  await page.getByLabel('Calendar mode').selectOption('agent');
  await page.getByText('Agent research', { exact: true }).waitFor();
  await page.waitForTimeout(100);
  assert.equal(await page.getByText('Design review', { exact: true }).count(), 0);
  await page.getByLabel('Calendar mode').selectOption('personal');
  await page.getByText('Design review', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'New event', exact: true }).click();
  await page.getByLabel('Event title').fill('Saved from UI');
  await page.getByLabel('Starting date & time').fill(local);
  const endInput = page.getByRole('dialog').locator('input[type=datetime-local]').nth(1);
  await endInput.fill(new Date(+end - end.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  await page.getByRole('button', { name: 'Save event', exact: true }).click();
  await page.getByText('Saved from UI', { exact: true }).waitFor();
  await page.locator('.sidebar').getByRole('button', { name: 'Reports', exact: true }).click();
  await page.getByRole('heading', { name: 'Reports', exact: true }).waitFor();
  assert.equal(requests.length, 0);
  await page.getByRole('button', { name: 'Configure', exact: true }).first().click();
  await page.getByRole('button', { name: 'Schedule', exact: true }).click();
  await page.getByLabel('Repeat', { exact: true }).selectOption('dates');
  await page.getByLabel('Custom report dates').fill('2026-12-12T08:00\n2026-12-14T18:00');
  await page.getByRole('button', { name: 'Preview next occurrences', exact: true }).click();
  await page.getByRole('status').last().waitFor();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(requests.length, 0);
  await page.getByRole('button', { name: 'Run now', exact: true }).first().click();
  await page.locator('.report-library-row').first().getByText('done', { exact: false }).waitFor();
  assert.equal(requests.length, 1);
  assert.ok(requests[0].messages[0].content.includes('"preferredName":"Octavian"'));
  assert.ok(requests[0].messages[0].content.includes('mandatory application guidance'));
  assert.ok(!requests[0].tools.some((t) => t.function.name === 'create_item'));
  await screenshot('reports-library-1080');
  await page.locator('.report-library-row').first().locator('button').first().click();
  await page.getByRole('dialog', { name: 'Morning briefing', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Next section', exact: true }).click();
  await page
    .locator('.report-scroll')
    .getByText('A saved calendar event and recorded task state.', { exact: true })
    .waitFor();
  await screenshot('report-reader-1080');
  await page.keyboard.press('Escape');
  assert.equal(requests.length, 1);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  const before = {
    nodes: await page.evaluate(() => document.getElementsByTagName('*').length),
    heap: (await cdp.send('Runtime.getHeapUsage')).usedSize,
  };
  for (let i = 0; i < 20; i++) {
    await page.locator('.report-library-row').first().locator('button').first().click();
    await page.getByRole('dialog', { name: 'Morning briefing' }).waitFor();
    await page.keyboard.press('Escape');
  }
  await cdp.send('HeapProfiler.collectGarbage');
  const after = {
    nodes: await page.evaluate(() => document.getElementsByTagName('*').length),
    heap: (await cdp.send('Runtime.getHeapUsage')).usedSize,
  };
  assert.ok(after.nodes <= before.nodes + 25);
  for (const [w, h] of [
    [2560, 1440],
    [1366, 768],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size),
      [w, h],
    );
    await screenshot('reports-' + w);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1920, 1080));
  await page.evaluate(() => (document.documentElement.style.zoom = '1.25'));
  await screenshot('reports-125percent');
  await page.evaluate(() => (document.documentElement.style.zoom = '1'));
  for (const theme of ['ink', 'day', 'night', 'summer', 'autumn', 'winter']) {
    await page.evaluate((theme) => window.intelligence.settings({ theme }), theme);
    await screenshot('reports-theme-' + theme);
  }
  await page.evaluate(() => window.intelligence.settings({ language: 'ro' }));
  await page.locator('.sidebar').getByRole('button', { name: 'Calendar', exact: true }).click();
  await page.getByRole('heading', { name: 'Calendar', exact: true }).waitFor();
  await screenshot('calendar-ro');
  await page.waitForTimeout(1000);
  const processMetrics = await app.evaluate(({ app }) =>
    app
      .getAppMetrics()
      .map((p) => ({ type: p.type, cpu: p.cpu.percentCPUUsage, memory: p.memory.workingSetSize })),
  );
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(directory, 'metrics.json'),
    JSON.stringify(
      {
        startupMs,
        before,
        after,
        processMetrics,
        modelRequests: requests.length,
        prompt: requests[0],
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      result: 'passed',
      directory,
      startupMs,
      modelRequests: requests.length,
      before,
      after,
      processMetrics,
      checks: [
        'contextual selection',
        'task/report layout/modal',
        'Activity delete/clear/undo',
        'switch geometry',
        'name/preferences',
        'Calendar modes/CRUD',
        'custom timing/preview',
        'report generation/scopes/reader',
        '20 lifecycle cycles',
        '1366/1920/2560/125%',
        'six themes/Romanian/no renderer errors',
      ],
    }),
  );
} finally {
  await app.close();
  await new Promise((resolve) => server.close(resolve));
}
