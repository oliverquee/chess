export class BackendUnavailableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'BackendUnavailableError';
  }
}

function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string.`);
  return value.trim();
}

async function requestJson(fetchImpl, url, options, timeoutMs) {
  let response;
  try {
    response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new BackendUnavailableError(`Request failed: ${error.message}`, { cause: error });
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new BackendUnavailableError(`HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
  try {
    return await response.json();
  } catch (error) {
    throw new BackendUnavailableError(`Backend returned non-JSON transport data: ${error.message}`, { cause: error });
  }
}

function userText(input, validationFeedback) {
  const payload = `INPUT JSON:\n${JSON.stringify(input)}`;
  return validationFeedback ? `${payload}\n\n${validationFeedback}` : payload;
}

export class ClaudeBackend {
  constructor({ apiKey, model, fetchImpl = fetch, timeoutMs = 60000, endpoint = 'https://api.anthropic.com/v1/messages' }) {
    this.apiKey = required(apiKey, 'apiKey');
    this.model = required(model, 'model');
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.endpoint = endpoint;
    this.name = 'claude';
  }

  async generate({ prompt, input, validationFeedback }) {
    const data = await requestJson(this.fetchImpl, this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        temperature: 0,
        system: prompt,
        messages: [{ role: 'user', content: userText(input, validationFeedback) }],
      }),
    }, this.timeoutMs);
    const text = data.content?.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
    if (!text) throw new BackendUnavailableError('Claude response contained no text block.');
    return text;
  }
}

export class OllamaBackend {
  constructor({ model, fetchImpl = fetch, timeoutMs = 120000, endpoint = 'http://127.0.0.1:11434/api/generate' }) {
    this.model = required(model, 'model');
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.endpoint = endpoint;
    this.name = 'ollama';
  }

  async generate({ prompt, input, validationFeedback }) {
    const data = await requestJson(this.fetchImpl, this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        system: prompt,
        prompt: userText(input, validationFeedback),
        format: 'json',
        stream: false,
        options: { temperature: 0 },
      }),
    }, this.timeoutMs);
    if (typeof data.response !== 'string' || !data.response.trim()) {
      throw new BackendUnavailableError('Ollama response contained no generated text.');
    }
    return data.response;
  }
}
