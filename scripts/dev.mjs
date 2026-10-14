import { spawn } from 'node:child_process';
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], {
  stdio: 'inherit',
});
let desktop;
let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  desktop?.kill();
  vite.kill();
  process.exit(code);
}
process.on('SIGINT', () => close());
process.on('SIGTERM', () => close());
for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch('http://127.0.0.1:5173')).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
  if (i === 79) close(1);
}
vite.on('exit', (code) => close(code ?? 0));
if (process.platform === 'linux') {
  const { default: electron } = await import('electron');
  const env = { ...process.env, INTELLIGENCE_DEV_URL: 'http://127.0.0.1:5173' };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = spawn(electron, ['.'], { stdio: 'inherit', env });
  desktop.on('exit', (code) => close(code ?? 0));
} else {
  console.log('Linux-only application. Browser UI preview: http://127.0.0.1:5173/');
}
