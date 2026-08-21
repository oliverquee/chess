import test from 'node:test';
import assert from 'node:assert/strict';
import { ChessClock, formatClockTime, parseTimeControl } from '../engine/clock.js';

test('parseTimeControl parses standard formats and handles untimed', () => {
  assert.deepEqual(parseTimeControl('5|0'), { baseSeconds: 300, incrementSeconds: 0, isUntimed: false });
  assert.deepEqual(parseTimeControl('3|2'), { baseSeconds: 180, incrementSeconds: 2, isUntimed: false });
  assert.deepEqual(parseTimeControl('1|0'), { baseSeconds: 60, incrementSeconds: 0, isUntimed: false });
  assert.deepEqual(parseTimeControl('none'), { baseSeconds: null, incrementSeconds: 0, isUntimed: true });
  assert.deepEqual(parseTimeControl('untimed'), { baseSeconds: null, incrementSeconds: 0, isUntimed: true });
  assert.throws(() => parseTimeControl('invalid'), /Invalid time control format/);
});

test('formatClockTime formats mm:ss and tenths under 10 seconds', () => {
  assert.equal(formatClockTime(300000), '05:00');
  assert.equal(formatClockTime(65000), '01:05');
  assert.equal(formatClockTime(9500), '00:09.5');
  assert.equal(formatClockTime(500), '00:00.5');
  assert.equal(formatClockTime(0), '00:00');
  assert.equal(formatClockTime(-100), '00:00');
});

test('ChessClock tracks time accurately and switches turns with increment', () => {
  let currentTime = 1000000;
  const now = () => currentTime;

  const clock = new ChessClock({
    timeControl: '3|2', // 180s base (180000ms), 2s inc (2000ms)
    now,
  });

  assert.equal(clock.getTime('white', currentTime), 180000);
  assert.equal(clock.getTime('black', currentTime), 180000);

  // White starts
  clock.start('white', currentTime);

  // 10 seconds pass
  currentTime += 10000;
  assert.equal(clock.getTime('white', currentTime), 170000);
  assert.equal(clock.getTime('black', currentTime), 180000);

  // White makes move -> gets +2s increment, switch to black
  clock.switchTurn('black', currentTime);
  assert.equal(clock.getTime('white', currentTime), 172000);
  assert.equal(clock.getTime('black', currentTime), 180000);

  // Black thinks for 5 seconds
  currentTime += 5000;
  assert.equal(clock.getTime('white', currentTime), 172000);
  assert.equal(clock.getTime('black', currentTime), 175000);

  // Black makes move -> gets +2s increment, switch to white
  clock.switchTurn('white', currentTime);
  assert.equal(clock.getTime('white', currentTime), 172000);
  assert.equal(clock.getTime('black', currentTime), 177000);
});

test('ChessClock pause and resume handles app backgrounding without drift', () => {
  let currentTime = 1000000;
  const now = () => currentTime;

  const clock = new ChessClock({
    timeControl: '5|0',
    now,
  });

  clock.start('white', currentTime);

  // 20s pass
  currentTime += 20000;
  assert.equal(clock.getTime('white', currentTime), 280000);

  // App paused / backgrounded
  clock.pause(currentTime);

  // App is in background for 60 seconds
  currentTime += 60000;
  assert.equal(clock.getTime('white', currentTime), 280000); // Time did not elapse while paused!

  // App resumes
  clock.resume(currentTime);

  // 10s pass while active again
  currentTime += 10000;
  assert.equal(clock.getTime('white', currentTime), 270000);
});

test('ChessClock fires onFlagFall callback when time reaches 0', () => {
  let currentTime = 1000000;
  const now = () => currentTime;
  let flagFallen = null;

  const clock = new ChessClock({
    timeControl: '1|0', // 60s
    onFlagFall: (color) => { flagFallen = color; },
    now,
  });

  clock.start('black', currentTime);

  currentTime += 59000;
  assert.equal(clock.isFlagFallen('black', currentTime), false);
  assert.equal(flagFallen, null);

  currentTime += 2000; // 61s total -> flag fall!
  assert.equal(clock.isFlagFallen('black', currentTime), true);
  assert.equal(clock.getTime('black', currentTime), 0);

  // Turn switch triggers callback if not already triggered
  clock.switchTurn('white', currentTime);
  assert.equal(flagFallen, 'black');
});

test('Untimed ChessClock never flag falls', () => {
  let currentTime = 1000000;
  const clock = new ChessClock({ timeControl: 'none', now: () => currentTime });
  clock.start('white', currentTime);
  currentTime += 99999999;
  assert.equal(clock.isUntimed, true);
  assert.equal(clock.isFlagFallen('white', currentTime), false);
  assert.equal(clock.getTime('white', currentTime), null);
});

