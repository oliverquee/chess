import test from 'node:test';
import assert from 'node:assert/strict';
import { AppController } from '../app/controller.js';
import { TrainingOrchestrator } from '../core/orchestrator.js';
import { initPuzzleDb, SqlitePuzzleLibrary } from '../data/puzzleDb.js';
import { initDb } from '../storage/db.js';

const RAW_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function seedPuzzles() {
  const db = initPuzzleDb(':memory:');
  const puzzle = db.prepare('INSERT INTO puzzles (puzzle_id, fen, moves, rating, step_count) VALUES (?, ?, ?, ?, ?)');
  const theme = db.prepare('INSERT INTO puzzle_themes (theme, puzzle_id) VALUES (?, ?)');
  puzzle.run('short', RAW_FEN, 'e2e4 e7e5 g1f3 b8c6', 1200, 4);
  puzzle.run('long', RAW_FEN, 'e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f3d4 g8f6', 1400, 8);
  theme.run('fork', 'short'); theme.run('fork', 'long');
  return db;
}

function practiceEngine() {
  const analyses = [
    { bestMove: 'e7e5', evalCp: 30, isMateScore: false, principalVariation: ['e7e5', 'g1f3'] },
    { bestMove: 'g1f3', evalCp: -10, isMateScore: false, principalVariation: ['g1f3'] },
    { bestMove: 'g1f3', evalCp: 5, isMateScore: false, principalVariation: ['g1f3'] },
  ];
  return {
    async analyzePosition() { return analyses.shift(); },
    async playMove() { return 'g1f3'; },
    dispose() {},
  };
}

test('main-process controller runs practice and returns future lines only from practice moves', async () => {
  const db = initDb(':memory:');
  const puzzleDb = seedPuzzles();
  let id = 0;
  const orchestrator = new TrainingOrchestrator({
    db,
    puzzleLibrary: new SqlitePuzzleLibrary(puzzleDb),
    engineFactory: practiceEngine,
    idFactory: () => `app-session-${++id}`,
  });
  const controller = new AppController({
    db,
    orchestrator,
    engineFactory: practiceEngine,
    backendFactory: () => { throw new Error('unused'); },
    secretStore: { get: () => null },
  });
  try {
    const started = controller.startPractice({ rankedWeaknesses: ['practical_time', 'tactical'] });
    assert.equal(started.mode, 'practice');
    assert.equal(started.weaknessCategory, 'tactical');
    assert.equal(started.queued.length, 2);
    assert.equal('futureLine' in started, false);

    const turn = await controller.playPracticeMove({ gameId: started.gameId, move: 'c7c5' });
    assert.equal(turn.mode, 'practice');
    assert.deepEqual(turn.futureLine, ['e7e5', 'g1f3']);

    const completed = controller.completePractice({ gameId: started.gameId });
    assert.deepEqual(completed, { gameId: started.gameId, status: 'completed' });
    assert.equal('futureLine' in completed, false);
    assert.equal(controller.getState().games.find((game) => game.id === started.gameId).status, 'completed');
  } finally {
    puzzleDb.close(); db.close();
  }
});
