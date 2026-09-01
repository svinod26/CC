import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizePlayerKey,
  normalizePlayerName,
  normalizePlayerNameKey
} from '../src/lib/player-name.ts';

test('normalizes whitespace without changing the displayed spelling', () => {
  assert.equal(normalizePlayerName('  Owen\u00a0  Danganan  '), 'Owen Danganan');
});

test('builds a case-insensitive name key', () => {
  assert.equal(normalizePlayerNameKey('  William   He '), 'william he');
});

test('builds the same alias key used by imports and exhibition games', () => {
  assert.equal(normalizePlayerKey(" O'Wen-Danganan "), 'owendanganan');
});
