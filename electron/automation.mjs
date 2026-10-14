import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
export class ExternalEvents {
  constructor(store, credentials, signal, emit = () => {}) {
    this.store = store;
    this.credentials = credentials;
    this.signal = signal;
    this.emit = emit;
    this.server = null;
    this.port = null;
    this.generation = 0;
  }
  token() {
    let token = this.credentials.get();
    if (!token) {
      token = randomBytes(32).toString('hex');
      this.credentials.save(token);
    }
    return token;
  }
  async refresh() {
    const generation = ++this.generation;
    const s = this.store.settings();
    if (!s.externalEventsEnabled || s.backgroundPaused) {
      await this.close(false);
      return;
    }
    if (this.server && this.port === s.externalEventsPort) return;
    await this.close(false);
    if (generation !== this.generation) return;
    const token = this.token();
    const server = (this.server = createServer((req, res) => {
      const provided = Buffer.from(String(req.headers.authorization ?? '').replace(/^Bearer /, '')),
        expected = Buffer.from(token);
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
        res.writeHead(401);
        res.end('Unauthorized');
        return;
      }
      const channel = /^\/events\/([a-zA-Z0-9_-]{1,60})$/.exec(req.url ?? '')?.[1];
      if (
        req.method !== 'POST' ||
        !channel ||
        this.store.settings().backgroundPaused ||
        !this.store.settings().externalEventsEnabled
      ) {
        res.writeHead(400);
        res.end('Event not accepted');
        return;
      }
      if (Number(req.headers['content-length'] ?? 0) > 1024) {
        res.writeHead(413);
        res.end();
        return;
      }
      req.resume();
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(this.signal(channel)));
    }));
    this.server.requestTimeout = 5000;
    this.server.headersTimeout = 5000;
    this.server.maxConnections = 8;
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(s.externalEventsPort, '127.0.0.1', resolve);
    });
    if (generation !== this.generation) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      if (this.server === server) this.server = null;
      return;
    }
    this.port = s.externalEventsPort;
    this.server.on('error', (e) => this.emit({ type: 'notice', error: e.message }));
  }
  async close(invalidate = true) {
    if (invalidate) this.generation++;
    const server = this.server;
    this.server = null;
    this.port = null;
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  }
}
export function wakeCapability(
  platform = process.platform,
  alarm = '/sys/class/rtc/rtc0/wakealarm',
) {
  if (platform !== 'linux')
    return { available: false, reason: 'Laptop wake requires a writable Linux RTC wakealarm.' };
  try {
    fs.accessSync(alarm, fs.constants.W_OK);
    return { available: true, alarm };
  } catch {
    return {
      available: false,
      reason:
        'Configure Linux RTC wakealarm permissions outside Intelligence before enabling laptop wake.',
    };
  }
}
export function updateWake(store, capability = wakeCapability()) {
  if (!capability.available) return null;
  const current = fs.readFileSync(capability.alarm, 'utf8').trim();
  if (!store.settings().wakeForTasks || store.settings().backgroundPaused) {
    if (store.ownedWake && current === store.ownedWake) fs.writeFileSync(capability.alarm, '0');
    store.ownedWake = null;
    return null;
  }
  const times = store
    .all(false, true)
    .filter((e) =>
      e.kind === 'report-template'
        ? store.settings().reportsAutomation &&
          e.data.enabled &&
          !e.data.attention &&
          store.access(e.id)
        : ['card', 'matrix-task'].includes(e.kind) &&
          store.assigned(e.id) &&
          !['done', 'failed', 'needs_input', 'paused'].includes(e.data.status),
    )
    .map((e) => Date.parse(e.kind === 'report-template' ? e.data.nextRun : e.data.schedule?.start))
    .filter((t) => Number.isFinite(t) && t > Date.now())
    .sort((a, b) => a - b);
  if (Number(current) > 0 && current !== store.ownedWake) return Number(current) * 1000;
  fs.writeFileSync(capability.alarm, '0');
  if (times.length) {
    const preparation =
      times[0] -
      (store.settings().matrixPreload ? store.settings().matrixPreloadMinutes * 60000 : 0);
    store.ownedWake = String(
      Math.floor((preparation > Date.now() + 1000 ? preparation : times[0]) / 1000),
    );
    fs.writeFileSync(capability.alarm, store.ownedWake);
  } else store.ownedWake = null;
  return times[0] ?? null;
}
