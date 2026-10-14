import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAssignments,
  distroFamily,
  machineIdentity,
  inspectMachine,
  inspectArea,
  machineProfileData,
} from '../electron/system.mjs';
function fixture(id, like, manager, extra = {}) {
  const files = {
    '/etc/os-release': `ID=${id}\nID_LIKE="${like}"\nPRETTY_NAME="${id} Linux"\nVERSION_ID=1`,
    '/etc/machine-info': 'PRETTY_HOSTNAME="My Linux studio"',
    '/proc/1/comm': 'systemd\n',
    '/proc/meminfo': 'MemTotal: 8388608 kB\nMemAvailable: 4194304 kB\n',
    '/sys/class/drm/card0/device/uevent': 'DRIVER=amdgpu\n',
  };
  const commands = new Set([
    `/usr/bin/${manager}`,
    '/usr/bin/systemctl',
    '/usr/bin/nmcli',
    '/usr/bin/wpctl',
    '/run/user/1000/pipewire-0',
  ]);
  const queries = [];
  return {
    platform: 'linux',
    env: {
      XDG_CURRENT_DESKTOP: 'KDE',
      XDG_SESSION_TYPE: 'wayland',
      XDG_RUNTIME_DIR: '/run/user/1000',
    },
    runtime: {
      hostname: () => 'linux-studio',
      homedir: () => '/home/example',
      userInfo: () => ({ uid: 1000 }),
      cpus: () => [{ model: 'Test CPU' }, { model: 'Test CPU' }],
      totalmem: () => 8 * 1024 ** 3,
      freemem: () => 1 * 1024 ** 3,
      networkInterfaces: () => ({ lo: [{ internal: true }], eth0: [{ internal: false }] }),
      arch: () => 'x64',
      release: () => '6.12-test',
      loadavg: () => [0.2, 0.1, 0.1],
      uptime: () => 9000,
    },
    read: async (p) => files[p] ?? '',
    exists: async (p) => commands.has(p),
    statfs: async () => ({ blocks: 1000, bavail: 600, bsize: 4096 }),
    query: async (command, args) => {
      queries.push({ command, args });
      return {
        available: true,
        output: command.endsWith('systemctl') ? 'running' : 'connected:full',
      };
    },
    queries,
    ...extra,
  };
}
test('OS identity is parsed as data and the chosen pretty hostname is used', async () => {
  const text = 'ID=cachyos\nID_LIKE=arch\nPRETTY_NAME="CachyOS"\nPAYLOAD="$(touch unsafe)"';
  assert.equal(parseAssignments(text).PAYLOAD, '$(touch unsafe)');
  assert.equal(distroFamily(parseAssignments(text)), 'arch');
  assert.equal(
    (await machineIdentity(fixture('cachyos', 'arch', 'pacman'))).displayName,
    'My Linux studio',
  );
});
for (const [id, like, manager, family] of [
  ['cachyos', 'arch', 'pacman', 'arch'],
  ['manjaro', 'arch', 'pacman', 'arch'],
  ['ubuntu', 'debian', 'apt', 'debian'],
  ['fedora', '', 'dnf', 'fedora'],
]) {
  test(`${id}: discovery selects capabilities without executing setup or package operations`, async () => {
    const env = fixture(id, like, manager),
      report = await inspectMachine(env);
    assert.equal(report.distro.family, family);
    assert.equal(report.packageManager, manager);
    assert.equal(report.readOnly, true);
    assert.equal(report.audio.pipewire, true);
    assert.equal(report.memory.available, 4 * 1024 ** 3);
    assert.deepEqual(report.gpuDrivers, ['amdgpu']);
    assert.deepEqual(env.queries, []);
    assert.equal(machineProfileData(report).permission, 'read');
    assert.ok(!JSON.stringify(report).includes('/home/example'));
  });
}
test('service and network queries use only fixed read-only arguments', async () => {
  const env = fixture('cachyos', 'arch', 'pacman');
  await inspectArea('services', env);
  await inspectArea('network', env);
  assert.deepEqual(env.queries, [
    { command: '/usr/bin/systemctl', args: ['is-system-running'] },
    {
      command: '/usr/bin/nmcli',
      args: ['--terse', '--fields', 'STATE,CONNECTIVITY', 'general', 'status'],
    },
  ]);
  await assert.rejects(() => inspectArea('restart', env), /Unknown inspection/);
});
test('missing components and immutable Fedora are reported without guessing a repair', async () => {
  const missing = fixture('custom', '', 'pacman', { exists: async () => false });
  const report = await inspectMachine(missing);
  assert.equal(report.packageManager, null);
  assert.equal(report.audio.pipewire, false);
  const atomic = fixture('fedora', '', 'dnf', {
    exists: async (p) =>
      p === '/run/ostree-booted' || p === '/usr/bin/rpm-ostree' || p === '/usr/bin/dnf',
  });
  const immutable = await inspectMachine(atomic);
  assert.equal(immutable.distro.immutable, true);
  assert.equal(immutable.packageManager, 'rpm-ostree');
});
