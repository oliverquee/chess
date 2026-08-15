import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { AnalysisService } from '../analysis/service.js';
import { fetchChessComMonthlyArchive } from '../import/chessComArchive.js';
import {
  buildImportedGameSummary,
  importChessComMonthlyArchive,
  importCompletedPgn,
  ImportValidationError,
} from '../import/pgnImport.js';
import { getGameById, initDb } from '../storage/db.js';

const NOW = '2026-08-15T15:00:00.000Z';
const WHITE_PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.08.14"]
[UTCDate "2026.08.14"]
[UTCTime "10:00:00"]
[White "Oliver"]
[Black "Rival"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0`;
const BLACK_PGN = WHITE_PGN.replace('[White "Oliver"]', '[White "Rival"]')
  .replace('[Black "Rival"]', '[Black "Oliver"]')
  .replace('[Result "1-0"]', '[Result "0-1"]')
  .replace('a6 1-0', 'a6 0-1');

function legalEngine({ failAt = null } = {}) {
  let calls = 0;
  return {
    engineName: 'Deterministic local Stockfish double',
    analysisDepth: 4,
    get calls() { return calls; },
    async analyzePosition(fen) {
      calls += 1;
      if (calls === failAt) throw new Error('engine failed');
      const [move] = new Chess(fen).moves({ verbose: true });
      const uci = move ? move.lan : null;
      return {
        bestMove: uci,
        evalCp: move ? calls : 100000,
        isMateScore: !move,
        principalVariation: uci ? [uci] : [],
      };
    },
  };
}

test('manual completed PGN import stores White perspective and truthful post-hoc timestamps', async () => {
  const db = initDb(':memory:');
  const engine = legalEngine();
  try {
    const summary = await importCompletedPgn({
      db,
      pgn: WHITE_PGN,
      username: 'oLiVeR',
      engine,
      now: () => NOW,
      gameId: 'white-import',
    });
    assert.equal(engine.calls, summary.moves.length + 1);
    const stored = getGameById(db, 'white-import');
    assert.equal(stored.mode, 'imported');
    assert.equal(stored.status, 'completed');
    assert.equal(stored.player_color, 'white');
    assert.equal(stored.white_player, 'Oliver');
    assert.equal(stored.black_player, 'Rival');
    assert.equal(stored.date, '2026-08-14T10:00:00Z');
    assert.equal(stored.analysis_engine, engine.engineName);
    assert.equal(stored.analysis_depth, 4);
    assert.ok(stored.moves.every((move) => move.timestamp === NOW));
    assert.ok(stored.moves.every((move) => move.timestamp_source === 'posthoc_analysis'));
    assert.ok(stored.moves.every((move) => Number.isInteger(move.eval_cp_before)));
    assert.ok(stored.moves.every((move) => Number.isInteger(move.eval_cp_after)));
  } finally {
    db.close();
  }
});

test('imported Black game feeds only the user plies through the same analysis pipeline', async () => {
  const db = initDb(':memory:');
  try {
    const summary = await importCompletedPgn({
      db,
      pgn: BLACK_PGN,
      username: 'Oliver',
      engine: legalEngine(),
      now: () => NOW,
      gameId: 'black-import',
    });
    assert.equal(summary.player_color, 'black');
    let calls = 0;
    const service = new AnalysisService({
      backend: {
        name: 'ollama',
        model: 'test-model',
        async generate() {
          calls += 1;
          return '{"category":"tactical","severity":"low","rationale":"Post-game evidence."}';
        },
      },
      now: () => NOW,
    });
    const result = await service.analyzeStoredGame(db, summary.id);
    assert.equal(calls, 3);
    assert.deepEqual(result.results.map((entry) => getGameById(db, summary.id).moves.find((move) => move.id === entry.moveId).ply_number), [2, 4, 6]);
    assert.equal(getGameById(db, summary.id).status, 'analyzed');
  } finally {
    db.close();
  }
});

test('ongoing, non-standard, empty, and wrong-user PGNs fail before engine work', async () => {
  const cases = [
    WHITE_PGN.replaceAll('1-0', '*'),
    WHITE_PGN.replace('[Event "Live Chess"]', '[Event "Live Chess"]\n[Variant "Chess960"]'),
    WHITE_PGN.replace('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0', '1-0'),
  ];
  for (const pgn of cases) {
    const engine = legalEngine();
    await assert.rejects(
      () => buildImportedGameSummary({ pgn, username: 'Oliver', engine }),
      ImportValidationError,
    );
    assert.equal(engine.calls, 0);
  }
  const engine = legalEngine();
  await assert.rejects(
    () => buildImportedGameSummary({ pgn: WHITE_PGN, username: 'SomeoneElse', engine }),
    /neither White nor Black/,
  );
  assert.equal(engine.calls, 0);
});

test('engine failure leaves no partial imported database state', async () => {
  const db = initDb(':memory:');
  try {
    await assert.rejects(
      () => importCompletedPgn({ db, pgn: WHITE_PGN, username: 'Oliver', engine: legalEngine({ failAt: 3 }) }),
      /engine failed/,
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM games').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM moves').get().count, 0);
  } finally {
    db.close();
  }
});

test('archive client uses only the completed monthly public endpoint', async () => {
  let observed;
  const games = await fetchChessComMonthlyArchive({
    username: 'Oliver',
    year: 2026,
    month: 8,
    fetchImpl: async (url, options) => {
      observed = { url, options };
      return { ok: true, status: 200, async json() { return { games: [{ uuid: 'one' }] }; } };
    },
  });
  assert.deepEqual(games, [{ uuid: 'one' }]);
  assert.equal(observed.url, 'https://api.chess.com/pub/player/oliver/games/2026/08');
  const archiveUrl = new URL(observed.url);
  assert.equal(archiveUrl.origin, 'https://api.chess.com');
  assert.equal(archiveUrl.pathname, '/pub/player/oliver/games/2026/08');
});

test('archive import filters before engine creation and skips duplicates before evaluation', async () => {
  const db = initDb(':memory:');
  let engines = 0;
  const payload = {
    games: [
      { uuid: 'complete', rules: 'chess', pgn: WHITE_PGN, end_time: 1786701600 },
      { uuid: 'ongoing', rules: 'chess', pgn: WHITE_PGN.replaceAll('1-0', '*') },
      { uuid: 'variant', rules: 'chess960', pgn: WHITE_PGN },
      { uuid: 'missing', rules: 'chess' },
    ],
  };
  const options = {
    db,
    username: 'Oliver',
    year: 2026,
    month: 8,
    engineFactory: () => { engines += 1; return legalEngine(); },
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return payload; } }),
    now: () => NOW,
  };
  try {
    const first = await importChessComMonthlyArchive(options);
    assert.equal(first.imported.length, 1);
    assert.equal(first.skipped.length, 3);
    assert.equal(engines, 1);

    const second = await importChessComMonthlyArchive(options);
    assert.equal(second.imported.length, 0);
    assert.equal(second.skipped.find((item) => item.id === 'complete').reason, 'duplicate');
    assert.equal(engines, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM games').get().count, 1);
  } finally {
    db.close();
  }
});
