import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Store } from '../electron/store.mjs';
import { Consolidator, validateConsolidation } from '../electron/consolidation.mjs';
import { ensureSummaryModel } from '../electron/memory-model.mjs';
import { Agent, nativeTools } from '../electron/agent.mjs';
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-consolidation-'));
  const store = new Store(directory);
  t.after(() => store.close());
  const conversation = store.mutate({ kind: 'conversation', title: 'Preferences', data: {} });
  const user = store.message(
    conversation.id,
    'user',
    'I prefer dark mode. My distribution is CachyOS.',
  );
  store.message(conversation.id, 'assistant', 'You prefer dark mode and use CachyOS.');
  return { store, conversation, user, directory, clock: () => Date.now() + 120000 };
}
const result = (transcript) => ({
  summary: 'The user discussed their Linux preferences.',
  facts: [
    {
      key: 'user.theme',
      text: 'The user prefers dark mode.',
      evidence: 'I prefer dark mode.',
      source: transcript[0].id,
    },
  ],
});

test('generic process summaries are omitted while grounded facts and substantive summaries survive', () => {
  const transcript = [{ id: 'u:0', messageId: 'u', role: 'user', content: 'I prefer dark mode.' }];
  for (const summary of [
    'A brief factual summary of the provided conversation excerpts.',
    'A brief factual summary of the provided messages.',
    'User and assistant messages were analyzed for durable facts, extracted from the provided conversation.',
  ]) {
    const validated = validateConsolidation({ ...result(transcript), summary }, transcript);
    assert.equal(validated.summary, '');
    assert.equal(validated.facts.length, 1);
  }
  assert.equal(
    validateConsolidation({ summary: 'I prefer dark mode.', facts: [] }, transcript).summary,
    'I prefer dark mode.',
  );
});

test('automatic facts do not duplicate facts already saved through the memory UI or remember tool', async (t) => {
  const f = fixture(t);
  f.store.mutate({
    kind: 'memory',
    title: 'Theme',
    data: { content: 'The user prefers dark mode.' },
  });
  await new Consolidator(f.store, () => {}, {
    clock: f.clock,
    runner: { run: async (transcript) => result(transcript) },
  }).tick();
  assert.equal(
    f.store
      .all()
      .filter((e) => e.kind === 'memory' && e.data.content === 'The user prefers dark mode.')
      .length,
    1,
  );
});

test('idle consolidation persists summaries, facts, provenance and cursor; restart never repeats a committed batch', async (t) => {
  const f = fixture(t);
  let calls = 0;
  const runner = {
    run: async (transcript) => {
      calls++;
      return result(transcript);
    },
  };
  const worker = new Consolidator(f.store, () => {}, { runner, clock: f.clock });
  await worker.tick();
  const memories = f.store.all().filter((m) => m.kind === 'memory');
  assert.equal(memories.length, 2);
  assert.ok(memories.every((m) => m.data.sources.includes(f.conversation.id)));
  assert.deepEqual(memories.find((m) => m.data.type === 'fact').data.messageIds, [f.user.id]);
  assert.ok(f.store.consolidationCursor(f.conversation.id));
  await new Consolidator(f.store, () => {}, { runner, clock: f.clock }).tick();
  assert.equal(calls, 1);
  const restarted = new Store(f.directory);
  t.after(() => restarted.close());
  await new Consolidator(restarted, () => {}, { runner, clock: f.clock }).tick();
  assert.equal(calls, 1);
});

test('evidence validation rejects invented facts, assistant claims and secret-bearing facts', () => {
  const transcript = [
    { id: 'u:0', messageId: 'u', role: 'user', content: 'I prefer dark mode. password=[redacted]' },
    { id: 'a:0', messageId: 'a', role: 'assistant', content: 'The fix succeeded.' },
  ];
  const valid = result(transcript);
  valid.facts.push(
    {
      key: 'audio.fixed',
      text: 'The fix succeeded.',
      evidence: 'The fix succeeded.',
      source: 'a:0',
    },
    { key: 'user.editor', text: 'Uses Vim.', evidence: 'I use Vim.', source: 'u:0' },
    {
      key: 'user.password',
      text: 'password=secret',
      evidence: 'password=[redacted]',
      source: 'u:0',
    },
  );
  assert.equal(validateConsolidation(valid, transcript).facts.length, 1);
  assert.throws(
    () => validateConsolidation({ summary: 'x'.repeat(2001), facts: [] }, transcript),
    /too long/,
  );
});

