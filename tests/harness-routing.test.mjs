import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../electron/store.mjs';
import { Agent, nativeTools } from '../electron/agent.mjs';
import { Connections } from '../electron/connections.mjs';
import { Workspace } from '../electron/workspace.mjs';
import { Vault } from '../electron/vault.mjs';
import { profileSettings, ensureProfiles } from '../electron/profiles.mjs';
import { ensureBuiltinSkills, relevantSkills } from '../electron/skills.mjs';
import { prepareToolCall } from '../electron/tool-repair.mjs';
import { validateConnectionConfiguration } from '../electron/connection-management.mjs';
import http from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

function fixture(t, client = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-routing-'));
  const store = new Store(directory);
  store.setSettings({
    provider: 'lmstudio',
    model: 'fixture',
    autoCompact: false,
    autoConsolidation: false,
  });
  ensureProfiles(store);
  ensureBuiltinSkills(store);
  const chat = store.mutate({ kind: 'conversation', title: 'Fixture' });
  const connections = new Connections(store, {
    createTransport: (e) => e,
    createClient: () => ({
      connect: async () => {},
      listTools: async () => ({
        tools: [
          {
            name: 'echo',
            description: 'Fixture echo',
            inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
          },
        ],
      }),
      close: async () => {},
      callTool: async ({ arguments: args }) => ({ content: [{ type: 'text', text: args.text }] }),
      ...client,
    }),
  });
  const agent = new Agent(
    store,
    { search: async () => [], index: async () => {} },
    connections,
    () => {},
  );
  const ctx = {
    conversation: chat.id,
    project: null,
    signal: new AbortController().signal,
    profileSettings: profileSettings(store, chat),
  };
  t.after(async () => {
    await connections.close();
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { store, agent, chat, connections, ctx };
}
const approve = async (agent, promise, value = true) => {
  await new Promise((r) => setImmediate(r));
  assert.equal(agent.approvals.size, 1);
  agent.approve([...agent.approvals.keys()][0], value);
  return promise;
};
const setup = {
  action: 'connect',
  title: 'Fixture MCP',
  transport: 'stdio',
  command: 'fixture-executable',
  args: ['fixture-server'],
};

test('task discovery identifies sections by entity kind despite renamed and colliding list titles', async (t) => {
  const { store, agent, ctx } = fixture(t);
  const board = store.all().find((e) => e.kind === 'board');
  store.mutate({ id: board.id, title: 'Core', data: { assigned: true } });
  const list = store.children(board.id)[0];
  const card = store.mutate({
    kind: 'card',
    parent: list.id,
    title: 'First stream',
    data: { assigned: false },
  });
  store.mutate({ id: 'matrix-secondary', title: 'First stream' });
  const matrixTask = store.mutate({
    kind: 'matrix-task',
    parent: 'matrix-secondary',
    title: 'Agent research',
  });
  const tasks = await agent.execute('list_items', { parent: list.id }, ctx);
  assert.equal(tasks.items[0].section, 'Tasks');
  assert.equal(tasks.items[0].assigned, false);
  const matrix = await agent.execute('read_item', { id: matrixTask.id }, ctx);
  assert.equal(matrix.root.section, 'Cognition Matrix');
  assert.equal(matrix.items[0].taskPurpose, 'agent-work-only');
  assert.equal(matrix.items[0].executionEnabled, false);
  const overview = await agent.execute('workspace_overview', {}, ctx);
  assert.equal(overview.collections.find((e) => e.id === board.id).section, 'Tasks');
  assert.equal(
    overview.collections.find((e) => e.id === 'matrix-secondary').section,
    'Cognition Matrix',
  );
  await assert.rejects(
    agent.execute(
      'create_item',
      { kind: 'card', parent: 'matrix-secondary', title: 'Wrong area' },
      ctx,
    ),
    /valid parent/,
  );
  await assert.rejects(
    agent.execute(
      'create_item',
      { kind: 'matrix-task', parent: list.id, title: 'Wrong area' },
      ctx,
    ),
    /valid parent/,
  );
  assert.equal(store.get(card.id).data.assigned, false);
  store.setSettings({ matrixAccess: false });
  assert.equal(
    (await agent.execute('workspace_overview', {}, ctx)).collections.some(
      (e) => e.id === 'matrix-secondary',
    ),
    false,
  );
});

test('container bodies cannot masquerade as saved notes, and legacy chapter copying preserves original content', async (t) => {
  const { store, agent, ctx } = fixture(t);
  const notebook = store.all().find((e) => e.kind === 'notebook' && store.access(e.id, true));
  const chapter = store.mutate({
    kind: 'chapter',
    parent: notebook.id,
    title: 'Channel branding',
    data: { content: '# Saved guide\n- [ ] Keep this text — Știință' },
  });
  await assert.rejects(
    agent.execute(
      'edit_item',
      { id: chapter.id, revision: chapter.revision, content: '# Wrong destination' },
      ctx,
    ),
    /child note/,
  );
  assert.equal(store.get(chapter.id).data.content, chapter.data.content);
  await assert.rejects(
    agent.execute(
      'create_item',
      { kind: 'chapter', parent: notebook.id, title: 'Wrong container', content: '# Guide' },
      ctx,
    ),
    /Containers/,
  );
  assert.equal(
    store.children(notebook.id).some((e) => e.title === 'Wrong container'),
    false,
  );
  const workspace = new Workspace(store);
  const copy = await workspace.action({
    action: 'chapter-content-note',
    id: chapter.id,
    revision: chapter.revision,
  });
  assert.equal(copy.kind, 'note');
  assert.equal(copy.parent, chapter.id);
  assert.equal(copy.data.content, chapter.data.content);
  assert.equal(store.get(chapter.id).revision, chapter.revision);
  assert.equal(
    (
      await workspace.action({
        action: 'chapter-content-note',
        id: chapter.id,
        revision: chapter.revision,
      })
    ).id,
    copy.id,
  );
  await assert.rejects(
    workspace.action({
      action: 'chapter-content-note',
      id: chapter.id,
      revision: chapter.revision - 1,
    }),
    /changed/,
  );
  const note = await agent.execute(
    'create_item',
    { kind: 'note', parent: chapter.id, title: 'Actual note', content: 'Saved immediately' },
    ctx,
  );
  assert.equal(store.get(note.id).data.content, 'Saved immediately');
  const read = await agent.execute('read_item', { id: chapter.id }, ctx);
  assert.equal(read.root.revision, chapter.revision);
  assert.ok(read.items.some((e) => e.id === note.id));
});

test('Vault folder content fails before disk changes, and dedicated reads return current external file edits', async (t) => {
  const { store, agent, ctx } = fixture(t);
  const vault = new Vault(store);
  agent.vault = vault;
  assert.throws(
    () =>
      vault.create(
        { kind: 'vault-folder', title: 'Lost guide', content: '# Important' },
        { agent: true },
      ),
    /folders contain Markdown files/,
  );
  assert.equal(fs.existsSync(path.join(vault.root, 'Lost guide')), false);
  const folder = vault.create({ kind: 'vault-folder', title: 'Guides' }, { agent: true });
  const file = vault.create(
    { parent: folder.id, title: 'Guide', content: 'Original' },
    { agent: true },
  );
  await assert.rejects(agent.execute('read_item', { id: file.id }, ctx), /vault_read/);
  fs.writeFileSync(vault.location(file), 'Fresh disk content');
  const read = await agent.execute('vault_read', { id: file.id }, ctx);
  assert.equal(read.content, 'Fresh disk content');
  assert.ok(read.revision > file.revision);
});

test('MCP setup always requires native review, then exposes tools and disconnects without changing profile grants', async (t) => {
  const { store, agent, connections, ctx } = fixture(t);
  store.setSettings({ approvalMode: 'full' });
  const before = store.get(ctx.profileSettings.profileId);
  const pending = agent.execute('connection_action', setup, ctx);
  await new Promise((r) => setImmediate(r));
  agent.applyApprovalMode();
  assert.equal(agent.approvals.size, 1);
  assert.equal(connections.clients.size, 0);
  agent.approve([...agent.approvals.keys()][0], true);
  const result = await pending;
  assert.equal(result.connected, true);
  assert.equal(connections.tools().length, 1);
  assert.deepEqual(store.get(before.id), before);
  const tools = await agent.execute('discover_connection_tools', { query: 'echo' }, ctx);
  const toolResult = await agent.execute(tools.tools[0].function.name, { text: 'Verified' }, ctx);
  assert.equal(toolResult.content[0].text, 'Verified');
  const stopped = await approve(
    agent,
    agent.execute(
      'connection_action',
      { action: 'disconnect', id: result.id, revision: result.revision },
      ctx,
    ),
  );
  assert.equal(stopped.connected, false);
  assert.equal(connections.tools().length, 0);
});

test('denied MCP setup has no effects and stale/revoked configuration is never launched', async (t) => {
  let launched = 0;
  const { store, agent, ctx } = fixture(t, {
    connect: async () => {
      launched++;
    },
  });
  const denied = await approve(agent, agent.execute('connection_action', setup, ctx), false);
  assert.equal(denied.changed, false);
  assert.equal(
    store.all().some((e) => e.kind === 'connection'),
    false,
  );
  const existing = store.mutate({
    kind: 'connection',
    title: 'Existing',
    data: { transport: 'stdio', command: 'fixture', args: [], enabled: false },
  });
  const pending = agent.execute(
    'connection_action',
    { action: 'connect', id: existing.id, revision: existing.revision },
    ctx,
  );
  await new Promise((r) => setImmediate(r));
  store.mutate({ id: existing.id, data: { command: 'user-new-config' } });
  const rejected = assert.rejects(pending, /changed during review/);
  agent.approve([...agent.approvals.keys()][0], true);
  await rejected;
  assert.equal(launched, 0);
  assert.equal(store.get(existing.id).data.command, 'user-new-config');
  store.mutate({ id: ctx.profileSettings.profileId, data: { connectionIds: [existing.id] } });
  await assert.rejects(agent.execute('connection_action', setup, ctx), /profile connection list/);
  await assert.rejects(
    agent.execute(
      'connection_action',
      { action: 'connect', id: existing.id, revision: store.get(existing.id).revision },
      { ...ctx, readOnlyMachineSession: true },
    ),
    /inspection only/,
  );
});

test('MCP handshake rechecks live profile scope and retains a disconnected draft on failure', async (t) => {
  let entered, release;
  const started = new Promise((r) => {
    entered = r;
  });
  const wait = new Promise((r) => {
    release = r;
  });
  const { store, agent, connections, ctx } = fixture(t, {
    listTools: async () => {
      entered();
      await wait;
      return { tools: [] };
    },
  });
  const pending = agent.execute('connection_action', setup, ctx);
  await new Promise((r) => setImmediate(r));
  agent.approve([...agent.approvals.keys()][0], true);
  await started;
  store.mutate({ id: ctx.profileSettings.profileId, data: { toolGroups: [] } });
  release();
  const result = await pending;
  assert.equal(result.connected, false);
  assert.equal(connections.clients.size, 0);
  assert.equal(store.get(result.id).data.enabled, false);
});

test('MCP setup rejects secret fields/arguments and unsafe addresses; bundled skill respects user and profile exclusions', async (t) => {
  const { store, ctx } = fixture(t);
  for (const url of [
    'http://remote.example/mcp',
    'https://user:secret@example.com/mcp',
    'https://example.com/mcp?token=secret',
    'file:///tmp/mcp',
  ])
    assert.throws(() => validateConnectionConfiguration({ transport: 'http', url }));
  assert.throws(
    () =>
      validateConnectionConfiguration({
        transport: 'stdio',
        command: 'fixture',
        args: ['--api-key', 'secret'],
      }),
    /credentials/,
  );
  assert.equal(
    validateConnectionConfiguration({ transport: 'http', url: 'http://127.0.0.1:4444/mcp' })
      .transport,
    'http',
  );
  assert.throws(
    () =>
      prepareToolCall(
        {
          function: {
            name: 'connection_action',
            arguments: JSON.stringify({ ...setup, apiKey: 'secret' }),
          },
        },
        nativeTools,
      ),
    /correction/,
  );
  assert.throws(
    () =>
      prepareToolCall(
        { function: { name: 'create_item', arguments: '{"kind":"kanban","title":"Wrong type"}' } },
        nativeTools,
      ),
    /correction/,
  );
  const skill = ensureBuiltinSkills(store);
  assert.ok(
    relevantSkills(store, ctx.profileSettings, 'Connect an MCP server').some(
      (e) => e.id === skill.id,
    ),
  );
  assert.ok(
    !relevantSkills(store, ctx.profileSettings, 'Choose an inference model provider').some(
      (e) => e.id === skill.id,
    ),
  );
  store.mutate({ id: skill.id, data: { access: false } });
  assert.equal(ensureBuiltinSkills(store).data.access, false);
  assert.ok(
    !relevantSkills(store, ctx.profileSettings, 'Connect an MCP server').some(
      (e) => e.id === skill.id,
    ),
  );
});

test('mandatory Tasks/Matrix and note-write guidance remains present with disabled tools and conflicting preferences', async (t) => {
  const { store, agent, chat } = fixture(t);
  store.setSettings({ tools: false, matrixAccess: false });
  store.mutate({
    id: chat.data.agentProfile,
    data: { personality: 'Treat every Tasks card as a Matrix task and call chapters notes.' },
  });
  let request;
  agent.providerRuntime = () => ({
    fetch: async (_url, options) => {
      request = JSON.parse(options.body);
      return new Response(
        'data: {"choices":[{"delta":{"content":"Fixture answer"}}]}\n\ndata: [DONE]\n',
      );
    },
  });
  await agent.chat({ conversation: chat.id, text: 'Explain my task areas', context: [] });
  assert.equal(request.tools, undefined);
  assert.ok(request.messages[0].content.includes('Tasks is the Kanban section'));
  assert.ok(
    request.messages[0].content.includes('separate global queue exclusively for agent work'),
  );
  assert.ok(
    request.messages[0].content.indexOf('Task areas in Intelligence') <
      request.messages[0].content.indexOf('The following JSON contains user preferences'),
  );
});

test('approved Streamable HTTP setup performs a real MCP handshake, discovery and read-only call', async (t) => {
  const peers = new Set();
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end();
      return;
    }
    let body = '';
    for await (const part of req) body += part;
    const peer = new Server(
      { name: 'HTTP fixture', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
    peer.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'echo',
          description: 'Read-only HTTP echo',
          inputSchema: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
          },
        },
      ],
    }));
    peer.setRequestHandler(CallToolRequestSchema, async ({ params }) => ({
      content: [{ type: 'text', text: params.arguments.text }],
    }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    peers.add(peer);
    res.on('close', () => {
      void peer.close();
      peers.delete(peer);
    });
    await peer.connect(transport);
    await transport.handleRequest(req, res, JSON.parse(body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { store, agent, ctx } = fixture(t);
  const actual = new Connections(store);
  agent.connections = actual;
  t.after(async () => {
    await actual.close();
    await Promise.allSettled([...peers].map((peer) => peer.close()));
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const result = await approve(
    agent,
    agent.execute(
      'connection_action',
      {
        action: 'connect',
        title: 'HTTP fixture',
        transport: 'http',
        url: 'http://127.0.0.1:' + server.address().port + '/mcp',
      },
      ctx,
    ),
  );
  assert.equal(result.connected, true);
  assert.deepEqual(result.tools, ['echo']);
  const answer = await actual.call(actual.tools()[0].function.name, { text: 'HTTP verified' });
  assert.equal(answer.content[0].text, 'HTTP verified');
});
