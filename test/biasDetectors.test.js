import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb, saveGameSession, getLatestAnalysisResults, getAnalysisHistory } from '../storage/db.js';
import {
  detectTiltIndex,
  detectMaterialBias,
  detectPlanFixation,
  detectForcingBias,
  detectWinLossAsymmetry,
  detectFirstIdeaBias,
  runBiasAnalysis,
} from '../analysis/biasDetectors.js';

test('bias detectors: return insufficient_data when below sample gates', () => {
  const db = initDb(':memory:');

  // Insert 1 game with 2 moves (insufficient for all gates)
  saveGameSession(db, {
    id: 'game-sparse-1',
    mode: 'imported',
    status: 'analyzed',
    result: '1-0',
    player_color: 'white',
    assistance_level: 'none',
    start_fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    moves: [
      {
        game_id: 'game-sparse-1',
        ply_number: 1,
        fen_before: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        move_played: 'e2e4',
        eval_cp_before: 20,
        eval_cp_after: -25,
        best_move: 'e2e4',
        best_move_depth8: 'e2e4',
        time_to_move_ms: 2000,
        timestamp: '2026-08-01T00:00:00Z',
      },
      {
        game_id: 'game-sparse-1',
        ply_number: 2,
        fen_before: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
        move_played: 'e7e5',
        eval_cp_before: 25,
        eval_cp_after: -20,
        best_move: 'e7e5',
        best_move_depth8: 'e7e5',
        time_to_move_ms: 1500,
        timestamp: '2026-08-01T00:00:02Z',
      },
    ],
  });

  const tilt = detectTiltIndex(db);
  assert.equal(tilt.insufficient_data, true);
  assert.equal(tilt.gateRequired, 10);
  assert.equal(tilt.gateObserved, 0);

  const mat = detectMaterialBias(db);
  assert.equal(mat.insufficient_data, true);
  assert.equal(mat.gateRequired, 25);

  const plan = detectPlanFixation(db);
  assert.equal(plan.insufficient_data, true);
  assert.equal(plan.gateRequired, 15);

  const forcing = detectForcingBias(db);
  assert.equal(forcing.insufficient_data, true);
  assert.equal(forcing.gateRequired, 30);

  const winLoss = detectWinLossAsymmetry(db);
  assert.equal(winLoss.insufficient_data, true);
  assert.equal(winLoss.gateRequired, 20);

  const firstIdea = detectFirstIdeaBias(db);
  assert.equal(firstIdea.insufficient_data, true);
  assert.equal(firstIdea.gateRequired, 40);

  const fullReport = runBiasAnalysis(db);
  assert.ok(fullReport.tilt_index.insufficient_data);
  assert.ok(fullReport.material_bias.insufficient_data);
  assert.ok(fullReport.plan_fixation.insufficient_data);
  assert.ok(fullReport.forcing_bias.insufficient_data);
  assert.ok(fullReport.win_loss_asymmetry.insufficient_data);
  assert.ok(fullReport.first_idea_bias.insufficient_data);
  assert.equal(fullReport.meta.games_analyzed, 1);
  assert.equal(fullReport.meta.moves_analyzed, 1); // 1 White player ply

  db.close();
});

test('bias detectors: assistance filter (assistance_level = none) strictly excludes assisted games', () => {
  const db = initDb(':memory:');

  // Insert assisted game (assistance_level: 'hints') with 50 moves
  const assistedMoves = [];
  for (let i = 1; i <= 50; i += 1) {
    assistedMoves.push({
      game_id: 'game-assisted-1',
      ply_number: i,
      fen_before: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      move_played: i % 2 === 1 ? 'e2e4' : 'e7e5',
      eval_cp_before: 20,
      eval_cp_after: -25,
      best_move: i % 2 === 1 ? 'e2e4' : 'e7e5',
      best_move_depth8: i % 2 === 1 ? 'e2e4' : 'e7e5',
      time_to_move_ms: 1000,
      timestamp: '2026-08-01T00:00:00Z',
    });
  }

  saveGameSession(db, {
    id: 'game-assisted-1',
    mode: 'practice',
    status: 'analyzed',
    result: '1-0',
    player_color: 'white',
    assistance_level: 'hints',
    start_fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    moves: assistedMoves,
  });

  const fullReport = runBiasAnalysis(db);
  // Zero unassisted moves counted
  assert.equal(fullReport.meta.games_analyzed, 0);
  assert.equal(fullReport.meta.moves_analyzed, 0);
  assert.ok(fullReport.tilt_index.insufficient_data);

  db.close();
});

