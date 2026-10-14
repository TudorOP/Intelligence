import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const workspace = process.cwd();
const base = path.resolve('.test-data/source-distribution');
fs.mkdirSync(base, { recursive: true });
const script = path.join(workspace, 'scripts/verify-source.mjs');
function fixture() {
  const root = fs.mkdtempSync(path.join(base, 'source-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  const write = (file, content) => {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };
  for (const file of [
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
  ]) {
    write(file, fs.readFileSync(path.join(workspace, file)));
  }
  write('public/licenses/index.json', JSON.stringify({ entries: [{ file: 'GPL-3.0.txt' }] }));
  for (const theme of ['festive', 'tech', 'astral', 'marble']) {
    for (const prefix of ['theme', 'welcome', 'background-detail'])
      write(`public/assets/originals/${prefix}-${theme}.png`, 'fixture artwork');
  }
  git('init', '--initial-branch=main');
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-m', 'Fixture');
  return {
    root,
    git,
    write,
    verify: (initial = false) =>
      spawnSync(process.execPath, [script, ...(initial ? ['--initial'] : [])], {
        cwd: root,
        encoding: 'utf8',
      }),
    close: () => {
      assert(root.startsWith(base + path.sep), 'Fixture cleanup escaped isolated data');
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test('source publication guard accepts a complete source snapshot and rejects prior commit history', () => {
  const f = fixture();
  try {
    const first = f.verify(true);
    assert.equal(first.status, 0, first.stderr);
    f.write('README.md', 'Changed fixture');
    f.git('add', '.');
    f.git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@localhost',
      'commit',
      '-m',
      'Second',
    );
    assert.equal(f.verify().status, 0);
    const extra = f.verify(true);
    assert.notEqual(extra.status, 0);
    assert.match(extra.stderr, /one commit/);
  } finally {
    f.close();
  }
});

test('source publication guard rejects force-added credentials, models and runtime downloads', () => {
  const f = fixture();
  try {
    for (const file of ['.env.local', 'models/model.gguf', 'modules/engine/runtime.js']) {
      f.write(file, 'private fixture');
      f.git('add', '--force', file);
      const result = f.verify();
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /ignore rules/);
      f.git('reset', '--hard', 'HEAD');
    }
  } finally {
    f.close();
  }
});

test('source publication guard detects disguised model data, credentials and incomplete notices', () => {
  const f = fixture();
  try {
    for (const content of ['GGUFfixture payload', 'sk-' + 'a'.repeat(52)]) {
      f.write('example.md', content);
      f.git('add', '.');
      const result = f.verify();
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Model\/native engine|credential/);
      f.git('reset', '--hard', 'HEAD');
    }
    f.write(
      'public/licenses/index.json',
      JSON.stringify({ entries: [{ file: 'missing-notice.txt' }] }),
    );
    f.git('add', '.');
    const result = f.verify();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing complete license notice/);
  } finally {
    f.close();
  }
});
