import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { createCipheriv, createDecipheriv } from 'node:crypto';
import { Store } from '../electron/store.mjs';
import { WebSearch } from '../electron/web-search.mjs';
import { SearchCredentials } from '../electron/search-credentials.mjs';
import { Agent } from '../electron/agent.mjs';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-search-'));
  const store = new Store(directory);
  t.after(() => {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return store;
}
async function server(t, callback) {
  const value = createServer(callback);
  await new Promise((resolve) => value.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => value.close(resolve)));
  return 'http://127.0.0.1:' + value.address().port;
}

test('SearXNG encodes queries, supports base paths, caps results, and reports its actual time filter', async (t) => {
  const store = fixture(t);
  let request;
  const endpoint = await server(t, (req, res) => {
    request = new URL(req.url, 'http://fixture');
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        results: [
          {
            title: '<b>Primary</b>',
            url: 'https://example.org/source',
            content: 'Evidence &amp; context',
          },
          { title: 'Second', url: 'https://example.org/second', content: 'More' },
        ],
      }),
    );
  });
  store.setSettings({ searxngEndpoint: endpoint + '/private/base/' });
  const service = new WebSearch(store);
  const result = await service.search({ query: 'Linux & "context"', count: 1, freshness: 'week' });
  assert.equal(request.pathname, '/private/base/search');
  assert.equal(request.searchParams.get('q'), 'Linux & "context"');
  assert.equal(request.searchParams.get('format'), 'json');
  assert.equal(request.searchParams.get('time_range'), 'month');
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].snippet, 'Evidence & context');
  assert.equal(result.appliedFreshness, 'month');
  assert.equal(result.requestedFreshness, 'week');
});

test('Brave uses the fixed HTTPS API and header key, respects count/freshness, and redacts provider echoes', async (t) => {
  const store = fixture(t);
  store.setSettings({ searchProvider: 'brave' });
  const key = 'fixture-private-key';
  let request;
  const service = new WebSearch(store, {
    credentials: { get: () => key },
    fetch: async (url, options) => {
      request = { url, options };
      return new Response(
        JSON.stringify({
          web: {
            results: [
              {
                title: 'Source',
                url: 'https://example.org/',
                description: 'Context ' + key,
                extra_snippets: ['Additional evidence'],
              },
            ],
          },
        }),
      );
    },
  });
  const result = await service.search({ query: 'Linux desktops', count: 3, freshness: 'day' });
  assert.equal(request.url.origin, 'https://api.search.brave.com');
  assert.equal(request.url.pathname, '/res/v1/web/search');
  assert.equal(request.options.headers['X-Subscription-Token'], key);
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.url.searchParams.get('count'), '3');
  assert.equal(request.url.searchParams.get('freshness'), 'pd');
  assert.ok(!JSON.stringify(result).includes(key));
  assert.ok(result.results[0].snippet.includes('[redacted]'));
  await assert.rejects(() => service.search({ query: key }), /without the key/);
  await assert.rejects(() => service.search({ query: 'x'.repeat(601) }), /600 characters/);
});

test('disabled search, missing configuration, malformed responses and limits fail without fallback or secret leakage', async (t) => {
  const store = fixture(t);
  let calls = 0;
  const service = new WebSearch(store, {
    fetch: async () => {
      calls++;
      return new Response('{}');
    },
  });
  await assert.rejects(() => service.search({ query: 'Topic' }), /SearXNG address/);
  assert.equal(calls, 0);
  store.setSettings({ searchProvider: 'brave' });
  await assert.rejects(() => service.search({ query: 'Topic' }), /API key/);
  assert.equal(calls, 0);
  store.setSettings({ searchEnabled: false });
  await assert.rejects(() => service.search({ query: 'Topic' }), /disabled/);
  store.setSettings({ searchEnabled: true });
  const key = 'fixture-error-secret';
  const errorService = new WebSearch(store, {
    credentials: { get: () => key },
    fetch: async () => new Response(key, { status: 401 }),
  });
  await assert.rejects(
    () => errorService.search({ query: 'Topic' }),
    (error) => error.message.includes('401') && !error.message.includes(key),
  );
  const malformed = new WebSearch(store, {
    credentials: { get: () => key },
    fetch: async () => new Response('Malformed'),
  });
  await assert.rejects(() => malformed.search({ query: 'Topic' }));
  const large = new WebSearch(store, {
    credentials: { get: () => key },
    fetch: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)),
  });
  await assert.rejects(() => large.search({ query: 'Topic' }), /2 MB/);
  await assert.rejects(() => service.search({ query: 'Topic', count: 21 }), /1 to 20/);
  assert.throws(() => store.setSettings({ searchProvider: 'unknown' }), /supported/);
  assert.throws(() => store.setSettings({ searchTimeoutSeconds: 0 }), /integer/);
});

