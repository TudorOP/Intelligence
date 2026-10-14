export class SearchCredentials {
  constructor(store, safeStorage, platform = process.platform, namespace = 'brave') {
    this.store = store;
    this.safeStorage = safeStorage;
    this.platform = platform;
    this.session = '';
    this.cached = null;
    this.namespace = namespace;
  }
  persistentAvailable() {
    try {
      return (
        this.safeStorage.isEncryptionAvailable() &&
        (this.platform !== 'linux' ||
          !['basic_text', 'unknown'].includes(this.safeStorage.getSelectedStorageBackend()))
      );
    } catch {
      return false;
    }
  }
  get() {
    if (this.session) return this.session;
    if (this.cached !== null) return this.cached;
    const encrypted = this.store.db
      .prepare('SELECT value FROM search_credentials WHERE provider=?')
      .get(this.namespace);
    if (!encrypted || !this.persistentAvailable()) return '';
    try {
      this.cached = this.safeStorage.decryptString(Buffer.from(encrypted.value));
      return this.cached;
    } catch {
      return '';
    }
  }
  info() {
    return {
      configured: !!this.get(),
      storage: this.session ? 'session' : 'keyring',
      persistentAvailable: this.persistentAvailable(),
    };
  }
  save(key) {
    if (typeof key !== 'string' || !key.trim() || key.length > 4096 || /[\r\n\u0000]/.test(key))
      throw new Error('Enter a valid API key');
    key = key.trim();
    if (this.persistentAvailable()) {
      const encrypted = this.safeStorage.encryptString(key);
      this.store.db
        .prepare('INSERT OR REPLACE INTO search_credentials VALUES(?,?)')
        .run(this.namespace, encrypted);
      this.session = '';
      this.cached = key;
    } else {
      this.store.db.prepare('DELETE FROM search_credentials WHERE provider=?').run(this.namespace);
      this.session = key;
      this.cached = null;
    }
    return this.info();
  }
  forget() {
    this.store.db.prepare('DELETE FROM search_credentials WHERE provider=?').run(this.namespace);
    this.session = '';
    this.cached = null;
    return this.info();
  }
}
