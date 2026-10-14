import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareToolCall, ToolCallError } from '../electron/tool-repair.mjs';
import { nativeTools } from '../electron/agent.mjs';
import { Agent } from '../electron/agent.mjs';
import { Store } from '../electron/store.mjs';
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const call = (name, args) => ({ function: { name, arguments: args } });
test('internal tool repairs normalize fences, unique name spelling, trailing commas and typed scalar arguments', () => {
  const result = prepareToolCall(
    call('List Items', '```json\n{"Offset":"2", "kind":"note",}\n```'),
    nativeTools,
  );
  assert.equal(result.name, 'list_items');
  assert.deepEqual(result.args, { offset: 2, kind: 'note' });
  assert.ok(result.repairs.length >= 3);
});
test('MCP schema validates nested required fields and supports conservative Boolean/number corrections', () => {
  const tools = [
    {
      function: {
        name: 'mcp_fixture_0',
        parameters: {
          type: 'object',
          properties: {
            options: {
              type: 'object',
              properties: { enabled: { type: 'boolean' }, amount: { type: 'number' } },
              required: ['enabled', 'amount'],
              additionalProperties: false,
            },
          },
          required: ['options'],
          additionalProperties: false,
        },
      },
    },
  ];
  assert.deepEqual(
    prepareToolCall(call('mcp_fixture_0', { options: { enabled: 'false', amount: '1.25' } }), tools)
      .args,
    { options: { enabled: false, amount: 1.25 } },
  );
  assert.throws(
    () => prepareToolCall(call('mcp_fixture_0', { options: { enabled: true } }), tools),
    (e) => e instanceof ToolCallError && e.details.schema.includes('amount'),
  );
});
test('repair never fills missing required values, drops unknown keys, resolves ambiguous names or evaluates text', () => {
  assert.throws(() => prepareToolCall(call('read_item', {}), nativeTools), /correction/);
  assert.throws(
    () => prepareToolCall(call('read_item', { id: 'known', extra: 'unknown' }), nativeTools),
    /correction/,
  );
  assert.throws(
    () => prepareToolCall(call('read_item', '{id:process.exit()}'), nativeTools),
    /correction/,
  );
  const tools = [
    { function: { name: 'tool_x', parameters: { type: 'object' } } },
    { function: { name: 'tool-x', parameters: { type: 'object' } } },
  ];
  assert.throws(() => prepareToolCall(call('Tool X', {}), tools), /unavailable/);
  const r = prepareToolCall(call('read_item', '{"id":"x,}",}'), nativeTools);
  assert.equal(r.args.id, 'x,}');
});
test('disabled repair still validates schemas and accepts only exact syntax and names', () => {
  assert.throws(
    () => prepareToolCall(call('List Items', {}), nativeTools, { repair: false }),
    /unavailable/,
  );
  assert.throws(
    () => prepareToolCall(call('list_items', { offset: '2' }), nativeTools, { repair: false }),
    /correction/,
  );
  assert.deepEqual(
    prepareToolCall(call('list_items', { offset: 2 }), nativeTools, { repair: false }).repairs,
    [],
  );
});
test('MCP draft 2020-12 validates references and formats with complete schema feedback', () => {
  const tools = [
    {
      function: {
        name: 'mcp_modern',
        parameters: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          $defs: { address: { type: 'string', format: 'uri' } },
          properties: { url: { $ref: '#/$defs/address' } },
          required: ['url'],
          additionalProperties: false,
        },
      },
    },
  ];
  assert.equal(
    prepareToolCall(call('mcp_modern', { url: 'https://example.org' }), tools).args.url,
    'https://example.org',
  );
  assert.throws(
    () => prepareToolCall(call('mcp_modern', { url: 'not a uri' }), tools),
    /correction/,
  );
});
async function harness(t, reply, connections = { tools: () => [] }) {
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-repair-')));
  t.after(() => store.close());
  const requests = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    requests.push(body);
    res.setHeader('Content-Type', 'text/event-stream');
    res.end(
      'data: ' +
        JSON.stringify({ choices: [{ delta: reply(body, requests.length, store) }] }) +
        '\n\ndata: [DONE]\n\n',
    );
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  store.setSettings({
    provider: 'lmstudio',
    endpoint: 'http://127.0.0.1:' + server.address().port,
    model: 'fixture',
    semanticSearch: false,
    autoConsolidation: false,
  });
  const events = [];
  const agent = new Agent(
    store,
    { search: async () => [], index: async () => {} },
    connections,
    (e) => {
      events.push(e);
      if (e.type === 'approval') agent.approve(e.id, true);
    },
  );
  const conversation = store.mutate({ kind: 'conversation', title: 'Repair fixture', data: {} });
  return { store, agent, conversation, events, requests };
}
const wireCall = (name, args) => ({
  tool_calls: [
    { index: 0, id: 'fixture_call', type: 'function', function: { name, arguments: args } },
  ],
});
test('agent repairs a malformed native call once, records its result, and preserves permission enforcement', async (t) => {
  const f = await harness(t, (_body, n, store) =>
    n === 1
      ? wireCall(
          'Read Item',
          '```json\n' +
            JSON.stringify({
              id: store.all().find((e) => e.kind === 'note' && store.access(e.id)).id,
            }).replace(/}$/, ',}') +
            '\n```',
        )
      : { content: 'Read successfully' },
  );
  await f.agent.chat({ conversation: f.conversation.id, text: 'Read a permitted note' });
  assert.equal(f.requests.length, 2);
  assert.ok(f.requests[1].messages.some((m) => m.role === 'tool' && JSON.parse(m.content).items));
  assert.ok(f.events.some((e) => e.repair));
  assert.equal(f.agent.active.size, 0);
});
test('MCP invalid arguments receive schema feedback and only the corrected approved action executes', async (t) => {
  let executed = 0;
  const tools = [
    {
      type: 'function',
      function: {
        name: 'mcp_fixture_0',
        description: 'Fixture',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
          additionalProperties: false,
        },
      },
    },
  ];
  const f = await harness(
    t,
    (body, n) =>
      n === 1
        ? wireCall('mcp_fixture_0', '{}')
        : n === 2
          ? wireCall('MCP Fixture 0', '{"query":"research"}')
          : { content: 'Finished' },
    {
      tools: () => tools,
      call: async (_name, args) => {
        executed++;
        assert.equal(args.query, 'research');
        return { answer: 'Fixture' };
      },
    },
  );
  await f.agent.chat({ conversation: f.conversation.id, text: 'Use the connected fixture' });
  const error = JSON.parse(f.requests[1].messages.find((m) => m.role === 'tool').content);
  assert.equal(error.actionExecuted, false);
  assert.ok(error.correction.schema.includes('query'));
  assert.equal(executed, 1);
  assert.equal(f.events.filter((e) => e.type === 'approval').length, 1);
  assert.equal(f.agent.approvals.size, 0);
});
test('repeated invalid calls stop at the configured correction budget', async (t) => {
  const f = await harness(t, () => wireCall('read_item', '{}'));
  f.store.setSettings({ toolRepairAttempts: 1 });
  await f.agent.chat({ conversation: f.conversation.id, text: 'Read a note' });
  assert.equal(f.requests.length, 2);
  assert.ok(f.store.messages(f.conversation.id).at(-1).content.includes('correction budget'));
  assert.equal(f.agent.active.size, 0);
});
