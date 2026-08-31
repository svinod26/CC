import assert from 'node:assert/strict';
import test from 'node:test';
import { formatGameDuration } from '../src/lib/game-duration.ts';

test('formats a completed game in minutes', () => {
  assert.equal(
    formatGameDuration('2026-08-31T18:00:00.000Z', '2026-08-31T18:47:30.000Z'),
    '47m'
  );
});

test('formats a completed game in hours and minutes', () => {
  assert.equal(
    formatGameDuration('2026-08-31T18:00:00.000Z', '2026-08-31T19:12:00.000Z'),
    '1h 12m'
  );
});

test('formats a sub-minute game without displaying zero minutes', () => {
  assert.equal(
    formatGameDuration('2026-08-31T18:00:00.000Z', '2026-08-31T18:00:45.000Z'),
    '<1m'
  );
});

test('returns null until a game has ended', () => {
  assert.equal(formatGameDuration('2026-08-31T18:00:00.000Z', null), null);
});

test('returns null for invalid or negative durations', () => {
  assert.equal(formatGameDuration('invalid', '2026-08-31T18:00:00.000Z'), null);
  assert.equal(
    formatGameDuration('2026-08-31T19:00:00.000Z', '2026-08-31T18:00:00.000Z'),
    null
  );
});

test('accepts a duration of exactly five hours', () => {
  assert.equal(
    formatGameDuration('2026-08-31T18:00:00.000Z', '2026-08-31T23:00:00.000Z'),
    '5h'
  );
});

test('returns null for a duration longer than five hours', () => {
  assert.equal(
    formatGameDuration('2026-08-31T18:00:00.000Z', '2026-08-31T23:00:00.001Z'),
    null
  );
});