test('keys persist as encrypted blobs, stay out of settings/status, and are cached after decryption', (t) => {
  const store = fixture(t),
    key = 'fixture-persistent-secret';
  let decrypts = 0;
  const mock = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (value) => {
      const cipher = createCipheriv('aes-256-cbc', Buffer.alloc(32, 1), Buffer.alloc(16));
      return Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    },
    decryptString: (value) => {
      decrypts++;
      const cipher = createDecipheriv('aes-256-cbc', Buffer.alloc(32, 1), Buffer.alloc(16));
      return Buffer.concat([cipher.update(value), cipher.final()]).toString();
    },
  };
  const vault = new SearchCredentials(store, mock, 'linux');
  assert.equal(vault.save(key).storage, 'keyring');
  const row = store.db
    .prepare('SELECT value FROM search_credentials WHERE provider=?')
    .get('brave');
  assert.ok(!Buffer.from(row.value).toString().includes(key));
  assert.ok(!JSON.stringify(store.settings()).includes(key));
  const restarted = new SearchCredentials(store, mock, 'linux');
  assert.equal(restarted.get(), key);
  assert.equal(restarted.get(), key);
  assert.equal(decrypts, 1);
  assert.ok(
    !JSON.stringify(new WebSearch(store, { credentials: restarted }).status()).includes(key),
  );
  restarted.forget();
  assert.equal(restarted.get(), '');
  assert.equal(store.db.prepare('SELECT count(*) AS count FROM search_credentials').get().count, 0);
});

test('Linux basic_text fallback keeps keys in memory for the session', (t) => {
  const store = fixture(t);
  const mock = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'basic_text',
    encryptString: () => {
      throw new Error('Plaintext fallback must not be used');
    },
  };
  const vault = new SearchCredentials(store, mock, 'linux');
  const info = vault.save('session-fixture-key');
  assert.equal(info.storage, 'session');
  assert.equal(info.persistentAvailable, false);
  assert.equal(vault.get(), 'session-fixture-key');
  assert.equal(store.db.prepare('SELECT count(*) AS count FROM search_credentials').get().count, 0);
  assert.equal(new SearchCredentials(store, mock, 'linux').get(), '');
});

test('ordinary notebook/project chat discovers and executes global search with Matrix access disabled', async (t) => {
  const store = fixture(t),
    conversation = store.mutate({
      kind: 'conversation',
      title: 'Notebook research',
      project: 'project-fixture',
      data: {},
    });
  const searchEndpoint = await server(t, (req, res) =>
    res.end(
      JSON.stringify({
        results: [
          { title: 'Primary source', url: 'https://example.org/', content: 'Fixture evidence' },
        ],
      }),
    ),
  );
  const requests = [];
  const modelEndpoint = await server(t, async (req, res) => {
    let text = '';
    for await (const part of req) text += part;
    const body = JSON.parse(text);
    requests.push(body);
    const delta =
      requests.length === 1
        ? {
            tool_calls: [
              {
                index: 0,
                id: 'search_call',
                type: 'function',
                function: {
                  name: 'search_web',
                  arguments: '{"query":"current Linux information"}',
                },
              },
            ],
          }
        : { content: 'The source reports fixture evidence. https://example.org/' };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('data: ' + JSON.stringify({ choices: [{ delta }] }) + '\n\ndata: [DONE]\n\n');
  });
  store.setSettings({
    provider: 'lmstudio',
    endpoint: modelEndpoint,
    model: 'fixture',
    searxngEndpoint: searchEndpoint,
    matrixAccess: false,
  });
  const agent = new Agent(
    store,
    { search: async () => [], index: async () => {} },
    { tools: () => [] },
    () => {},
  );
  const note = store.all().find((e) => e.kind === 'note');
  await agent.chat({
    conversation: conversation.id,
    text: 'Research this topic for my notebook.',
    context: [note.id],
  });
  assert.ok(requests[0].tools.some((tool) => tool.function.name === 'search_web'));
  assert.equal(
    new Set(requests[0].tools.map((tool) => tool.function.name)).size,
    requests[0].tools.length,
  );
  assert.ok(requests[0].messages[0].content.includes('Web search is a global capability'));
  assert.ok(
    requests[1].messages.some((m) => m.role === 'tool' && m.content.includes('Fixture evidence')),
  );
  store.setSettings({ searchEnabled: false });
  await assert.rejects(
    () =>
      agent.execute(
        'search_web',
        { query: 'Topic' },
        { signal: new AbortController().signal, readOnlyMachineSession: true },
      ),
    /disabled/,
  );
});

test('a model cannot invoke search after agent tools are disabled, even if it emits a tool call', async (t) => {
  const store = fixture(t),
    conversation = store.mutate({ kind: 'conversation', title: 'Tools disabled', data: {} });
  let searches = 0,
    requests = 0;
  const searchEndpoint = await server(t, (_req, res) => {
    searches++;
    res.end('{}');
  });
  const modelEndpoint = await server(t, async (req, res) => {
    let text = '';
    for await (const part of req) text += part;
    const body = JSON.parse(text);
    requests++;
    assert.ok(!body.tools?.length);
    assert.ok(body.messages[0].content.includes('Web search is disabled for this run'));
    if (requests === 2)
      assert.ok(
        body.messages.some(
          (m) => m.role === 'tool' && m.content.includes('Agent tools are disabled'),
        ),
      );
    const delta =
      requests === 1
        ? {
            tool_calls: [
              {
                index: 0,
                id: 'unexpected',
                type: 'function',
                function: { name: 'search_web', arguments: '{"query":"topic"}' },
              },
            ],
          }
        : { content: 'Enable the tools to search.' };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('data: ' + JSON.stringify({ choices: [{ delta }] }) + '\n\ndata: [DONE]\n\n');
  });
  store.setSettings({
    provider: 'lmstudio',
    endpoint: modelEndpoint,
    model: 'fixture',
    tools: false,
    searxngEndpoint: searchEndpoint,
  });
  const agent = new Agent(
    store,
    { search: async () => [], index: async () => {} },
    { tools: () => [] },
    () => {},
  );
  await agent.chat({ conversation: conversation.id, text: 'Research the topic' });
  assert.equal(requests, 2);
  assert.equal(searches, 0);
});
