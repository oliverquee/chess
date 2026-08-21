import { applyUciMoveToFen } from './fen.js';

const PIECE_NAMES = Object.freeze({
  p: 'Pawn',
  n: 'Knight',
  b: 'Bishop',
  r: 'Rook',
  q: 'Queen',
  k: 'King',
});

const PIECE_VALUES = Object.freeze({
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
});

export function parseFenBoard(fen) {
  const parts = String(fen).trim().split(/\s+/);
  const rows = parts[0].split('/');
  const board = [];

  for (let r = 0; r < 8; r += 1) {
    const row = [];
    for (const char of rows[r]) {
      if (/\d/.test(char)) {
        const count = Number.parseInt(char, 10);
        for (let i = 0; i < count; i += 1) row.push(null);
      } else {
        row.push(char);
      }
    }
    board.push(row);
  }

  const activeColor = parts[1] === 'b' ? 'black' : 'white';
  return { board, activeColor, fullFen: fen };
}

export function squareToCoords(square) {
  if (!square || square.length < 2) return null;
  const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = 8 - Number.parseInt(square[1], 10);
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return { row: rank, col: file };
}

export function coordsToSquare(row, col) {
  const file = String.fromCharCode('a'.charCodeAt(0) + col);
  const rank = 8 - row;
  return `${file}${rank}`;
}

export function getPieceAt(board, square) {
  const coords = squareToCoords(square);
  if (!coords) return null;
  return board[coords.row][coords.col];
}

/**
 * Creates a null-move FEN giving the opposing player a free turn.
 */
export function getNullMoveFen(fen) {
  const parts = String(fen).trim().split(/\s+/);
  if (parts.length < 2) return fen;

  const currentTurn = parts[1];
  const nextTurn = currentTurn === 'w' ? 'b' : 'w';
  const castling = parts[2] || '-';
  const enPassant = '-'; // Null move cancels any en-passant square
  const halfMoves = parts[4] !== undefined && !Number.isNaN(Number.parseInt(parts[4], 10))
    ? String(Number.parseInt(parts[4], 10) + 1)
    : '0';
  const fullMoves = parts[5] || '1';

  return `${parts[0]} ${nextTurn} ${castling} ${enPassant} ${halfMoves} ${fullMoves}`;
}

/**
 * Tier 1 (Warm): Static / Hanging Piece Assessment
 */
export async function getTier1Hint(fen, engine) {
  const { board, activeColor } = parseFenBoard(fen);
  const analysis = await engine.analyzePosition(fen, 8);
  const bestMove = analysis?.bestMove;

  // If best move is a capture, highlight the piece being attacked/captured
  if (bestMove && bestMove.length >= 4) {
    const fromSquare = bestMove.slice(0, 2);
    const toSquare = bestMove.slice(2, 4);
    const targetPiece = getPieceAt(board, toSquare);
    const attackingPiece = getPieceAt(board, fromSquare);

    if (targetPiece) {
      const pieceName = PIECE_NAMES[targetPiece.toLowerCase()] || 'piece';
      return {
        tier: 'warm',
        type: 'tactical_target',
        square: toSquare,
        message: `Look at the ${pieceName} on ${toSquare}. There is tactical tension around that square.`,
      };
    }
  }

  // Fallback: general awareness
  return {
    tier: 'warm',
    type: 'board_awareness',
    message: `Scan for undefended pieces and checks. Where can your pieces improve their activity?`,
  };
}

/**
 * Tier 2 (Warmer): Null-Move Threat Detection
 */
export async function getTier2Hint(fen, engine) {
  const nullFen = getNullMoveFen(fen);
  let threatMove = null;

  try {
    const threatAnalysis = await engine.analyzePosition(nullFen, 8);
    threatMove = threatAnalysis?.bestMove;
  } catch {
    // If null move fails (e.g. king in check), fallback to regular analysis
  }

  if (threatMove && threatMove.length >= 4) {
    const fromSquare = threatMove.slice(0, 2);
    const toSquare = threatMove.slice(2, 4);
    const { board } = parseFenBoard(fen);
    const opponentPiece = getPieceAt(board, fromSquare);
    const pieceName = opponentPiece ? (PIECE_NAMES[opponentPiece.toLowerCase()] || 'piece') : 'opponent piece';

    return {
      tier: 'warmer',
      type: 'opponent_threat',
      threatMove,
      fromSquare,
      toSquare,
      message: `Opponent Threat: If you make a passive move, opponent could play ${pieceName} to ${toSquare}!`,
    };
  }

  return {
    tier: 'warmer',
    type: 'opponent_threat',
    message: `Watch out for opponent's central breaks and attacks toward your position.`,
  };
}

/**
 * Tier 3 (Hot): Best-Move Nudge
 */
export async function getTier3Hint(fen, engine) {
  const analysis = await engine.analyzePosition(fen, 12);
  const bestMove = analysis?.bestMove;

  if (bestMove && bestMove.length >= 4) {
    const fromSquare = bestMove.slice(0, 2);
    const toSquare = bestMove.slice(2, 4);
    const { board } = parseFenBoard(fen);
    const piece = getPieceAt(board, fromSquare);
    const pieceName = piece ? (PIECE_NAMES[piece.toLowerCase()] || 'piece') : 'piece';

    return {
      tier: 'hot',
      type: 'best_move_nudge',
      bestMove,
      fromSquare,
      toSquare,
      message: `Key Move: Consider moving your ${pieceName} from ${fromSquare} toward ${toSquare}.`,
    };
  }

  return {
    tier: 'hot',
    type: 'best_move_nudge',
    message: `Look for the most active and forcing move in the current position.`,
  };
}

/**
 * Master hint dispatcher for any requested tier.
 */
export async function generateHint(fen, tier, engine) {
  switch (tier) {
    case 'warm':
      return getTier1Hint(fen, engine);
    case 'warmer':
      return getTier2Hint(fen, engine);
    case 'hot':
      return getTier3Hint(fen, engine);
    default:
      throw new RangeError(`Unknown hint tier: ${tier}. Expected 'warm', 'warmer', or 'hot'.`);
  }
}

/**
 * Blunder Confirmation Gate
 * Checks whether a proposed player move loses 200+ centipawns or allows mate.
 */
export async function checkBlunderCandidate(fenBefore, proposedMove, engine) {
  if (!fenBefore || !proposedMove || !engine) {
    return { isBlunder: false, evalDelta: 0 };
  }

  const { activeColor } = parseFenBoard(fenBefore);
  const beforeAnalysis = await engine.analyzePosition(fenBefore, 10);
  const fenAfter = applyUciMoveToFen(fenBefore, proposedMove);
  const afterAnalysis = await engine.analyzePosition(fenAfter, 10);

  const evalBefore = beforeAnalysis?.evalCp ?? 0;
  const evalAfter = afterAnalysis?.evalCp ?? 0;

  let loss = 0;
  if (activeColor === 'white') {
    loss = evalBefore - evalAfter;
  } else {
    loss = evalAfter - evalBefore;
  }

  const allowedMate = Boolean(afterAnalysis?.isMateScore && (
    (activeColor === 'white' && evalAfter < 0) ||
    (activeColor === 'black' && evalAfter > 0)
  ));

  const isBlunder = Boolean(loss >= 200 || allowedMate);

  return {
    isBlunder,
    evalDelta: loss,
    evalBefore,
    evalAfter,
    bestMove: beforeAnalysis?.bestMove ?? null,
    message: isBlunder
      ? `Blunder Warning: This move drops ${loss >= 200 ? Math.round(loss / 100) + ' pawns' : 'the game'}!`
      : null,
  };
}

