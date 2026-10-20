import { pickChoice } from './ui-pickers.mjs';
import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { createPackage } from '@electron/asar';

const directory = path.resolve('.test-data/matrix-desktop-' + Date.now());
fs.mkdirSync(directory, { recursive: true });
let heldResponse, releaseFirst, firstRequest;
const firstSeen = new Promise((resolve) => {
  firstRequest = resolve;
});
let taskId, childId, attachmentId, questionId;
const attempts = new Map();
const requests = [];
const send = (res, calls) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.end(
    'data: ' +
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: calls.map((call, index) => ({
                index,
                id: 'call_' + index,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.args) },
              })),
            },
          },
        ],
      }) +
      '\n\ndata: [DONE]\n\n',
  );
};
const server = createServer(async (req, res) => {
  if (req.url === '/api/v1/models') {
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        models: [
          {
            key: 'fixture',
            loaded_instances: [{ id: 'fixture', config: { context_length: 32768 } }],
          },
        ],
      }),
    );
    return;
  }
  if (req.url === '/v1/models') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data: [{ id: 'fixture' }, { id: 'second fixture model' }] }));
    return;
  }
  if (req.method === 'GET') {
    res.writeHead(404);
    res.end('{}');
    return;
  }
  let text = '';
  for await (const chunk of req) text += chunk;
  const body = JSON.parse(text),
    prompt = body.messages.findLast(
      (m) =>
        m.role === 'user' &&
        typeof m.content === 'string' &&
        m.content.includes('Execute this integrated'),
    )?.content;
  const id = prompt?.match(/"id":"([a-f0-9-]+)"/)?.[1];
  requests.push(body);
  if (id === childId && !heldResponse) {
    heldResponse = res;
    releaseFirst = () =>
      send(res, [
        {
          name: 'matrix_outcome',
          args: {
            id,
            status: 'done',
            message: 'Sources checked.',
            verification: 'Fixture source list reviewed.',
          },
        },
      ]);
    firstRequest();
    return;
  }
  if (id === questionId) {
    const attempt = attempts.get(id) ?? 0;
    attempts.set(id, attempt + 1);
    send(res, [
      {
        name: 'matrix_outcome',
        args: attempt
          ? {
              id,
              status: 'done',
              message: 'The last-month answer is ready.',
              verification: 'Used the user’s date range.',
            }
          : { id, status: 'needs_input', message: 'Which date range should I use?' },
      },
    ]);
    return;
  }
  send(res, [
    { name: 'matrix_read_attachment', args: { id: attachmentId } },
    {
      name: 'matrix_create_report',
      args: {
        id: taskId,
        name: 'research-report.md',
        content:
          '# Research report\n\nA saved desktop fixture report based on the attached context.',
      },
    },
    {
      name: 'matrix_respond',
      args: { id: taskId, content: 'The research report is attached to this task.' },
    },
    {
      name: 'matrix_outcome',
      args: {
        id: taskId,
        status: 'done',
        message: 'Report attached.',
        verification: 'Read the context attachment and saved research-report.md.',
      },
    },
  ]);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const env = { ...process.env, INTELLIGENCE_TEST: '1', INTELLIGENCE_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
// Preserve an explicitly selected dev preview; otherwise use the built interface.
let desktop;
try {
  desktop = await electron.launch({
    executablePath: electronPath,
    args: ['.', '--disable-gpu'],
    env,
    timeout: 30000,
  });
  await desktop.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1920, 1080),
  );
  const page = await desktop.firstWindow();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const capture = async (name) => {
    const encoded = await desktop.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      await window.capturePage(undefined, { stayHidden: true, stayAwake: true });
      await new Promise((resolve) => setTimeout(resolve, 150));
      return (await window.capturePage(undefined, { stayHidden: true, stayAwake: true }))
        .toPNG()
        .toString('base64');
    });
    fs.writeFileSync(path.join(directory, name), Buffer.from(encoded, 'base64'));
  };
  await page.getByRole('button', { name: 'Cognition Matrix', exact: true }).click();
  await page.getByRole('heading', { name: 'Cognition Matrix', exact: true }).waitFor();
  assert.equal(await page.locator('.matrix-list').count(), 3);
  assert.equal(await page.getByLabel('Active project').count(), 0);
  assert.deepEqual(await page.evaluate(() => ({ width: innerWidth, height: innerHeight })), {
    width: 1920,
    height: 1080,
  });
  await page.evaluate(
    (endpoint) =>
      window.intelligence.settings({
        provider: 'lmstudio',
        endpoint,
        model: 'fixture',
        semanticSearch: false,
        autoConsolidation: false,
      }),
    'http://127.0.0.1:' + server.address().port,
  );
  await page.evaluate(() =>
    window.intelligence.mutate({
      id: 'matrix-core',
      data: { description: 'Read the attached sources and keep report outputs with their tasks.' },
    }),
  );
  const core = page.getByRole('region', { name: 'Core Matrix list', exact: true });
  await core
    .getByRole('textbox', { name: 'New task in Core' })
    .fill('Research local search options');
  await core.getByRole('button', { name: 'Add task', exact: true }).click();
  await core
    .getByRole('button', { name: 'Expand Research local search options', exact: true })
    .waitFor();
  assert.equal(
    await core
      .getByRole('textbox', { name: 'Description for Research local search options', exact: true })
      .count(),
    0,
  );
  await core
    .getByRole('button', { name: 'Expand Research local search options', exact: true })
    .click();
  const description = core.getByRole('textbox', {
    name: 'Description for Research local search options',
    exact: true,
  });
  await description.fill('Compare the options using the context file, then attach a report.');
  await description.press('Tab');
  await page.waitForFunction(async () =>
    (await window.intelligence.bootstrap()).entities.some(
      (e) => e.kind === 'matrix-task' && e.data.content?.includes('Compare the options'),
    ),
  );
  await core.getByLabel('Result format for Research local search options').selectOption('report');
  await page.waitForFunction(async () =>
    (await window.intelligence.bootstrap()).entities.some(
      (e) => e.kind === 'matrix-task' && e.data.output === 'report',
    ),
  );
  await core
    .getByRole('textbox', { name: 'New subtask for Research local search options', exact: true })
    .fill('Check sources');
  await core.getByRole('button', { name: 'Add subtask', exact: true }).click();
  await core.getByRole('button', { name: 'Expand Check sources', exact: true }).waitFor();
  const snapshot = await page.evaluate(() => window.intelligence.bootstrap());
  taskId = snapshot.entities.find((e) => e.title === 'Research local search options').id;
  childId = snapshot.entities.find((e) => e.title === 'Check sources').id;
  const contextFile = path.join(directory, 'context.txt');
  fs.writeFileSync(contextFile, 'Local search context for the desktop smoke test.');
  await desktop.evaluate(
    ({ dialog }, files) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files });
    },
    [contextFile, path.resolve('build/icon.png')],
  );
  await core.getByRole('button', { name: 'Attach files / images', exact: true }).click();
  await core.getByRole('button', { name: /^context.txt/ }).waitFor();
  attachmentId = (await page.evaluate(() => window.intelligence.bootstrap())).entities.find(
    (e) => e.kind === 'matrix-file' && e.title === 'context.txt',
  ).id;
  await core.getByRole('switch', { name: 'Integrate Matrix Core', exact: true }).check();
  await firstSeen;
  await page.waitForFunction(
    async (id) => (await window.intelligence.bootstrap()).matrixActive?.task === id,
    childId,
  );
  await capture('matrix-working-1080.png');
  releaseFirst();
  await page.waitForFunction(
    async (id) =>
      (await window.intelligence.bootstrap()).entities.find((e) => e.id === id)?.data.status ===
      'done',
    taskId,
  );
  assert.ok(
    requests[0].messages.some(
      (m) => typeof m.content === 'string' && m.content.includes('Read the attached sources'),
    ),
  );
  await core.getByRole('button', { name: /^research-report.md/ }).waitFor();
  await desktop.evaluate(({ shell }) => {
    shell.openPath = async (file) => {
      globalThis.__matrixOpened = file;
      return '';
    };
  });
  await core.getByRole('button', { name: /^research-report.md/ }).click();
  const opened = await desktop.evaluate(() => globalThis.__matrixOpened);
  assert.equal(path.dirname(opened), path.join(directory, 'matrix-files'));
  assert.ok(fs.readFileSync(opened, 'utf8').includes('# Research report'));
  const exported = path.join(directory, 'research-report.md');
  await desktop.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, exported);
  await core
    .getByRole('button', { name: 'Save a copy of research-report.md', exact: true })
    .click();
  await page.waitForFunction(() => document.querySelectorAll('.matrix-file').length > 0);
  let exportedContent = '';
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      exportedContent = fs.readFileSync(exported, 'utf8');
    } catch (error) {
      if (!['ENOENT', 'EBUSY'].includes(error.code)) throw error;
    }
    if (exportedContent.includes('# Research report')) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(exportedContent.includes('# Research report'));
  const question = await page.evaluate(() =>
    window.intelligence.mutate({
      kind: 'matrix-task',
      parent: 'matrix-core',
      title: 'Summarize release activity',
      data: { status: 'paused', content: 'Ask for a date range before completing.' },
    }),
  );
  questionId = question.id;
  await page.evaluate(
    (id) => window.intelligence.matrixAction({ id, action: 'retry' }),
    questionId,
  );
  await page.waitForFunction(
    async (id) =>
      (await window.intelligence.bootstrap()).entities.find((e) => e.id === id)?.data.status ===
      'needs_input',
    questionId,
  );
  await core
    .getByRole('button', { name: 'Expand Summarize release activity', exact: true })
    .click();
  await core
    .getByRole('textbox', { name: 'Reply to Summarize release activity', exact: true })
    .fill('Use the last month');
  await core
    .getByRole('textbox', { name: 'Reply to Summarize release activity', exact: true })
    .locator('..')
    .getByRole('button', { name: 'Send & queue', exact: true })
    .click();
  await page.waitForFunction(
    async (id) =>
      (await window.intelligence.bootstrap()).entities.find((e) => e.id === id)?.data.status ===
      'done',
    questionId,
  );
  await page
    .getByRole('button', { name: 'Collapse Research local search options', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Collapse Summarize release activity', exact: true })
    .click();
  const secondary = page.getByRole('region', { name: 'Secondary Matrix list', exact: true });
  await secondary.locator('.matrix-configuration > summary').click();
  const name = secondary.getByLabel('Name for secondary');
  await name.fill('Research');
  await name.press('Tab');
  await page.waitForFunction(
    async () =>
      (await window.intelligence.bootstrap()).entities.find((e) => e.id === 'matrix-secondary')
        .title === 'Research',
  );
  await page.getByRole('button', { name: 'Matrix settings', exact: false }).click();
  assert.equal(
    await page
      .locator('.matrix-preload-control')
      .evaluate((node) => getComputedStyle(node).display),
    'grid',
  );
  const interval = page.getByLabel('Matrix preload lead time');
  await interval.fill('2');
  await interval.press('Tab');
  await page.waitForFunction(
    async () => (await window.intelligence.bootstrap()).settings.matrixPreloadMinutes === 2,
  );
  await page.getByRole('switch', { name: /Prepare model before Matrix tasks/ }).click();
  await page.waitForFunction(
    async () => (await window.intelligence.bootstrap()).settings.matrixPreload === false,
  );
  await page.waitForFunction(() =>
    !document.querySelector('input[disabled][aria-label="Matrix preload lead time"]')
      ? false
      : true,
  );
  await page.getByRole('switch', { name: /Prepare model before Matrix tasks/ }).click();
  await page.waitForFunction(
    async () => (await window.intelligence.bootstrap()).settings.matrixPreload === true,
  );
  await page.keyboard.press('Escape');
  await page.evaluate(() =>
    window.intelligence.mutate({ id: 'matrix-core', data: { integrated: false } }),
  );
  await core.locator('.matrix-configuration > summary').click();
  const matrixAgent = await page.evaluate(() =>
    window.intelligence.workspace({
      action: 'profile-save',
      title: 'Matrix fixture agent',
      data: {
        provider: 'ollama',
        model: 'second fixture model',
        inheritModel: false,
        toolGroups: null,
      },
    }),
  );
  await pickChoice(page, 'Choose agent', 'Matrix fixture agent', core);
  await page.waitForFunction(
    async (id) =>
      (await window.intelligence.bootstrap()).entities.find((e) => e.id === 'matrix-core').data
        .assignedAgent === id,
    matrixAgent.id,
  );
  await capture('matrix-agent-controls-1080.png');
  const defaultName = await page.evaluate(async () => {
    const s = await window.intelligence.bootstrap();
    return s.entities.find((e) => e.id === s.settings.activeAgent).title;
  });
  await pickChoice(page, 'Choose agent', defaultName, core);
  await core
    .getByRole('button', { name: 'Expand Research local search options', exact: true })
    .click();
  await core.locator('.matrix-configuration > summary').click();
  const taskControls = core.locator('.matrix-trigger-controls').first();
  await taskControls.locator('summary').click();
  await taskControls
    .getByLabel('Trigger for Research local search options')
    .selectOption('completion');
  await taskControls.getByRole('combobox').nth(1).selectOption(questionId);
  await capture('matrix-trigger-controls-1080.png');
  await taskControls.getByRole('button', { name: 'Save trigger' }).click();
  await page.waitForFunction(
    async (id) =>
      (await window.intelligence.bootstrap()).entities.find((e) => e.id === id).data.trigger
        ?.kind === 'completion',
    taskId,
  );
  await taskControls.getByLabel('Trigger for Research local search options').selectOption('time');
  await taskControls.getByRole('button', { name: 'Save trigger' }).click();
  await core
    .getByRole('button', { name: 'Collapse Research local search options', exact: true })
    .click();
  await page.evaluate(async () => {
    await window.intelligence.settings({ matrixDoneColor: '#22bb88' });
    for (const [parent, title, status] of [
      ['matrix-core', 'Review saved notes', 'paused'],
      ['matrix-core', 'Compare two proposals', 'paused'],
      ['matrix-core', 'Prepare a reading summary', 'paused'],
      ['matrix-core', 'Collect sources for a report', 'paused'],
      ['matrix-core', 'Check the latest findings', 'paused'],
      ['matrix-core', 'Outline the next experiment', 'paused'],
      ['matrix-core', 'Draft a documentation update', 'paused'],
      ['matrix-core', 'Organize follow-up questions', 'paused'],
      ['matrix-secondary', 'Compare document formats', 'needs_input'],
      ['matrix-secondary', 'Check a remote connection', 'failed'],
      ['matrix-tertiary', 'Draft a weekly brief', 'queued'],
      ['matrix-tertiary', 'Outline a reading plan', 'queued'],
    ])
      await window.intelligence.mutate({ kind: 'matrix-task', parent, title, data: { status } });
  });
  await page.waitForFunction(
    () =>
      document.querySelector('.matrix-marker[aria-label="Done"]')?.style.color ===
      'rgb(34, 187, 136)',
  );
  const layout = await page.locator('.matrix-list').evaluateAll((lists) =>
    lists.map((list) => {
      const r = list.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, right: r.right };
    }),
  );
  assert.ok(layout.every((r) => r.width > 400 && r.right <= 1920));
  assert.equal(layout[0].y, layout[2].y);
  assert.ok(layout[0].x < layout[1].x && layout[1].x < layout[2].x);
  await capture('matrix-night-1080.png');
  await page.getByRole('button', { name: 'Switch theme', exact: true }).click();
  await capture('matrix-day-1080.png');
  await page.getByRole('button', { name: 'Matrix settings', exact: false }).click();
  await capture('matrix-settings-1080.png');
  await page.keyboard.press('Escape');
  await desktop.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(2560, 1440),
  );
  assert.equal(await page.locator('.matrix-list').count(), 3);
  await capture('matrix-day-1440p.png');
  await desktop.evaluate(({ app }) => app.getAppMetrics());
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const idleProcesses = await desktop.evaluate(({ app }) =>
    app.getAppMetrics().map((value) => ({
      type: value.type,
      name: value.name ?? '',
      cpuPercent: value.cpu.percentCPUUsage,
      workingSetKiB: value.memory.workingSetSize,
    })),
  );
  // Test worker loading through an ASAR path, the same path form used by an AppImage.
  const stage = path.join(directory, 'worker-stage');
  fs.mkdirSync(path.join(stage, 'electron'), { recursive: true });
  fs.copyFileSync(
    'electron/matrix-file-worker.mjs',
    path.join(stage, 'electron', 'matrix-file-worker.mjs'),
  );
  fs.copyFileSync('electron/docx.mjs', path.join(stage, 'electron', 'docx.mjs'));
  fs.cpSync('node_modules/pdf2json', path.join(stage, 'node_modules', 'pdf2json'), {
    recursive: true,
  });
  const archive = path.join(directory, 'worker.asar');
  await createPackage(stage, archive);
  const archivedText = await desktop.evaluate(
    async (_, workerPath) => {
      const { Worker } = process.getBuiltinModule('worker_threads');
      return new Promise((resolve, reject) => {
        const worker = new Worker(new URL(workerPath), {
          workerData: { bytes: Buffer.from('Archived worker fixture'), extension: '.txt' },
        });
        const timer = setTimeout(() => {
          void worker.terminate();
          reject(new Error('Archived worker timed out'));
        }, 10000);
        worker.once('message', (message) => {
          clearTimeout(timer);
          void worker.terminate();
          message.error ? reject(new Error(message.error)) : resolve(message.text);
        });
        worker.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
    },
    pathToFileURL(path.join(archive, 'electron', 'matrix-file-worker.mjs')).href,
  );
  assert.equal(archivedText, 'Archived worker fixture');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(
    JSON.stringify({
      result: 'passed',
      directory,
      requests: requests.length,
      idleProcesses,
      checks: [
        '1920x1080 three-column layout',
        '2560x1440 layout',
        'global scope',
        'collapsed tasks',
        'subtasks first',
        'file/image attachments',
        'report file output',
        'task reply and resume',
        'preload toggle and lead time',
        'per-list model and chat inheritance',
        'task trigger controls',
        'custom status colors',
        'ASAR extraction worker',
        'no renderer errors',
      ],
    }),
  );
} finally {
  if (heldResponse && !heldResponse.writableEnded) heldResponse.destroy();
  await desktop?.close();
  await new Promise((resolve) => server.close(resolve));
}
