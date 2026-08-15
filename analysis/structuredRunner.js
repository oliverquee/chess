import { SchemaValidationError } from './schemas.js';

export function parseModelJson(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new SchemaValidationError('Model response must be non-empty JSON text.');
  }
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch (rawError) {
    const fenced = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
    if (!fenced) throw new SchemaValidationError(`Malformed JSON: ${rawError.message}`);
    try {
      return JSON.parse(fenced[1].trim());
    } catch (fencedError) {
      throw new SchemaValidationError(`Malformed fenced JSON: ${fencedError.message}`);
    }
  }
}

function provenance(backend, prompt, now) {
  return {
    model_used: backend.model,
    backend: backend.name,
    prompt_version: prompt.version,
    prompt_hash: prompt.hash,
    analysis_timestamp: now(),
  };
}

export async function runStructuredAnalysis({ backend, prompt, input, validate, now = () => new Date().toISOString() }) {
  if (!backend || typeof backend.generate !== 'function') throw new TypeError('backend must provide generate(request).');
  if (!prompt?.text || !prompt?.version || !prompt?.hash) throw new TypeError('prompt metadata is incomplete.');
  if (typeof validate !== 'function') throw new TypeError('validate must be a function.');

  let feedback = null;
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let text;
    try {
      text = await backend.generate({ prompt: prompt.text, input, validationFeedback: feedback });
    } catch (error) {
      return {
        status: 'unclassified',
        value: null,
        attempts: attempt,
        error: `Backend unavailable: ${error.message}`,
        provenance: provenance(backend, prompt, now),
      };
    }

    try {
      const value = validate(parseModelJson(text));
      return {
        status: 'classified',
        value,
        attempts: attempt,
        error: null,
        provenance: provenance(backend, prompt, now),
      };
    } catch (error) {
      lastError = error;
      feedback = `Validation failed: ${error.message}. Return only a corrected JSON object matching the schema.`;
    }
  }

  return {
    status: 'unclassified',
    value: null,
    attempts: 2,
    error: lastError?.message ?? 'Unknown validation failure.',
    provenance: provenance(backend, prompt, now),
  };
}
