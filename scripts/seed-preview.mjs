import { Store } from '../electron/store.mjs';
import fs from 'node:fs';
const store = new Store('.cache/preview-seed');
fs.mkdirSync('public', { recursive: true });
fs.writeFileSync('public/browser-seed.json', JSON.stringify(store.snapshot()));
store.close();
