import { pickChoice } from './ui-pickers.mjs';
import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
const directory = path.resolve('.test-data/onboarding-' + Date.now());
fs.mkdirSync(directory, { recursive: true });
const requests = [],
  captures = [];
let book, note;
const server = createServer(async (req, res) => {
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        data: [{ id: 'setup-fixture-model' }],
        models: [{ name: 'setup-fixture-model' }],
      }),
    );
    return;
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  requests.push(body);
  const last = body.messages.at(-1),
    user = [...body.messages].reverse().find((m) => m.role === 'user')?.content || '';
  let delta = { role: 'assistant', content: 'The local test model replied.' };
  if (body.tools?.length && user.includes('access')) {
    if (last.role === 'user')
      delta = {
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: 'grant-' + requests.length,
            type: 'function',
            function: {
              name: 'request_access',
              arguments: JSON.stringify({
                id: book,
                permission: 'read',
                reason: 'Read the notebook explicitly selected by the user',
              }),
            },
          },
        ],
      };
    else if (last.tool_name === 'request_access' && JSON.parse(last.content).approved)
      delta = {
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: 'read-' + requests.length,
            type: 'function',
            function: { name: 'read_item', arguments: JSON.stringify({ id: note }) },
          },
        ],
      };
    else delta = { role: 'assistant', content: 'Permission-backed reading finished.' };
  }
  if (body.tools?.length && user.includes('configure')) {
    if (last.role === 'user')
      delta = {
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: 'config-' + requests.length,
            type: 'function',
            function: {
              name: 'propose_configuration_change',
              arguments: JSON.stringify({
                changes: { personality: 'Use clear, short explanations.' },
                reason: 'Apply the assistance style requested by the user',
              }),
            },
          },
        ],
      };
    else delta = { role: 'assistant', content: 'Configuration review finished.' };
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.end(
    'data: ' +
      JSON.stringify({
        choices: [{ delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }],
      }) +
      '\n\ndata: [DONE]\n\n',
  );
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const env = {
  ...process.env,
  INTELLIGENCE_TEST: '1',
  INTELLIGENCE_TEST_ONBOARDING: '1',
  INTELLIGENCE_DATA_DIR: directory,
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.INTELLIGENCE_DEV_URL;
const app = await electron.launch({
  executablePath: electronPath,
  args: ['.', '--disable-gpu'],
  env,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const size = async (w, h) =>
    app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].setSize(...s), [w, h]);
  const shot = async (name) => {
    await page.mouse.move(10, 10);
    await page.waitForTimeout(200);
    await app.evaluate(async ({ BrowserWindow }) => {
      await BrowserWindow.getAllWindows()[0].capturePage(undefined, {
        stayHidden: true,
        stayAwake: true,
      });
    });
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
  };
  const fit = async () => {
    const boxes = await page
      .locator('.setup-dialog,.settings-dialog,.feature-lesson,.scoped-approval')
      .evaluateAll((es) =>
        es.map((e) => {
          const r = e.getBoundingClientRect();
          return {
            name: e.className,
            x: r.x,
            y: r.y,
            right: r.right,
            bottom: r.bottom,
            width: e.clientWidth,
            overflow: e.scrollWidth - e.clientWidth,
            viewport: [innerWidth, innerHeight],
          };
        }),
      );
    for (const box of boxes) {
      assert(box.x >= -1 && box.right <= box.viewport[0] + 2, JSON.stringify(box));
      assert(box.overflow <= 2, JSON.stringify(box));
      if (!box.name.includes('approval'))
        assert(box.y >= -1 && box.bottom <= box.viewport[1] + 2, JSON.stringify(box));
    }
  };
  await size(1920, 1080);
  const setup = page.getByRole('dialog', { name: 'Getting started', exact: true });
  await setup.waitFor();
  const fresh = await page.evaluate(() => window.intelligence.bootstrap());
  assert.equal(fresh.settings.semanticSearch, false);
  assert.equal(fresh.settings.autoConsolidation, false);
  assert.equal(fresh.settings.memoryAccess, false);
  assert.equal(fresh.settings.background, false);
  assert.equal(
    fresh.entities.find((e) => e.id === fresh.settings.activeAgent).data.resourcePolicy,
    'ask',
  );
  const fixtures = await page.evaluate(async () => {
    const b = await window.intelligence.mutate({
      kind: 'notebook',
      title: 'Selected private notebook',
      data: { access: false },
    });
    const n = await window.intelligence.mutate({
      kind: 'note',
      parent: b.id,
      title: 'Private fixture note',
      data: { content: 'Fixture-only private sentence.' },
    });
    return { book: b.id, note: n.id };
  });
  book = fixtures.book;
  note = fixtures.note;
  await page.evaluate(() => window.intelligence.settings({ theme: 'marble' }));
  await shot('01-welcome-marble');
  await fit();
  await setup.getByRole('button', { name: 'Start setup', exact: true }).click();
  await setup.getByLabel('Your name', { exact: true }).fill('Alex');
  await setup
    .getByLabel('Describe yourself (optional)', { exact: true })
    .fill('I enjoy gardens and weekly planning.');
  await setup.getByLabel('Agent name', { exact: true }).fill('Guide companion');
  await shot('02-profile-marble');
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  let state = await page.evaluate(() => window.intelligence.bootstrap());
  assert.equal(state.settings.preferredName, 'Alex');
  assert.equal(state.settings.profileDescription, 'I enjoy gardens and weekly planning.');
  assert.equal(state.settings.shareProfile, false);
  assert.equal(state.settings.onboarding.stage, 'model');
  await setup.getByLabel('Inference provider', { exact: true }).selectOption('lmstudio');
  const address = 'http://127.0.0.1:' + server.address().port;
  await setup.getByLabel('Server address', { exact: true }).fill(address);
  await setup.getByLabel('Server address', { exact: true }).press('Tab');
  await page.waitForFunction(
    async (endpoint) => (await window.intelligence.bootstrap()).settings.endpoint === endpoint,
    address,
  );
  await setup.getByRole('button', { name: /Test connection & find models/ }).click();
  await setup
    .getByText('Server reached · Models found. Choose a model below.', { exact: true })
    .waitFor();
  await pickChoice(page, 'Selected model', 'setup-fixture-model', setup);
  await setup.getByRole('button', { name: 'Test a reply', exact: true }).click();
  await setup
    .getByText('Reply tested. This model can chat. Agent tools remain untested.', { exact: true })
    .waitFor();
  assert(!JSON.stringify(requests[0]).includes('I enjoy gardens'));
  await shot('03-model-marble');
  await fit();
  await setup.getByRole('button', { name: 'Advanced setup in Settings', exact: true }).click();
  await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor();
  assert.equal(await setup.count(), 0);
  await page.getByRole('button', { name: 'Look & feel', exact: true }).click();
  await page.getByRole('button', { name: 'Return to setup', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await setup.getByRole('heading', { name: 'Connect your AI', exact: true }).waitFor();
  await setup.getByRole('button', { name: 'Save & exit', exact: true }).click();
  await setup.waitFor({ state: 'detached' });
  assert.equal(await setup.count(), 0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  assert.equal(await setup.count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Return to setup', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.reload();
  await page.locator('.sidebar').waitFor();
  assert.equal(await setup.count(), 0);
  await page.getByRole('button', { name: 'Continue setup', exact: true }).first().click();
  await setup.getByRole('heading', { name: 'Connect your AI', exact: true }).waitFor();
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  await shot('04-access-marble');
  await fit();
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  await shot('05-memory-marble');
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  await shot('06-review-marble');
  await fit();
  await setup.getByRole('button', { name: 'Start chatting', exact: true }).click();
  await setup.waitFor({ state: 'detached' });
  state = await page.evaluate(() => window.intelligence.bootstrap());
  assert.equal(state.settings.onboardingComplete, true);
  const openGuide = async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByText('Help & setup', { exact: true }).click();
    await page.getByRole('button', { name: 'Written guide', exact: true }).click();
    await page.getByRole('heading', { name: 'Your guide to Intelligence', exact: true }).waitFor();
  };
  await openGuide();
  await page
    .getByRole('navigation', { name: 'Guide contents' })
    .getByRole('button', { name: 'Agent access and approvals', exact: true })
    .click();
  await shot('07-written-guide-marble');
  await fit();
  await page.getByLabel('Find help', { exact: true }).fill('semantic');
  assert(
    (await page.getByRole('navigation', { name: 'Guide contents' }).getByRole('button').count()) >
      0,
  );
  await page.getByLabel('Find help', { exact: true }).fill('');
  await page
    .getByRole('navigation', { name: 'Guide contents' })
    .getByRole('button', { name: 'Notebooks, chapters and notes', exact: true })
    .click();
  await page.getByRole('button', { name: 'Start lesson', exact: true }).click();
  await page.getByRole('region', { name: 'Feature lesson' }).waitFor();
  await shot('08-optional-lesson');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Save & exit', exact: true }).click();
  state = await page.evaluate(() => window.intelligence.bootstrap());
  assert.equal(state.settings.onboardingComplete, true);
  assert.equal(state.settings.onboarding.lessons.notes, 1);
  await page.getByRole('button', { name: 'Chat', exact: true }).first().click();
  await page.getByRole('button', { name: 'Add sources', exact: true }).click();
  await page
    .locator('.sources-dialog')
    .getByRole('button', { name: 'Notebooks', exact: true })
    .click();
  await page.getByLabel('Find a resource', { exact: true }).fill('Selected private notebook');
  await page
    .locator('.sources-dialog .source-resource')
    .filter({ hasText: 'Selected private notebook' })
    .getByRole('checkbox')
    .check();
  await page.locator('.sources-dialog').getByRole('button', { name: 'Done', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Message Intelligence', exact: true })
    .fill('Ask for temporary access to my selected notebook.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByRole('button', { name: 'Allow for this request', exact: true }).waitFor();
  await shot('09-permission-main');
  await fit();
  await page.getByRole('button', { name: 'Allow for this request', exact: true }).click();
  await page.getByText('Permission-backed reading finished.', { exact: true }).waitFor();
  await page.waitForFunction(
    async () => !(await window.intelligence.bootstrap()).activeConversations.length,
  );
  state = await page.evaluate(() => window.intelligence.bootstrap());
  assert.equal(state.temporaryAccess.length, 0);
  const scopedMessages = await page.evaluate(
    (id) => window.intelligence.messages(id),
    state.entities.find((e) => e.kind === 'conversation' && e.title === 'Selected private notebook')
      .id,
  );
  assert(
    scopedMessages.some(
      (m) => m.role === 'assistant' && !m.data.tool && m.data.scopedSources?.includes(note),
    ),
    'Actual assistant replies retain scoped source provenance',
  );
  assert.equal(
    state.entities.find((e) => e.id === state.settings.activeAgent).data.resourceGrants.length,
    0,
  );
  assert(
    requests.some((r) =>
      r.messages.some(
        (m) => m.role === 'tool' && String(m.content).includes('Fixture-only private sentence.'),
      ),
    ),
    'Approved read reached the actual note tool',
  );
  await page
    .getByRole('textbox', { name: 'Message Intelligence', exact: true })
    .fill('Ask for permanent access to my selected notebook.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByRole('button', { name: 'Always allow for this agent', exact: true }).click();
  await page.waitForFunction(
    async () => !(await window.intelligence.bootstrap()).activeConversations.length,
  );
  state = await page.evaluate(() => window.intelligence.bootstrap());
  assert.equal(
    state.entities.find((e) => e.id === state.settings.activeAgent).data.resourceGrants.length,
    1,
  );
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Agent access', exact: true }).click();
  await page.locator('.resource-grants > summary').click();
  await page
    .locator('.grant-row')
    .filter({ hasText: 'Selected private notebook' })
    .getByRole('button', { name: 'Revoke', exact: true })
    .click();
  await page.waitForFunction(async () => {
    const state = await window.intelligence.bootstrap();
    return !state.entities.find((e) => e.id === state.settings.activeAgent).data.resourceGrants
      .length;
  });
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Message Intelligence', exact: true })
    .fill('Please configure your style.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByRole('button', { name: 'Save for this agent', exact: true }).waitFor();
  await shot('10-configuration-main');
  await page.getByRole('button', { name: 'Save for this agent', exact: true }).click();
  await page.waitForFunction(
    async () => !(await window.intelligence.bootstrap()).activeConversations.length,
  );
  await page.getByRole('button', { name: /Ask Guide companion/ }).click();
  const sidebar = page.locator('.assistant-pane');
  await sidebar.getByRole('button', { name: 'Add sources', exact: true }).click();
  await page
    .locator('.sources-dialog')
    .getByRole('button', { name: 'Notebooks', exact: true })
    .click();
  await page.getByLabel('Find a resource', { exact: true }).fill('Selected private notebook');
  await page
    .locator('.sources-dialog .source-resource')
    .filter({ hasText: 'Selected private notebook' })
    .getByRole('checkbox')
    .check();
  await page.locator('.sources-dialog').getByRole('button', { name: 'Done', exact: true }).click();
  await sidebar
    .getByRole('textbox', { name: 'Message contextual assistant', exact: true })
    .fill('Ask for access in the sidebar.');
  await sidebar.getByRole('button', { name: 'Send message', exact: true }).click();
  await sidebar.getByRole('button', { name: 'Allow for this request', exact: true }).waitFor();
  await shot('11-permission-sidebar');
  await fit();
  await sidebar.getByRole('button', { name: 'Decline', exact: true }).click();
  await page.waitForFunction(
    async () => !(await window.intelligence.bootstrap()).activeConversations.length,
  );
  for (const [w, h] of [
    [1366, 768],
    [2560, 1440],
    [3440, 1440],
  ]) {
    await size(w, h);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByText('Help & setup', { exact: true }).click();
    await page.getByRole('button', { name: 'Review setup', exact: true }).click();
    await fit();
    await shot('12-setup-' + w);
    if (w === 1366) {
      await setup.getByRole('button', { name: 'Start setup', exact: true }).click();
      await setup.getByRole('button', { name: 'Continue', exact: true }).click();
      await setup.getByRole('button', { name: 'Advanced setup in Settings', exact: true }).click();
      await page
        .locator('.settings-navigation')
        .getByRole('button', { name: 'Your profile', exact: true })
        .click();
      await page.getByRole('button', { name: 'Close settings', exact: true }).click();
      await setup.getByRole('heading', { name: 'Connect your AI', exact: true }).waitFor();
      await fit();
      await shot('12-model-short-review');
    }
    await setup
      .getByRole('button', { name: w === 1366 ? 'Save & exit' : 'Explore first', exact: true })
      .click();
    await setup.waitFor({ state: 'detached' });
    state = await page.evaluate(() => window.intelligence.bootstrap());
    assert.equal(
      state.settings.onboardingComplete,
      true,
      'Reviewing setup does not undo completion',
    );
    assert.equal(state.settings.onboarding.lessons.notes, 1, 'Reviewing setup preserves lessons');
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  }
  await size(1920, 1080);
  await page.evaluate(() => window.intelligence.settings({ language: 'ro' }));
  await page.getByRole('button', { name: 'Setări', exact: true }).click();
  await page.getByText('Ajutor și configurare', { exact: true }).click();
  await page.getByRole('button', { name: 'Ghid scris', exact: true }).click();
  await page
    .getByRole('heading', { name: 'Ghidul tău pentru Intelligence', exact: true })
    .waitFor();
  await shot('13-guide-ro');
  await fit();
  await page.getByRole('button', { name: 'Revizuiește configurarea', exact: true }).click();
  await page.getByRole('dialog', { name: 'Primii pași', exact: true }).waitFor();
  await shot('14-setup-ro');
  await fit();
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(directory, 'report.json'),
    JSON.stringify({ result: 'passed', captures, requests: requests.length, errors }, null, 2),
  );
  console.log(
    JSON.stringify({ result: 'passed', directory, captures, requests: requests.length, errors }),
  );
} finally {
  await app.close();
  await new Promise((r) => server.close(r));
}
