import { Chess } from 'chess.js';
import { saveAnalysisResult } from '../storage/db.js';

const PIECE_VALUES = Object.freeze({
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
});

function median(values) {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values) {
  if (!values || values.length === 0) return 0;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return sum / values.length;
}

function computeLoss(m) {
  const before = m.eval_cp_before;
  const after = m.eval_cp_after;
  if (before === null || after === null || before === undefined || after === undefined) {
    return 0;
  }
  // Eval delta from perspective of side to move: (-after) - before
  const evalDelta = -after - before;
  if (evalDelta < 0) {
    return Math.min(1000, -evalDelta);
  }
  return 0;
}

function isHumanFindable(m) {
  return Boolean(m.best_move && m.best_move_depth8 && m.best_move === m.best_move_depth8);
}

export function parseFenBoard(fen) {
  if (!fen) return {};
  const boardPart = fen.split(' ')[0];
  const board = {};
  const rows = boardPart.split('/');
  for (let r = 0; r < 8; r += 1) {
    const rank = 8 - r;
    let fileIdx = 0;
    for (const char of rows[r]) {
      if (char >= '1' && char <= '8') {
        fileIdx += parseInt(char, 10);
      } else {
        const file = String.fromCharCode('a'.charCodeAt(0) + fileIdx);
        const square = `${file}${rank}`;
        const isWhite = char === char.toUpperCase();
        board[square] = {
          type: char.toLowerCase(),
          color: isWhite ? 'w' : 'b',
        };
        fileIdx += 1;
      }
    }
  }
  return board;
}

function getPlayerMoves(db) {
  return db.prepare(`
    SELECT
      m.id,
      m.game_id,
      m.ply_number,
      m.fen_before,
      m.move_played,
      m.eval_cp_before,
      m.eval_cp_after,
      m.best_move,
      m.best_move_depth8,
      m.is_mate_score,
      m.time_to_move_ms,
      m.clock_remaining_ms,
      g.player_color,
      g.result,
      g.date
    FROM moves m
    JOIN games g ON m.game_id = g.id
    WHERE g.assistance_level = 'none'
      AND m.eval_cp_before IS NOT NULL
      AND m.eval_cp_after IS NOT NULL
      AND (
        (g.player_color = 'white' AND m.ply_number % 2 = 1)
        OR
        (g.player_color = 'black' AND m.ply_number % 2 = 0)
      )
    ORDER BY g.id, m.ply_number ASC
  `).all();
}

function groupMovesByGame(playerMoves) {
  const map = new Map();
  for (const m of playerMoves) {
    if (!map.has(m.game_id)) map.set(m.game_id, []);
    map.get(m.game_id).push(m);
  }
  return map;
}

export function inspectMove(fen, uciMove) {
  if (!fen || !uciMove || uciMove.length < 4) {
    return { isCapture: false, isCheck: false, movingPiece: null, targetPiece: null };
  }
  const board = parseFenBoard(fen);
  const from = uciMove.slice(0, 2);
  const to = uciMove.slice(2, 4);
  const movingPiece = board[from] || null;
  const targetPiece = board[to] || null;

  const isCapture = Boolean(targetPiece || (movingPiece?.type === 'p' && from[0] !== to[0]));

  // Check if move gives check using quick chess check lookup or lightweight move check
  let isCheck = false;
  if (fen.includes('k') || fen.includes('K')) {
    try {
      const chess = new Chess(fen);
      const res = chess.move({ from, to, promotion: uciMove[4] || 'q' });
      if (res) {
        isCheck = chess.inCheck();
      }
    } catch {
      isCheck = false;
    }
  }

  return { isCapture, isCheck, movingPiece, targetPiece };
}

/**
 * 1. Tilt Index Detector
 * Gate: >= 10 blunder events (CPL > 300, human-findable).
 * Computes median CPL of the 5 moves after each blunder vs player's overall median CPL.
 * tiltIndex = postBlunderMedianCpl / baselineMedianCpl. (>1.4 = real tilt signal).
 */
