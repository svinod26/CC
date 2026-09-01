import assert from 'node:assert/strict';
import test from 'node:test';
import { sortSeasons } from '../src/lib/season.ts';

test('sorts the fall season after spring in the same year', () => {
  const seasons = [
    { id: 'spring', name: 'S2026', year: 2026 },
    { id: 'fall', name: 'F2026', year: 2026 },
    { id: 'old', name: 'F2025', year: 2025 }
  ];
  assert.deepEqual(sortSeasons(seasons).map((season) => season.id), ['fall', 'spring', 'old']);
});
