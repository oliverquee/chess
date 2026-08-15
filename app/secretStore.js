import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class SecretStore {
  constructor({ safeStorage, path }) {
    if (!safeStorage?.isEncryptionAvailable || !safeStorage?.encryptString || !safeStorage?.decryptString) {
      throw new TypeError('safeStorage implementation is required.');
    }
    if (typeof path !== 'string' || !path) throw new TypeError('path must be a non-empty string.');
    this.safeStorage = safeStorage;
    this.path = path;
  }

  assertProtected() {
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('OS-protected secret storage is unavailable.');
    if (this.safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
      throw new Error('Refusing to store a secret with Electron basic_text fallback.');
    }
  }

  readAll() {
    try {
      return JSON.parse(readFileSync(this.path, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw error;
    }
  }

  writeAll(values) {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, JSON.stringify(values), { mode: 0o600 });
    renameSync(temporary, this.path);
  }

  set(name, value) {
    if (typeof name !== 'string' || !name) throw new TypeError('secret name is required.');
    if (typeof value !== 'string' || !value) throw new TypeError('secret value is required.');
    this.assertProtected();
    const values = this.readAll();
    values[name] = this.safeStorage.encryptString(value).toString('base64');
    this.writeAll(values);
  }

  has(name) {
    return Boolean(this.readAll()[name]);
  }

  get(name) {
    this.assertProtected();
    const encrypted = this.readAll()[name];
    return encrypted ? this.safeStorage.decryptString(Buffer.from(encrypted, 'base64')) : null;
  }

  delete(name) {
    const values = this.readAll();
    const existed = Boolean(values[name]);
    delete values[name];
    this.writeAll(values);
    return existed;
  }
}