export function detectTiltIndex(db) {
  const playerMoves = getPlayerMoves(db);
  if (playerMoves.length === 0) {
    return { insufficient_data: true, reason: 'No unassisted player moves found', gateRequired: 10, gateObserved: 0 };
  }

  const allLosses = playerMoves.map(computeLoss);
  const baselineMedianCpl = median(allLosses);

  const gameMap = groupMovesByGame(playerMoves);
  const postBlunderLosses = [];
  let blunderEventsCount = 0;

  for (const [_, moves] of gameMap.entries()) {
    for (let i = 0; i < moves.length; i += 1) {
      const cur = moves[i];
      const loss = computeLoss(cur);
      const isBlunder = (loss > 300 || (loss >= 300 && cur.is_mate_score)) && isHumanFindable(cur);

      if (isBlunder) {
        blunderEventsCount += 1;
        // Look at next up to 5 moves in the same game
        for (let nextIdx = i + 1; nextIdx <= Math.min(i + 5, moves.length - 1); nextIdx += 1) {
          postBlunderLosses.push(computeLoss(moves[nextIdx]));
        }
      }
    }
  }

  if (blunderEventsCount < 10) {
    return {
      insufficient_data: true,
      reason: 'Requires at least 10 human-findable blunder events',
      gateRequired: 10,
      gateObserved: blunderEventsCount,
    };
  }

  const postBlunderMedianCpl = median(postBlunderLosses);
  const tiltIndex = baselineMedianCpl > 0
    ? Number((postBlunderMedianCpl / baselineMedianCpl).toFixed(2))
    : Number(postBlunderMedianCpl.toFixed(2));

  return {
    tiltIndex,
    postBlunderMedianCpl: Number(postBlunderMedianCpl.toFixed(1)),
    baselineMedianCpl: Number(baselineMedianCpl.toFixed(1)),
    blunderEventsUsed: blunderEventsCount,
    postBlunderMovesEvaluated: postBlunderLosses.length,
    hasTiltSignal: tiltIndex > 1.4,
  };
}

/**
 * 2. Material Bias Detector
 * Gate: >= 25 sacrifice opportunities.
 * A sacrifice opportunity is a position where best_move is human-findable and results in
 * material sacrifice for the player (movingVal > targetVal or giving up piece for positional/tactical compensation).
 * Returns { sacrificeRejectionRate, opportunitiesCount, rejectionsCount, sacrificesPlayedCount }.
 */
export function detectMaterialBias(db) {
  const playerMoves = getPlayerMoves(db);
  if (playerMoves.length === 0) {
    return { insufficient_data: true, reason: 'No unassisted player moves found', gateRequired: 25, gateObserved: 0 };
  }

  let opportunitiesCount = 0;
  let rejectionsCount = 0;
  let sacrificesPlayedCount = 0;

  for (const m of playerMoves) {
    if (!m.best_move || !m.fen_before || !isHumanFindable(m)) continue;

    const board = parseFenBoard(m.fen_before);
    const from = m.best_move.slice(0, 2);
    const to = m.best_move.slice(2, 4);
    const moving = board[from];
    const target = board[to];

    if (!moving) continue;

    const movingVal = PIECE_VALUES[moving.type] ?? 0;
    const targetVal = target ? (PIECE_VALUES[target.type] ?? 0) : 0;

    // Sacrifice opportunity: minor/major piece move where movingVal > targetVal with active piece exchange / sacrifice
    const isSacrifice = (movingVal > 1 && movingVal > targetVal && (target !== null || (m.eval_cp_before !== null && m.eval_cp_before >= 0)))
      || (movingVal - targetVal >= 2);

    if (isSacrifice) {
      opportunitiesCount += 1;
      if (m.move_played === m.best_move) {
        sacrificesPlayedCount += 1;
      } else {
        rejectionsCount += 1;
      }
    }
  }

  if (opportunitiesCount < 25) {
    return {
      insufficient_data: true,
      reason: 'Requires at least 25 sacrifice opportunities',
      gateRequired: 25,
      gateObserved: opportunitiesCount,
    };
  }

  const sacrificeRejectionRate = Number((rejectionsCount / opportunitiesCount).toFixed(3));

  return {
    sacrificeRejectionRate,
    opportunitiesCount,
    rejectionsCount,
    sacrificesPlayedCount,
    hasMaterialBias: sacrificeRejectionRate > 0.65,
  };
}

