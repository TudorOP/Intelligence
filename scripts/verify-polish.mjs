import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { Store } from '../electron/store.mjs';
import { Vault } from '../electron/vault.mjs';
import { Planning } from '../electron/planning.mjs';
import { ensureProfiles } from '../electron/profiles.mjs';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
const requests = [];
const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/api/tags')
    return res.end(JSON.stringify({ models: [{ name: 'fixture-model' }] }));
  if (req.url === '/api/chat') {
    requests.push(JSON.parse(body));
    res.setHeader('Content-Type', 'application/x-ndjson');
    return res.end(
      JSON.stringify({
        message: {
          role: 'assistant',
          content: JSON.stringify({
            summary: 'Verified briefing',
            sections: [{ title: 'Findings', content: 'A saved report from the test fixture.' }],
          }),
        },
        done: true,
      }) + '\n',
    );
  }
  res.end('{}');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const directory = path.resolve('.test-data/polish-' + Date.now());
const store = new Store(directory);
store.setSettings({
  theme: 'day',
  semanticSearch: false,
  autoConsolidation: false,
  onboardingComplete: true,
  model: 'fixture-model',
  endpoint: 'http://127.0.0.1:' + server.address().port,
});
ensureProfiles(store);
const board = store.all().find((e) => e.kind === 'board');
store.mutate({ id: board.id, data: { access: true } });
const list = store.children(board.id)[0];
const cards = Array.from({ length: 3 }, (_, i) =>
  store.mutate({
    kind: 'card',
    parent: list.id,
    title: 'Review step ' + (i + 1),
    data: { content: 'A useful next step.', status: 'queued' },
  }),
);
const selectionNotebook = store.mutate({
  kind: 'notebook',
  title: 'Selection notebook',
  data: { access: true },
});
for (const title of ['First note', 'Second note', 'Third note'])
  store.mutate({
    kind: 'note',
    parent: selectionNotebook.id,
    title,
    data: { content: '# ' + title },
  });
const chapter = store.mutate({
  kind: 'chapter',
  parent: selectionNotebook.id,
  title: 'A chapter',
  data: {},
});
store.mutate({
  kind: 'note',
  parent: chapter.id,
  title: 'Chapter note',
  data: { content: '# Chapter note' },
});
for (const title of ['Planning skill', 'Writing skill'])
  store.mutate({
    kind: 'skill',
    title,
    data: { access: true, content: 'Reusable fixture guidance.' },
  });
const vault = new Vault(store);
for (const title of ['Ideas', 'Research', 'Notes'])
  vault.create({
    title,
    content: '# ' + title + '\n\nPreserved document text.',
    data: { access: true },
  });
for (const title of ['Draft one', 'Draft two', 'Draft three'])
  store.mutate({ kind: 'conversation', title, data: {} });
for (const title of ['Research project', 'Personal work', 'Planning'])
  store.mutate({ kind: 'project', title, data: { access: true, permission: 'read' } });
const planning = new Planning(store);
await planning.action({
  action: 'reports-save',
  title: 'Saved briefing',
  data: {
    agentProfile: store.settings().activeAgent,
    access: true,
    enabled: false,
    timing: { start: '2026-10-10T09:00', timezone: 'America/Los_Angeles', repeat: 'none' },
    sections: [{ title: 'Findings', type: 'custom', sources: [], prompt: 'Review recorded work.' }],
  },
});
for (const title of ['Daily review', 'Project progress', 'Research findings'])
  store.mutate({
    kind: 'report',
    title,
    data: {
      access: true,
      unread: true,
      status: 'done',
      agentName: 'Intelligence',
      agentProfile: store.settings().activeAgent,
      summary: 'A dated snapshot of recorded work.',
      content: '## Findings\n\nVerified fixture report.',
      sections: [{ title: 'Findings', content: 'Verified fixture report.' }],
    },
  });
