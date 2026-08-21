export const STANDARD_TIME_CONTROLS = Object.freeze([
  { id: '1|0', name: 'Bullet 1|0', baseSeconds: 60, incrementSeconds: 0 },
  { id: '3|0', name: 'Blitz 3|0', baseSeconds: 180, incrementSeconds: 0 },
  { id: '3|2', name: 'Blitz 3|2', baseSeconds: 180, incrementSeconds: 2 },
  { id: '5|0', name: 'Rapid 5|0', baseSeconds: 300, incrementSeconds: 0 },
  { id: '10|0', name: 'Rapid 10|0', baseSeconds: 600, incrementSeconds: 0 },
  { id: '15|10', name: 'Classical 15|10', baseSeconds: 900, incrementSeconds: 10 },
  { id: 'none', name: 'Untimed', baseSeconds: null, incrementSeconds: 0 },
]);

export function parseTimeControl(tc) {
  if (!tc || tc === 'none' || tc === 'untimed' || tc === 'unlimited' || tc === '∞') {
    return { baseSeconds: null, incrementSeconds: 0, isUntimed: true };
  }
  const match = String(tc).trim().match(/^(\d+)\|(\d+)$/);
  if (!match) {
    throw new RangeError(`Invalid time control format: "${tc}". Expected "M|S" or "none".`);
  }
  const baseMinutes = Number.parseInt(match[1], 10);
  const incrementSeconds = Number.parseInt(match[2], 10);
  return {
    baseSeconds: baseMinutes * 60,
    incrementSeconds,
    isUntimed: false,
  };
}

export function formatClockTime(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) {
    ms = 0;
  }
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');

  if (totalSeconds < 10 && ms > 0) {
    const tenths = Math.floor((ms % 1000) / 100);
    return `${mm}:${ss}.${tenths}`;
  }
  return `${mm}:${ss}`;
}

export class ChessClock {
  constructor({
    timeControl = '5|0',
    onFlagFall = null,
    now = () => Date.now(),
  } = {}) {
    this.timeControl = timeControl;
    this.onFlagFall = typeof onFlagFall === 'function' ? onFlagFall : null;
    this.now = now;

    const parsed = parseTimeControl(timeControl);
    this.isUntimed = parsed.isUntimed;
    this.baseMs = parsed.baseSeconds !== null ? parsed.baseSeconds * 1000 : null;
    this.incrementMs = parsed.incrementSeconds * 1000;

    this.whiteTimeMs = this.baseMs;
    this.blackTimeMs = this.baseMs;
    this.activeColor = null;
    this.isRunning = false;
    this.lastTickTimestamp = null;
    this.flagFallenColor = null;
  }

  _normalizeColor(color) {
    if (!color) return null;
    const lower = String(color).toLowerCase();
    if (lower === 'w' || lower === 'white') return 'white';
    if (lower === 'b' || lower === 'black') return 'black';
    throw new RangeError(`Unknown color: ${color}`);
  }

  start(initialColor = 'white', nowMs = this.now()) {
    if (this.isUntimed) return;
    const color = this._normalizeColor(initialColor);
    this.activeColor = color;
    this.isRunning = true;
    this.lastTickTimestamp = nowMs;
  }

  _updateActiveColorElapsed(nowMs = this.now()) {
    if (!this.isRunning || !this.activeColor || this.isUntimed || this.lastTickTimestamp === null) {
      return;
    }
    const elapsed = Math.max(0, nowMs - this.lastTickTimestamp);
    if (this.activeColor === 'white') {
      this.whiteTimeMs = Math.max(0, this.whiteTimeMs - elapsed);
      if (this.whiteTimeMs <= 0 && !this.flagFallenColor) {
        this.flagFallenColor = 'white';
        this.isRunning = false;
        this.onFlagFall?.('white');
      }
    } else if (this.activeColor === 'black') {
      this.blackTimeMs = Math.max(0, this.blackTimeMs - elapsed);
      if (this.blackTimeMs <= 0 && !this.flagFallenColor) {
        this.flagFallenColor = 'black';
        this.isRunning = false;
        this.onFlagFall?.('black');
      }
    }
    this.lastTickTimestamp = nowMs;
  }

  switchTurn(nextColor, nowMs = this.now()) {
    if (this.isUntimed) return;
    this._updateActiveColorElapsed(nowMs);

    if (this.flagFallenColor) return;

    // Apply increment to the color that just completed its turn
    if (this.activeColor === 'white') {
      this.whiteTimeMs += this.incrementMs;
    } else if (this.activeColor === 'black') {
      this.blackTimeMs += this.incrementMs;
    }

    this.activeColor = this._normalizeColor(nextColor);
    this.lastTickTimestamp = nowMs;
    this.isRunning = true;
  }

  pause(nowMs = this.now()) {
    if (this.isUntimed) return;
    this._updateActiveColorElapsed(nowMs);
    this.isRunning = false;
  }

  resume(nowMs = this.now()) {
    if (this.isUntimed || this.flagFallenColor) return;
    this.lastTickTimestamp = nowMs;
    this.isRunning = true;
  }

  getTime(color, nowMs = this.now()) {
    if (this.isUntimed) return null;
    const normalized = this._normalizeColor(color);
    if (this.isRunning && this.activeColor === normalized && this.lastTickTimestamp !== null) {
      const elapsed = Math.max(0, nowMs - this.lastTickTimestamp);
      const remaining = (normalized === 'white' ? this.whiteTimeMs : this.blackTimeMs) - elapsed;
      return Math.max(0, remaining);
    }
    return normalized === 'white' ? this.whiteTimeMs : this.blackTimeMs;
  }

  isFlagFallen(color, nowMs = this.now()) {
    if (this.isUntimed) return false;
    const time = this.getTime(color, nowMs);
    return time !== null && time <= 0;
  }

  state(nowMs = this.now()) {
    return {
      timeControl: this.timeControl,
      isUntimed: this.isUntimed,
      activeColor: this.activeColor,
      isRunning: this.isRunning,
      whiteTimeMs: this.getTime('white', nowMs),
      blackTimeMs: this.getTime('black', nowMs),
      flagFallenColor: this.flagFallenColor,
    };
  }
}