/**
 * 3. Plan Fixation Detector
 * Gate: >= 15 runs.
 * A run = 3+ consecutive player moves involving the same piece where cumulative eval drops >100cp.
 * Returns { fixationEventsPerHundredMoves, runsDetected, totalPlayerMoves, totalRunsEvaluated }.
 */
export function detectPlanFixation(db) {
  const playerMoves = getPlayerMoves(db);
  if (playerMoves.length === 0) {
    return { insufficient_data: true, reason: 'No unassisted player moves found', gateRequired: 15, gateObserved: 0 };
  }

  const gameMap = groupMovesByGame(playerMoves);
  let totalRunsEvaluated = 0;
  let runsDetected = 0;

  for (const [_, moves] of gameMap.entries()) {
    for (let i = 2; i < moves.length; i += 1) {
      const m1 = moves[i - 2];
      const m2 = moves[i - 1];
      const m3 = moves[i];

      if (!m1.move_played || !m2.move_played || !m3.move_played) continue;

      const from1 = m1.move_played.slice(0, 2);
      const to1 = m1.move_played.slice(2, 4);
      const from2 = m2.move_played.slice(0, 2);
      const to2 = m2.move_played.slice(2, 4);
      const from3 = m3.move_played.slice(0, 2);

      // Same piece moved 3 consecutive times: to1 === from2 && to2 === from3
      if (to1 === from2 && to2 === from3) {
        totalRunsEvaluated += 1;
        const loss1 = computeLoss(m1);
        const loss2 = computeLoss(m2);
        const loss3 = computeLoss(m3);
        const cumulativeLoss = loss1 + loss2 + loss3;

        if (cumulativeLoss > 100) {
          runsDetected += 1;
        }
      }
    }
  }

  if (totalRunsEvaluated < 15) {
    return {
      insufficient_data: true,
      reason: 'Requires at least 15 three-move piece sequences evaluated',
      gateRequired: 15,
      gateObserved: totalRunsEvaluated,
    };
  }

  const fixationEventsPerHundredMoves = Number(((runsDetected / Math.max(1, playerMoves.length)) * 100).toFixed(2));

  return {
    fixationEventsPerHundredMoves,
    runsDetected,
    totalRunsEvaluated,
    totalPlayerMoves: playerMoves.length,
    hasPlanFixation: fixationEventsPerHundredMoves > 1.0,
  };
}

/**
 * 4. Forcing Bias Detector
 * Gate: >= 30 positions.
 * Evaluates over-forcing (quiet best move missed in favor of an error forcing move)
 * vs passivity (forcing best move missed in favor of an error quiet move).
 * Returns { forcingBiasRate, passivityBiasRate, quietBestMovePositions, forcingMovesPlayed, ... }.
 */
