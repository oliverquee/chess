import { Chess } from 'chess.js';

const UCI_MOVE_PATTERN = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;

export function applyUciMoveToFen(fen, uciMove) {
  const normalizedFen = String(fen ?? '').trim();
  const normalizedMove = String(uciMove ?? '').trim();
  const match = normalizedMove.match(UCI_MOVE_PATTERN);

  if (!match) {
    throw new Error(`Invalid UCI move: ${uciMove}`);
  }

  let chess;
  try {
    chess = new Chess(normalizedFen);
  } catch (error) {
    throw new Error(`Invalid FEN: ${error.message}`, { cause: error });
  }

  const [, from, to, promotion] = match;
  const move = promotion ? { from, to, promotion } : { from, to };

  try {
    chess.move(move);
  } catch (error) {
    throw new Error(`Illegal UCI move ${normalizedMove}: ${error.message}`, { cause: error });
  }

  return chess.fen();
}

export function getFenTurn(fen) {
  const turn = String(fen).trim().split(/\s+/)[1];
  if (turn !== 'w' && turn !== 'b') throw new Error('Invalid FEN active color.');
  return turn;
}
