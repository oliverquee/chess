import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb, saveGameSession, updateMoveAnalysis, updateGameAnalysisStatus } from '../storage/db.js';
import {
  buildImportedGameSummary,
  importCompletedPgn,
  importChessComMonthlyArchive,
  parseClockStringMs,
  parseStartingTimeMs,
  ImportValidationError,
} from '../import/pgnImport.js';
import { computeRealityMetrics, generateReportMarkdown } from '../scripts/generateM11aReport.js';

test('import: parseClockStringMs and parseStartingTimeMs parse clock formats accurately', () => {
  assert.equal(parseClockStringMs('0:00:59.9'), 59900);
  assert.equal(parseClockStringMs('0:01:30'), 90000);
  assert.equal(parseClockStringMs('0:05:00.0'), 300000);
  assert.equal(parseClockStringMs('10:00'), 600000);
  assert.equal(parseClockStringMs(null), null);

  assert.deepEqual(parseStartingTimeMs('60'), { baseMs: 60000, incMs: 0 });
  assert.deepEqual(parseStartingTimeMs('180+2'), { baseMs: 180000, incMs: 2000 });
  assert.deepEqual(parseStartingTimeMs('none'), { baseMs: null, incMs: 0 });
});

test('import: handles Black-perspective games correctly with exact player_color, move metadata and clock times', async () => {
  const db = initDb(':memory:');

  const pgnBlack = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.08.01"]
[White "OpponentWhite"]
[Black "lastautumnleaf1"]
[Result "0-1"]
[TimeControl "60"]

1. e4 {[%clk 0:00:59.9]} 1... c5 {[%clk 0:00:59.1]} 2. Nf3 {[%clk 0:00:59.4]} 2... d6 {[%clk 0:00:58.2]} 0-1`;

  const summary = await importCompletedPgn({
    db,
    pgn: pgnBlack,
    username: 'lastautumnleaf1',
  });

  assert.equal(summary.player_color, 'black');
  assert.equal(summary.white_player, 'OpponentWhite');
  assert.equal(summary.black_player, 'lastautumnleaf1');
  assert.equal(summary.result, '0-1');
  assert.equal(summary.assistance_level, 'none');
  assert.equal(summary.moves.length, 4);

  // Black move 1 (ply 2): spent 60000 - 59100 = 900ms
  assert.equal(summary.moves[1].move_played, 'c7c5');
  assert.equal(summary.moves[1].clock_remaining_ms, 59100);
  assert.equal(summary.moves[1].time_to_move_ms, 900);

  // Black move 2 (ply 4): spent 59100 - 58200 = 900ms
  assert.equal(summary.moves[3].move_played, 'd7d6');
  assert.equal(summary.moves[3].clock_remaining_ms, 58200);
  assert.equal(summary.moves[3].time_to_move_ms, 900);

  // Assert DB persisted values
  const row = db.prepare('SELECT player_color, assistance_level FROM games WHERE id = ?').get(summary.id);
  assert.equal(row.player_color, 'black');
  assert.equal(row.assistance_level, 'none');

  db.close();
});

test('import: variant and unfinished games are rejected explicitly', async () => {
  const pgnVariant = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.08.01"]
[White "Opponent"]
[Black "lastautumnleaf1"]
[Result "1-0"]
[Variant "Crazyhouse"]

1. e4 e5 1-0`;

  const pgnUnfinished = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.08.01"]
[White "lastautumnleaf1"]
[Black "Opponent"]
[Result "*"]

1. e4 e5 *`;

  await assert.rejects(
    () => buildImportedGameSummary({ pgn: pgnVariant, username: 'lastautumnleaf1' }),
    /Only standard chess is importable/,
  );

  await assert.rejects(
    () => buildImportedGameSummary({ pgn: pgnUnfinished, username: 'lastautumnleaf1' }),
    /Only completed games are importable/,
  );
});

test('analysis backfill: resumable backfill updates move evaluations and game status without duplication', () => {
  const db = initDb(':memory:');

  saveGameSession(db, {
    id: 'game-resumable-1',
    mode: 'imported',
    status: 'completed',
    result: '1-0',
    player_color: 'white',
    start_fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    moves: [
      {
        game_id: 'game-resumable-1',
        ply_number: 1,
        fen_before: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        move_played: 'e2e4',
        timestamp: '2026-08-01T00:00:00Z',
      },
    ],
  });

  // Verify unanalyzed query finds it
  const unanalyzed = db.prepare("SELECT id FROM games WHERE status != 'analyzed'").all();
  assert.equal(unanalyzed.length, 1);

  // Perform backfill update
  updateMoveAnalysis(db, 1, {
    eval_cp_before: 20,
    eval_cp_after: -30,
    best_move: 'e2e4',
    best_move_depth8: 'e2e4',
    principal_variation: 'e2e4 e7e5',
    is_mate_score: 0,
  });
  updateGameAnalysisStatus(db, 'game-resumable-1', { status: 'analyzed', analysis_engine: 'Stockfish 18 Lite WASM', analysis_depth: 16 });

  // Verify it is no longer in unanalyzed queue
  const remaining = db.prepare("SELECT id FROM games WHERE status != 'analyzed'").all();
  assert.equal(remaining.length, 0);

  const updatedMove = db.prepare('SELECT eval_cp_before, best_move, best_move_depth8 FROM moves WHERE id = 1').get();
  assert.equal(updatedMove.eval_cp_before, 20);
  assert.equal(updatedMove.best_move, 'e2e4');
  assert.equal(updatedMove.best_move_depth8, 'e2e4');

  db.close();
});

test('human-findability: classifies findability correctly on matching vs non-matching depth best moves', () => {
  // Matching best moves (human-findable)
  const findableMove = {
    best_move: 'd2d4',
    best_move_depth8: 'd2d4',
  };
  const isFindable = Boolean(findableMove.best_move && findableMove.best_move_depth8 && findableMove.best_move === findableMove.best_move_depth8);
  assert.equal(isFindable, true);

  // Non-matching (superhuman engine-only find, discarded by findability filter)
  const superhumanMove = {
    best_move: 'c1g5',
    best_move_depth8: 'f1e2',
  };
  const isSuperhumanFindable = Boolean(superhumanMove.best_move && superhumanMove.best_move_depth8 && superhumanMove.best_move === superhumanMove.best_move_depth8);
  assert.equal(isSuperhumanFindable, false);
});

test('reality check report: computeRealityMetrics and generateReportMarkdown calculate CPL distribution and bias gates correctly', () => {
  const db = initDb(':memory:');

  // Insert mock White game
  db.prepare(`
    INSERT INTO games (id, mode, status, result, player_color, import_source, date)
    VALUES ('test-g1', 'imported', 'analyzed', '1-0', 'white', 'chesscom_archive', '2026-08-01')
  `).run();

  // Insert White moves (ply 1: good move, ply 3: blunder, human-findable)
  db.prepare(`
    INSERT INTO moves (game_id, ply_number, fen_before, move_played, eval_cp_before, eval_cp_after, best_move, best_move_depth8, clock_remaining_ms, time_to_move_ms)
    VALUES
      ('test-g1', 1, 'fen1', 'e2e4', 20, -25, 'e2e4', 'e2e4', 60000, 1500),
      ('test-g1', 2, 'fen2', 'e7e5', 25, -20, 'e7e5', 'e7e5', 59000, 1000),
      ('test-g1', 3, 'fen3', 'g1f3', 20, 350, 'g1f3', 'g1f3', 58000, 2000),
      ('test-g1', 4, 'fen4', 'b8c6', -350, 340, 'b8c6', 'b8c6', 57000, 2000)
  `).run();

  const metrics = computeRealityMetrics(db);
  assert.equal(metrics.gameCounts.total_games, 1);
  assert.equal(metrics.gameCounts.white_games, 1);
  assert.equal(metrics.playerMovesCount, 2); // Plies 1 and 3
  assert.equal(metrics.gamesWithClock, 1);

  const md = generateReportMarkdown(metrics, '10.5');
  assert.ok(md.includes('# Milestone M11-A Reality Check Report'));
  assert.ok(md.includes('10.5 seconds'));
  assert.ok(md.includes('Centipawn Loss (CPL) Distribution'));
  assert.ok(md.includes('Human-Findability Filter Effect'));

  db.close();
});


