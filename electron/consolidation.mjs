import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { redactLog } from './workloads.mjs';
import { isGenericSummary } from './memory-summary.mjs';

const normalize = (text) => String(text).normalize('NFKC').replace(/\s+/g, ' ').trim();
export function memoryText(text) {
  return redactLog(text)
    .replace(/```[\s\S]*?```/g, '[code omitted]')
    .replace(/<\|[^>]+\|>/g, '[control token omitted]');
}
export function validateConsolidation(result, transcript) {
  if (
    !result ||
    typeof result.summary !== 'string' ||
    !Array.isArray(result.facts) ||
    result.facts.length > 6
  )
    throw new Error('MiniCPM5 returned an invalid memory result');
  if (result.summary.length > 2000) throw new Error('Memory summary is too long');
  const facts = [];
  for (const fact of result.facts) {
    const source = transcript.find((m) => m.id === fact.source && m.role === 'user');
    if (
      !source ||
      typeof fact.text !== 'string' ||
      typeof fact.evidence !== 'string' ||
      typeof fact.key !== 'string' ||
      !/^[a-z0-9_.-]{3,90}$/i.test(fact.key) ||
      fact.text.length > 500 ||
      fact.evidence.length > 600 ||
      normalize(fact.evidence).length < 8 ||
      !normalize(source.content).includes(normalize(fact.evidence)) ||
      /\[redacted\]|\[code omitted\]/i.test(fact.text + fact.evidence)
    )
      continue;
    const clean = memoryText(fact.text);
    if (clean !== fact.text) continue;
    facts.push({
      key: fact.key.toLowerCase(),
      content: fact.text.trim(),
      evidence: fact.evidence,
      messageIds: [source.messageId],
    });
  }
  const summary = memoryText(result.summary).trim();
  return { summary: isGenericSummary(summary) ? '' : summary, facts };
}
export class MiniCPMRunner {
  constructor(directory, emit) {
    this.directory = directory;
    this.emit = emit;
    this.child = null;
    this.idle = null;
  }
  run(transcript, signal) {
    if (process.platform !== 'linux')
      return Promise.reject(new Error('MiniCPM5 runs in the Linux application'));
    clearTimeout(this.idle);
    if (!this.child) {
      this.child = fork(fileURLToPath(new URL('./consolidation-worker.mjs', import.meta.url)), [], {
        execPath: process.execPath,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      const spawned = this.child;
      spawned.on('error', () => {
        if (this.child === spawned) this.close();
      });
      spawned.on('exit', () => {
        if (this.child === spawned) {
          clearTimeout(this.idle);
          this.child = null;
        }
      });
    }
    const child = this.child;
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        this.close();
        finish(new Error('MiniCPM5 processing timed out; will retry later'));
      }, 600000);
      const finish = (error, output) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        child.off('message', message);
        child.off('error', failed);
        child.off('exit', exited);
        if (this.child === child) this.idle = setTimeout(() => this.close(), 30000);
        error ? reject(error) : resolve(output);
      };
      const abort = () => {
        this.close();
        finish(new Error('Memory processing paused'));
      };
      const failed = (error) => {
        this.close();
        finish(error);
      };
      const exited = () => {
        this.child = null;
        finish(new Error('Memory worker stopped; will retry later'));
      };
      const message = (m) => {
        if (m.type === 'status') this.emit(m.status);
        if (m.type === 'result') finish(null, m.output);
        if (m.type === 'error') failed(new Error(m.error));
      };
      child.on('message', message);
      child.once('error', failed);
      child.once('exit', exited);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      else child.send({ type: 'summarize', directory: this.directory, transcript });
    });
  }
  close() {
    clearTimeout(this.idle);
    const child = this.child;
    this.child = null;
    child?.kill();
  }
}
export class Consolidator {
  constructor(store, emit, { runner, busy = () => false, clock = Date.now } = {}) {
    this.store = store;
    this.emit = emit;
    this.busy = busy;
    this.clock = clock;
    this.status = 'Automatic memory · waits for an idle conversation';
    this.runner = runner ?? new MiniCPMRunner(store.directory, (status) => this.update(status));
    this.controller = null;
    this.retryAt = 0;
    this.closed = false;
  }
  update(status) {
    this.status = status;
    this.emit({ type: 'consolidation', status });
  }
  pause() {
    this.controller?.abort();
  }
  close() {
    this.closed = true;
    this.pause();
    this.runner.close?.();
  }
  async tick() {
    if (
      this.closed ||
      this.controller ||
      this.busy() ||
      this.clock() < this.retryAt ||
      !this.store.settings().autoConsolidation ||
      this.store.settings().backgroundPaused ||
      !this.store.settings().memoryAccess
    )
      return;
    const conversations = this.store
      .all(false, true)
      .filter(
        (c) => c.kind === 'conversation' && !c.data.attachmentPrivate && this.store.access(c.id),
      );
    for (const c of conversations) {
      const messages = this.store
        .messages(c.id)
        .filter(
          (m) =>
            !m.data.tool &&
            !m.data.error &&
            !m.data.sharedPrefix &&
            ['user', 'assistant'].includes(m.role),
        );
      if (
        messages.length < 2 ||
        messages.at(-1).role !== 'assistant' ||
        this.clock() - Date.parse(messages.at(-1).created) < 90000
      )
        continue;
      const chunks = messages.flatMap((m) => {
        const content = memoryText(m.content);
        return Array.from({ length: Math.max(1, Math.ceil(content.length / 800)) }, (_, i) => ({
          id: m.id + ':' + i,
          messageId: m.id,
          role: m.role,
          content: content.slice(i * 800, (i + 1) * 800),
        }));
      });
      const cursor = this.store.consolidationCursor(c.id);
      const start = cursor ? chunks.findIndex((m) => m.id === cursor) + 1 : 0;
      const transcript = chunks.slice(start, start + 4);
      if (!transcript.length) continue;
      const controller = new AbortController();
      this.controller = controller;
      try {
        this.update('Preparing automatic memory · MiniCPM5 on CPU');
        const result = validateConsolidation(
          await this.runner.run(transcript, controller.signal),
          transcript,
        );
        controller.signal.throwIfAborted();
        const sources = [
          ...new Set([...(c.data.context ?? []), ...messages.flatMap((m) => m.data.context ?? [])]),
        ];
        this.store.commitConsolidation(
          c.id,
          transcript.at(-1).id,
          result.summary,
          result.facts,
          [...new Set(transcript.map((m) => m.messageId))],
          sources,
        );
        this.update('Automatic memory ready · MiniCPM5 on CPU');
        this.emit({ type: 'changed' });
      } catch (e) {
        if (!controller.signal.aborted) {
          this.retryAt = this.clock() + 300000;
          this.update('Automatic memory will retry later · ' + e.message);
        } else this.update('Automatic memory paused · chat has priority');
      } finally {
        this.controller = null;
      }
      return; // One bounded batch per tick; no catch-up CPU burst.
    }
  }
}
