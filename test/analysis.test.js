import test from 'node:test';
import assert from 'node:assert/strict';
import { AnalysisService } from '../analysis/service.js';
import { loadPrompt } from '../analysis/promptRegistry.js';
import {
  validateMoveClassification,
  validateProgressReview,
  validateWeaknessRanking,
} from '../analysis/schemas.js';
import { parseModelJson, runStructuredAnalysis } from '../analysis/structuredRunner.js';
import {
  getGameById,
  getMoveClassifications,
  getWeaknessTally,
  initDb,
  saveGameSession,
  saveMoveClassification,
} from '../storage/db.js';

const NOW = '2026-08-15T14:00:00.000Z';
const FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

class QueueBackend {
  constructor(responses, { name = 'ollama', model = 'test-model' } = {}) {
    this.responses = [...responses];
    this.requests = [];
    this.name = name;
    this.model = model;
  }

  async generate(request) {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response instanceof Error) throw response;
    return response;
  }
}

function storedGame(db, id = 'analysis-game') {
  saveGameSession(db, {
    id,
    mode: 'practice',
    result: '*',
    start_fen: FEN,
    current_fen: FEN,
    moves: [{
      game_id: id,
      ply_number: 1,
      fen_before: FEN,
      move_played: 'c7c5',
      eval_cp_before: 80,
      eval_cp_after: 20,
      best_move: 'e7e5',
      principal_variation: 'e7e5 g1f3',
      is_mate_score: 0,
      stockfish_response: null,
      timestamp: NOW,
    }],
  });
  return getGameById(db, id);
}

test('versioned prompt files are distinct and hash-addressed', () => {
  const prompts = ['move', 'ranking', 'progress'].map(loadPrompt);
  assert.deepEqual(prompts.map((prompt) => prompt.version), ['move-v1', 'ranking-v1', 'progress-v1']);
  assert.equal(new Set(prompts.map((prompt) => prompt.hash)).size, 3);
  prompts.forEach((prompt) => assert.match(prompt.hash, /^[a-f0-9]{64}$/));
});

