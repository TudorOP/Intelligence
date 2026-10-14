import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const engines = new Set(['docker', 'podman']);
const dockerFormats = {
  containers:
    '{"id":{{json .ID}},"name":{{json .Names}},"image":{{json .Image}},"state":{{json .State}},"status":{{json .Status}},"ports":{{json .Ports}}}',
  images:
    '{"id":{{json .ID}},"repository":{{json .Repository}},"tag":{{json .Tag}},"size":{{json .Size}},"created":{{json .CreatedSince}}}',
  volumes: '{"name":{{json .Name}},"driver":{{json .Driver}},"scope":{{json .Scope}}}',
  networks:
    '{"id":{{json .ID}},"name":{{json .Name}},"driver":{{json .Driver}},"scope":{{json .Scope}}}',
};
function environment(overrides = {}) {
  return {
    platform: process.platform,
    env: process.env,
    exists: async (file) =>
      fs.access(file).then(
        () => true,
        () => false,
      ),
    query: async (command, args) => {
      try {
        const result = await execute(command, args, {
          timeout: 8000,
          maxBuffer: 512000,
          env: { ...process.env, LC_ALL: 'C', NO_COLOR: '1' },
        });
        return { available: true, output: result.stdout.trim(), errorOutput: result.stderr.trim() };
      } catch (error) {
        return {
          available: false,
          output: '',
          errorOutput: '',
          reason: error.killed
            ? 'Inspection timed out'
            : 'The current account or CLI connection cannot read this source.',
        };
      }
    },
    ...overrides,
  };
}
async function command(name, env) {
  if (env.platform !== 'linux') return null;
  const dirs = ['/usr/bin', '/usr/local/bin', '/bin', '/usr/sbin'];
  for (const dir of dirs.filter(Boolean)) {
    const file = path.posix.join(dir, name);
    if (await env.exists(file)) return file;
  }
  return null;
}
export function redactLog(text) {
  return String(text ?? '')
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1[redacted]')
    .replace(
      /\b(password|passwd|secret|api[_-]?key|access[_-]?token|authorization)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1=[redacted]',
    )
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[redacted]');
}
export function parseRows(output) {
  const text = String(output ?? '').trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    const rows = JSON.parse(text);
    if (!Array.isArray(rows)) throw new Error('Unexpected inventory format');
    return rows;
  }
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
const field = (row, ...keys) => keys.map((k) => row[k]).find((v) => v !== undefined && v !== null);
const text = (value) =>
  redactLog(Array.isArray(value) ? value.join(', ') : (value ?? '')).slice(0, 500);
