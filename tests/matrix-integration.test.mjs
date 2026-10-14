import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { Store } from '../electron/store.mjs';
import { Agent } from '../electron/agent.mjs';
import { CognitionMatrix } from '../electron/matrix.mjs';
import { modelHistory } from '../electron/chat-history.mjs';
async function server(t, handler) {
  const value = createServer((req, res) => {
    if (req.url === '/api/v1/models') {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({ models: [{ key: 'fixture', loaded_instances: [{ id: 'fixture' }] }] }),
      );
      return;
    }
    return handler(req, res);
  });
  await new Promise((resolve) => value.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => value.close(resolve)));
  return 'http://127.0.0.1:' + value.address().port;
}
function fixture(t, events = () => {}, connections = { tools: () => [] }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-matrix-wire-'));
  const store = new Store(directory);
  store.setSettings({
    provider: 'lmstudio',
    model: 'fixture',
    semanticSearch: false,
    autoConsolidation: false,
  });
  const agent = new Agent(
    store,
    { search: async () => [], index: async () => {} },
    connections,
    events,
  );
  const matrix = new CognitionMatrix(store, agent, events);
  agent.matrix = matrix;
  store.mutate({
    id: 'matrix-core',
    data: { integrated: true, description: 'Research context fixture' },
  });
  t.after(() => {
    matrix.close();
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { store, agent, matrix };
}
const send = (res, calls, content = '') => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.end(
    'data: ' +
      JSON.stringify({
        choices: [
          {
            delta: {
              content,
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

test('real harness researches through SearXNG, creates a report, and records a verified task output', async (t) => {
  const f = fixture(t);
  const task = f.store.mutate({
    kind: 'matrix-task',
    parent: 'matrix-core',
    title: 'Research fixture',
    data: {
      status: 'queued',
      output: 'report',
      content: 'Research a question and attach the answer.',
    },
  });
  let searchCount = 0;
  const searchEndpoint = await server(t, (req, res) => {
    const url = new URL(req.url, 'http://fixture');
    assert.equal(url.pathname, '/search');
    assert.equal(url.searchParams.get('format'), 'json');
    searchCount++;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        results: [
          {
            title: 'Primary fixture',
            url: 'https://example.org/source',
            content: 'Evidence from a fixture',
          },
        ],
      }),
    );
  });
  const requests = [];
  const endpoint = await server(t, async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    if (requests.length === 1)
      send(res, [
        { name: 'matrix_read_task', args: { id: task.id } },
        { name: 'searxng_search', args: { query: 'fixture query' } },
      ]);
    else
      send(res, [
        {
          name: 'matrix_create_report',
          args: {
            id: task.id,
            name: 'research.md',
            content: '# Research\nEvidence from a fixture. [Source](https://example.org/source)',
          },
        },
        {
          name: 'matrix_respond',
          args: {
            id: task.id,
            content: 'The answer is in the attached report. [Source](https://example.org/source)',
          },
        },
        {
          name: 'matrix_outcome',
          args: {
            id: task.id,
            status: 'done',
            message: 'Research report attached.',
            verification: 'Read the returned source and attached a saved report.',
          },
        },
        {
          name: 'matrix_create_report',
          args: { id: task.id, name: 'should-not-run.md', content: 'Action after completion' },
        },
      ]);
  });
  f.store.setSettings({ endpoint, searxngEndpoint: searchEndpoint });
  await f.matrix.tick();
  assert.equal(searchCount, 1);
  assert.equal(requests.length, 2);
  assert.ok(requests[0].messages[0].content.includes('global agent-only execution queue'));
  assert.ok(requests[0].tools.some((tool) => tool.function.name === 'matrix_outcome'));
  assert.ok(
    requests[1].messages.some(
      (m) => m.role === 'tool' && m.content.includes('Research context fixture'),
    ),
  );
  assert.equal(f.store.get(task.id).data.status, 'done');
  const reports = f.store.children(task.id).filter((e) => e.kind === 'matrix-file');
  assert.equal(reports.length, 1);
  assert.equal(reports[0].title, 'research.md');
  assert.ok(
    fs
      .readFileSync(await f.matrix.files.path(reports[0].id), 'utf8')
      .includes('https://example.org/source'),
  );
  assert.ok(
    f.store
      .children(task.id)
      .filter((e) => e.kind === 'matrix-entry')
      .at(-1)
      .data.content.includes('answer is in the attached report'),
  );
  await f.matrix.tick();
  assert.equal(requests.length, 2);
});

test('images reach LM Studio and replay as image content while stored history keeps references', async (t) => {
  const f = fixture(t);
  const task = f.store.mutate({
    kind: 'matrix-task',
    parent: 'matrix-core',
    title: 'Image fixture',
    data: { status: 'queued' },
  });
  const source = path.join(f.store.directory, 'input.png');
  fs.writeFileSync(source, 'Image fixture bytes');
  const file = await f.matrix.files.import(task.id, source),
    requests = [];
  const endpoint = await server(t, async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    if (requests.length === 1)
      send(res, [{ name: 'matrix_read_attachment', args: { id: file.id } }]);
    else
      send(res, [
        {
          name: 'matrix_outcome',
          args: {
            id: task.id,
            status: 'done',
            message: 'Image inspected',
            verification: 'Image content was provided to the model',
          },
        },
      ]);
  });
  f.store.setSettings({ endpoint });
  await f.matrix.tick();
  assert.ok(
    requests[1].messages.some(
      (m) => Array.isArray(m.content) && m.content.some((part) => part.type === 'image_url'),
    ),
  );
  const conversation = f.store.get(task.id).data.conversation;
  assert.ok(modelHistory(f.store, conversation).some((m) => Array.isArray(m.content)));
  assert.ok(!JSON.stringify(f.store.messages(conversation)).includes('data:image/png;base64'));
});

test('approval requests expose attention, remain reviewable, and deny produces a recorded input request', async (t) => {
  let requested, approve;
  const f = fixture(
    t,
    (event) => {
      if (event.type === 'approval') {
        requested = event;
        approve(event);
      }
    },
    {
      tools: () => [
        {
          type: 'function',
          function: { name: 'mcp_fixture', description: 'Fixture', parameters: { type: 'object' } },
        },
      ],
      call: async () => {
        throw new Error('Denied tools must never execute');
      },
    },
  );
  const task = f.store.mutate({
    kind: 'matrix-task',
    parent: 'matrix-core',
    title: 'Approval fixture',
    data: { status: 'queued' },
  });
  const waiting = new Promise((resolve) => {
    approve = resolve;
  });
  let count = 0;
  const endpoint = await server(t, async (req, res) => {
    for await (const _ of req) {
    }
    count++;
    if (count === 1) send(res, [{ name: 'mcp_fixture', args: {} }]);
    else
      send(res, [
        {
          name: 'matrix_outcome',
          args: {
            id: task.id,
            status: 'needs_input',
            message: 'The connected action was denied. Choose another approach.',
          },
        },
      ]);
  });
  f.store.setSettings({ endpoint });
  const run = f.matrix.tick();
  await waiting;
  assert.equal(f.store.get(task.id).data.awaitingApproval, true);
  assert.equal(f.store.get(task.id).data.status, 'needs_input');
  assert.equal(
    f.agent.approvals.get(requested.id).conversation,
    f.store.get(task.id).data.conversation,
  );
  f.agent.approve(requested.id, false);
  await run;
  assert.equal(f.store.get(task.id).data.awaitingApproval, false);
  assert.equal(f.store.get(task.id).data.status, 'needs_input');
});
