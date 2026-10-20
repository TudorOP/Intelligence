import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export class CommandSessions {
  constructor({ launch = spawn, platform = process.platform } = {}) {
    this.sessions = new Map();
    this.launch = launch;
    this.platform = platform;
  }
  start({
    conversation,
    controller,
    profile,
    command,
    cwd,
    timeout = 600000,
    executable = '/bin/bash',
    args = ['--noprofile', '--norc', '-c', command],
  }) {
    if (this.sessions.size >= 32)
      for (const [id, entry] of this.sessions)
        if (entry.status !== 'running') {
          entry.controller.signal.removeEventListener('abort', entry.abort);
          this.sessions.delete(id);
          if (this.sessions.size < 32) break;
        }
    if (this.sessions.size >= 32) throw Error('Too many command sessions');
    controller.signal.throwIfAborted();
    const id = randomUUID();
    const proc = this.launch(executable, args, {
      cwd,
      detached: this.platform === 'linux',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const entry = {
      id,
      conversation,
      controller,
      profile,
      proc,
      output: '',
      status: 'running',
      offset: 0,
      total: 0,
      exitCode: null,
    };
    this.sessions.set(id, entry);
    const append = (bytes) => {
      const text = bytes.toString();
      entry.total += text.length;
      entry.output = (entry.output + text).slice(-100000);
    };
    proc.stdout?.on('data', append);
    proc.stderr?.on('data', append);
    const finish = (status, code = null) => {
      if (entry.status !== 'running') return;
      entry.status = status;
      entry.exitCode = code;
      clearTimeout(entry.timer);
    };
    proc.on('error', (e) => {
      append(e.message);
      finish('failed');
    });
    proc.stdin?.on('error', (e) => {
      append(e.message);
      // A closed input pipe does not mean the process has exited. Keep tracking
      // the job until close so Stop, revocation and run cleanup still kill it.
    });
    proc.on('close', (code) => finish(code === 0 ? 'done' : 'failed', code));
    entry.stop = () => {
      if (entry.status !== 'running') return;
      if (this.platform === 'linux' && proc.pid) {
        try {
          process.kill(-proc.pid, 'SIGTERM');
        } catch {}
      } else proc.kill();
      finish('stopped');
      entry.killTimer = setTimeout(() => {
        if (this.platform === 'linux' && proc.pid) {
          try {
            process.kill(-proc.pid, 'SIGKILL');
          } catch {}
        } else if (proc.exitCode === null) proc.kill('SIGKILL');
      }, 500);
      entry.killTimer.unref?.();
    };
    entry.abort = () => entry.stop();
    controller.signal.addEventListener('abort', entry.abort, { once: true });
    entry.timer = setTimeout(
      () => {
        append('\nCommand reached its execution time limit.');
        entry.stop();
      },
      Math.min(1800000, Math.max(1000, timeout)),
    );
    entry.timer.unref?.();
    return id;
  }
  require(id, { conversation, controller, profile }) {
    const entry = this.sessions.get(id);
    if (
      !entry ||
      entry.conversation !== conversation ||
      entry.controller !== controller ||
      entry.profile !== profile
    )
      throw Error('Command session is outside this run');
    controller.signal.throwIfAborted();
    return entry;
  }
  async read(id, ctx, wait = 0) {
    const entry = this.require(id, ctx);
    if (entry.status === 'running' && wait > 0)
      await new Promise((resolve) => {
        const timer = setTimeout(done, Math.min(60000, wait));
        const abort = () => done();
        function done() {
          clearTimeout(timer);
          ctx.controller.signal.removeEventListener('abort', abort);
          entry.proc.removeListener('close', done);
          entry.proc.removeListener('error', done);
          resolve();
        }
        ctx.controller.signal.addEventListener('abort', abort, { once: true });
        entry.proc.once('close', done);
        entry.proc.once('error', done);
      });
    this.require(id, ctx);
    const start = Math.max(0, entry.offset - (entry.total - entry.output.length)),
      output = entry.output.slice(start),
      truncated = entry.offset < entry.total - entry.output.length;
    entry.offset = entry.total;
    return { session: id, status: entry.status, output, truncated, exitCode: entry.exitCode };
  }
  input(id, ctx, text) {
    const entry = this.require(id, ctx);
    if (entry.status !== 'running') throw Error('Command has finished');
    if (typeof text !== 'string' || text.length > 100000) throw Error('Invalid command input');
    entry.proc.stdin.write(text);
    return { session: id, status: 'running' };
  }
  stop(id, ctx) {
    const entry = this.require(id, ctx);
    entry.stop();
    return { session: id, status: 'stopped' };
  }
  running(conversation, controller) {
    return [...this.sessions.values()].filter(
      (entry) =>
        entry.conversation === conversation &&
        entry.controller === controller &&
        entry.status === 'running',
    );
  }
  closeRun(conversation, controller) {
    for (const [id, entry] of this.sessions)
      if (entry.conversation === conversation && entry.controller === controller) {
        entry.stop();
        controller.signal.removeEventListener('abort', entry.abort);
        clearTimeout(entry.timer);
        this.sessions.delete(id);
      }
  }
  revoke(allowed) {
    for (const entry of this.sessions.values()) if (!allowed(entry)) entry.stop();
  }
  close() {
    for (const entry of this.sessions.values()) {
      entry.stop();
      entry.controller.signal.removeEventListener('abort', entry.abort);
    }
    this.sessions.clear();
  }
}
