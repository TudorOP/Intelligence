import fs from 'node:fs';
const romanian = JSON.parse(
  fs.readFileSync(new URL('../src/locales/ro.json', import.meta.url), 'utf8'),
);
export const localized = (text, language) => (language === 'ro' ? (romanian[text] ?? text) : text);
