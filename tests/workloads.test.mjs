import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inspectContainers,
  readLogs,
  redactLog,
  validateLogOptions,
} from '../electron/workloads.mjs';
const id = 'a'.repeat(64);
function fixture(engine, query) {
  const calls = [];
  return {
    platform: 'linux',
    exists: async (file) => file === '/usr/bin/' + engine,
    query: async (command, args) => {
      calls.push({ command, args });
      return query(args);
    },
    calls,
  };
}
test('Docker inventory uses only listing commands and excludes environment/labels from public data', async () => {
  const env = fixture('docker', (args) => ({
    available: true,
    output: JSON.stringify(
      args[0] === 'ps'
        ? {
            id,
            name: 'example',
            image: 'app:latest',
            status: 'Up',
            state: 'running',
            ports: '8080->80',
            Env: ['PASSWORD=hidden'],
            Labels: 'SECRET=hidden',
          }
        : args[0] === 'image'
          ? { id: 'sha256:' + id, repository: 'app', tag: 'latest', size: '32MB', created: 'today' }
          : { name: 'example', driver: 'local', scope: 'local', Options: { password: 'hidden' } },
    ),
  }));
  const inventory = await inspectContainers(env),
    docker = inventory.engines.find((e) => e.engine === 'docker');
  assert.equal(docker.available, true);
  assert.equal(docker.sections.containers.items[0].name, 'example');
  assert.ok(!JSON.stringify(inventory).includes('PASSWORD'));
  assert.ok(!JSON.stringify(inventory).includes('hidden'));
  assert.deepEqual(
    env.calls.map((c) => c.args[0]),
    ['ps', 'image', 'volume', 'network'],
  );
  assert.ok(env.calls.every((c) => c.args.includes('--format')));
});
test('Podman JSON arrays normalize names, sizes, volume drivers, and ports', async () => {
  const env = fixture('podman', (args) => ({
    available: true,
    output: JSON.stringify([
      args[0] === 'ps'
        ? {
            Id: id,
            Names: ['example'],
            Image: 'app:latest',
            State: 'running',
            Status: 'Up',
            Ports: [{ host_port: 8080, container_port: 80, protocol: 'tcp' }],
          }
        : args[0] === 'images'
          ? { Id: id, RepoTags: ['app:latest'], Size: 1000000 }
          : { Name: 'example', Driver: 'local' },
    ]),
  }));
  const podman = (await inspectContainers(env)).engines.find((e) => e.engine === 'podman');
  assert.equal(podman.sections.containers.items[0].ports, '8080:80/tcp');
  assert.equal(podman.sections.images.items[0].size, 1000000);
  assert.equal(podman.sections.volumes.items[0].name, 'example');
  assert.ok(env.calls.every((c) => c.args.includes('--format=json')));
});
test('unreachable engines stop before other queries; unsupported hosts execute nothing', async () => {
  const env = fixture('docker', () => ({ available: false, reason: 'Not readable' }));
  const report = await inspectContainers(env);
  assert.equal(report.engines[0].available, false);
  assert.equal(env.calls.length, 1);
  let queries = 0;
  const unsupported = {
    platform: 'unsupported-preview',
    exists: async () => true,
    query: async () => {
      queries++;
      return { available: true, output: '[]' };
    },
  };
  assert.equal((await inspectContainers(unsupported)).supported, false);
  assert.equal((await readLogs({}, unsupported)).available, false);
  assert.equal(queries, 0);
});
test('journal reads are bounded, filtered, and redacted without write/follow options', async () => {
  const env = fixture('journalctl', () => ({
    available: true,
    output: JSON.stringify({
      __REALTIME_TIMESTAMP: '1700000000000000',
      PRIORITY: '4',
      _SYSTEMD_UNIT: 'example.service',
      MESSAGE: 'password=hidden Authorization: Bearer abcdef123456',
    }),
  }));
  const logs = await readLogs({ scope: 'user', limit: 50, unit: 'example.service' }, env);
  assert.equal(logs.available, true);
  assert.ok(!logs.entries[0].message.includes('hidden'));
  assert.ok(!logs.entries[0].message.includes('abcdef123456'));
  const args = env.calls[0].args;
  assert.ok(args.includes('--user'));
  assert.ok(args.includes('--user-unit'));
  assert.ok(args.some((a) => a.startsWith('--output-fields=')));
  assert.ok(args.includes('--no-pager'));
  assert.ok(args.includes('50'));
  assert.ok(!args.includes('--follow'));
  assert.ok(!args.some((a) => a.includes('vacuum') || a.includes('rotate')));
  await readLogs({ scope: 'system', unit: 'example.service' }, env);
  assert.ok(env.calls[1].args.includes('--system'));
  assert.ok(env.calls[1].args.includes('--unit'));
});
test('container logs use an ID, a finite tail, and timestamps; injection-like filters are rejected', async () => {
  const env = fixture('docker', () => ({
    available: true,
    output: '2026-10-07T10:00:00Z token ok',
    errorOutput: '2026-10-07T10:01:00Z api_key=hidden',
  }));
  const logs = await readLogs({ source: 'container', engine: 'docker', id, limit: 50 }, env);
  assert.equal(logs.entries.length, 2);
  assert.ok(!logs.entries[1].message.includes('hidden'));
  assert.deepEqual(env.calls[0].args, [
    'logs',
    '--tail',
    '50',
    '--timestamps',
    '--since',
    '1h',
    id,
  ]);
  assert.throws(
    () => validateLogOptions({ source: 'container', engine: 'docker', id: '--follow' }),
    /valid container/,
  );
  assert.throws(() => validateLogOptions({ unit: 'bad.service; touch file' }), /unit name/);
  assert.throws(() => validateLogOptions({ limit: 100000 }), /filter/);
});
test('common credential patterns and connection passwords are redacted', () => {
  const result = redactLog(
    'postgres://user:password@host password="private value" Bearer abcdef api-key=secret',
  );
  assert.ok(!result.includes('private value'));
  assert.ok(!result.includes('user:password'));
  assert.ok(!result.includes('abcdef'));
  assert.ok(result.includes('[redacted]'));
});
