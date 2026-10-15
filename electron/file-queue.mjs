import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const ignored = (name) =>
  name.startsWith('.') ||
  /\.(crdownload|part|partial|download|tmp)$/i.test(name) ||
  /\.intelligence-/.test(name);
export class FileQueue {
  constructor(matrix, { watch = fs.watch, now = Date.now, settleMs = 2500 } = {}) {
    this.matrix = matrix;
    this.watch = watch;
    this.now = now;
    this.settleMs = settleMs;
    this.targets = new Map();
    this.generation = 0;
    this.closed = false;
    this.scanning = false;
    this.timer = null;
    this.debounce = null;
    matrix.store.db.exec(
      "UPDATE file_queue SET state='needs_input',result='Interrupted file run. Review before retrying.' WHERE state='running'",
    );
  }
  async reconcile(tasks) {
    this.matrix.store.db.exec(
      "DELETE FROM file_queue WHERE task NOT IN (SELECT id FROM entities WHERE kind='matrix-task'); DELETE FROM file_watches WHERE task NOT IN (SELECT id FROM entities WHERE kind='matrix-task');",
    );
    const generation = ++this.generation;
    for (const target of this.targets.values()) target.handle.close();
    this.targets.clear();
    clearInterval(this.timer);
    this.timer = null;
    if (this.closed || !tasks.length) return;
    for (const task of tasks.slice(0, 64)) {
      try {
        const target = await this.matrix.triggers.target(task);
        if (this.closed || generation !== this.generation) return;
        const stat = fs.lstatSync(target.directory);
        if (!stat.isDirectory() || stat.isSymbolicLink())
          throw Error('Choose a real folder to monitor');
        const source = JSON.stringify([target.directory, target.file]);
        const previous = this.matrix.store.db
          .prepare('SELECT source FROM file_watches WHERE task=?')
          .get(task.id);
        const initial = previous?.source !== source;
        const handle = this.watch(target.directory, { persistent: false }, () => this.schedule());
        handle.on('error', () => {
          handle.close();
          this.targets.delete(task.id);
          this.matrix.triggerError(
            task.id,
            'File monitoring stopped. Review the folder and retry.',
          );
        });
        this.targets.set(task.id, {
          ...target,
          source,
          handle,
          initial,
          includeExisting: task.data.trigger.includeExisting === true,
        });
        this.matrix.store.db
          .prepare(
            'INSERT INTO file_watches VALUES(?,?) ON CONFLICT(task) DO UPDATE SET source=excluded.source',
          )
          .run(task.id, source);
      } catch (error) {
        this.matrix.triggerError(task.id, error.message);
      }
    }
    if (generation !== this.generation || this.closed) return;
    this.timer = setInterval(() => void this.scan(), 3000);
    this.timer.unref?.();
    await this.scan();
  }
  schedule() {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.scan(), 300);
    this.debounce.unref?.();
  }
  identity(stat) {
    return [stat.dev, stat.ino, stat.birthtimeMs].join(':');
  }
  fingerprint(stat) {
    return [stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
  }
  async scan() {
    if (this.closed || this.scanning || this.matrix.store.settings().backgroundPaused) return;
    this.scanning = true;
    try {
      for (const [id, target] of this.targets) {
        const task = this.matrix.store.get(id);
        if (!task || !this.matrix.store.assigned(id)) continue;
        try {
          const current = await this.matrix.triggers.target(task);
          if (current.directory !== target.directory || current.file !== target.file)
            throw Error('The monitored folder changed; review its configuration');
          const names = fs.readdirSync(target.directory);
          if (names.length > 5000)
            throw Error(
              'This monitored folder exceeds 5000 direct entries; choose a smaller inbox',
            );
          const time = this.now(),
            seenIds = new Set();
          const known = new Map(
            this.matrix.store.db
              .prepare('SELECT * FROM file_queue WHERE task=? AND source=?')
              .all(id, target.source)
              .map((row) => [row.identity, row]),
          );
          for (const name of names) {
            if (ignored(name) || (target.file && target.file !== name)) continue;
            const file = path.join(target.directory, name);
            let stat;
            try {
              stat = fs.lstatSync(file);
            } catch {
              continue;
            }
            if (!stat.isFile() || stat.isSymbolicLink()) continue;
            const identity = this.identity(stat),
              fingerprint = this.fingerprint(stat);
            const old = known.get(identity);
            if (!old) {
              if (
                this.matrix.store.db
                  .prepare('SELECT count(*) AS n FROM file_queue WHERE task=?')
                  .get(id).n >= 10000
              )
                throw Error(
                  'File history reached 10000 entries. Review and archive this ongoing task.',
                );
              const key = randomUUID();
              seenIds.add(key);
              this.matrix.store.db
                .prepare('INSERT INTO file_queue VALUES(?,?,?,?,?,?,?,?,?,?,?)')
                .run(
                  key,
                  id,
                  target.source,
                  identity,
                  file,
                  fingerprint,
                  target.initial && !target.includeExisting ? 'ignored' : 'settling',
                  time,
                  time,
                  '',
                  null,
                );
            } else {
              seenIds.add(old.id);
              if (['settling', 'ready'].includes(old.state)) {
                if (old.fingerprint !== fingerprint)
                  this.matrix.store.db
                    .prepare(
                      "UPDATE file_queue SET fingerprint=?,file=?,state='settling',seen=?,updated=? WHERE id=?",
                    )
                    .run(fingerprint, file, time, time, old.id);
                else if (
                  old.state === 'settling' &&
                  time - old.seen >= this.settleMs &&
                  time - stat.mtimeMs >= this.settleMs
                )
                  this.matrix.store.db
                    .prepare("UPDATE file_queue SET file=?,state='ready',updated=? WHERE id=?")
                    .run(file, time, old.id);
              }
            }
          }
          target.initial = false;
          for (const entry of this.matrix.store.db
            .prepare(
              "SELECT id FROM file_queue WHERE task=? AND source=? AND state IN ('settling','ready')",
            )
            .all(id, target.source))
            if (!seenIds.has(entry.id))
              this.matrix.store.db
                .prepare(
                  "UPDATE file_queue SET state='missing',result='File was moved or removed before processing' WHERE id=?",
                )
                .run(entry.id);
          const ready = this.matrix.store.db
            .prepare(
              "SELECT count(*) AS n FROM file_queue WHERE task=? AND source=? AND state='ready'",
            )
            .get(id, target.source).n;
          const live = this.matrix.store.get(id);
          if (
            ready &&
            ['queued', 'done'].includes(live?.data.status || 'queued') &&
            !this.matrix.running &&
            this.now() - Date.parse(live.data.lastTriggeredAt || 0) >=
              (live.data.trigger.cooldownSeconds || 5) * 1000
          ) {
            if (live.data.status !== 'queued' || !live.data.triggerPending)
              this.matrix.store.mutate({
                id,
                data: {
                  status: 'queued',
                  triggerPending: true,
                  watchPending: ready,
                  triggerDetail: ready + ' file(s) waiting',
                  result: live.data.result || '',
                },
              });
          }
        } catch (error) {
          this.matrix.triggerError(id, error.message);
        }
      }
    } finally {
      this.scanning = false;
    }
  }
  claim(task) {
    const target = this.targets.get(task.id);
    if (!target) return [];
    const rows = this.matrix.store.db
      .prepare(
        "SELECT * FROM file_queue WHERE task=? AND source=? AND state='ready' ORDER BY seen LIMIT 10",
      )
      .all(task.id, target.source);
    for (const row of rows)
      this.matrix.store.db
        .prepare("UPDATE file_queue SET state='running',updated=? WHERE id=? AND state='ready'")
        .run(this.now(), row.id);
    return rows.map((row) => ({ id: row.id, path: row.file, fingerprint: row.fingerprint }));
  }
  finish(task, run) {
    const status = task?.data.status === 'done' ? 'done' : 'needs_input';
    this.matrix.store.db
      .prepare(
        "UPDATE file_queue SET state=?,result=?,run=?,updated=? WHERE task=? AND state='running'",
      )
      .run(status, task?.data.result || '', run, this.now(), task.id);
    this.schedule();
  }
  retry(id) {
    this.matrix.store.db
      .prepare("UPDATE file_queue SET state='settling',seen=? WHERE task=? AND state='needs_input'")
      .run(this.now(), id);
    this.schedule();
  }
  noteOutput(file) {
    for (const [task, target] of this.targets) {
      if (path.dirname(file) !== target.directory) continue;
      try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile()) continue;
        this.matrix.store.db
          .prepare(
            "INSERT INTO file_queue VALUES(?,?,?,?,?,?,'ignored',?,?,?,NULL) ON CONFLICT(task,source,identity) DO UPDATE SET fingerprint=excluded.fingerprint",
          )
          .run(
            randomUUID(),
            task,
            target.source,
            this.identity(stat),
            file,
            this.fingerprint(stat),
            this.now(),
            this.now(),
            'Created or changed by this automation',
          );
      } catch {}
    }
  }
  history(id) {
    return this.matrix.store.db
      .prepare(
        'SELECT id,file,state,result,updated,run FROM file_queue WHERE task=? ORDER BY updated DESC LIMIT 100',
      )
      .all(id);
  }
  close() {
    this.closed = true;
    ++this.generation;
    clearInterval(this.timer);
    clearTimeout(this.debounce);
    for (const target of this.targets.values()) target.handle.close();
    this.targets.clear();
  }
}