test('bias detectors: human-findability filter excludes superhuman engine-only misses', () => {
  const db = initDb(':memory:');

  const moves = [];
  // Generate 12 blunder moves where best_move_depth8 DOES NOT MATCH best_move
  for (let g = 1; g <= 12; g += 1) {
    saveGameSession(db, {
      id: `game-superhuman-${g}`,
      mode: 'imported',
      status: 'analyzed',
      result: '0-1',
      player_color: 'white',
      assistance_level: 'none',
      start_fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      moves: [
        {
          game_id: `game-superhuman-${g}`,
          ply_number: 1,
          fen_before: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          move_played: 'h2h4',
          eval_cp_before: 20,
          eval_cp_after: 450, // -(-after) - before = -470 (loss: 470)
          best_move: 'e2e4',
          best_move_depth8: 'd2d4', // Superhuman depth-16 find, discarded by findability filter!
          time_to_move_ms: 1500,
          timestamp: '2026-08-01T00:00:00Z',
        },
      ],
    });
  }

  // Because best_move !== best_move_depth8, human findability filter eliminates them all
  const tilt = detectTiltIndex(db);
  assert.equal(tilt.insufficient_data, true);
  assert.equal(tilt.gateObserved, 0);

  db.close();
});

test('bias detectors: tilt index computes correct ratio on seeded blunder cascade', () => {
  const db = initDb(':memory:');

  // Seed 10 games, each with 1 human-findable blunder followed by 5 tilted moves (loss = 50)
  // and baseline moves (loss = 10)
  for (let g = 1; g <= 10; g += 1) {
    const moves = [];
    // Move 1 (Ply 1): Baseline good move (loss 0)
    moves.push({
      game_id: `game-tilt-${g}`,
      ply_number: 1,
      fen_before: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      move_played: 'e2e4',
      eval_cp_before: 20,
      eval_cp_after: -20,
      best_move: 'e2e4',
      best_move_depth8: 'e2e4',
      time_to_move_ms: 2000,
      timestamp: '2026-08-01T00:00:00Z',
    });
    // Move 2 (Ply 2): Opponent
    moves.push({
      game_id: `game-tilt-${g}`,
      ply_number: 2,
      fen_before: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
      move_played: 'e7e5',
      eval_cp_before: 20,
      eval_cp_after: -20,
      best_move: 'e7e5',
      best_move_depth8: 'e7e5',
      time_to_move_ms: 2000,
      timestamp: '2026-08-01T00:00:02Z',
    });
    // Move 3 (Ply 3): Blunder (loss 400), human findable
    moves.push({
      game_id: `game-tilt-${g}`,
      ply_number: 3,
      fen_before: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
      move_played: 'g1h3',
      eval_cp_before: 20,
      eval_cp_after: 380, // evalDelta = -380 - 20 = -400 (loss: 400)
      best_move: 'g1f3',
      best_move_depth8: 'g1f3',
      time_to_move_ms: 2000,
      timestamp: '2026-08-01T00:00:04Z',
    });
    // Move 4 (Ply 4): Opponent
    moves.push({
      game_id: `game-tilt-${g}`,
      ply_number: 4,
      fen_before: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/7N/PPPP1PPP/RNBQKB1R b KQkq - 1 2',
      move_played: 'd7d5',
      eval_cp_before: -380,
      eval_cp_after: 380,
      best_move: 'd7d5',
      best_move_depth8: 'd7d5',
      time_to_move_ms: 2000,
      timestamp: '2026-08-01T00:00:06Z',
    });
    // Move 5 (Ply 5): Post-blunder tilt move (loss 80)
    moves.push({
      game_id: `game-tilt-${g}`,
      ply_number: 5,
      fen_before: 'rnbqkbnr/ppp2ppp/8/3pp3/4P3/7N/PPPP1PPP/RNBQKB1R w KQkq - 0 3',
      move_played: 'h1g1',
      eval_cp_before: -380,
      eval_cp_after: 460, // loss = -460 - (-380) = -80 (loss: 80)
      best_move: 'e4d5',
      best_move_depth8: 'e4d5',
      time_to_move_ms: 2000,
      timestamp: '2026-08-01T00:00:08Z',
    });

    saveGameSession(db, {
      id: `game-tilt-${g}`,
      mode: 'imported',
      status: 'analyzed',
      result: '0-1',
      player_color: 'white',
      assistance_level: 'none',
      start_fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      moves,
    });
  }

  const tilt = detectTiltIndex(db);
  assert.equal(tilt.insufficient_data, undefined);
  assert.equal(tilt.blunderEventsUsed, 10);
  assert.equal(tilt.postBlunderMedianCpl, 80);
  assert.equal(tilt.baselineMedianCpl, 80); // Across plies 1 (0), 3 (400), 5 (80) -> median is 80
  assert.equal(tilt.tiltIndex, 1.0);

  db.close();
});