test('temporary/excluded/revoked-source chats never reach the summarizer or historical search', async (t) => {
  const f = fixture(t);
  let calls = 0;
  const worker = new Consolidator(f.store, () => {}, {
    runner: {
      run: async () => {
        calls++;
        return {};
      },
    },
    clock: f.clock,
  });
  for (const data of [
    { temporary: true },
    { temporary: false, memoryExcluded: true },
    { memoryExcluded: false, logContext: { entries: [] } },
  ]) {
    f.store.mutate({ id: f.conversation.id, data });
    await worker.tick();
    assert.equal(f.store.searchConversations('dark').length, 0);
  }
  const note = f.store.all().find((e) => e.kind === 'note');
  f.store.mutate({ id: note.id, data: { access: false } });
  f.store.mutate({ id: f.conversation.id, data: { logContext: null, context: [note.id] } });
  await worker.tick();
  assert.equal(calls, 0);
  assert.throws(() => f.store.readConversation(f.conversation.id), /outside memory/);
});

test('foreground chat, shutdown and mid-flight source revocation prevent committing automatic memory', async (t) => {
  const f = fixture(t);
  let release,
    calls = 0;
  const runner = {
    run: async (transcript) => {
      calls++;
      await new Promise((r) => {
        release = r;
      });
      return result(transcript);
    },
  };
  const worker = new Consolidator(f.store, () => {}, { runner, clock: f.clock, busy: () => true });
  await worker.tick();
  assert.equal(calls, 0);
  worker.busy = () => false;
  const work = worker.tick();
  f.store.mutate({ id: f.conversation.id, data: { memoryExcluded: true } });
  release();
  await work;
  assert.equal(f.store.all().filter((e) => e.kind === 'memory').length, 0);
  assert.equal(f.store.consolidationCursor(f.conversation.id), undefined);
  f.store.mutate({ id: f.conversation.id, data: { memoryExcluded: false } });
  const stopped = worker.tick();
  worker.close();
  release();
  await stopped;
  await worker.tick();
  assert.equal(calls, 2);
  assert.equal(f.store.consolidationCursor(f.conversation.id), undefined);
});

test('failed generations retain cursor for retry and disabled automatic memory never schedules work', async (t) => {
  const f = fixture(t);
  let time = f.clock(),
    calls = 0;
  const worker = new Consolidator(f.store, () => {}, {
    clock: () => time,
    runner: {
      run: async () => {
        calls++;
        throw new Error('Offline');
      },
    },
  });
  await worker.tick();
  await worker.tick();
  assert.equal(calls, 1);
  assert.equal(f.store.consolidationCursor(f.conversation.id), undefined);
  time += 300001;
  f.store.setSettings({ autoConsolidation: false });
  await worker.tick();
  assert.equal(calls, 1);
  f.store.setSettings({ autoConsolidation: true });
  await worker.tick();
  assert.equal(calls, 2);
});

