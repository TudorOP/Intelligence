import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
if (
  process.platform !== 'linux' ||
  process.env.INTELLIGENCE_DOCKER_BUILD !== '1' ||
  !fs.existsSync('/.dockerenv')
) {
  console.error('Build the AppImage inside Docker: docker compose run --build --rm appimage');
  process.exit(1);
}
const result = spawnSync(
  process.execPath,
  [
    'node_modules/electron-builder/out/cli/cli.js',
    '--linux',
    'AppImage',
    '--x64',
    ...(['prism', 'aurora'].includes(process.env.INTELLIGENCE_ICON)
      ? ['--config.linux.icon=build/icon-' + process.env.INTELLIGENCE_ICON + '.png']
      : []),
  ],
  { stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } },
);
process.exit(result.status ?? 1);