test('bias detectors: win/loss asymmetry detects collapse-when-ahead and give-up-when-behind', () => {
  const db = initDb(':memory:');

  const moves = [];
  let ply = 1;
  // 25 winning moves with high loss (120cp)
  for (let i = 0; i < 25; i += 1) {
    moves.push({
      game_id: 'game-asym-1',
      ply_number: ply++,
      fen_before: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      move_played: 'e2e4',
      eval_cp_before: 250, // winning bucket (> +200)
      eval_cp_after: -130, // loss = -(-130) - 250 = 130 - 250 = -120 (loss: 120)
      best_move: 'e2e4',
      best_move_depth8: 'e2e4',
      time_to_move_ms: 2000,
      timestamp: '2026-08-01T00:00:00Z',
    });
    // opponent ply
    moves.push({
      game_id: 'game-asym-1',
      ply_number: ply++,
      fen_before: 'fen',
      move_played: 'e7e5',
      eval_cp_before: 130,
      eval_cp_after: -130,
      best_move: 'e7e5',
      best_move_depth8: 'e7e5',
      time_to_move_ms: 2000,
      timestamp: '2026-08-01T00:00:02Z',
    });
  }

  // 25 balanced moves with low loss (20cp)
  for (let i = 0; i < 25; i += 1) {
    moves.push({
      game_id: 'game-asym-1',
      ply_number: ply++,
      fen_before: 'fen',
      move_played: 'g1f3',
      eval_cp_before: 10, // balanced bucket
      eval_cp_after: 10, // loss = -10 - 10 = -20 (loss: 20)
      best_move: 'g1f3',
      best_move_depth8: 'g1f3',
      time_to_move_ms: 2000,
      timestamp: '2026-08-01T00:00:04Z',
    });
    moves.push({
      game_id: 'game-asym-1',
      ply_number: ply++,
      fen_before: 'fen',
      move_played: 'b8c6',
      eval_cp_before: -10,
      eval_cp_after: 10,
      best_move: 'b8c6',
      best_move_depth8: 'b8c6',
      time_to_move_ms: 2000,
      timestamp: '2026-08-01T00:00:06Z',
    });
  }

  // 25 losing moves with moderate loss (40cp)
  for (let i = 0; i < 25; i += 1) {
    moves.push({
      game_id: 'game-asym-1',
      ply_number: ply++,
      fen_before: 'fen',
      move_played: 'f1c4',
      eval_cp_before: -300, // losing bucket (<-200)
      eval_cp_after: 340, // loss = -340 - (-300) = -40 (loss: 40)
      best_move: 'f1c4',
      best_move_depth8: 'f1c4',
      time_to_move_ms: 2000,
      timestamp: '2026-08-01T00:00:08Z',
    });
    moves.push({
      game_id: 'game-asym-1',
      ply_number: ply++,
      fen_before: 'fen',
      move_played: 'g8f6',
      eval_cp_before: 340,
      eval_cp_after: -340,
      best_move: 'g8f6',
      best_move_depth8: 'g8f6',
      time_to_move_ms: 2000,
      timestamp: '2026-08-01T00:00:10Z',
    });
  }

  saveGameSession(db, {
    id: 'game-asym-1',
    mode: 'imported',
    status: 'analyzed',
    result: '1/2-1/2',
    player_color: 'white',
    assistance_level: 'none',
    start_fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    moves,
  });

  const res = detectWinLossAsymmetry(db);
  assert.equal(res.insufficient_data, undefined);
  assert.equal(res.winningMovesCount, 25);
  assert.equal(res.balancedMovesCount, 25);
  assert.equal(res.losingMovesCount, 25);
  assert.equal(res.winningMeanCpl, 120);
  assert.equal(res.balancedMeanCpl, 20);
  assert.equal(res.losingMeanCpl, 40);
  assert.equal(res.pattern, 'collapse_when_ahead');

  db.close();
});

test('bias detectors: runBiasAnalysis persists analysis_results and round-trips via getLatestAnalysisResults', () => {
  const db = initDb(':memory:');

  const report = runBiasAnalysis(db, { save: true, runAt: '2026-08-21T12:00:00Z' });
  assert.ok(report.tilt_index);
  assert.ok(report.material_bias);
  assert.ok(report.plan_fixation);
  assert.ok(report.forcing_bias);
  assert.ok(report.win_loss_asymmetry);
  assert.ok(report.first_idea_bias);
  assert.equal(report.meta.run_at, '2026-08-21T12:00:00Z');

  const latest = getLatestAnalysisResults(db);
  assert.ok(latest.tilt_index);
  assert.ok(latest.material_bias);
  assert.ok(latest.plan_fixation);
  assert.ok(latest.forcing_bias);
  assert.ok(latest.win_loss_asymmetry);
  assert.ok(latest.first_idea_bias);
  assert.equal(latest.tilt_index.run_at, '2026-08-21T12:00:00Z');

  const history = getAnalysisHistory(db, 'tilt_index');
  assert.equal(history.length, 1);
  assert.equal(history[0].detector, 'tilt_index');

  db.close();
});
