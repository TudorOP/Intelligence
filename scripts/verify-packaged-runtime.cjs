const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
module.exports = async (context) => {
  if (context.electronPlatformName !== 'linux') return;
  const notices = path.join(context.appOutDir, 'resources', 'licenses', 'kokoro');
  const original = path.join(__dirname, '..', 'public', 'licenses', 'kokoro');
  const index = fs.readFileSync(path.join(notices, 'index.json'));
  if (!index.equals(fs.readFileSync(path.join(original, 'index.json'))))
    throw Error('Packaged Kokoro license index differs from the source');
  const entries = JSON.parse(index.toString('utf8'));
  if (!Array.isArray(entries) || !entries.length)
    throw Error('Packaged Kokoro notices are missing');
  for (const entry of entries) {
    if (typeof entry.file !== 'string' || !/^kokoro\/[^/\\]+\.txt$/.test(entry.file))
      throw Error('Invalid packaged Kokoro license path');
    const name = entry.file.slice('kokoro/'.length);
    if (
      !fs.readFileSync(path.join(notices, name)).equals(fs.readFileSync(path.join(original, name)))
    )
      throw Error('Packaged Kokoro license is missing or differs: ' + name);
  }
  console.log('Packaged Kokoro notices are complete outside ASAR');
  const executable = path.join(context.appOutDir, context.packager.executableName);
  const result = spawnSync(
    executable,
    [
      '-e',
      `const {createRequire}=require('node:module');const path=require('node:path');const req=createRequire(path.join(process.resourcesPath,'app.asar','package.json'));const sharp=req('sharp');sharp({create:{width:1,height:1,channels:3,background:'white'}}).png().toBuffer().then(()=>console.log('Packaged sharp/libvips loaded')).catch(error=>{console.error(error);process.exit(1)});`,
    ],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' },
  );
  if (result.status !== 0)
    throw Error('Packaged native image runtime failed; AppImage was not produced');
};
