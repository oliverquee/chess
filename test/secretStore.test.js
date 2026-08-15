import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SecretStore } from '../app/secretStore.js';

function fakeSafeStorage(backend = 'kwallet6') {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => backend,
    encryptString: (value) => Buffer.from([...Buffer.from(value)].map((byte) => byte ^ 0x5a)),
    decryptString: (value) => Buffer.from([...value].map((byte) => byte ^ 0x5a)).toString(),
  };
}

test('secret store persists only encrypted bytes and supports has/get/delete', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chess-secrets-'));
  const path = join(dir, 'secrets.json');
  try {
    const store = new SecretStore({ safeStorage: fakeSafeStorage(), path });
    store.set('claude_api_key', 'sk-ant-plain-secret');
    assert.equal(store.has('claude_api_key'), true);
    assert.equal(store.get('claude_api_key'), 'sk-ant-plain-secret');
    assert.doesNotMatch(readFileSync(path, 'utf8'), /sk-ant-plain-secret/);
    assert.equal(store.delete('claude_api_key'), true);
    assert.equal(store.has('claude_api_key'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('secret store refuses Electron basic_text fallback', () => {
  const store = new SecretStore({ safeStorage: fakeSafeStorage('basic_text'), path: '/tmp/unused-chess-secret.json' });
  assert.throws(() => store.set('claude_api_key', 'secret'), /Refusing to store/);
});
