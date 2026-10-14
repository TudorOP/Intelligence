import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../electron/store.mjs';
import { completion, listModels } from '../electron/provider.mjs';
import { InferenceCredentials, inferenceProviders } from '../electron/inference-providers.mjs';
const response = () =>
  new Response(
    'data: ' +
      JSON.stringify({ choices: [{ delta: { content: 'Answer' } }] }) +
      '\n\ndata: [DONE]\n\n',
  );
test('all cloud providers send authenticated bounded multimodal requests with supported wire fields', async () => {
  for (const provider of inferenceProviders.filter((p) => p.cloud)) {
    let request;
    const settings = {
      provider: provider.id,
      endpoint: provider.endpoint,
      model: 'fixture',
      apiMaxTokens: 4096,
    };
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,Zg==' } },
        ],
      },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'long_call_identity',
            type: 'function',
            function: { name: 'read_item', arguments: '{}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'long_call_identity', tool_name: 'read_item', content: '{}' },
    ];
    const output = await completion(
      settings,
      messages,
      [],
      () => {},
      new AbortController().signal,
      {
        key: 'test-secret',
        fetch: async (url, options) => {
          request = { url, options, body: JSON.parse(options.body) };
          return response();
        },
      },
    );
    assert.equal(output.content, 'Answer');
    assert.equal(request.options.headers.Authorization, 'Bearer test-secret');
    assert.equal(request.options.redirect, 'error');
    assert.ok(!JSON.stringify(request.body).includes('test-secret'));
    assert.equal(request.body.messages[2].tool_name, undefined);
    assert.equal(request.body.temperature, undefined);
    if (provider.id === 'openai') assert.equal(request.body.max_completion_tokens, 4096);
    else assert.equal(request.body.max_tokens, 4096);
    if (provider.id === 'mistral')
      assert.match(request.body.messages[1].tool_calls[0].id, /^[a-z0-9]{9}$/);
  }
});
test('cloud errors never include provider response bodies or keys, and disabled vision rejects before sending', async () => {
  const settings = { provider: 'openai', endpoint: 'https://api.openai.com/v1', model: 'fixture' };
  await assert.rejects(
    completion(settings, [], [], () => {}, new AbortController().signal, {
      key: 'secret',
      fetch: async () => new Response('secret echoed', { status: 401 }),
    }),
    (e) => e.message.includes('401') && !e.message.includes('secret'),
  );
  await assert.rejects(
    completion(
      { ...settings, visionEnabled: false },
      [{ role: 'user', content: [{ type: 'image_url' }] }],
      [],
      () => {},
      new AbortController().signal,
      { key: 'secret' },
    ),
    /Image input is disabled/,
  );
  await assert.rejects(listModels(settings), /Save an API key/);
  const models = await listModels(settings, {
    key: 'secret',
    fetch: async () => new Response(JSON.stringify({ data: [{ id: 'one' }, { id: 'two' }] })),
  });
  assert.deepEqual(models, ['one', 'two']);
});
test('provider profiles preserve local/cloud choices and credentials bind to provider plus full address', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-providers-')),
    store = new Store(directory);
  t.after(() => store.close());
  store.setSettings({ model: 'local-one' });
  store.setSettings({ provider: 'openai' });
  assert.equal(store.settings().endpoint, 'https://api.openai.com/v1');
  store.setSettings({ model: 'api-one' });
  store.setSettings({ provider: 'ollama' });
  assert.equal(store.settings().model, 'local-one');
  store.setSettings({ provider: 'openai' });
  assert.equal(store.settings().model, 'api-one');
  const secure = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('encrypted:' + s),
    decryptString: (b) => b.toString().slice(10),
  };
  const credentials = new InferenceCredentials(store, secure, 'win32'),
    original = store.settings();
  credentials.save(original, 'private-key');
  assert.equal(credentials.get(original), 'private-key');
  assert.equal(credentials.get({ ...original, endpoint: 'https://other.example/v1' }), '');
  assert.equal(credentials.get({ ...original, provider: 'mistral' }), '');
  assert.ok(!JSON.stringify(store.snapshot()).includes('private-key'));
  assert.equal(credentials.get(original), 'private-key');
  assert.throws(
    () => store.setSettings({ provider: 'mistral', endpoint: 'http://localhost' }),
    /HTTPS/,
  );
});
test('OpenRouter reasoning details persist through tool requests without leaking app-specific fields', async () => {
  const detail = { index: 0, type: 'reasoning.encrypted', data: 'opaque-blob', format: 'fixture' };
  const answer = await completion(
    { provider: 'openrouter', endpoint: 'https://openrouter.ai/api/v1', model: 'fixture' },
    [],
    [],
    () => {},
    new AbortController().signal,
    {
      key: 'key',
      fetch: async () =>
        new Response(
          'data: ' +
            JSON.stringify({
              choices: [
                {
                  delta: {
                    reasoning_details: [detail],
                    tool_calls: [
                      { index: 0, id: 'call', function: { name: 'read_item', arguments: '{}' } },
                    ],
                  },
                },
              ],
            }) +
            '\n\ndata: [DONE]\n',
        ),
    },
  );
  assert.deepEqual(answer.reasoning_details, [detail]);
  let wire;
  await completion(
    { provider: 'openrouter', endpoint: 'https://openrouter.ai/api/v1', model: 'fixture' },
    [answer, { role: 'tool', content: 'result', tool_name: 'read_item', tool_call_id: 'call' }],
    [],
    () => {},
    new AbortController().signal,
    {
      key: 'key',
      fetch: async (_url, options) => {
        wire = JSON.parse(options.body);
        return response();
      },
    },
  );
  assert.deepEqual(wire.messages[0].reasoning_details, [detail]);
  assert.equal(wire.messages[1].tool_name, undefined);
});
test('Ollama vision requests translate content parts to base64 images and keep the text context', async () => {
  let body;
  await completion(
    { provider: 'ollama', endpoint: 'http://localhost', model: 'fixture' },
    [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe locally' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=' } },
        ],
      },
    ],
    [],
    () => {},
    new AbortController().signal,
    {
      fetch: async (_url, options) => {
        body = JSON.parse(options.body);
        return new Response(
          JSON.stringify({ message: { content: 'Local image' }, done: true }) + '\n',
        );
      },
    },
  );
  assert.deepEqual(body.messages[0].images, ['aW1hZ2U=']);
  assert.equal(body.messages[0].content, 'Describe locally');
});
