import { SearchCredentials } from './search-credentials.mjs';
export const inferenceProviders = [
  { id: 'ollama', name: 'Ollama', endpoint: 'http://127.0.0.1:11434', cloud: false },
  { id: 'lmstudio', name: 'LM Studio', endpoint: 'http://127.0.0.1:1234', cloud: false },
  { id: 'llamacpp', name: 'llama.cpp', endpoint: 'http://127.0.0.1:8080/v1', cloud: false },
  { id: 'openai', name: 'OpenAI', endpoint: 'https://api.openai.com/v1', cloud: true },
  { id: 'mistral', name: 'Mistral', endpoint: 'https://api.mistral.ai/v1', cloud: true },
  {
    id: 'qwen',
    name: 'Qwen',
    endpoint: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
    cloud: true,
  },
  { id: 'openrouter', name: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1', cloud: true },
  {
    id: 'compatible',
    name: 'OpenAI-compatible API',
    endpoint: 'http://127.0.0.1:8080/v1',
    cloud: true,
    optionalKey: true,
  },
];
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
  if (url.username || url.password || !['http:', 'https:'].includes(url.protocol) ||
    (providerInfo(settings.provider).cloud && url.protocol !== 'https:' && !(settings.provider === 'compatible' && local)))
    throw Error('API providers require HTTPS; local compatible endpoints may use HTTP on loopback');
  return url;
}
export class InferenceCredentials {
  constructor(store, safeStorage, platform = process.platform) {
    this.store = store;
    this.safeStorage = safeStorage;
    this.platform = platform;
    this.entries = new Map();
  }
  credentials(settings) {
    const info = providerInfo(settings.provider);
    if (!info.cloud) return null;
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
    return (
      this.credentials(settings)?.info() ?? {
        configured: false,
        storage: 'none',
        persistentAvailable: false,
      }
    );
  }
  save(settings, key) {
    const entry = this.credentials(settings);
    if (!entry) throw new Error('Local providers do not use an API key');
    return entry.save(key);
  }
  forget(settings) {
    return this.credentials(settings)?.forget();
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
