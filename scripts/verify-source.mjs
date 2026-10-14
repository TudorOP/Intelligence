import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';

const root = process.cwd();
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
assert.equal(path.resolve(git('rev-parse', '--show-toplevel')), path.resolve(root));
const files = git('ls-files', '-z').split('\0').filter(Boolean);
assert(files.length > 0, 'Source inventory is empty');
const inventory = new Set(files);
const required = [
  'README.md',
  'LICENSE',
  'COPYRIGHT',
  'ASSETS.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'package.json',
  'package-lock.json',
  'Dockerfile',
  'compose.yaml',
  '.gitignore',
  '.dockerignore',
  '.github/FUNDING.yml',
  '.github/workflows/source-checks.yml',
  'docs/LICENSES.md',
  'docs/RELEASE_CHECKLIST.md',
  'public/assets/theme-provenance.json',
  'public/assets/icons/SOURCE.json',
  'public/assets/icons/LUCIDE-LICENSE.txt',
  'public/licenses/GPL-3.0.txt',
  'public/licenses/index.json',
  'public/licenses/kokoro/index.json',
];
for (const file of required) assert(inventory.has(file), `Missing source/license file: ${file}`);

// --no-index also detects accidentally force-added files, which ignore rules alone cannot protect.
const ignored = spawnSync('git', ['check-ignore', '--no-index', '-z', '--stdin'], {
  cwd: root,
  encoding: 'utf8',
  input: files.join('\0') + '\0',
});
assert([0, 1].includes(ignored.status), 'Could not check tracked ignore rules');
assert.equal(
  ignored.stdout,
  '',
  `Tracked files match private/generated ignore rules: ${ignored.stdout.replaceAll('\0', ', ')}`,
);

const forbiddenPath =
  /(?:^|\/)(?:node_modules|\.git|\.test-data|\.cache|\.codex|\.claude|\.cursor|\.history|private-history|secrets|credentials)(?:\/|$)|^(?:dist|release|out|coverage|data|user-data|backups|models|weights|engines|modules|voices|archives|runtime|downloads|tmp|temp)\//i;
const forbiddenFile =
  /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.authinfo)$|\.(?:sqlite(?:3)?(?:-.*)?|db(?:-.*)?|bundle|backup|gguf|ggml|onnx|safetensors|pt|pth|ckpt|bin|tflite|zim|zip|tgz|7z|AppImage|deb|rpm|exe|dll|so|dylib|msi|dmg|pem|key|p12|pfx|keystore|jks)$/i;
const secrets = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-(?:proj-)?[A-Za-z0-9_-]{40,})\b/,
];
const privatePaths = /(?:C:[/\\]Users[/\\]|\/Users\/|\/home\/)(?:octavian|[^\s"']+\/Desktop)/i;
const textExtensions = new Set([
  '.md',
  '.mjs',
  '.cjs',
  '.js',
  '.ts',
  '.tsx',
  '.json',
  '.ps1',
  '.yaml',
  '.yml',
  '.txt',
  '.html',
  '.css',
  '.svg',
]);
let bytes = 0;
for (const file of files) {
  assert(!forbiddenPath.test(file), `Private/generated directory is tracked: ${file}`);
  assert(
    !forbiddenFile.test(file) || /(?:^|\/)\.env\.(?:example|sample)$/.test(file),
    `Runtime/data/credential artifact is tracked: ${file}`,
  );
  const absolute = path.resolve(root, file);
  assert(absolute.startsWith(root + path.sep), `Source path escaped repository: ${file}`);
  assert(
    fs.realpathSync(absolute).startsWith(fs.realpathSync(root) + path.sep),
    `Source resolves outside repository: ${file}`,
  );
  const info = fs.lstatSync(absolute);
  assert(info.isFile() && !info.isSymbolicLink(), `Unexpected source link/directory: ${file}`);
  assert(info.size < 50 * 1024 * 1024, `Oversized GitHub source file: ${file}`);
  bytes += info.size;
  const buffer = fs.readFileSync(absolute);
  assert(
    !buffer.subarray(0, 16).equals(Buffer.from('SQLite format 3\0')),
    `SQLite data is tracked: ${file}`,
  );
  assert(
    !['GGUF', '\x7fELF'].includes(buffer.subarray(0, 4).toString()),
    `Model/native engine is tracked: ${file}`,
  );
  assert(buffer.subarray(0, 2).toString() !== 'MZ', `Native executable is tracked: ${file}`);
  if (textExtensions.has(path.extname(file)) || !path.extname(file)) {
    const text = buffer.toString('utf8');
    assert(!privatePaths.test(text), `Personal machine path is tracked: ${file}`);
    for (const pattern of secrets)
      assert(!pattern.test(text), `Potential credential is tracked: ${file}`);
  }
}

assert.equal(
  fs.readFileSync('LICENSE', 'utf8').replaceAll('\r\n', '\n'),
  fs.readFileSync('public/licenses/GPL-3.0.txt', 'utf8').replaceAll('\r\n', '\n'),
  'Local GPL copies differ',
);
assert.equal(JSON.parse(fs.readFileSync('package.json')).license, 'GPL-3.0-only');
assert(fs.readFileSync('COPYRIGHT', 'utf8').includes('Octavian and contributors'));
const licenses = JSON.parse(fs.readFileSync('public/licenses/index.json')).entries;
for (const entry of licenses) {
  const file = path.posix.join('public/licenses', entry.file);
  assert(
    !entry.file.includes('..') && !path.isAbsolute(entry.file),
    'License path escaped notice directory',
  );
  assert(
    inventory.has(file) && fs.statSync(file).size > 0,
    `Missing complete license notice: ${file}`,
  );
}
for (const theme of ['festive', 'tech', 'astral', 'marble']) {
  for (const file of [
    `public/assets/originals/theme-${theme}.png`,
    `public/assets/originals/welcome-${theme}.png`,
    `public/assets/originals/background-detail-${theme}.png`,
  ]) {
    assert(inventory.has(file), `Missing original artwork: ${file}`);
  }
}
assert(fs.readFileSync('.github/FUNDING.yml', 'utf8').includes('https://ko-fi.com/B0B5KQRRD'));
if (process.argv.includes('--initial')) {
  assert.equal(
    git('rev-list', '--all', '--count'),
    '1',
    'Initial publication must contain one commit',
  );
  assert.equal(git('show', '-s', '--format=%P', 'HEAD'), '', 'Initial commit has a parent');
  assert.equal(
    git('for-each-ref', '--format=%(refname)'),
    'refs/heads/main',
    'Unexpected initial branches/tags',
  );
}
console.log(
  JSON.stringify({
    result: 'passed',
    files: files.length,
    bytes,
    licenseNotices: licenses.length,
    optionalArtifacts: 0,
    initialHistory: process.argv.includes('--initial'),
  }),
);
