import test from 'node:test';
import assert from 'node:assert/strict';
import { applyUciMoveToFen } from '../engine/fen.js';

test('applies castling with rook movement and castling-right updates', () => {
  const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  assert.equal(
    applyUciMoveToFen(fen, 'e1g1'),
    'r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1',
  );
});

test('applies en-passant captures correctly', () => {
  const fen = '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1';
  assert.equal(
    applyUciMoveToFen(fen, 'e5d6'),
    '4k3/8/3P4/8/8/8/8/4K3 b - - 0 1',
  );
});

test('applies UCI promotion moves correctly', () => {
  const fen = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';
  assert.equal(
    applyUciMoveToFen(fen, 'a7a8q'),
    'Q3k3/8/8/8/8/8/8/4K3 b - - 0 1',
  );
});

test('rejects illegal UCI moves instead of mutating FEN manually', () => {
  const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  assert.throws(() => applyUciMoveToFen(fen, 'e2e5'), /Illegal UCI move/);
});
