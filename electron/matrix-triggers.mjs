import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { projectPath } from './projects.mjs';
function gitToken(file, event) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size,
      bytes = Buffer.alloc(Math.min(65536, size));
    fs.readSync(fd, bytes, 0, bytes.length, Math.max(0, size - bytes.length));
    const text = bytes.toString('utf8').trim();
    return event === 'commit' ? text.split('\n').at(-1) : text;
  } finally {
    fs.closeSync(fd);
  }
}

// One watcher per directory, one pending event per task. No file contents or event history in RAM.
export class MatrixTriggers {
  constructor(matrix, { watch = fs.watch, now = Date.now } = {}) {
    this.matrix = matrix;
    this.watch = watch;
    this.now = now;
    this.watchers = new Map();
    this.pending = new Map();
    this.closed = false;
    this.generation = 0;
    this.signature = '';
    this.timer = null;
    this.systemTimer = null;
    this.systemEdges = new Map();
    this.gitTokens = new Map();
  }
  async target(task) {
    const { store, agent } = this.matrix,
      trigger = task.data.trigger;
    const source = store.get(trigger.source);
    if (!source || !store.access(source.id))
      throw Error('The watched source is outside agent access.');
    let file;
    if (source.kind === 'project')
      file = (
        await projectPath(
          store,
          source.id,
          trigger.kind === 'git'
            ? trigger.event === 'branch'
              ? '.git/HEAD'
              : '.git/logs/HEAD'
            : (trigger.path ?? '.'),
        )
      ).file;
    else if (agent.vault) file = agent.vault.location(source, false);
    else throw Error('Vault monitoring is unavailable.');
    const stat = await fs.promises.lstat(file);
    if (stat.isSymbolicLink()) throw Error('Symbolic links cannot be watched.');
    return {
      directory: stat.isDirectory() ? file : path.dirname(file),
      file: stat.isDirectory() ? null : path.basename(file),
    };
  }
  reconcile() {
    if (this.closed) return;
    const systemTasks = this.matrix
      .tasks()
      .filter(
        (t) =>
          !this.matrix.store.settings().backgroundPaused &&
          this.matrix.store.settings().tools &&
          this.matrix.store.assigned(t.id) &&
          t.data.trigger?.kind === 'system' &&
          this.matrix.store.access(t.data.trigger.source),
      );
    if (systemTasks.length && !this.systemTimer) {
      this.systemTimer = setInterval(() => this.scanSystem(), 15000);
      this.systemTimer.unref?.();
    }
    if (!systemTasks.length) {
      clearInterval(this.systemTimer);
      this.systemTimer = null;
      this.systemEdges.clear();
    }
    for (const id of this.systemEdges.keys())
      if (!systemTasks.some((t) => t.id === id)) this.systemEdges.delete(id);
    const tasks = this.matrix
      .tasks()
      .filter(
        (task) =>
          this.matrix.store.settings().tools &&
          !this.matrix.store.settings().backgroundPaused &&
          this.matrix.store.assigned(task.id) &&
          !['failed', 'needs_input', 'paused'].includes(task.data.status) &&
          ['file', 'git'].includes(task.data.trigger?.kind),
      );
    for (const id of this.gitTokens.keys())
      if (!tasks.some((task) => task.id === id)) this.gitTokens.delete(id);
    let signature;
    try {
      signature = JSON.stringify(
        tasks.map((task) => {
          const source = this.matrix.store.get(task.data.trigger.source);
          return [
            task.id,
            task.data.trigger,
            source?.revision,
            this.matrix.agent.vault && source?.kind.startsWith('vault-')
              ? this.matrix.agent.vault.relative(source)
              : null,
          ];
        }),
      );
    } catch (error) {
      for (const task of tasks) this.matrix.triggerError(task.id, error.message);
      return;
    }
    if (signature === this.signature) return;
    this.signature = signature;
    const generation = ++this.generation;
    // Remove old subscriptions immediately on revocation/configuration changes.
    for (const value of this.watchers.values()) value.handle.close();
    this.watchers.clear();
    this.pending.clear();
    clearTimeout(this.timer);
    this.timer = null;
    void this.install(tasks.slice(0, 64), generation).catch((e) =>
      this.matrix.emit({ type: 'notice', error: e.message }),
    );
    for (const task of tasks.slice(64))
      this.matrix.triggerError(task.id, 'At most 64 file-change tasks can be monitored at once.');
  }
  async install(tasks, generation) {
    for (const task of tasks) {
      try {
        const target = await this.target(task);
        if (task.data.trigger?.kind === 'git')
          this.gitTokens.set(
            task.id,
            gitToken(path.join(target.directory, target.file), task.data.trigger.event),
          );
        if (this.closed || generation !== this.generation) return;
        let entry = this.watchers.get(target.directory);
        if (!entry) {
          entry = { subscriptions: new Map(), handle: null };
          entry.handle = this.watch(target.directory, { persistent: false }, (_event, name) =>
            this.event(target.directory, name),
          );
          entry.handle.on('error', () => {
            entry.handle.close();
            this.watchers.delete(target.directory);
            for (const id of entry.subscriptions.keys())
              this.matrix.triggerError(id, 'File monitoring stopped. Check the source and retry.');
          });
          this.watchers.set(target.directory, entry);
        }
        entry.subscriptions.set(task.id, target.file);
      } catch (e) {
        if (this.closed || generation !== this.generation) return;
        this.matrix.triggerError(task.id, e.message);
      }
    }
  }
  event(directory, name) {
    if (this.closed || !name) return;
    const filename = String(name);
    if (filename.startsWith('.') || /\.intelligence-|node_modules/.test(filename)) return;
    for (const [id, filter] of this.watchers.get(directory)?.subscriptions ?? []) {
      if (filter && filter !== filename) continue;
      const task = this.matrix.store.get(id);
      if (!task || !this.matrix.store.assigned(id)) continue;
      if (task.data.trigger?.kind === 'git') {
        try {
          const token = gitToken(path.join(directory, filename), task.data.trigger.event);
          if (
            task.data.trigger.event === 'commit' &&
            !/\t(?:commit(?: \([^)]+\))?|cherry-pick):/.test(token)
          )
            continue;
          if (this.gitTokens.get(id) === token) continue;
          this.gitTokens.set(id, token);
        } catch {
          continue;
        }
      }
      // Ignore edits during Matrix work and its settling period. This also breaks cross-task loops.
      if (this.matrix.running || this.now() < (this.matrix.suppressFilesUntil ?? 0)) continue;
      if (
        this.now() - Date.parse(task.data.lastTriggeredAt ?? 0) <
        (task.data.trigger.cooldownSeconds ?? 60) * 1000
      )
        continue;
      this.pending.set(id, { at: this.now(), filename });
    }
    if (!this.pending.size) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 500);
    this.timer.unref?.();
  }
  flush() {
    this.timer = null;
    const pending = [...this.pending];
    this.pending.clear();
    for (const [id, event] of pending) {
      const task = this.matrix.store.get(id);
      if (
        !task ||
        !this.matrix.store.assigned(id) ||
        this.matrix.running ||
        this.now() < (this.matrix.suppressFilesUntil ?? 0) ||
        !['queued', 'done'].includes(task.data.status ?? 'queued')
      )
        continue;
      this.matrix.store.mutate({
        id,
        data: {
          status: 'queued',
          triggerPending: true,
          lastTriggeredAt: new Date(event.at).toISOString(),
          triggerDetail: event.filename,
          result: '',
        },
      });
    }
    this.matrix.refresh();
  }
  signalTask(task, detail) {
    if (
      this.closed ||
      this.matrix.store.settings().backgroundPaused ||
      !this.matrix.store.settings().tools ||
      !this.matrix.store.assigned(task.id) ||
      this.matrix.running ||
      !['queued', 'done'].includes(task.data.status ?? 'queued') ||
      this.now() - Date.parse(task.data.lastTriggeredAt ?? 0) <
        (task.data.trigger.cooldownSeconds ?? 60) * 1000
    )
      return false;
    this.matrix.store.mutate({
      id: task.id,
      data: {
        status: 'queued',
        triggerPending: true,
        lastTriggeredAt: new Date(this.now()).toISOString(),
        triggerDetail: detail,
        result: '',
      },
    });
    return true;
  }
  scanSystem(
    readings = {
      memory: (1 - os.freemem() / os.totalmem()) * 100,
      cpu: (os.loadavg()[0] / Math.max(1, os.cpus().length)) * 100,
    },
  ) {
    if (this.closed || this.matrix.running || this.matrix.store.settings().backgroundPaused) return;
    for (const task of this.matrix
      .tasks()
      .filter(
        (t) =>
          t.data.trigger?.kind === 'system' &&
          this.matrix.store.assigned(t.id) &&
          this.matrix.store.access(t.data.trigger.source),
      )) {
      const high = readings[task.data.trigger.metric] >= task.data.trigger.threshold;
      if (high && this.systemEdges.get(task.id) === false)
        this.signalTask(task, task.data.trigger.metric + ' >= ' + task.data.trigger.threshold);
      this.systemEdges.set(task.id, high);
    }
  }
  external(channel) {
    let count = 0;
    for (const task of this.matrix
      .tasks()
      .filter((t) => t.data.trigger?.kind === 'external' && t.data.trigger.channel === channel))
      if (this.signalTask(task, 'External event: ' + channel)) count++;
    return { queued: count };
  }
  close() {
    this.closed = true;
    ++this.generation;
    clearTimeout(this.timer);
    this.timer = null;
    clearInterval(this.systemTimer);
    this.systemTimer = null;
    this.systemEdges.clear();
    this.gitTokens.clear();
    for (const value of this.watchers.values()) value.handle.close();
    this.watchers.clear();
    this.pending.clear();
  }
}
