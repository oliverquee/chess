/**
 * Import the last 12 months of completed, standard-variant games
 * for a Chess.com user into local SQLite database.
 */

import { resolve } from 'node:path';
import { initDb } from '../storage/db.js';
import { importChessComMonthlyArchive } from '../import/pgnImport.js';

const USERNAME = 'lastautumnleaf1';
const DB_PATH = resolve('storage/analyst.db');

const MONTHS = [
  { year: 2025, month: 9 },
  { year: 2025, month: 10 },
  { year: 2025, month: 11 },
  { year: 2025, month: 12 },
  { year: 2026, month: 1 },
  { year: 2026, month: 2 },
  { year: 2026, month: 3 },
  { year: 2026, month: 4 },
  { year: 2026, month: 5 },
  { year: 2026, month: 6 },
  { year: 2026, month: 7 },
  { year: 2026, month: 8 },
];

async function main() {
  console.log(`Initializing database at: ${DB_PATH}`);
  const db = initDb(DB_PATH);

  console.log(`Starting Chess.com import for user: "${USERNAME}" over last 12 months...`);

  let totalImported = 0;
  let totalSkipped = 0;
  const monthSummaries = [];

  for (const { year, month } of MONTHS) {
    const ymStr = `${year}/${String(month).padStart(2, '0')}`;
    process.stdout.write(`Fetching ${ymStr}... `);

    try {
      const res = await importChessComMonthlyArchive({
        db,
        username: USERNAME,
        year,
        month,
      });

      totalImported += res.imported.length;
      totalSkipped += res.skipped.length;

      const nonStandard = res.skipped.filter(s => s.reason === 'non_standard').length;
      const incomplete = res.skipped.filter(s => s.reason?.includes('Only completed games')).length;
      const duplicates = res.skipped.filter(s => s.reason === 'duplicate').length;

      monthSummaries.push({
        ym: ymStr,
        imported: res.imported.length,
        skipped: res.skipped.length,
        nonStandard,
        incomplete,
        duplicates,
      });

      console.log(`imported=${res.imported.length}, skipped=${res.skipped.length}`);
    } catch (err) {
      console.log(`error: ${err.message}`);
      monthSummaries.push({ ym: ymStr, error: err.message, imported: 0, skipped: 0 });
    }

    // Polite rate limiting between months
    await new Promise(resolve => setTimeout(resolve, 150));
  }

  console.log('\n--- Import Summary ---');
  console.table(monthSummaries);

  // Query DB stats
  const gameStats = db.prepare(`
    SELECT
      COUNT(*) as total_games,
      SUM(CASE WHEN player_color = 'white' THEN 1 ELSE 0 END) as white_games,
      SUM(CASE WHEN player_color = 'black' THEN 1 ELSE 0 END) as black_games,
      SUM(CASE WHEN result = '1-0' THEN 1 ELSE 0 END) as white_wins,
      SUM(CASE WHEN result = '0-1' THEN 1 ELSE 0 END) as black_wins,
      SUM(CASE WHEN result = '1/2-1/2' THEN 1 ELSE 0 END) as draws
    FROM games
    WHERE import_source = 'chesscom_archive'
  `).get();

  const moveStats = db.prepare(`
    SELECT
      COUNT(*) as total_moves,
      SUM(CASE WHEN clock_remaining_ms IS NOT NULL THEN 1 ELSE 0 END) as moves_with_clock,
      SUM(CASE WHEN time_to_move_ms IS NOT NULL THEN 1 ELSE 0 END) as moves_with_spent_time
    FROM moves m
    JOIN games g ON m.game_id = g.id
    WHERE g.import_source = 'chesscom_archive'
  `).get();

  const gamesWithClock = db.prepare(`
    SELECT COUNT(DISTINCT g.id) as count
    FROM games g
    JOIN moves m ON g.id = m.game_id
    WHERE g.import_source = 'chesscom_archive' AND m.clock_remaining_ms IS NOT NULL
  `).get().count;

  console.log('Database Statistics for Imported Archive:');
  console.log(`Total games in DB: ${gameStats.total_games} (White: ${gameStats.white_games}, Black: ${gameStats.black_games})`);
  console.log(`Game outcomes: White wins=${gameStats.white_wins}, Black wins=${gameStats.black_wins}, Draws=${gameStats.draws}`);
  console.log(`Games with usable clock data: ${gamesWithClock} / ${gameStats.total_games}`);
  console.log(`Total moves: ${moveStats.total_moves} (Moves with clock: ${moveStats.moves_with_clock})`);

  db.close();
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});

