import { SearchCredentials } from './search-credentials.mjs';
import { inferenceProviders } from './inference-catalog.mjs';
export { inferenceProviders } from './inference-catalog.mjs';
export function providerInfo(id) {
  const provider = inferenceProviders.find((p) => p.id === id);
  if (!provider) throw new Error('Choose a supported inference provider');
  return provider;
}
export function providerBase(settings) {
  return settings.endpoint.replace(/\/$/, '');
}
export function requireConnectedProvider(settings) {
  if (settings.connectedProviders && !settings.connectedProviders.includes(settings.provider))
    throw Error(
      'This inference provider is disconnected. Reconnect it in Settings → Model & providers.',
    );
}
export function disconnectProvider(store, credentials, provider) {
  providerInfo(provider);
  const settings = store.settings();
  credentials.disconnect(provider);
  const profiles = { ...settings.providerProfiles };
  delete profiles[provider];
  store.db.exec('BEGIN');
  try {
    const write = store.db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)');
    write.run(
      'connectedProviders',
      JSON.stringify(settings.connectedProviders.filter((id) => id !== provider)),
    );
    write.run('providerProfiles', JSON.stringify(profiles));
    if (provider === settings.provider) write.run('model', JSON.stringify(''));
    store.db.exec('COMMIT');
  } catch (error) {
    store.db.exec('ROLLBACK');
    throw error;
  }
  store.emit('changed', { settings: true });
  return store.settings();
}
export function validateInferenceAddress(settings) {
  const url = new URL(settings.endpoint);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    !['http:', 'https:'].includes(url.protocol) ||
    (providerInfo(settings.provider).cloud &&
      url.protocol !== 'https:' &&
      !(settings.provider === 'compatible' && local))
  )
    throw Error('API providers require HTTPS; local compatible endpoints may use HTTP on loopback');
  return url;
}
export class InferenceCredentials {
  constructor(store, safeStorage, platform = process.platform) {
    this.store = store;
    this.safeStorage = safeStorage;
    this.platform = platform;
    this.entries = new Map();
    this.revisions = new Map();
    this.nextRevision = 0;
  }
  revisionKey(settings) {
    return settings.provider + ':' + new URL(settings.endpoint).href.replace(/\/$/, '');
  }
  changed(settings) {
    this.revisions.set(this.revisionKey(settings), ++this.nextRevision);
    while (this.revisions.size > 64) this.revisions.delete(this.revisions.keys().next().value);
  }
  credentials(settings) {
    const info = providerInfo(settings.provider);
    const url = validateInferenceAddress(settings);
    const namespace = 'inference:' + info.id + ':' + url.href.replace(/\/$/, '');
    if (!this.entries.has(namespace)) {
      if (this.entries.size >= 24) this.entries.delete(this.entries.keys().next().value);
      this.entries.set(
        namespace,
        new SearchCredentials(this.store, this.safeStorage, this.platform, namespace),
      );
    }
    return this.entries.get(namespace);
  }
  get(settings) {
    return this.credentials(settings)?.get() ?? '';
  }
  info(settings) {
    return {
      ...(this.credentials(settings)?.info() ?? {
        configured: false,
        storage: 'none',
        persistentAvailable: false,
      }),
      generation: this.revisions.get(this.revisionKey(settings)) || 0,
    };
  }
  save(settings, key) {
    const entry = this.credentials(settings);
    const url = validateInferenceAddress(settings);
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      throw Error('Authentication outside this computer requires HTTPS');
    const result = entry.save(key);
    this.changed(settings);
    return { ...result, generation: this.revisions.get(this.revisionKey(settings)) };
  }
  forget(settings) {
    const result = this.credentials(settings)?.forget();
    this.changed(settings);
    return result;
  }
  disconnect(provider) {
    const prefix = 'inference:' + provider + ':';
    for (const [name, entry] of this.entries)
      if (name.startsWith(prefix)) {
        entry.forget();
        this.entries.delete(name);
      }
    this.store.db
      .prepare('DELETE FROM search_credentials WHERE substr(provider,1,?)=?')
      .run(prefix.length, prefix);
  }
}
