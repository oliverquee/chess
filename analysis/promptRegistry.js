import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const DEFINITIONS = Object.freeze({
  move: { file: 'per-move-classification.v1.md', version: 'move-v1' },
  ranking: { file: 'weakness-ranking.v1.md', version: 'ranking-v1' },
  progress: { file: 'progress-review.v1.md', version: 'progress-v1' },
});

export function loadPrompt(name) {
  const definition = DEFINITIONS[name];
  if (!definition) throw new RangeError(`Unknown prompt: ${name}`);
  const text = readFileSync(new URL(`../prompts/${definition.file}`, import.meta.url), 'utf8');
  return Object.freeze({
    name,
    version: definition.version,
    file: definition.file,
    text,
    hash: createHash('sha256').update(text).digest('hex'),
  });
}
