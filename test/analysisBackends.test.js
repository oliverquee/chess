import test from 'node:test';
import assert from 'node:assert/strict';
import { BackendUnavailableError, ClaudeBackend, OllamaBackend } from '../analysis/backends.js';

function response(data, { ok = true, status = 200, text = '' } = {}) {
  return {
    ok,
    status,
    async json() { return data; },
    async text() { return text; },
  };
}

test('Claude backend sends the current Messages API shape and returns text', async () => {
  let observed;
  const backend = new ClaudeBackend({
    apiKey: 'secret-key',
    model: 'claude-test',
    fetchImpl: async (url, options) => {
      observed = { url, options };
      return response({ content: [{ type: 'text', text: '{"ok":true}' }] });
    },
  });
  assert.equal(await backend.generate({ prompt: 'system', input: { move: 'e2e4' } }), '{"ok":true}');
  assert.equal(observed.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(observed.options.headers['x-api-key'], 'secret-key');
  assert.equal(observed.options.headers['anthropic-version'], '2023-06-01');
  const body = JSON.parse(observed.options.body);
  assert.equal(body.model, 'claude-test');
  assert.equal(body.system, 'system');
  assert.equal(body.messages[0].role, 'user');
});

test('Ollama backend requests non-streaming JSON output from the local API', async () => {
  let observed;
  const backend = new OllamaBackend({
    model: 'local-test',
    fetchImpl: async (url, options) => {
      observed = { url, options };
      return response({ response: '{"ok":true}' });
    },
  });
  assert.equal(await backend.generate({ prompt: 'system', input: { move: 'e2e4' } }), '{"ok":true}');
  assert.equal(observed.url, 'http://127.0.0.1:11434/api/generate');
  const body = JSON.parse(observed.options.body);
  assert.equal(body.model, 'local-test');
  assert.equal(body.format, 'json');
  assert.equal(body.stream, false);
});

test('HTTP dependency failure is normalized as BackendUnavailableError', async () => {
  const backend = new OllamaBackend({
    model: 'missing',
    fetchImpl: async () => response({}, { ok: false, status: 503, text: 'not running' }),
  });
  await assert.rejects(
    () => backend.generate({ prompt: 'x', input: {} }),
    (error) => error instanceof BackendUnavailableError && /HTTP 503: not running/.test(error.message),
  );
});