function normalize(kind, row) {
  const id = text(field(row, 'id', 'Id', 'ID'));
  if (kind === 'containers') {
    const ports = field(row, 'ports', 'Ports');
    return {
      id,
      name: text(field(row, 'name', 'Names', 'names', 'Name')),
      image: text(field(row, 'image', 'Image', 'ImageName')),
      state: text(field(row, 'state', 'State')),
      status: text(field(row, 'status', 'Status')),
      ports: text(
        Array.isArray(ports)
          ? ports.map((p) =>
              typeof p === 'string'
                ? p
                : `${p.host_port ?? p.hostPort ?? ''}:${p.container_port ?? p.containerPort ?? ''}/${p.protocol ?? 'tcp'}`,
            )
          : ports,
      ),
    };
  }
  if (kind === 'images') {
    const tags = field(row, 'RepoTags', 'Names', 'names') ?? [];
    return {
      id,
      repository: text(field(row, 'repository', 'Repository') ?? tags[0] ?? '<untagged>'),
      tag: text(field(row, 'tag', 'Tag') ?? ''),
      size: field(row, 'size', 'Size') ?? null,
      created: text(field(row, 'created', 'Created', 'CreatedAt', 'CreatedSince')),
    };
  }
  return {
    id,
    name: text(field(row, 'name', 'Name')),
    driver: text(field(row, 'driver', 'Driver')),
    scope: text(field(row, 'scope', 'Scope') ?? 'Current user / connection'),
  };
}
async function inspectEngine(engine, env) {
  const executable = await command(engine, env);
  const result = {
    engine,
    installed: !!executable,
    available: false,
    scope: 'Current CLI context / user',
    sections: {},
    message: executable
      ? 'Connection unavailable'
      : `${engine === 'docker' ? 'Docker' : 'Podman'} CLI is not installed`,
  };
  if (!executable) return result;
  const args = (kind) =>
    engine === 'docker'
      ? [
          ...(kind === 'containers'
            ? ['ps', '--all', '--no-trunc']
            : kind === 'images'
              ? ['image', 'ls', '--no-trunc']
              : [kind === 'volumes' ? 'volume' : 'network', 'ls']),
          '--format',
          dockerFormats[kind],
        ]
      : [
          ...(kind === 'containers'
            ? ['ps', '--all', '--no-trunc']
            : kind === 'images'
              ? ['images', '--no-trunc']
              : [kind === 'volumes' ? 'volume' : 'network', 'ls']),
          '--format=json',
        ];
  const load = async (kind) => {
    const query = await env.query(executable, args(kind));
    if (!query.available)
      return {
        available: false,
        items: [],
        total: 0,
        message: query.reason ?? 'Inventory unavailable',
      };
    try {
      const rows = parseRows(query.output);
      return {
        available: true,
        total: rows.length,
        items: rows.slice(0, 500).map((row) => normalize(kind, row)),
        limited: rows.length > 500,
      };
    } catch {
      return {
        available: false,
        items: [],
        total: 0,
        message: 'The engine returned an unsupported inventory format',
      };
    }
  };
  const containers = await load('containers');
  result.sections.containers = containers;
  if (!containers.available) {
    result.message = containers.message;
    return result;
  }
  result.available = true;
  result.message = 'Read-only inventory';
  const kinds = ['images', 'volumes', 'networks'];
  const lists = await Promise.all(kinds.map(load));
  kinds.forEach((kind, index) => (result.sections[kind] = lists[index]));
  return result;
}
export async function inspectContainers(overrides = {}) {
  const env = environment(overrides);
  if (env.platform !== 'linux')
    return {
      readOnly: true,
      supported: false,
      collectedAt: new Date().toISOString(),
      engines: [],
      message: 'Container integration is available when Intelligence runs on Linux.',
    };
  return {
    readOnly: true,
    supported: true,
    collectedAt: new Date().toISOString(),
    engines: await Promise.all(['docker', 'podman'].map((engine) => inspectEngine(engine, env))),
  };
}
export function validateLogOptions(input = {}) {
  const source = input.source ?? 'journal',
    scope = input.scope ?? 'user',
    since = input.since ?? '1h',
    priority = input.priority ?? 'warning',
    limit = Number(input.limit ?? 100);
  if (
    !['journal', 'container'].includes(source) ||
    !['user', 'system'].includes(scope) ||
    !['15m', '1h', '24h', 'boot'].includes(since) ||
    !['warning', 'error', 'all'].includes(priority) ||
    ![50, 100, 200, 500].includes(limit)
  )
    throw new Error('Invalid log filter');
  if (
    source === 'container' &&
    (!engines.has(input.engine) || !/^[a-f0-9]{12,64}$/i.test(input.id ?? ''))
  )
    throw new Error('Choose a valid container ID');
  if (
    input.unit &&
    !/^[A-Za-z0-9_.@:-]{1,180}\.(service|socket|timer|target|scope)$/.test(input.unit)
  )
    throw new Error('Use a service/unit name such as sshd.service');
  return {
    source,
    scope,
    since,
    priority,
    limit,
    engine: input.engine,
    id: input.id,
    unit: input.unit ?? '',
  };
}
export async function readLogs(input = {}, overrides = {}) {
  const options = validateLogOptions(input),
    env = environment(overrides);
  const base = {
    readOnly: true,
    collectedAt: new Date().toISOString(),
    options,
    entries: [],
    available: false,
    redaction: 'Best-effort redaction; review entries before sharing.',
  };
  if (env.platform !== 'linux')
    return {
      ...base,
      message:
        'Log inspection is available when Intelligence runs on Linux. This development host is not queried.',
    };
  if (options.source === 'container') {
    const executable = await command(options.engine, env);
    if (!executable) return { ...base, message: 'Container CLI is not installed' };
    const args = [
      'logs',
      '--tail',
      String(options.limit),
      '--timestamps',
      ...(options.since === 'boot' ? [] : ['--since', options.since]),
      options.id,
    ];
    const result = await env.query(executable, args);
    if (!result.available)
      return { ...base, message: result.reason ?? 'Container logs are unavailable' };
    const entries = (result.output + '\n' + (result.errorOutput ?? ''))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line, index) => {
        const match = line.match(/^(\d{4}-\d\d-\d\dT\S+)\s+(.*)$/);
        return {
          id: String(index),
          timestamp: match?.[1] ?? null,
          priority: 'output',
          unit: options.engine + ' / ' + options.id.slice(0, 12),
          message: redactLog(match?.[2] ?? line).slice(0, 4000),
        };
      })
      .sort((a, b) => String(a.timestamp ?? '').localeCompare(String(b.timestamp ?? '')))
      .slice(-options.limit);
    return {
      ...base,
      available: true,
      sourceName: options.engine + ' container ' + options.id.slice(0, 12),
      entries,
    };
  }
  const executable = await command('journalctl', env);
  if (!executable)
    return {
      ...base,
      message: 'The system journal is unavailable. This system may use another logging service.',
    };
  const args = [
    options.scope === 'user' ? '--user' : '--system',
    '--no-pager',
    '--quiet',
    '--output=json',
    '--output-fields=__REALTIME_TIMESTAMP,MESSAGE,PRIORITY,_SYSTEMD_UNIT,_SYSTEMD_USER_UNIT,SYSLOG_IDENTIFIER',
    '--lines',
    String(options.limit),
    '--boot',
    ...(options.since === 'boot' ? [] : ['--since', '-' + options.since]),
    ...(options.priority === 'all' ? [] : ['--priority', options.priority === 'error' ? '3' : '4']),
    ...(options.unit ? [options.scope === 'user' ? '--user-unit' : '--unit', options.unit] : []),
  ];
  const result = await env.query(executable, args);
  if (!result.available)
    return {
      ...base,
      message: 'The journal could not be read with the current account. Try user/session logs.',
    };
  try {
    return {
      ...base,
      available: true,
      sourceName: options.scope === 'user' ? 'User journal' : 'System journal',
      entries: parseRows(result.output)
        .slice(0, options.limit)
        .map((row, index) => ({
          id: String(index),
          timestamp: row.__REALTIME_TIMESTAMP
            ? new Date(Number(row.__REALTIME_TIMESTAMP) / 1000).toISOString()
            : null,
          priority: String(row.PRIORITY ?? '6'),
          unit: String(row._SYSTEMD_USER_UNIT ?? row._SYSTEMD_UNIT ?? row.SYSLOG_IDENTIFIER ?? ''),
          message: redactLog(
            typeof row.MESSAGE === 'string' ? row.MESSAGE : '[Binary message omitted]',
          ).slice(0, 4000),
        })),
    };
  } catch {
    return { ...base, message: 'The journal response could not be decoded' };
  }
}
