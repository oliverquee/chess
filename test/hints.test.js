import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkBlunderCandidate,
  generateHint,
  getNullMoveFen,
  getTier1Hint,
  getTier2Hint,
  getTier3Hint,
  parseFenBoard,
} from '../engine/hints.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const HANGING_KNIGHT_FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3';

test('getNullMoveFen generates valid opponent-turn FEN with cleared en-passant', () => {
  const whiteTurnFen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e3 0 1';
  const blackTurnFen = getNullMoveFen(whiteTurnFen);
  assert.equal(blackTurnFen, 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 1 1');

  const blackTurnFen2 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e6 0 1';
  const whiteTurnFen2 = getNullMoveFen(blackTurnFen2);
  assert.equal(whiteTurnFen2, 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 1 1');
});

test('parseFenBoard parses 8x8 squares and active color correctly', () => {
  const parsed = parseFenBoard(START_FEN);
  assert.equal(parsed.activeColor, 'black');
  assert.equal(parsed.board[0][4], 'k'); // e8
  assert.equal(parsed.board[7][4], 'K'); // e1
  assert.equal(parsed.board[4][4], 'P'); // e4
  assert.equal(parsed.board[3][3], null); // d5 is empty
});

test('Tier 1, Tier 2, and Tier 3 progressive hints return actionable guidance', async () => {
  const mockEngine = {
    async analyzePosition(fen) {
      if (fen.includes(' b ')) {
        // Black's turn or null move: threaten knight capture
        return { bestMove: 'c6d4', evalCp: -150, principalVariation: ['c6d4'] };
      }
      return { bestMove: 'c4f7', evalCp: 250, principalVariation: ['c4f7', 'e8f7'] };
    },
  };

  // Tier 1
  const t1 = await getTier1Hint(HANGING_KNIGHT_FEN, mockEngine);
  assert.equal(t1.tier, 'warm');
  assert.ok(t1.message.length > 0);

  // Tier 2 (Null move threat)
  const t2 = await getTier2Hint(HANGING_KNIGHT_FEN, mockEngine);
  assert.equal(t2.tier, 'warmer');
  assert.ok(t2.message.includes('Opponent Threat') || t2.message.length > 0);

  // Tier 3 (Best move nudge)
  const t3 = await getTier3Hint(HANGING_KNIGHT_FEN, mockEngine);
  assert.equal(t3.tier, 'hot');
  assert.equal(t3.bestMove, 'c6d4');
  assert.equal(t3.fromSquare, 'c6');
  assert.equal(t3.toSquare, 'd4');
  assert.match(t3.message, /c6/);

  // Dispatcher
  const dispatched = await generateHint(HANGING_KNIGHT_FEN, 'hot', mockEngine);
  assert.equal(dispatched.tier, 'hot');
});

test('checkBlunderCandidate identifies major eval drops and mate blunders', async () => {
  const WHITE_START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  let callCount = 0;
  const mockEngine = {
    async analyzePosition(fen) {
      callCount += 1;
      // First call is fenBefore (+100 cp for White)
      if (callCount === 1) return { bestMove: 'e2e4', evalCp: 100, isMateScore: false };
      // Second call is fenAfter blunder (-250 cp) -> loss = 350 cp!
      return { bestMove: 'e7e5', evalCp: -250, isMateScore: false };
    },
  };

  const blunderCheck = await checkBlunderCandidate(WHITE_START_FEN, 'g2g4', mockEngine);
  assert.equal(blunderCheck.isBlunder, true);
  assert.ok(blunderCheck.evalDelta >= 200);
  assert.match(blunderCheck.message, /Blunder Warning/);

  // Non-blunder
  callCount = 0;
  const goodEngine = {
    async analyzePosition() {
      callCount += 1;
      if (callCount === 1) return { bestMove: 'e2e4', evalCp: 50 };
      return { bestMove: 'e7e5', evalCp: 40 }; // 10 cp loss -> not a blunder
    },
  };

  const goodCheck = await checkBlunderCandidate(WHITE_START_FEN, 'e2e4', goodEngine);
  assert.equal(goodCheck.isBlunder, false);
  assert.equal(goodCheck.message, null);
});

