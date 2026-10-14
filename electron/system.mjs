import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);

export function parseAssignments(text = '') {
  const result = {};
  for (const line of text.split('\n')) {
    const match = line.trim().match(/^([A-Z_][A-Z_0-9]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    result[match[1]] = value.replace(/\\(["\\$`])/g, '$1');
  }
  return result;
}
export function distroFamily(release) {
  const ids = [release.ID, ...(release.ID_LIKE ?? '').split(/\s+/)].filter(Boolean);
  if (ids.some((id) => ['arch', 'cachyos', 'manjaro', 'endeavouros', 'garuda'].includes(id)))
    return 'arch';
  if (ids.some((id) => ['ubuntu', 'debian', 'linuxmint', 'pop'].includes(id))) return 'debian';
  if (ids.some((id) => ['fedora', 'rhel', 'centos'].includes(id))) return 'fedora';
  if (ids.some((id) => ['opensuse', 'opensuse-tumbleweed', 'suse'].includes(id))) return 'suse';
  if (ids.includes('nixos')) return 'nixos';
  return 'other';
}
function environment(overrides = {}) {
  return {
    platform: process.platform,
    runtime: os,
    env: process.env,
    read: async (file) => fs.readFile(file, 'utf8').catch(() => ''),
    exists: async (file) =>
      fs.access(file).then(
        () => true,
        () => false,
      ),
    statfs: async (file) => fs.statfs(file).catch(() => null),
    query: async (command, args) => {
      try {
        const { stdout } = await execute(command, args, {
          timeout: 1500,
          maxBuffer: 64000,
          env: { ...process.env, LC_ALL: 'C', NO_COLOR: '1' },
        });
        return { output: stdout.trim(), available: true };
      } catch (error) {
        return {
          output: String(error.stdout ?? '').trim(),
          available: false,
          reason: error.killed ? 'Inspection timed out' : 'Status unavailable',
        };
      }
    },
    ...overrides,
  };
}
async function findCommand(name, env) {
  // Linux system commands only. Never execute a user-supplied command or load shell startup files.
  for (const directory of ['/usr/bin', '/usr/sbin', '/bin', '/sbin']) {
    const candidate = path.posix.join(directory, name);
    if (await env.exists(candidate)) return candidate;
  }
  return null;
}
export async function machineIdentity(overrides = {}) {
  const env = environment(overrides),
    hostname = env.runtime.hostname();
  const info =
    env.platform === 'linux' ? parseAssignments(await env.read('/etc/machine-info')) : {};
  return {
    hostname,
    displayName: info.PRETTY_HOSTNAME?.trim() || hostname || 'This device',
    platform: env.platform,
  };
}
export async function inspectMachine(overrides = {}) {
  const env = environment(overrides),
    identity = await machineIdentity(env),
    linux = env.platform === 'linux';
  const release = linux
    ? parseAssignments(
        (await env.read('/etc/os-release')) || (await env.read('/usr/lib/os-release')),
      )
    : {};
  const family = linux ? distroFamily(release) : null,
    processors = env.runtime.cpus(),
    totalMemory = env.runtime.totalmem();
  const meminfo = linux ? await env.read('/proc/meminfo') : '';
  const availableMatch = meminfo.match(/^MemAvailable:\s+(\d+)\s+kB/m);
  const availableMemory = availableMatch ? Number(availableMatch[1]) * 1024 : env.runtime.freemem();
  const volume = await env.statfs(env.runtime.homedir());
  const tools = {};
  if (linux)
    for (const name of [
      'pacman',
      'apt',
      'dnf',
      'rpm-ostree',
      'zypper',
      'nix',
      'flatpak',
      'snap',
      'systemctl',
      'rc-status',
      'sv',
      'nmcli',
      'networkctl',
      'wpctl',
      'pactl',
      'aplay',
    ])
      tools[name] = await findCommand(name, env);
  const pid1 = linux ? (await env.read('/proc/1/comm')).trim() : '';
  const init =
    pid1 === 'systemd'
      ? 'systemd'
      : linux && (await env.exists('/run/openrc'))
        ? 'OpenRC'
        : pid1 === 'runit'
          ? 'runit'
          : linux
            ? pid1 || 'Unknown'
            : null;
  const uid = linux && env.runtime.userInfo ? env.runtime.userInfo().uid : null;
  const runtimeDirectory =
    linux && (env.env.XDG_RUNTIME_DIR || (uid !== null && `/run/user/${uid}`));
  const pipewire = runtimeDirectory
    ? await env.exists(path.posix.join(runtimeDirectory, 'pipewire-0'))
    : false;
  const pulse = runtimeDirectory
    ? await env.exists(path.posix.join(runtimeDirectory, 'pulse/native'))
    : false;
  const preferred = { arch: 'pacman', debian: 'apt', fedora: 'dnf', suse: 'zypper', nixos: 'nix' }[
    family
  ];
  const immutable = linux && (await env.exists('/run/ostree-booted'));
  const packageManager =
    immutable && tools['rpm-ostree']
      ? 'rpm-ostree'
      : preferred && tools[preferred]
        ? preferred
        : null;
  const networkInterfaces = Object.values(env.runtime.networkInterfaces())
    .flat()
    .filter((n) => n && !n.internal);
  const gpuDrivers = [];
  if (linux)
    for (let index = 0; index < 6; index++) {
      const text = await env.read(`/sys/class/drm/card${index}/device/uevent`);
      const driver = text.match(/^DRIVER=(.+)$/m)?.[1];
      if (driver && !gpuDrivers.includes(driver)) gpuDrivers.push(driver);
    }
  const capabilities = [
    {
      id: 'resources',
      title: 'Resource readings',
      available: true,
      provider: 'Native OS interfaces',
      detail: 'Memory, processor, uptime, and filesystem capacity.',
    },
    {
      id: 'packages',
      title: 'Software environment',
      available: !!packageManager,
      provider: packageManager ?? 'No supported package manager detected',
      detail: immutable
        ? 'Immutable system detected; package changes require its own workflow.'
        : 'System package manager and software environment.',
    },
    {
      id: 'services',
      title: 'Service inspection',
      available: linux && init === 'systemd' && !!tools.systemctl,
      provider: init ?? 'Native desktop',
      detail:
        init === 'systemd'
          ? 'Read systemd service status.'
          : 'Basic environment inspection; additional service adapters can be added.',
    },
    {
      id: 'network',
      title: 'Network inspection',
      available: true,
      provider: tools.nmcli ? 'NetworkManager tooling available' : 'Native interface readings',
      detail: 'Network interfaces and connection manager status.',
    },
    {
      id: 'audio',
      title: 'Audio environment',
      available: linux,
      provider: pipewire
        ? 'PipeWire socket active'
        : pulse
          ? 'Pulse-compatible socket active'
          : linux
            ? 'No active user audio socket detected'
            : 'Available on Linux',
      detail: 'Audio services, runtime sockets, and available utilities.',
    },
  ];
  return {
    ...identity,
    readOnly: true,
    collectedAt: new Date().toISOString(),
    architecture: env.runtime.arch(),
    kernel: env.runtime.release(),
    osName: release.PRETTY_NAME ?? (linux ? 'Linux' : 'Development preview'),
    distro: { id: release.ID ?? null, family, version: release.VERSION_ID ?? null, immutable },
    desktop: linux
      ? (env.env.XDG_CURRENT_DESKTOP ?? 'Unknown')
      : 'Linux integrations unavailable on this development host',
    session: linux ? (env.env.XDG_SESSION_TYPE ?? 'Unknown') : null,
    memory: { total: totalMemory, available: availableMemory },
    cpu: {
      model: processors[0]?.model ?? 'Unknown processor',
      threads: processors.length,
      load: linux ? env.runtime.loadavg() : null,
    },
    storage: volume
      ? {
          total: Number(volume.blocks) * Number(volume.bsize),
          available: Number(volume.bavail) * Number(volume.bsize),
        }
      : null,
    uptime: env.runtime.uptime(),
    environment: { container: linux && (await env.exists('/.dockerenv')), init },
    network: {
      externalInterfaceCount: networkInterfaces.length,
      manager: tools.nmcli
        ? 'NetworkManager tooling available'
        : tools.networkctl
          ? 'systemd-networkd tooling available'
          : 'Unknown',
    },
    audio: {
      pipewire,
      pulse,
      utilities: ['wpctl', 'pactl', 'aplay'].filter((name) => tools[name]),
    },
    gpuDrivers,
    packageManager,
    optionalPackageTools: ['flatpak', 'snap'].filter((name) => tools[name]),
    capabilities,
  };
}
export async function inspectArea(area, overrides = {}) {
  if (!['system', 'network', 'audio', 'storage', 'services'].includes(area))
    throw new Error('Unknown inspection area');
  const env = environment(overrides),
    report = await inspectMachine(env);
  if (area === 'system') return report;
  if (area === 'storage')
    return { readOnly: true, collectedAt: report.collectedAt, storage: report.storage };
  if (area === 'audio')
    return {
      readOnly: true,
      collectedAt: report.collectedAt,
      audio: report.audio,
      gpuDrivers: report.gpuDrivers,
    };
  if (area === 'services') {
    const tool = report.environment.init === 'systemd' ? await findCommand('systemctl', env) : null;
    const status = tool ? await env.query(tool, ['is-system-running']) : null;
    return {
      readOnly: true,
      collectedAt: report.collectedAt,
      manager: report.environment.init,
      status: status?.output || 'Status unavailable',
      available: !!status?.output,
    };
  }
  const nmcli = await findCommand('nmcli', env);
  const status = nmcli
    ? await env.query(nmcli, ['--terse', '--fields', 'STATE,CONNECTIVITY', 'general', 'status'])
    : null;
  return {
    readOnly: true,
    collectedAt: report.collectedAt,
    ...report.network,
    status: status?.available ? status.output : null,
  };
}
export function machineProfileData(report) {
  return {
    access: true,
    permission: 'read',
    ready: true,
    readOnly: true,
    snapshot: report,
    content: `# ${report.displayName}\n\nThis is a read-only machine context. Explain and inspect; do not install software, alter settings, restart services, or run arbitrary host commands in this conversation.\n\n${JSON.stringify(report, null, 2)}`,
  };
}