test('corrections require review; accepting one supersedes the earlier fact, and forgetting prevents recreation', async (t) => {
  const f = fixture(t);
  await new Consolidator(f.store, () => {}, {
    clock: f.clock,
    runner: { run: async (transcript) => result(transcript) },
  }).tick();
  const corrected = f.store.mutate({ kind: 'conversation', title: 'Correction', data: {} });
  const user = f.store.message(corrected.id, 'user', 'I now prefer the light theme.');
  const assistant = f.store.message(corrected.id, 'assistant', 'Acknowledged.');
  f.store.commitConsolidation(
    corrected.id,
    assistant.id,
    '',
    [
      {
        key: 'user.theme',
        content: 'The user prefers the light theme.',
        evidence: user.content,
        messageIds: [user.id],
      },
    ],
    [user.id],
    [],
  );
  const newFact = f.store.all().find((e) => e.data.status === 'needs_review');
  assert.ok(newFact);
  assert.equal(f.store.access(newFact.id), false);
  f.store.resolveMemory(newFact.id);
  assert.equal(f.store.access(newFact.id), true);
  assert.equal(
    f.store.all().find((e) => e.data.content === 'The user prefers dark mode.').data.status,
    'superseded',
  );
  f.store.mutate({ id: newFact.id, action: 'trash' });
  f.store.commitConsolidation(
    corrected.id,
    'new-cursor',
    '',
    [
      {
        key: 'user.theme',
        content: newFact.data.content,
        evidence: user.content,
        messageIds: [user.id],
      },
    ],
    [user.id],
    [],
  );
  assert.equal(f.store.get(newFact.id), null);
});

test('agent history tools respect project scope, permissions and full-message pagination', async (t) => {
  const f = fixture(t);
  const other = f.store.mutate({
    kind: 'conversation',
    title: 'Other project',
    project: 'other',
    data: {},
  });
  f.store.message(other.id, 'user', 'dark mode in a different project');
  f.store.message(f.conversation.id, 'assistant', 'tool-only dark mode', { tool: true });
  f.store.message(f.conversation.id, 'assistant', 'error-only dark mode', { error: true });
  const content = 'Long past message '.repeat(900);
  const long = f.store.message(f.conversation.id, 'user', content);
  const agent = new Agent(f.store, {}, { tools: () => [] }, () => {});
  const ctx = { project: null, readOnlyMachineSession: true };
  assert.ok(nativeTools.some((t) => t.function.name === 'search_conversations'));
  const hits = await agent.execute('search_conversations', { query: 'dark' }, ctx);
  assert.ok(hits.every((h) => !/tool-only|error-only/.test(h.excerpt)));
  assert.equal(f.store.searchConversations('dark', { project: 'other' }).length, 1);
  await assert.rejects(
    () =>
      agent.execute(
        'read_conversation',
        { id: f.conversation.id },
        { ...ctx, project: { id: 'other' } },
      ),
    /current project/,
  );
  let offset = 0,
    text = '';
  do {
    const page = await agent.execute('read_conversation', { id: f.conversation.id, offset }, ctx);
    assert.ok(JSON.stringify(page).length < 10000);
    text += page.messages
      .filter((m) => m.id === long.id)
      .map((m) => m.content)
      .join('');
    offset = page.nextOffset;
  } while (offset !== null);
  assert.equal(text, content);
  f.store.mutate({ id: f.conversation.id, data: { memoryExcluded: true } });
  assert.ok(!f.store.searchConversations('dark').some((h) => h.conversation === f.conversation.id));
  f.store.setSettings({ memoryAccess: false });
  await assert.rejects(
    () => agent.execute('search_conversations', { query: 'dark' }, ctx),
    /disabled/,
  );
});

test('MiniCPM model downloader verifies size and hash, reuses cache offline, and rejects corrupt downloads', async (t) => {
  const f = fixture(t),
    bytes = Buffer.from('GGUF fixture bytes');
  let downloads = 0;
  const manifest = {
    file: 'fixture.gguf',
    revision: 'fixed',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  const fetcher = async () => {
    downloads++;
    return new Response(bytes);
  };
  const file = await ensureSummaryModel(f.directory, { manifest, fetcher });
  assert.deepEqual(fs.readFileSync(file), bytes);
  await ensureSummaryModel(f.directory, {
    manifest,
    fetcher: async () => {
      throw new Error('Offline');
    },
  });
  assert.equal(downloads, 1);
  const corrupt = { ...manifest, file: 'corrupt.gguf', sha256: '0'.repeat(64) };
  await assert.rejects(
    () => ensureSummaryModel(f.directory, { manifest: corrupt, fetcher }),
    /verification failed/,
  );
  assert.equal(
    fs.existsSync(path.join(f.directory, 'models', 'consolidation', 'corrupt.gguf')),
    false,
  );
});
