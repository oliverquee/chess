const REQUIRED_COLUMNS = ['PuzzleId', 'FEN', 'Moves', 'Themes', 'Rating'];

function parseCsvRows(csvText) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const char = csvText[i];

    if (quoted) {
      if (char === '"' && csvText[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }

  return rows.filter((columns) => columns.some((value) => value !== ''));
}

export function countPuzzlePlies(moves) {
  const trimmed = String(moves ?? '').trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function normalizePuzzle(record) {
  const moves = record.Moves.trim().split(/\s+/).filter(Boolean);
  const themes = record.Themes.trim().split(/\s+/).filter(Boolean);

  return Object.freeze({
    PuzzleId: record.PuzzleId,
    FEN: record.FEN,
    Moves: record.Moves,
    Themes: record.Themes,
    Rating: Number.parseInt(record.Rating, 10),
    moves,
    themes,
    stepCount: moves.length,
  });
}

export class PuzzleLibrary {
  constructor(puzzles) {
    this.puzzles = Object.freeze([...puzzles]);
    this.themeIndex = new Map();
    this.stepIndex = new Map();

    this.puzzles.forEach((puzzle, index) => {
      for (const theme of puzzle.themes) {
        if (!this.themeIndex.has(theme)) this.themeIndex.set(theme, new Set());
        this.themeIndex.get(theme).add(index);
      }
      if (!this.stepIndex.has(puzzle.stepCount)) this.stepIndex.set(puzzle.stepCount, new Set());
      this.stepIndex.get(puzzle.stepCount).add(index);
    });
  }

  filter({ themeTags = [], stepRange = [0, Number.POSITIVE_INFINITY] } = {}) {
    const [minSteps, maxSteps] = stepRange;
    const normalizedThemes = [...new Set(themeTags.filter(Boolean))];

    let candidateIndices;
    if (normalizedThemes.length === 0) {
      candidateIndices = new Set(this.puzzles.map((_, index) => index));
    } else {
      candidateIndices = new Set();
      for (const theme of normalizedThemes) {
        for (const index of this.themeIndex.get(theme) ?? []) candidateIndices.add(index);
      }
    }

    return [...candidateIndices]
      .sort((a, b) => a - b)
      .map((index) => this.puzzles[index])
      .filter((puzzle) => puzzle.stepCount >= minSteps && puzzle.stepCount <= maxSteps);
  }
}

export function parsePuzzleCsv(csvText) {
  const rows = parseCsvRows(String(csvText ?? ''));
  if (!rows.length) return new PuzzleLibrary([]);

  const headers = rows[0].map((header, index) => (index === 0 ? header.replace(/^\uFEFF/, '') : header));
  const headerIndex = new Map(headers.map((header, index) => [header, index]));

  const missing = REQUIRED_COLUMNS.filter((column) => !headerIndex.has(column));
  if (missing.length) {
    throw new Error(`Puzzle CSV is missing required columns: ${missing.join(', ')}`);
  }

  const puzzles = rows.slice(1).map((columns, rowIndex) => {
    const record = {};
    for (const header of headers) record[header] = columns[headerIndex.get(header)] ?? '';

    if (!record.FEN || !record.Moves) {
      throw new Error(`Invalid puzzle CSV row ${rowIndex + 2}: FEN and Moves are required.`);
    }
    return normalizePuzzle(record);
  });

  return new PuzzleLibrary(puzzles);
}

let activeLibrary = null;

export function loadPuzzleCsv(csvText) {
  activeLibrary = parsePuzzleCsv(csvText);
  return activeLibrary;
}

export function setPuzzleLibrary(library) {
  if (!(library instanceof PuzzleLibrary)) {
    throw new TypeError('library must be a PuzzleLibrary instance.');
  }
  activeLibrary = library;
}

export function getPuzzleLibrary() {
  if (!activeLibrary) {
    throw new Error('No puzzle library loaded. Call loadPuzzleCsv(csvText) or pass a PuzzleLibrary explicitly.');
  }
  return activeLibrary;
}

export function filterPuzzles(query, library = activeLibrary) {
  if (!library) {
    throw new Error('No puzzle library loaded. Call loadPuzzleCsv(csvText) before filterPuzzles().');
  }
  return library.filter(query);
}
