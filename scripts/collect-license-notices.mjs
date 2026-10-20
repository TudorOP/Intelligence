import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root = process.cwd(),
  directory = path.resolve(root, 'public/licenses/generated');
if (
  !directory.startsWith(path.resolve(root) + path.sep) ||
  path.basename(directory) !== 'generated'
)
  throw Error('Unsafe notices directory');
fs.rmSync(directory, { recursive: true, force: true });
fs.mkdirSync(directory, { recursive: true });
const entries = [{ id: 'intelligence', title: 'Intelligence · GPLv3', file: 'GPL-3.0.txt' }],
  lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
function copy(title, file) {
  const bytes = fs.readFileSync(file),
    id = crypto
      .createHash('sha256')
      .update(title + '\0' + file)
      .digest('hex')
      .slice(0, 24),
    name = id + '.txt';
  fs.writeFileSync(path.join(directory, name), bytes);
  entries.push({
    id,
    title,
    file: 'generated/' + name,
    format: file.endsWith('.html') ? 'html' : 'text',
  });
}
function notices(title, directory, depth = 0) {
  if (depth > 2) return;
  for (const file of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, file.name);
    if (file.isFile() && /^(LICENSE|LICENCE|COPYING|NOTICE|COPYRIGHT)([._-]|$)/i.test(file.name))
      copy(title + ' · ' + file.name, full);
    else if (
      file.isDirectory() &&
      !file.name.startsWith('.') &&
      file.name !== 'node_modules' &&
      depth < 2 &&
      /licen|notice|bin|dist|lib/i.test(file.name)
    )
      notices(title, full, depth + 1);
  }
}
for (const [location, record] of Object.entries(lock.packages)) {
  if (!location || record.dev || !fs.existsSync(location)) continue;
  const name = record.name || location.split('node_modules/').at(-1);
  notices(name + ' ' + record.version, path.resolve(location));
}
for (const file of ['LICENSE', 'LICENSES.chromium.html']) {
  const source = path.join(root, 'node_modules/electron/dist', file);
  if (fs.existsSync(source)) copy('Electron / Chromium · ' + file, source);
}
for (const file of [
  'public/assets/INTER-LICENSE.txt',
  'public/assets/LORA-LICENSE.txt',
  'public/assets/EB-GARAMOND-LICENSE.txt',
  'public/assets/JETBRAINS-MONO-LICENSE.txt',
  'public/assets/icons/LUCIDE-LICENSE.txt',
])
  copy(path.basename(file), file);
entries.push(
  ...JSON.parse(fs.readFileSync(path.join(root, 'public/licenses/kokoro/index.json'), 'utf8')),
);
// Native libraries bundled by electron-builder into the AppImage (usr/lib); the
// texts live in public/licenses/native/ and are pinned by public/licenses/index.json.
entries.push(
  {
    id: 'appimage-libnotify',
    title: 'libnotify (libnotify.so.4.0.0) · bundled AppImage native library · LGPL-2.1',
    file: 'native/LGPL-2.1.txt',
    format: 'text',
  },
  {
    id: 'appimage-libgconf',
    title: 'GConf (libgconf-2.so.4.1.5) · bundled AppImage native library · LGPL-2.1',
    file: 'native/LGPL-2.1.txt',
    format: 'text',
  },
  {
    id: 'appimage-libindicator',
    title: 'libindicator (libindicator3.so.7.0.0) · bundled AppImage native library · GPL-3.0',
    file: 'GPL-3.0.txt',
    format: 'text',
  },
  {
    id: 'appimage-libappindicator',
    title:
      'libappindicator (libappindicator3.so.1.0.0) · bundled AppImage native library · LGPL-3.0',
    file: 'native/LGPL-3.0.txt',
    format: 'text',
  },
  {
    id: 'appimage-libxtst',
    title: 'libXtst (libXtst.so.6.1.0) · bundled AppImage native library · X11',
    file: 'native/X11.txt',
    format: 'text',
  },
  {
    id: 'appimage-libxss',
    title: 'libXss (libXss.so.1.0.0) · bundled AppImage native library · X11',
    file: 'native/X11.txt',
    format: 'text',
  },
);
fs.writeFileSync(
  path.join(root, 'public/licenses/index.json'),
  JSON.stringify({ schema: 1, platform: process.platform, entries }, null, 2) + '\n',
);
console.log(
  'Collected ' +
    entries.length +
    ' license/notice documents for ' +
    process.platform +
    ' build inputs; this is not a compatibility/source-obligations audit.',
);
