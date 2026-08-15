import test from 'node:test';
import assert from 'node:assert/strict';
import { PracticeSession } from '../engine/practiceSession.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

test('seeded practice session starts from puzzle FEN and produces move-table-shaped logs', async () => {
  const engineMoves = ['e7e5', 'b8c6'];
  let evalCounter = 0;
  const engine = {
    async analyzePosition() {
      evalCounter += 1;
      return { bestMove: 'e2e4', evalCp: evalCounter * 10, principalVariation: ['e2e4'] };
    },
    async playMove() {
      return engineMoves.shift() ?? null;
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
  assert.equal(turn.playerLog.stockfish_response, 'e7e5');
  assert.equal(turn.engineLog.move_played, 'e7e5');
  assert.equal(session.logs.length, 2);

  for (const [index, log] of session.logs.entries()) {
    assert.equal(log.game_id, 'game-1');
    assert.equal(log.ply_number, index + 1);
    assert.equal(typeof log.fen_before, 'string');
    assert.equal(typeof log.move_played, 'string');
    assert.equal(typeof log.eval_cp, 'number');
    assert.equal(log.timestamp, '2026-08-15T08:30:00.000Z');
  }

  assert.equal(
    session.currentFen,
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
  );
});
