import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMainFileMatchers } from 'app-builder-lib/out/fileMatcher.js';

test('Linux image runtime remains unpacked and verified for the single main build', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).build;
  assert.ok(config.asarUnpack.includes('node_modules/@img/**'));
  assert.ok(
    config.extraResources.some((resource) => resource.to.endsWith('sharp-libvips-linux-x64')),
  );
  assert.equal(config.afterPack, 'scripts/verify-packaged-runtime.cjs');
  const packaging = fs.readFileSync(
    new URL('../scripts/package-linux.mjs', import.meta.url),
    'utf8',
  );
  assert.equal(config.directories.output, 'release');
  assert.doesNotMatch(
    packaging,
    /bundleMemory|bundled-memory/,
  );
});

test('Electron packaging includes the runtime icon despite build-resource exclusions', () => {
  const root = fileURLToPath(new URL('../', import.meta.url)).replace(/[\\/]$/, '');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).build;
  const output = path.join(root, config.directories.output);
  const matchers = getMainFileMatchers(
    root,
    path.join(output, 'resources/app'),
    (s) => s,
    config.linux,
    {
      info: {
        projectDir: root,
        buildResourcesDir: path.join(root, config.directories.buildResources),
        config,
        debugLogger: { isEnabled: false },
      },
    },
    output,
    false,
  );
  for (const relative of ['build', 'build/icon.png', 'electron/chat-history.mjs']) {
    const file = path.join(root, relative);
    assert.ok(
      matchers.some((matcher) => matcher.createFilter()(file, fs.statSync(file))),
      relative + ' must be included in app.asar',
    );
  }
});