export function detectForcingBias(db) {
  const playerMoves = getPlayerMoves(db);
  if (playerMoves.length === 0) {
    return { insufficient_data: true, reason: 'No unassisted player moves found', gateRequired: 30, gateObserved: 0 };
  }

  let quietBestMovePositions = 0;
  let forcingMovesPlayed = 0;
  let forcingBestMovePositions = 0;
  let quietMovesPlayed = 0;

  for (const m of playerMoves) {
    if (!m.best_move || !m.fen_before || !isHumanFindable(m)) continue;

    const board = parseFenBoard(m.fen_before);
    const bestFrom = m.best_move.slice(0, 2);
    const bestTo = m.best_move.slice(2, 4);
    const bestMoving = board[bestFrom];
    const bestTarget = board[bestTo];
    const isBestCapture = Boolean(bestTarget || (bestMoving?.type === 'p' && bestFrom[0] !== bestTo[0]));

    const playedFrom = m.move_played?.slice(0, 2);
    const playedTo = m.move_played?.slice(2, 4);
    const playedMoving = playedFrom ? board[playedFrom] : null;
    const playedTarget = playedTo ? board[playedTo] : null;
    const isPlayedCapture = Boolean(playedTarget || (playedMoving?.type === 'p' && playedFrom[0] !== playedTo[0]));

    const loss = computeLoss(m);

    if (!isBestCapture) {
      // Quiet best move position
      quietBestMovePositions += 1;
      if (isPlayedCapture && loss >= 50) {
        forcingMovesPlayed += 1;
      }
    } else {
      // Forcing best move position
      forcingBestMovePositions += 1;
      if (!isPlayedCapture && loss >= 50) {
        quietMovesPlayed += 1;
      }
    }
  }

  const minPositions = Math.min(quietBestMovePositions, forcingBestMovePositions);
  if (minPositions < 30) {
    return {
      insufficient_data: true,
      reason: 'Requires at least 30 quiet and 30 forcing best move positions',
      gateRequired: 30,
      gateObserved: minPositions,
    };
  }

  const forcingBiasRate = Number((forcingMovesPlayed / Math.max(1, quietBestMovePositions)).toFixed(3));
  const passivityBiasRate = Number((quietMovesPlayed / Math.max(1, forcingBestMovePositions)).toFixed(3));

  let dominantBias = 'neutral';
  if (forcingBiasRate > passivityBiasRate * 1.25) dominantBias = 'forcing';
  else if (passivityBiasRate > forcingBiasRate * 1.25) dominantBias = 'passivity';

  return {
    forcingBiasRate,
    passivityBiasRate,
    quietBestMovePositions,
    forcingMovesPlayed,
    forcingBestMovePositions,
    quietMovesPlayed,
    dominantBias,
  };
}

/**
 * 5. Win/Loss Asymmetry Detector
 * Gate: >= 20 moves per eval bucket (Winning > +200, Balanced -200 to +200, Losing < -200).
 * Computes mean CPL per bucket to detect collapse-when-ahead or give-up-when-behind.
 */
export function detectWinLossAsymmetry(db) {
  const playerMoves = getPlayerMoves(db);
  if (playerMoves.length === 0) {
    return { insufficient_data: true, reason: 'No unassisted player moves found', gateRequired: 20, gateObserved: 0 };
  }

  const winningLosses = [];
  const balancedLosses = [];
  const losingLosses = [];

  for (const m of playerMoves) {
    const before = m.eval_cp_before;
    if (before === null || before === undefined) continue;

    const loss = computeLoss(m);

    if (before > 200) {
      winningLosses.push(loss);
    } else if (before < -200) {
      losingLosses.push(loss);
    } else {
      balancedLosses.push(loss);
    }
  }

  const minBucketCount = Math.min(winningLosses.length, balancedLosses.length, losingLosses.length);
  if (minBucketCount < 20) {
    return {
      insufficient_data: true,
      reason: 'Requires at least 20 moves in winning, balanced, and losing buckets',
      gateRequired: 20,
      gateObserved: minBucketCount,
      buckets: {
        winning: winningLosses.length,
        balanced: balancedLosses.length,
        losing: losingLosses.length,
      },
    };
  }

  const winningMeanCpl = Number(mean(winningLosses).toFixed(1));
  const balancedMeanCpl = Number(mean(balancedLosses).toFixed(1));
  const losingMeanCpl = Number(mean(losingLosses).toFixed(1));

  let pattern = 'balanced';
  if (winningMeanCpl > balancedMeanCpl * 1.25) {
    pattern = 'collapse_when_ahead';
  } else if (losingMeanCpl > balancedMeanCpl * 1.25) {
    pattern = 'give_up_when_behind';
  }

  const asymmetryRatio = Number((winningMeanCpl / Math.max(1, losingMeanCpl)).toFixed(2));

  return {
    winningMeanCpl,
    balancedMeanCpl,
    losingMeanCpl,
    winningMovesCount: winningLosses.length,
    balancedMovesCount: balancedLosses.length,
    losingMovesCount: losingLosses.length,
    asymmetryRatio,
    pattern,
  };
}

