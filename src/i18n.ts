import { useSyncExternalStore } from 'react';
import romanian from './locales/ro.json';
let language: 'en' | 'ro' = 'en';
const subscribers = new Set<() => void>();
const reverse = Object.fromEntries(Object.entries(romanian).map(([en, ro]) => [ro, en]));
export function setLanguage(next: 'en' | 'ro') {
  if (next === language) return;
  language = next;
  document.documentElement.lang = next;
  subscribers.forEach((fn) => fn());
}
export function useLanguage() {
  return useSyncExternalStore(
    (fn) => {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
    () => language,
  );
}
export function locale() {
  return language === 'ro' ? 'ro-RO' : 'en-US';
}
export function t(value: string): string {
  const text = String(value ?? '').replace(/^Error invoking remote method '[^']+': Error: /, '');
  const source = Object.hasOwn(romanian,text)?text:(reverse[text] ?? text);
  if (language === 'en') return source;
  const exact = (romanian as Record<string, string>)[source];
  if (exact) return exact;
  for (const prefix of [
    'Restore ',
    'Delete permanently ',
    'Expand ',
    'Collapse ',
    'Name for ',
    'Description for ',
    'Connected · ',
    'Using ',
    'Corrected tool formatting · ',
    'Working · ',
    'Awaiting approval · ',
    'Read-only · ',
    'Preparing memory model · ',
  ]) {
    if (source.startsWith(prefix))
      return ((romanian as Record<string, string>)[prefix] ?? prefix) + source.slice(prefix.length);
  }
  return text;
}

export function sourceText(value: string) {
  return reverse[value] ?? value;
}
