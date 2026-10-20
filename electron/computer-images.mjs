import { randomUUID } from 'node:crypto';
const caches = new WeakMap();
export function computerImageReference(store, bytes, mime, conversation, controller) {
  if (bytes.length > 10 * 1024 * 1024) throw Error('Vision images must be smaller than 10 MB');
  let cache = caches.get(store);
  if (!cache) {
    cache = new Map();
    caches.set(store, cache);
  }
  if (cache.size >= 32) throw Error('Too many images in this response');
  const token = randomUUID();
  cache.set(token, {
    conversation,
    controller,
    url: 'data:' + mime + ';base64,' + bytes.toString('base64'),
  });
  return { kind: 'computer', token, conversation };
}
export function computerImageData(store, reference) {
  const entry = caches.get(store)?.get(reference.token);
  if (!entry || entry.conversation !== reference.conversation || entry.controller.signal.aborted)
    throw Error('Computer image is no longer available');
  return { type: 'image_url', image_url: { url: entry.url } };
}
export function clearComputerImages(store, controller) {
  const cache = caches.get(store);
  if (cache)
    for (const [token, entry] of cache) if (entry.controller === controller) cache.delete(token);
}