planning.close();
store.close();
const env = { ...process.env, INTELLIGENCE_TEST: '1', INTELLIGENCE_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
// Preserve an explicitly selected dev preview; otherwise use the built interface.
const app = await electron.launch({
  executablePath: electronPath,
  args: ['.', '--disable-gpu'],
  env,
});
const results = { directory, captures: [], checks: [] };
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.locator('.sidebar').waitFor();
  const size = async (w, h) => {
    await app.evaluate(
      ({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h),
      [w, h],
    );
    await page.waitForTimeout(200);
  };
  await size(1920, 1080);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const shot = async (name) => {
    await page.mouse.move(900, 25);
    await page.waitForTimeout(250);
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
    results.captures.push(name);
    console.log('Captured ' + name);
  };
  const nav = async (name) => {
    await page.locator('.sidebar').getByRole('button', { name, exact: true }).click();
    await page.waitForTimeout(250);
  };
  if (process.argv.includes('--selection-only')) {
    await nav('Notebooks');
    await page.getByRole('button', { name: 'Selection notebook', exact: true }).click();
    const rows = page.locator('.overview-notes > button');
    await rows.nth(0).click({ modifiers: ['Control'] });
    await rows.nth(2).click({ modifiers: ['Shift'] });
    assert.equal(await page.locator('.overview-notes > button[data-selected=true]').count(), 3);
    await shot('notebook-overview-selected');
    await page.keyboard.press('Escape');
    const area = await page.locator('.overview-notes').boundingBox(),
      first = await rows.first().boundingBox();
    await page.mouse.move(area.x + area.width - 2, area.y + area.height - 2);
    await page.mouse.down();
    await page.mouse.move(first.x + 2, first.y + 2, { steps: 12 });
    await page.mouse.up();
    assert.equal(await page.locator('.overview-notes > button[data-selected=true]').count(), 4);
    await page.keyboard.press('Escape');
    await nav('Projects');
    await shot('projects-spacing');
    await nav('Tasks');
    await page.locator('.assistant-toggle').click();
    await shot('assistant-empty');
    results.checks.push(
      'notebook overview range/marquee selection, project button spacing, final assistant controls',
    );
  } else {
    if (!process.argv.includes('--visual-only')) {
      assert.equal(
        await page.getByRole('button', { name: 'Recently opened', exact: true }).count(),
        0,
      );
      assert.equal(await page.locator('.agent-profile').count(), 1);
      await page.locator('.agent-profile').click();
      await page.getByRole('heading', { name: 'Agent Profiles' }).waitFor();
      await shot('agent-profiles');
      await page.locator('.agent-profile-grid article button').first().click();
      await shot('agent-details');
      await nav('Tasks');
      await page.locator('.assistant-toggle').click();
      const scope = page.getByLabel('Assistant context scope');
      assert.deepEqual(await scope.locator('option').allTextContents(), [
        'Current screen',
        'All accessible work',
      ]);
      const composer = page.locator('.assistant-pane textarea').last();
      await composer.fill('A draft that stays with me');
      await nav('Reports');
      assert.equal(await composer.inputValue(), 'A draft that stays with me');
      await nav('Vault');
      assert.equal(await composer.inputValue(), 'A draft that stays with me');
      await nav('Notebooks');
      assert.equal(await composer.inputValue(), 'A draft that stays with me');
      await nav('Tasks');
      await composer.fill('Summarize this board');
      await composer.press('Enter');
      await page.locator('.assistant-pane .message.assistant').waitFor();
      assert.ok(
        requests
          .at(-1)
          .messages.some(
            (m) => typeof m.content === 'string' && m.content.includes('"section":"tasks"'),
          ),
      );
      const firstConversation = await page.evaluate(
        async () =>
          (await window.intelligence.bootstrap()).entities.find(
            (e) => e.kind === 'conversation' && e.title === 'A little progress',
          )?.id,
      );
      await nav('Reports');
      await composer.fill('Summarize this screen');
      await composer.press('Enter');
      await page.waitForTimeout(500);
      assert.ok(
        requests
          .at(-1)
          .messages.some(
            (m) => typeof m.content === 'string' && m.content.includes('"section":"reports"'),
          ),
      );
      assert.equal(
        await page.evaluate(
          async (id) =>
            (await window.intelligence.bootstrap()).entities.filter(
              (e) => e.kind === 'conversation' && e.id === id,
            ).length,
          firstConversation,
        ),
        1,
      );
      await shot('reports-assistant');
      await page.getByLabel('Close assistant').click();
      assert.equal(
        await page.getByRole('button', { name: 'Select reports', exact: true }).count(),
        0,
      );
      await page
        .locator('.report-library-row > button')
        .first()
        .click({ modifiers: ['Control'] });
      await page
        .locator('.report-library-row > button')
        .nth(2)
        .click({ modifiers: ['Shift'] });
      assert.equal(await page.locator('.report-library-row[data-selected=true]').count(), 3);
      await shot('reports-selected');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.report-library-row[data-selected=true]').count(), 0);
      const marquee = async (surfaceSelector, rowSelector) => {
        const surface = await page.locator(surfaceSelector).boundingBox(),
          row = await page.locator(rowSelector).first().boundingBox();
        await page.mouse.move(surface.x + surface.width - 3, surface.y + surface.height - 3);
        await page.mouse.down();
        await page.mouse.move(row.x + 2, row.y + 2, { steps: 12 });
        await page.mouse.up();
        assert.ok(await page.locator(rowSelector + '[data-selected=true]').count());
        assert.equal(await page.locator('.selection-marquee').count(), 0);
        await page.keyboard.press('Escape');
      };
      await marquee('.report-selection-list', '.report-library-row');
      await page.getByRole('button', { name: 'New report', exact: true }).click();
      await page.locator('.report-template-library').waitFor();
      assert.equal(await page.locator('.report-template-grid article').count(), 5);
      await shot('report-templates');
      await page.getByRole('button', { name: 'Create template', exact: true }).click();
      await page.getByLabel('Report name').fill('Reusable situations');
      await page.getByRole('button', { name: 'Save template', exact: true }).click();
      await page.locator('.report-editor').waitFor({ state: 'detached' });
      const templateCount = await page.evaluate(
        async () =>
          (await window.intelligence.bootstrap()).entities.filter(
            (e) => e.kind === 'report-template',
          ).length,
      );
      assert.equal(templateCount, 2);
      await page.getByRole('button', { name: 'New report', exact: true }).click();
      await page.getByRole('button', { name: 'New custom report', exact: true }).click();
      await page.getByLabel('Report name').fill('Situational overview');
      assert.equal(
        await page
          .locator('.report-editor .form-tabs')
          .getByRole('button', { name: 'Schedule', exact: true })
          .count(),
        0,
      );
      await shot('custom-report-editor');
      await page.getByRole('button', { name: 'Create report', exact: true }).click();
      await page.locator('.report-editor').waitFor({ state: 'detached' });
      await page.waitForFunction(async () =>
        (await window.intelligence.bootstrap()).entities.some(
          (e) =>
            e.kind === 'report' && e.title === 'Situational overview' && e.data.status === 'done',
        ),
      );
      assert.equal(
        await page.evaluate(
          async () =>
            (await window.intelligence.bootstrap()).entities.filter(
              (e) => e.kind === 'report-template',
            ).length,
        ),
        templateCount,
      );
      results.checks.push(
        'global assistant navigation/context, report gallery/template/one-off generation, report range/marquee/Escape selection',
      );
      await nav('Tasks');
      await page
        .locator('.task-card')
        .first()
        .click({ modifiers: ['Control'] });
      await page
        .locator('.task-card')
        .nth(2)
        .click({ modifiers: ['Shift'] });
      assert.equal(await page.locator('.task-card-shell[data-selected=true]').count(), 3);
      await shot('tasks-selected');
      if (await page.locator('.toast').count()) {
        const geometry = await page.evaluate(() => ({
          bar: document.querySelector('.bulk-bar').getBoundingClientRect().top,
          toasts: [...document.querySelectorAll('.toast')].map(
            (e) => e.getBoundingClientRect().bottom,
          ),
        }));
        assert(
          geometry.toasts.every((bottom) => bottom <= geometry.bar),
          'Notifications cover selected-item actions',
        );
      }
      await page.keyboard.press('Escape');
      await marquee('.kanban-board', '.task-card-shell');
      await page.locator('.task-card').first().click();
      await page.locator('.assistant-toggle').click();
      assert.deepEqual(await scope.locator('option').allTextContents(), [
        'Current screen',
        'Entire board',
        'All accessible work',
      ]);
      await shot('task-details-assistant');
      await page.getByLabel('Close assistant').click();
      await nav('Vault');
      await page
        .locator('.vault-tree-row > .vault-open')
        .first()
        .click({ modifiers: ['Control'] });
      await page
        .locator('.vault-tree-row > .vault-open')
        .nth(2)
        .click({ modifiers: ['Shift'] });
      assert.equal(await page.locator('.vault-tree-row[data-selected=true]').count(), 3);
      await shot('vault-selected');
      await page.keyboard.press('Escape');
      await marquee('.vault-tree', '.vault-tree-row');
      await nav('Chat');
      await page.getByRole('button', { name: 'Recent conversations', exact: true }).click();
      const history = page.locator('.conversation-library');
      assert.ok((await history.boundingBox()).width <= 721);
      await page
        .locator('.conversation-library-row > button')
        .first()
        .click({ modifiers: ['Control'] });
      await page
        .locator('.conversation-library-row > button')
        .nth(2)
        .click({ modifiers: ['Shift'] });
      assert.equal(await page.locator('.conversation-library-row[data-selected=true]').count(), 3);
      await shot('chat-history');
      await page.keyboard.press('Escape');
      await marquee('.conversation-library-list', '.conversation-library-row');
      await page.keyboard.press('Escape');
      await nav('Notebooks');
      await marquee('.notebook-shelf', '.book-notebook');
      await shot('notebooks');
      await page.getByRole('button', { name: 'Selection notebook', exact: true }).click();
      const notes = page.locator('.notebook-nav .note-nav-row > button');
      await notes.nth(0).click({ modifiers: ['Control'] });
      await notes.nth(2).click({ modifiers: ['Shift'] });
      assert.equal(
        await page.locator('.notebook-nav .note-nav-row[data-selected=true]').count(),
        3,
      );
      await page.keyboard.press('Escape');
      await page
        .locator('.chapter-tree summary > button')
        .first()
        .click({ modifiers: ['Control'] });
      assert.equal(await page.locator('.chapter-tree[data-selected=true]').count(), 1);
      await page.keyboard.press('Escape');
      await shot('notebook-contents');
      await nav('Skills');
      const skill = page.locator('.skills-grid .resource-card');
      await skill.first().click({ modifiers: ['Control'] });
      await skill.nth(2).click({ modifiers: ['Shift'] });
      assert.equal(
        await page.locator('.skills-grid .resource-card[data-selected=true]').count(),
        3,
      );
      await page.keyboard.press('Escape');
      await marquee('.skills-grid', '.skills-grid .resource-card');
      results.checks.push('note/chapter/skill selection without mode controls');
      await nav('Projects');
      await marquee('.projects-page .resource-grid', '.projects-page .resource-card');
      await shot('projects');
      await nav('Cognition Matrix');
      const geometry = await page.locator('.matrix-add button').evaluateAll((buttons) =>
        buttons.map((b) => {
          const a = b.getBoundingClientRect(),
            s = b.querySelector('.add-symbol').getBoundingClientRect(),
            input = b.previousElementSibling.getBoundingClientRect();
          return {
            dx: Math.abs(a.x + a.width / 2 - s.x - s.width / 2),
            dy: Math.abs(a.y + a.height / 2 - s.y - s.height / 2),
            height: a.height,
            input: input.height,
          };
        }),
      );
      assert.ok(geometry.every((g) => g.dx < 1 && g.dy < 1 && Math.abs(g.height - g.input) < 1));
      await shot('matrix');
      await page.getByRole('button', { name: 'Activity', exact: true }).click();
      await page.getByRole('button', { name: 'Clear history', exact: true }).click();
      await page.locator('.activity-empty').waitFor();
      const alignment = await page.locator('.activity-panel').evaluate((e) => {
        const textLeft = (node) => {
          const r = document.createRange();
          r.selectNodeContents(node);
          return r.getBoundingClientRect().left;
        };
        return Math.abs(
          textLeft(e.querySelector('.activity-empty')) -
            textLeft(e.querySelector('.current-work b')),
        );
      });
      assert.ok(alignment < 2);
      await shot('activity');
      await page.getByLabel('Close activity').click();
      const theme = page.getByLabel('Switch theme', { exact: true });
      for (const choice of ['ink', 'day', 'summer', 'autumn', 'winter', 'system']) {
        await page.evaluate((theme) => window.intelligence.settings({ theme }), choice);
        await page.waitForTimeout(100);
        await theme.click();
        await page.waitForTimeout(100);
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'night');
        await theme.click();
        await page.waitForTimeout(100);
        assert.equal(await page.locator('html').getAttribute('data-theme'), choice);
      }
      await page.evaluate(() => window.intelligence.settings({ theme: 'autumn' }));
      await theme.click();
      await page.reload();
      await page.locator('.sidebar').waitFor();
      await theme.click();
      await page.waitForTimeout(150);
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'autumn');
      results.checks.push(
        'Tasks/Vault/History/notebooks/projects range/marquee; centered Matrix icons; Activity alignment; six theme pairs and reload persistence',
      );
    }
    for (const choice of ['ink', 'day', 'night', 'summer', 'autumn', 'winter']) {
      await page.evaluate((theme) => window.intelligence.settings({ theme }), choice);
      await nav('Reports');
      await page.getByRole('button', { name: 'New report', exact: true }).click();
      await shot('gallery-' + choice);
      await page.keyboard.press('Escape');
    }
    await page.evaluate(() => window.intelligence.settings({ theme: 'day' }));
    for (const name of [
      'Chat',
      'Calendar',
      'Reports',
      'Notebooks',
      'Tasks',
      'Vault',
      'Projects',
      'Memory',
      'Skills',
      'Connections',
      'Cognition Matrix',
    ]) {
      await nav(name);
      await shot('section-' + name.toLowerCase().replaceAll(' ', '-'));
    }
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await shot('settings');
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    const machine = await page.evaluate(
      async () => (await window.intelligence.bootstrap()).machine.displayName,
    );
    await nav(machine);
    await shot('machine');
    for (const [w, h] of [
      [2560, 1440],
      [1366, 768],
    ]) {
      await size(w, h);
      await nav('Reports');
      await page.locator('.assistant-toggle').click();
      await shot('reports-' + w);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
      await page.getByLabel('Close assistant').click();
      await page.getByRole('button', { name: 'New report', exact: true }).click();
      await shot('gallery-' + w);
      await page.keyboard.press('Escape');
    }
    await size(1920, 1080);
    await page.evaluate(() => {
      document.documentElement.style.zoom = '1.25';
    });
    await page.getByRole('button', { name: 'New report', exact: true }).click();
    const scaledBounds = await page.locator('.report-template-library').boundingBox();
    assert.ok(scaledBounds.y >= 0 && scaledBounds.y + scaledBounds.height <= 1081);
    await shot('gallery-125percent');
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      document.documentElement.style.zoom = '1';
    });
    await size(1920, 1080);
    await page.evaluate(() => window.intelligence.settings({ language: 'ro' }));
    await page.waitForTimeout(200);
    await nav('Rapoarte');
    await page.getByRole('button', { name: 'Raport nou', exact: true }).click();
    await page.getByRole('button', { name: 'Raport personalizat nou', exact: true }).waitFor();
    await shot('gallery-ro');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.intelligence.settings({ language: 'en' }));
  }
  assert.deepEqual(errors, []);
  if (!process.argv.includes('--selection-only'))
    results.checks.push(
      'all section screenshots, six gallery themes, 2560/1366 layouts, Romanian, no renderer errors',
    );
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} catch (e) {
  console.error(e);
  throw e;
} finally {
  await app.close();
  await new Promise((r) => server.close(r));
}
