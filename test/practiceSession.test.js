import test from 'node:test';
import assert from 'node:assert/strict';
import { computeEvalDelta } from '../engine/eval.js';
import { getMotifReadyFen, PracticeSession } from '../engine/practiceSession.js';

const RAW_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const MOTIF_READY_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

test('seeded practice applies Moves[0], then allows free play with analysis-ready logs', async () => {
  const analyses = [
    { bestMove: 'e7e5', evalCp: 30, isMateScore: false, principalVariation: ['e7e5', 'g1f3'] },
    { bestMove: 'g1f3', evalCp: -10, isMateScore: false, principalVariation: ['g1f3', 'b8c6'] },
    { bestMove: 'g1f3', evalCp: 5, isMateScore: false, principalVariation: ['g1f3', 'b8c6'] },
  ];
  const engine = {
    async analyzePosition() {
      return analyses.shift();
    },
    async playMove() {
      return 'g1f3';
    },
  };

  const session = new PracticeSession({
    puzzle: {
      PuzzleId: 'seed-1',
      FEN: RAW_FEN,
      Moves: 'e2e4 e7e5 g1f3',
      weaknessCategory: 'tactical',
    },
    engine,
    gameId: 'game-1',
    now: () => '2026-08-15T08:30:00.000Z',
  });

  // c7c5 differs from the remaining exported solution move e7e5, proving the
  // solution is reference evidence rather than a forced line.
  const turn = await session.playTurn('c7c5');

  assert.equal(session.startFen, MOTIF_READY_FEN);
  assert.equal(turn.playerLog.fen_before, MOTIF_READY_FEN);
  assert.equal(turn.playerLog.move_played, 'c7c5');
  assert.equal(turn.playerLog.best_move, 'e7e5');
  assert.equal(turn.playerLog.principal_variation, 'e7e5 g1f3');
  assert.equal(turn.playerLog.eval_cp_before, 30);
  assert.equal(turn.playerLog.eval_cp_after, -10);
  assert.equal(computeEvalDelta(turn.playerLog), -20);
  assert.equal(turn.playerLog.stockfish_response, 'g1f3');

  assert.equal(turn.engineLog.move_played, 'g1f3');
  assert.equal(turn.engineLog.best_move, 'g1f3');
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
    'rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2',
  );
});

test('motif-ready startup fails explicitly when setup move is missing or illegal', () => {
  assert.throws(
    () => getMotifReadyFen({ FEN: RAW_FEN, Moves: '' }),
    /Moves\[0\] setup move is required/,
  );
  assert.throws(
    () => getMotifReadyFen({ FEN: RAW_FEN, Moves: 'e2e5 e7e5' }),
    /Illegal UCI move/,
  );
});

test('failed engine response leaves the entire practice turn uncommitted', async () => {
  const session = new PracticeSession({
    puzzle: { PuzzleId: 'seed-atomic', FEN: RAW_FEN, Moves: 'e2e4 e7e5' },
    engine: {
      async analyzePosition() {
        return { bestMove: 'e7e5', evalCp: 0, isMateScore: false, principalVariation: ['e7e5'] };
      },
      async playMove() {
        throw new Error('worker stopped');
      },
    },
    gameId: 'game-atomic',
  });

  await assert.rejects(() => session.playTurn('c7c5'), /worker stopped/);
  assert.equal(session.currentFen, MOTIF_READY_FEN);
  assert.deepEqual(session.logs, []);
});
