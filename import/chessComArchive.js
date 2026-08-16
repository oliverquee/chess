// Official read-only completed monthly archive endpoint:
// https://www.chess.com/news/view/published-data-api#complete-monthly-archives
const ARCHIVE_ORIGIN = 'https://api.chess.com';

function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string.`);
  return value.trim();
}

export async function fetchChessComMonthlyArchive({ username, year, month, fetchImpl = fetch }) {
  const normalizedUser = required(username, 'username').toLowerCase();
  if (!Number.isInteger(year) || year < 2007 || year > 9999) throw new RangeError('year must be a valid Chess.com archive year.');
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError('month must be between 1 and 12.');
  const url = `${ARCHIVE_ORIGIN}/pub/player/${encodeURIComponent(normalizedUser)}/games/${year}/${String(month).padStart(2, '0')}`;
  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'ChessAnalystPersonalApp/0.1',
      },
    });
  } catch (error) {
    throw new Error(`Chess.com archive request failed: ${error.message}`, { cause: error });
  }
  if (!response.ok) throw new Error(`Chess.com archive request failed with HTTP ${response.status}.`);
  const payload = await response.json();
  if (!Array.isArray(payload.games)) throw new Error('Chess.com archive response did not contain a games array.');
  return payload.games;
}

export const CHESSCOM_ARCHIVE_ORIGIN = ARCHIVE_ORIGIN;