/**
 * 6. First-Idea Bias Detector
 * Gate: >= 40 fast moves (<5000ms).
 * Computes frequency of human-findable errors on fast moves (CPL > 100, best_move = best_move_depth8).
 */
export function detectFirstIdeaBias(db) {
  const playerMoves = getPlayerMoves(db);
  if (playerMoves.length === 0) {
    return { insufficient_data: true, reason: 'No unassisted player moves found', gateRequired: 40, gateObserved: 0 };
  }

  let fastMovesTotal = 0;
  let fastMissesCount = 0;

  for (const m of playerMoves) {
    if (m.time_to_move_ms === null || m.time_to_move_ms === undefined) continue;

    if (m.time_to_move_ms < 5000) {
      fastMovesTotal += 1;
      const loss = computeLoss(m);
      if (loss >= 100 && isHumanFindable(m)) {
        fastMissesCount += 1;
      }
    }
  }

  if (fastMovesTotal < 40) {
    return {
      insufficient_data: true,
      reason: 'Requires at least 40 fast moves (<5s)',
      gateRequired: 40,
      gateObserved: fastMovesTotal,
    };
  }

  const firstIdeaBiasRate = Number((fastMissesCount / fastMovesTotal).toFixed(3));

  return {
    firstIdeaBiasRate,
    fastMovesTotal,
    fastMissesCount,
    hasFirstIdeaBias: firstIdeaBiasRate > 0.15,
  };
}

/**
 * Aggregator: runBiasAnalysis(db, { save = false } = {})
 * Runs all 6 cognitive bias detectors, returns full ranked/keyed results object.
 * When save === true, persists results to analysis_results table.
 */
export function runBiasAnalysis(db, { save = false, runAt = new Date().toISOString() } = {}) {
  const tiltIndex = detectTiltIndex(db);
  const materialBias = detectMaterialBias(db);
  const planFixation = detectPlanFixation(db);
  const forcingBias = detectForcingBias(db);
  const winLossAsymmetry = detectWinLossAsymmetry(db);
  const firstIdeaBias = detectFirstIdeaBias(db);

  // Total unassisted games & moves analyzed
  const counts = db.prepare(`
    SELECT
      COUNT(DISTINCT g.id) AS games_analyzed,
      COUNT(m.id) AS moves_analyzed
    FROM games g
    JOIN moves m ON g.id = m.game_id
    WHERE g.assistance_level = 'none'
      AND m.eval_cp_before IS NOT NULL
      AND m.eval_cp_after IS NOT NULL
      AND (
        (g.player_color = 'white' AND m.ply_number % 2 = 1)
        OR
        (g.player_color = 'black' AND m.ply_number % 2 = 0)
      )
  `).get() || { games_analyzed: 0, moves_analyzed: 0 };

  const results = {
    tilt_index: tiltIndex,
    material_bias: materialBias,
    plan_fixation: planFixation,
    forcing_bias: forcingBias,
    win_loss_asymmetry: winLossAsymmetry,
    first_idea_bias: firstIdeaBias,
    meta: {
      games_analyzed: counts.games_analyzed,
      moves_analyzed: counts.moves_analyzed,
      run_at: runAt,
    },
  };

  if (save) {
    const detectors = [
      ['tilt_index', tiltIndex],
      ['material_bias', materialBias],
      ['plan_fixation', planFixation],
      ['forcing_bias', forcingBias],
      ['win_loss_asymmetry', winLossAsymmetry],
      ['first_idea_bias', firstIdeaBias],
    ];
    for (const [name, res] of detectors) {
      saveAnalysisResult(db, {
        run_at: runAt,
        detector: name,
        result: res,
        games_analyzed: counts.games_analyzed,
        moves_analyzed: counts.moves_analyzed,
      });
    }
  }

  return results;
}
