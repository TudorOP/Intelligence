import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function fixture(options = {}) {
  const listeners = new Set(),
    requests = [],
    contexts = [],
    errors = [],
    states = [];
  let count = 0,
    resolveStart;
  const emit = (e) => {
    for (const listener of [...listeners]) listener({ type: 'module-speech', module: 'tts', ...e });
  };
  const api = {
    onEvent(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async workspace(input) {
      requests.push(input);
      if (input.action !== 'module-speak') return true;
      const session = 's' + ++count;
      if (options.pending)
        await new Promise((r) => {
          resolveStart = r;
        });
      if (options.reject) throw Error('Enable the speech module first');
      if (!options.pending) {
        emit({
          session,
          audio: options.invalid
            ? 'AQ=='
            : Buffer.alloc(options.large ? 24000 * 2 * 40 : 480).toString('base64'),
          sampleRate: 24000,
        });
        emit({ session, done: true });
      }
      return { session };
    },
  };
  class AudioContext {
    constructor() {
      this.currentTime = 0;
      this.destination = {};
      this.nodes = [];
      contexts.push(this);
    }
    async resume() {
      if (options.resumeError) throw Error('Audio device unavailable');
    }
    async close() {
      this.closed = true;
    }
    createBuffer(_channels, length, rate) {
      const data = new Float32Array(length);
      return { duration: length / rate, getChannelData: () => data };
    }
    createBufferSource() {
      const source = {
        connect() {},
        disconnect() {},
        start() {},
        stop() {
          this.stopped = true;
        },
      };
      this.nodes.push(source);
      return source;
    }
  }
  const exports = {};
  const js = ts.transpileModule(
    fs.readFileSync('src/speech.ts', 'utf8').replace("import { api } from './api';", ''),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  vm.runInNewContext(js, { exports, api, AudioContext, atob, Uint8Array, DataView, console });
  return {
    speech: exports,
    requests,
    contexts,
    errors,
    states,
    listeners,
    emit,
    finish() {
      for (const c of contexts)
        for (const n of c.nodes) {
          const ended = n.onended;
          n.onended = null;
          ended?.();
        }
    },
    resolve() {
      resolveStart?.();
    },
  };
}
const tick = () => new Promise((r) => setImmediate(r));
test('read aloud handles audio before session reply, waits for drain and closes resources', async () => {
  const f = fixture(),
    p = f.speech.speak(
      'Hello',
      (e) => f.errors.push(e),
      (s) => f.states.push(s),
    );
  await tick();
  assert.equal(f.contexts[0].nodes.length, 1);
  assert.equal(f.listeners.size, 0);
  f.finish();
  await p;
  assert.equal(f.states.at(-1), '');
  assert.equal(f.contexts[0].closed, true);
  assert.deepEqual(f.errors, []);
});
test('long replies synthesize sequential bounded chunks without dropping text', async () => {
  const f = fixture(),
    text = 'A full sentence. '.repeat(900),
    p = f.speech.speak(text, (e) => f.errors.push(e));
  for (let i = 0; i < 50; i++) {
    await tick();
    f.finish();
  }
  await p;
  const chunks = f.requests.filter((r) => r.action === 'module-speak').map((r) => r.text);
  assert.ok(chunks.length > 12);
  assert.ok(chunks.every((v) => v.length <= 1000));
  assert.equal(chunks.join(''), text);
  assert.deepEqual(f.errors, []);
});
test('fast generation exceeding thirty seconds remains playable', async () => {
  const f = fixture({ large: true }),
    p = f.speech.speak('Read a longer passage', (e) => f.errors.push(e));
  await tick();
  assert.deepEqual(f.errors, []);
  f.finish();
  await p;
});
test('Stop during setup cancels only its late session and never attaches listeners again', async () => {
  const f = fixture({ pending: true }),
    p = f.speech.speak('Hello', (e) => f.errors.push(e));
  await tick();
  f.speech.stopPlayback();
  f.resolve();
  await p;
  assert.equal(f.listeners.size, 0);
  assert.ok(f.requests.some((r) => r.action === 'module-stop' && r.session === 's1'));
  assert.equal(f.contexts[0].closed, true);
});
test('invalid audio and startup failures clear status and resources', async () => {
  for (const options of [{ invalid: true }, { reject: true }, { resumeError: true }]) {
    const f = fixture(options);
    await f.speech
      .speak(
        'Hello',
        (e) => f.errors.push(e),
        (s) => f.states.push(s),
      )
      .catch((e) => f.errors.push(e));
    assert.equal(f.errors.length, 1);
    assert.equal(f.states.at(-1), '');
    assert.equal(f.listeners.size, 0);
    assert.equal(f.contexts[0].closed, true);
  }
});
