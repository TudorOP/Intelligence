import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { gzipSync } from 'node:zlib';
import { Store } from '../electron/store.mjs';
import { listModels, completion } from '../electron/provider.mjs';
import { Workspace } from '../electron/workspace.mjs';
import { validateInferenceAddress } from '../electron/inference-providers.mjs';
import { WebSearch } from '../electron/web-search.mjs';
import { readUserProfile } from '../electron/user-profile.mjs';
import { modelHistory } from '../electron/chat-history.mjs';
import { deleteTrashBatch } from '../electron/trash-bulk.mjs';
import { OptionalModules, moduleCatalog } from '../electron/optional-modules.mjs';
import { digestBytes, downloadArtifact, unpackVerifiedTar } from '../electron/module-artifacts.mjs';
import { exportBackup, inspectBackup, restoreBackup } from '../electron/backup.mjs';
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'intelligence-26-'));
  const store = new Store(path.join(directory, 'data'));
  new Workspace(store);
  store.setSettings({ semanticSearch: false, autoConsolidation: false });
  t.after(async () => {
    store.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { store, directory };
}
function tar(files) {
  const entries = [];
  for (const [name, bytes] of Object.entries(files)) {
    const data = Buffer.from(bytes),
      h = Buffer.alloc(512);
    h.write(name);
    h.write('0000644\0', 100);
    h.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
    h.write('0', 156);
    entries.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
}
test('compatible APIs allow keyless loopback streaming but preserve transport restrictions', async () => {
  const settings = {
    provider: 'compatible',
    endpoint: 'http://127.0.0.1:8080/v1',
    model: 'custom',
    apiMaxTokens: 128,
  };
  let payload;
  const fetch = async (url, options = {}) => {
    assert.equal(options.headers.Authorization, undefined);
    if (url.endsWith('/models')) return Response.json({ data: [{ id: 'custom' }] });
    payload = JSON.parse(options.body);
    return new Response(
      'data: ' +
        JSON.stringify({
          choices: [{ delta: { content: 'Hello', reasoning_content: 'Returned reasoning' } }],
        }) +
        '\n\ndata: [DONE]\n\n',
    );
  };
  assert.deepEqual(await listModels(settings, { fetch }), ['custom']);
  const output = await completion(
    settings,
    [{ role: 'user', content: 'Hi' }],
    [],
    () => {},
    new AbortController().signal,
    { fetch },
  );
  assert.equal(output.content, 'Hello');
  assert.equal(payload.stream_options, undefined);
  assert.throws(
    () => validateInferenceAddress({ ...settings, endpoint: 'http://public.example/v1' }),
    /HTTPS/,
  );
  assert.throws(
    () => validateInferenceAddress({ ...settings, endpoint: 'https://user:secret@example.com/v1' }),
    /HTTPS/,
  );
});
test('search engine choices require configured engines and never substitute unrelated results', async (t) => {
  const { store } = await fixture(t);
  store.setSettings({ searchProvider: 'ecosia', searxngEndpoint: 'https://search.example/base' });
  const calls = [];
  const search = new WebSearch(store, {
    fetch: async (url) => {
      calls.push(String(url));
      return String(url).endsWith('/config')
        ? Response.json({ engines: [{ name: 'ecosia', disabled: false }] })
        : Response.json({
            results: [{ title: 'Source', url: 'https://source.example/', engines: ['ecosia'] }],
          });
    },
  });
  assert.equal((await search.search({ query: 'plants' })).results.length, 1);
  assert.ok(calls[1].includes('engines=ecosia'));
  search.fetch = async () => Response.json({ engines: [] });
  await assert.rejects(search.search({ query: 'plants' }), /Enable the selected engine/);
});
test('profile data is available on demand and does not replay bulky profile payloads', async (t) => {
  const { store } = await fixture(t);
  assert.throws(() => readUserProfile(store), /disabled/);
  store.setSettings({ shareProfile: true, profileDescription: 'A private profile description' });
  assert.equal(readUserProfile(store).description, 'A private profile description');
  const conversation = store.mutate({
    kind: 'conversation',
    title: 'Profile',
    data: { access: true },
  });
  store.message(conversation.id, 'user', 'About me');
  store.message(conversation.id, 'assistant', 'tool', {
    tool: true,
    name: 'read_user_profile',
    modelMessage: {
      role: 'tool',
      tool_call_id: 'profile',
      content: JSON.stringify(readUserProfile(store)),
    },
  });
  assert.ok(
    !JSON.stringify(modelHistory(store, conversation.id)).includes('A private profile description'),
  );
  store.setSettings({ shareProfile: false });
  assert.throws(() => readUserProfile(store), /disabled/);
  assert.throws(
    () => store.setSettings({ profilePhoto: 'https://remote.example/photo.png' }),
    /imported/,
  );
});
test('bulk Trash deletion deduplicates ancestry and reports partial failures without touching live work', async (t) => {
  const { store } = await fixture(t);
  const board = store.mutate({ kind: 'board', title: 'Trash board', data: {} }),
    list = store.mutate({ kind: 'list', parent: board.id, title: 'List', data: {} }),
    card = store.mutate({ kind: 'card', parent: list.id, title: 'Card', data: {} });
  store.mutate({ id: board.id, action: 'trash' });
  const other = store.mutate({ kind: 'skill', title: 'Other', data: {} });
  store.mutate({ id: other.id, action: 'trash' });
  const calls = [];
  const result = await deleteTrashBatch(store, [board.id, card.id, other.id], (id) => {
    calls.push(id);
    if (id === other.id) throw Error('Fixture failure');
    return store.deleteTrash(id);
  });
  assert.deepEqual(calls, [board.id, other.id]);
  assert.ok(result.deleted.includes(card.id));
  assert.equal(result.failed.length, 1);
  assert.ok(store.get(other.id, true));
  await assert.rejects(
    deleteTrashBatch(store, ['missing'], () => assert.fail()),
    /Trash changed/,
  );
});
test('artifact download and extraction reject corrupt bytes and archive path escapes', async (t) => {
  const { directory } = await fixture(t),
    bytes = Buffer.from('verified'),
    artifact = {
      url: 'https://vendor.example/file',
      sha256: digestBytes(bytes),
      bytes: bytes.length,
    };
  let calls = 0;
  const fetch = async () => {
    calls++;
    return new Response(bytes);
  };
  const target = path.join(directory, 'download');
  await downloadArtifact(artifact, target, undefined, () => {}, fetch);
  await downloadArtifact(
    artifact,
    target,
    undefined,
    () => {},
    () => assert.fail('Cached verified bytes should not fetch'),
  );
  assert.equal(calls, 1);
  await assert.rejects(
    downloadArtifact(
      { ...artifact, sha256: '0'.repeat(64) },
      path.join(directory, 'bad'),
      undefined,
      () => {},
      fetch,
    ),
    /verification/,
  );
  const packed = tar({ '../escaped': 'unsafe' }),
    file = path.join(directory, 'unsafe.tar.gz');
  await fs.writeFile(file, packed);
  await assert.rejects(
    unpackVerifiedTar({ sha256: digestBytes(packed) }, file, path.join(directory, 'unpack')),
    /Unsafe module path/,
  );
});
test('complete backups include module artifacts and models, exclude the trust key, and stage offline reconnection', async (t) => {
  const { store, directory } = await fixture(t);
  await fs.mkdir(path.join(store.directory, 'modules', 'downloads'), { recursive: true });
  await fs.mkdir(path.join(store.directory, 'models', 'optional'), { recursive: true });
  await fs.writeFile(path.join(store.directory, 'modules', 'downloads', 'engine.whl'), 'engine');
  await fs.writeFile(path.join(store.directory, 'models', 'optional', 'weights.onnx'), 'weights');
  await fs.writeFile(path.join(store.directory, '.module-trust'), 'private key');
  store.setSettings({ optionalModules: { tts: { enabled: true, adapter: 'local' } } });
  const exported = await exportBackup(store, directory, {
    includeModules: true,
    includeModelCaches: true,
  });
  assert.equal(exported.version, 2);
  assert.ok(exported.files.some((f) => f.path.includes('engine.whl')));
  assert.ok(!exported.files.some((f) => f.path.includes('.module-trust')));
  const preview = await inspectBackup(exported.directory);
  assert.equal(preview.includeModules, true);
  assert.equal(preview.offlineModules[0].status, 'incomplete');
  assert.ok(preview.offlineModules[0].missing.includes('uv.tar.gz'));
  const restored = await restoreBackup(store, exported.directory);
  assert.equal(restored.modulesToReconnect.tts.enabled, true);
  assert.equal(store.settings().optionalModules.tts.enabled, false);
  assert.equal(
    await fs.readFile(path.join(store.directory, 'models', 'optional', 'weights.onnx'), 'utf8'),
    'weights',
  );
});
test('offline restore reconstructs an enabled module from trusted cached artifacts with zero fetching', async (t) => {
  const { store } = await fixture(t);
  let network = 0,
    executions = 0;
  const uv = tar({ 'uv-x86_64-unknown-linux-gnu/uv': 'fixture uv' }),
    python = tar({ 'python/bin/python3.12': 'fixture python' }),
    wheel = Buffer.from('fixture wheel'),
    model = Buffer.from('fixture model');
  const definition = {
    ...moduleCatalog.modules.find((m) => m.id === 'tts'),
    wheels: [
      {
        name: 'fixture.whl',
        package: 'fixture',
        url: 'https://vendor.example/fixture.whl',
        sha256: digestBytes(wheel),
        bytes: wheel.length,
      },
    ],
    model: { files: [{ name: 'voice.onnx', sha256: digestBytes(model), bytes: model.length }] },
  };
  const catalog = {
    ...moduleCatalog,
    runtime: {
      ...moduleCatalog.runtime,
      uv: { url: 'https://vendor.example/uv.tar.gz', sha256: digestBytes(uv), bytes: uv.length },
      python: {
        url: 'https://vendor.example/python.tar.gz',
        sha256: digestBytes(python),
        bytes: python.length,
      },
    },
    modules: [definition, ...moduleCatalog.modules.filter((m) => m.id !== 'tts')],
  };
  const manager = new OptionalModules(store, () => {}, {
    platform: 'linux',
    arch: 'x64',
    catalog,
    fetch: () => {
      network++;
      throw Error('Offline');
    },
  });
  const downloads = path.join(manager.root, 'downloads');
  await fs.mkdir(path.join(downloads, 'wheels', 'tts'), { recursive: true });
  await fs.mkdir(path.join(manager.models, 'tts'), { recursive: true });
  await fs.writeFile(path.join(downloads, 'uv.tar.gz'), uv);
  await fs.writeFile(path.join(downloads, 'python.tar.gz'), python);
  await fs.writeFile(path.join(downloads, 'wheels', 'tts', 'fixture.whl'), wheel);
  await fs.writeFile(path.join(manager.models, 'tts', 'voice.onnx'), model);
  manager.command = async (_exe, args) => {
    executions++;
    if (args.includes('venv')) {
      const root = args.at(-1);
      await fs.mkdir(path.join(root, 'bin'), { recursive: true });
      await fs.writeFile(path.join(root, 'bin', 'python'), 'fixture executable');
    }
    if (args.includes('install')) {
      assert.ok(args.includes('--offline'));
      assert.ok(args.includes('--no-index'));
      assert.ok(args.includes('--require-hashes'));
    }
    return true;
  };
  store.setSettings({ optionalModules: { tts: { enabled: false, adapter: 'local' } } });
  const result = await manager.reconnectBackup(
    { tts: { enabled: true, adapter: 'local' } },
    { includeModules: true, includeModelCaches: true },
  );
  assert.deepEqual(result.offlineReady, ['tts']);
  assert.deepEqual(result.attention, []);
  assert.equal(network, 0);
  assert.equal(executions, 3);
  assert.equal(store.settings().optionalModules.tts.enabled, true);
  const injected = path.join(manager.root, 'runtime', 'python', 'sitecustomize.py');
  await fs.writeFile(injected, 'unexpected executable code');
  await assert.rejects(
    manager.ensureRuntime(undefined, 'tts', { offline: true }),
    /unexpected files/,
  );
  await fs.unlink(injected);
  const manifest = manager.manifest('tts');
  assert.ok(manifest.signature);
  await manager.verifyInstalled('tts');
  await fs.writeFile(path.join(manager.directory('tts'), 'venv', 'bin', 'python'), 'tampered');
  await assert.rejects(manager.verifyInstalled('tts'), /Module files changed/);
});
test('module startup stays passive and incompatible offline restore never executes engines', async (t) => {
  const { store } = await fixture(t);
  let network = 0;
  const manager = new OptionalModules(store, () => {}, {
    platform: 'win32',
    fetch: () => {
      network++;
      assert.fail();
    },
  });
  manager.command = () => assert.fail('Must not run incompatible engines');
  assert.equal(manager.state().supported, false);
  assert.equal(network, 0);
  const result = await manager.reconnectBackup(
    { tts: { enabled: true, adapter: 'local' } },
    { includeModules: true, includeModelCaches: true },
  );
  assert.equal(result.offlineReady.length, 0);
  assert.match(result.attention[0].error, /Linux x64/);
  assert.equal(network, 0);
  const script = await manager.harnessFile('module-worker.py');
  assert.ok(script.startsWith(manager.root + path.sep));
  assert.equal(
    await fs.readFile(script, 'utf8'),
    await fs.readFile(new URL('../electron/module-worker.py', import.meta.url), 'utf8'),
  );
});

test('compatible speech streams bounded PCM, transcribes WAV, and cancels on access revocation', async (t) => {
  const { store } = await fixture(t),
    events = [];
  const manager = new OptionalModules(store, (event) => events.push(event), {
    fetch: async (_url, input) => {
      if (input.body instanceof FormData) {
        assert.equal(input.body.get('file').type, 'audio/wav');
        assert.equal(input.body.get('model'), 'small-local');
        return Response.json({ text: 'A useful transcript' });
      }
      assert.equal(JSON.parse(input.body).response_format, 'pcm');
      return new Response(new Uint8Array([1, 0, 2, 0]), {
        headers: { 'content-type': 'audio/pcm' },
      });
    },
  });
  manager.config('tts', {
    enabled: true,
    adapter: 'compatible',
    endpoint: 'http://localhost:9000/v1',
  });
  await manager.startSpeech('tts', { text: 'Read this' });
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(events.some((e) => e.audio && e.sampleRate === 24000));
  assert.ok(events.some((e) => e.done));
  manager.config('stt', {
    enabled: true,
    adapter: 'compatible',
    endpoint: 'http://localhost:9000/v1',
    model: 'small-local',
  });
  const { session } = await manager.startSpeech('stt');
  manager.pushAudio(session, Buffer.from([1, 0, 2, 0]).toString('base64'));
  await manager.finishSpeech(session);
  assert.ok(events.some((e) => e.transcript === 'A useful transcript' && e.final));
  const cancelled = await manager.startSpeech('stt');
  manager.config('stt', { enabled: false });
  assert.ok(events.some((e) => e.session === cancelled.session && e.cancelled));
  assert.equal(manager.sessions.size, 0);
  assert.throws(() => manager.pushAudio(cancelled.session, 'AA=='), /Start microphone/);
  manager.fetch = async () =>
    new Response('compressed mp3', { headers: { 'content-type': 'audio/mpeg' } });
  await manager.startSpeech('tts', { text: 'Read this' });
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(events.some((e) => e.error?.includes('raw PCM')));
  assert.throws(
    () => store.setSettings({ optionalModules: { tts: { endpoint: 'http://public.example/v1' } } }),
    /HTTPS/,
  );
});