test('valid and fenced JSON are recoverable', () => {
  const valid = { category: 'tactical', severity: 'high', rationale: 'Lost a piece.' };
  assert.deepEqual(validateMoveClassification(parseModelJson(JSON.stringify(valid))), valid);
  assert.deepEqual(parseModelJson(`Here is the result:\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``), valid);
});

for (const [name, bad] of [
  ['malformed JSON', '{"category":'],
  ['invalid category', '{"category":"opening","severity":"low","rationale":"x"}'],
  ['missing severity', '{"category":"tactical","rationale":"x"}'],
  ['prose-only response', 'This was a tactical mistake.'],
]) {
  test(`${name} is rejected, receives feedback, and succeeds only after a valid retry`, async () => {
    const backend = new QueueBackend([
      bad,
      '{"category":"tactical","severity":"medium","rationale":"Missed a fork."}',
    ]);
    const result = await runStructuredAnalysis({
      backend,
      prompt: loadPrompt('move'),
      input: { fen_before: FEN },
      validate: validateMoveClassification,
      now: () => NOW,
    });
    assert.equal(result.status, 'classified');
    assert.equal(result.attempts, 2);
    assert.match(backend.requests[1].validationFeedback, /Validation failed/);
  });
}

test('a second invalid response becomes unclassified and preserves provenance', async () => {
  const backend = new QueueBackend(['not json', '{"category":"invented"}']);
  const result = await runStructuredAnalysis({
    backend,
    prompt: loadPrompt('move'),
    input: {},
    validate: validateMoveClassification,
    now: () => NOW,
  });
  assert.equal(result.status, 'unclassified');
  assert.equal(result.attempts, 2);
  assert.equal(result.value, null);
  assert.deepEqual(result.provenance, {
    model_used: 'test-model',
    backend: 'ollama',
    prompt_version: 'move-v1',
    prompt_hash: loadPrompt('move').hash,
    analysis_timestamp: NOW,
  });
});

test('backend unavailable becomes unclassified without a fake retry', async () => {
  const backend = new QueueBackend([new Error('connection refused')]);
  const result = await runStructuredAnalysis({
    backend,
    prompt: loadPrompt('move'),
    input: {},
    validate: validateMoveClassification,
    now: () => NOW,
  });
  assert.equal(result.status, 'unclassified');
  assert.equal(result.attempts, 1);
  assert.match(result.error, /Backend unavailable: connection refused/);
});

test('ranking rejects invented puzzles and progress accepts only fixed trends', () => {
  assert.throws(
    () => validateWeaknessRanking({
      ranked_weaknesses: [{ category: 'tactical', evidence_count: 2 }],
      selected_puzzle_ids: ['invented'],
    }, { eligiblePuzzleIds: ['real'] }),
    /ineligible puzzle/,
  );
  assert.throws(
    () => validateWeaknessRanking({
      ranked_weaknesses: [{ category: 'tactical', evidence_count: 99 }],
      selected_puzzle_ids: ['real'],
    }, { eligiblePuzzleIds: ['real'], evidenceCounts: { tactical: 2 } }),
    /must equal supplied evidence count 2/,
  );
  assert.deepEqual(validateProgressReview({
    categories: [{ category: 'tactical', trend: 'improved', evidence: '2 errors became 1.' }],
  }), {
    categories: [{ category: 'tactical', trend: 'improved', evidence: '2 errors became 1.' }],
  });
});

test('ranking and progress prompts run through the shared validated backend abstraction', async () => {
  const backend = new QueueBackend([
    '{"ranked_weaknesses":[{"category":"tactical","evidence_count":2}],"selected_puzzle_ids":["puzzle-1"]}',
    '{"categories":[{"category":"tactical","trend":"improved","evidence":"Errors decreased from 2 to 1."}]}',
  ]);
  const service = new AnalysisService({ backend, now: () => NOW });
  const ranking = await service.rankWeaknesses({
    classifications: [{ category: 'tactical' }, { value: { category: 'tactical' } }],
    eligiblePuzzles: [{ PuzzleId: 'puzzle-1', Themes: ['fork'] }],
  });
  assert.equal(ranking.status, 'classified');
  assert.deepEqual(ranking.value.selected_puzzle_ids, ['puzzle-1']);

  const progress = await service.reviewProgress({
    before: { tactical: 2 },
    after: { tactical: 1 },
  });
  assert.equal(progress.status, 'classified');
  assert.equal(progress.value.categories[0].trend, 'improved');
  assert.equal(backend.requests[0].prompt, loadPrompt('ranking').text);
  assert.equal(backend.requests[1].prompt, loadPrompt('progress').text);
});

test('classification history preserves model provenance while tallies use only the current result', () => {
  const db = initDb(':memory:');
  try {
    const game = storedGame(db, 'provenance-game');
    const moveId = game.moves[0].id;
    const base = {
      status: 'classified',
      attempts: 1,
      error: null,
      provenance: {
        model_used: 'model-v1',
        backend: 'ollama',
        prompt_version: 'move-v1',
        prompt_hash: 'a'.repeat(64),
        analysis_timestamp: NOW,
      },
    };
    saveMoveClassification(db, moveId, {
      ...base,
      value: { category: 'tactical', severity: 'high', rationale: 'First model result.' },
    });
    saveMoveClassification(db, moveId, {
      ...base,
      value: { category: 'king_safety', severity: 'medium', rationale: 'Second model result.' },
      provenance: { ...base.provenance, model_used: 'model-v2', prompt_hash: 'b'.repeat(64) },
    });

    const history = getMoveClassifications(db, moveId);
    assert.deepEqual(history.map((row) => [row.model_used, row.is_current]), [
      ['model-v1', 0],
      ['model-v2', 1],
    ]);
    assert.deepEqual(getWeaknessTally(db), [{ category: 'king_safety', count: 1 }]);
  } finally {
    db.close();
  }
});

test('valid stored-game analysis writes provenance and a fixed-taxonomy tag atomically', async () => {
  const db = initDb(':memory:');
  try {
    const before = storedGame(db);
    const backend = new QueueBackend([
      '{"category":"tactical","severity":"high","rationale":"The move lost material."}',
    ], { name: 'claude', model: 'claude-test' });
    const service = new AnalysisService({ backend, now: () => NOW });
    const outcome = await service.analyzeStoredGame(db, before.id);

    assert.equal(outcome.results[0].status, 'classified');
    const after = getGameById(db, before.id);
    assert.equal(after.status, 'analyzed');
    assert.deepEqual(after.moves, before.moves);
    const [classification] = getMoveClassifications(db, before.moves[0].id, { currentOnly: true });
    assert.equal(classification.category, 'tactical');
    assert.equal(classification.severity, 'high');
    assert.equal(classification.backend, 'claude');
    assert.equal(classification.model_used, 'claude-test');
    assert.equal(classification.prompt_version, 'move-v1');
    assert.match(classification.prompt_hash, /^[a-f0-9]{64}$/);
    assert.equal(classification.analysis_timestamp, NOW);
    assert.deepEqual(
      db.prepare('SELECT category, severity, classification_id FROM weakness_tags').all().map((row) => ({ ...row })),
      [{ category: 'tactical', severity: 'high', classification_id: classification.id }],
    );
    assert.equal(backend.requests[0].input.normalized_eval_delta_cp, -100);
    assert.equal(backend.requests[0].input.game_phase, 'opening');
  } finally {
    db.close();
  }
});

test('backend outage records unclassified while preserving completed-game evidence', async () => {
  const db = initDb(':memory:');
  try {
    const before = storedGame(db, 'outage-game');
    const service = new AnalysisService({
      backend: new QueueBackend([new Error('offline')]),
      now: () => NOW,
    });
    const outcome = await service.analyzeStoredGame(db, before.id);
    assert.equal(outcome.results[0].status, 'unclassified');

    const after = getGameById(db, before.id);
    assert.equal(after.status, 'analyzed');
    assert.deepEqual(after.moves, before.moves);
    const [classification] = getMoveClassifications(db, before.moves[0].id, { currentOnly: true });
    assert.equal(classification.status, 'unclassified');
    assert.equal(classification.category, null);
    assert.equal(classification.severity, null);
    assert.match(classification.error, /offline/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM weakness_tags').get().count, 0);
  } finally {
    db.close();
  }
});
