const FILES = 'abcdefgh';

function squareToCoords(square) {
  if (!/^[a-h][1-8]$/.test(square)) throw new Error(`Invalid square: ${square}`);
  return {
    file: FILES.indexOf(square[0]),
    rank: Number(square[1]) - 1,
  };
}

function coordsToSquare(file, rank) {
  return `${FILES[file]}${rank + 1}`;
}

function parseBoard(boardPart) {
  const board = new Map();
  const ranks = boardPart.split('/');
  if (ranks.length !== 8) throw new Error('Invalid FEN board: expected 8 ranks.');

  ranks.forEach((rankText, fenRankIndex) => {
    let file = 0;
    const rank = 7 - fenRankIndex;
    for (const char of rankText) {
      if (/\d/.test(char)) {
        file += Number(char);
      } else {
        if (!/[prnbqkPRNBQK]/.test(char) || file > 7) throw new Error('Invalid FEN board.');
        board.set(coordsToSquare(file, rank), char);
        file += 1;
      }
    }
    if (file !== 8) throw new Error('Invalid FEN board rank width.');
  });

  return board;
}

function serializeBoard(board) {
  const ranks = [];
  for (let rank = 7; rank >= 0; rank -= 1) {
    let text = '';
    let empty = 0;
    for (let file = 0; file < 8; file += 1) {
      const piece = board.get(coordsToSquare(file, rank));
      if (!piece) {
        empty += 1;
      } else {
        if (empty) text += String(empty);
        text += piece;
        empty = 0;
      }
    }
    if (empty) text += String(empty);
    ranks.push(text);
  }
  return ranks.join('/');
}

function pieceColor(piece) {
  return piece === piece.toUpperCase() ? 'w' : 'b';
}

function removeCastlingRight(rights, chars) {
  let next = rights;
  for (const char of chars) next = next.replace(char, '');
  return next;
}

export function applyUciMoveToFen(fen, uciMove) {
  const parts = String(fen).trim().split(/\s+/);
  if (parts.length !== 6) throw new Error('Invalid FEN: expected 6 fields.');

  const [boardPart, turn, rawCastling, enPassant, rawHalfmove, rawFullmove] = parts;
  const match = String(uciMove).trim().match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/);
  if (!match) throw new Error(`Invalid UCI move: ${uciMove}`);

  const [, from, to, promotion] = match;
  const board = parseBoard(boardPart);
  const piece = board.get(from);
  if (!piece) throw new Error(`No piece on source square ${from}.`);
  if (pieceColor(piece) !== turn) throw new Error(`Piece on ${from} does not belong to side to move.`);

  const targetPiece = board.get(to);
  if (targetPiece && pieceColor(targetPiece) === turn) {
    throw new Error(`Destination ${to} is occupied by the moving side.`);
  }

  let capture = Boolean(targetPiece);
  let castling = rawCastling === '-' ? '' : rawCastling;
  const isPawn = piece.toLowerCase() === 'p';
  const fromCoords = squareToCoords(from);
  const toCoords = squareToCoords(to);

  if (isPawn && to === enPassant && !targetPiece && fromCoords.file !== toCoords.file) {
    const capturedRank = toCoords.rank + (turn === 'w' ? -1 : 1);
    const capturedSquare = coordsToSquare(toCoords.file, capturedRank);
    const capturedPiece = board.get(capturedSquare);
    if (!capturedPiece || capturedPiece.toLowerCase() !== 'p' || pieceColor(capturedPiece) === turn) {
      throw new Error('Invalid en passant capture.');
    }
    board.delete(capturedSquare);
    capture = true;
  }

  board.delete(from);

  let placedPiece = piece;
  if (promotion) {
    if (!isPawn || ![0, 7].includes(toCoords.rank)) throw new Error('Invalid promotion move.');
    placedPiece = turn === 'w' ? promotion.toUpperCase() : promotion.toLowerCase();
  }
  board.set(to, placedPiece);

  if (piece.toLowerCase() === 'k' && Math.abs(toCoords.file - fromCoords.file) === 2) {
    const rank = turn === 'w' ? 0 : 7;
    const kingSide = toCoords.file === 6;
    const rookFrom = coordsToSquare(kingSide ? 7 : 0, rank);
    const rookTo = coordsToSquare(kingSide ? 5 : 3, rank);
    const rook = board.get(rookFrom);
    if (!rook || rook.toLowerCase() !== 'r' || pieceColor(rook) !== turn) {
      throw new Error('Invalid castling move: rook missing.');
    }
    board.delete(rookFrom);
    board.set(rookTo, rook);
  }

  if (piece === 'K') castling = removeCastlingRight(castling, 'KQ');
  if (piece === 'k') castling = removeCastlingRight(castling, 'kq');
  if (from === 'h1' || to === 'h1') castling = removeCastlingRight(castling, 'K');
  if (from === 'a1' || to === 'a1') castling = removeCastlingRight(castling, 'Q');
  if (from === 'h8' || to === 'h8') castling = removeCastlingRight(castling, 'k');
  if (from === 'a8' || to === 'a8') castling = removeCastlingRight(castling, 'q');

  let nextEnPassant = '-';
  if (isPawn && Math.abs(toCoords.rank - fromCoords.rank) === 2) {
    nextEnPassant = coordsToSquare(fromCoords.file, (fromCoords.rank + toCoords.rank) / 2);
  }

  const halfmove = isPawn || capture ? 0 : Number.parseInt(rawHalfmove, 10) + 1;
  const fullmove = Number.parseInt(rawFullmove, 10) + (turn === 'b' ? 1 : 0);
  const nextTurn = turn === 'w' ? 'b' : 'w';

  return `${serializeBoard(board)} ${nextTurn} ${castling || '-'} ${nextEnPassant} ${halfmove} ${fullmove}`;
}

export function getFenTurn(fen) {
  const turn = String(fen).trim().split(/\s+/)[1];
  if (turn !== 'w' && turn !== 'b') throw new Error('Invalid FEN active color.');
  return turn;
}
