import test from 'node:test';
import assert from 'node:assert/strict';
import { computeEvalDelta } from '../engine/eval.js';
import { PracticeSession } from '../engine/practiceSession.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

test('seeded practice session starts from puzzle FEN and produces analysis-ready logs', async () => {
  const analyses = [
    { bestMove: 'e2e4', evalCp: 30, isMateScore: false, principalVariation: ['e2e4', 'e7e5'] },
    { bestMove: 'e7e5', evalCp: -10, isMateScore: false, principalVariation: ['e7e5', 'g1f3'] },
    { bestMove: 'g1f3', evalCp: 5, isMateScore: false, principalVariation: ['g1f3', 'b8c6'] },
  ];
  const engine = {
    async analyzePosition() {
      return analyses.shift();
    },
    async playMove() {
      return 'e7e5';
    },
  };

  const session = new PracticeSession({
    puzzle: { PuzzleId: 'seed-1', FEN: START_FEN, weaknessCategory: 'tactical' },
    engine,
    gameId: 'game-1',
    now: () => '2026-08-15T08:30:00.000Z',
  });

  const turn = await session.playTurn('e2e4');

  assert.equal(session.startFen, START_FEN);
  assert.equal(turn.playerLog.move_played, 'e2e4');
  assert.equal(turn.playerLog.best_move, 'e2e4');
  assert.equal(turn.playerLog.principal_variation, 'e2e4 e7e5');
  assert.equal(turn.playerLog.eval_cp_before, 30);
  assert.equal(turn.playerLog.eval_cp_after, -10);
  assert.equal(computeEvalDelta(turn.playerLog), -20);
  assert.equal(turn.playerLog.stockfish_response, 'e7e5');

  assert.equal(turn.engineLog.move_played, 'e7e5');
  assert.equal(turn.engineLog.best_move, 'e7e5');
  assert.equal(turn.engineLog.eval_cp_before, -10);
  assert.equal(turn.engineLog.eval_cp_after, 5);
  assert.equal(computeEvalDelta(turn.engineLog), 5);
  assert.equal(session.logs.length, 2);

  for (const [index, log] of session.logs.entries()) {
    assert.equal(log.game_id, 'game-1');
    assert.equal(log.ply_number, index + 1);
    assert.equal(typeof log.fen_before, 'string');
    assert.equal(typeof log.move_played, 'string');
    assert.equal(typeof log.eval_cp_before, 'number');
    assert.equal(typeof log.eval_cp_after, 'number');
    assert.equal(typeof log.best_move, 'string');
    assert.equal(typeof log.principal_variation, 'string');
    assert.equal(log.is_mate_score, 0);
    assert.equal(log.timestamp, '2026-08-15T08:30:00.000Z');
  }

  assert.equal(
    session.currentFen,
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
  );
});
