import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { sortPlayerGamesBySeasonAndWeek } from '../src/lib/player-game-order.ts';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const chronologicalOrder =
  /orderBy:\s*\[\{ startedAt: 'desc' \}, \{ createdAt: 'desc' \}, \{ id: 'desc' \}\]/;

test('general chronological game lists order by date and never by week first', async () => {
  const [gameHistory, homePage, teamProfile] = await Promise.all([
    readSource('../src/app/(app)/games/page.tsx'),
    readSource('../src/app/page.tsx'),
    readSource('../src/app/(app)/teams/[id]/page.tsx')
  ]);

  for (const source of [gameHistory, homePage, teamProfile]) {
    assert.doesNotMatch(source, /return b\.weekNumber - a\.weekNumber/);
    assert.doesNotMatch(source, /const weekA = a\.scheduleEntry\?\.week/);
    assert.doesNotMatch(source, /scheduleEntry:\s*\{ week: 'desc' \}/);
    assert.match(source, chronologicalOrder);
  }
});

test('all-season player games sort by canonical season order, then descending week', () => {
  const seasons = [
    { id: 'spring-2026', name: 'S2026', year: 2026 },
    { id: 'fall-2025', name: 'F2025', year: 2025 },
    { id: 'fall-2026', name: 'F2026', year: 2026 }
  ];
  const game = (id, seasonId, week, startedAt) => ({
    id,
    seasonId,
    scheduleEntry: week === null ? null : { week },
    startedAt: new Date(startedAt),
    createdAt: new Date(startedAt)
  });
  const games = [
    game('old-imported-late', 'fall-2025', 7, '2026-07-07T15:00:00Z'),
    game('fall-current', 'fall-2026', 1, '2026-08-27T15:00:00Z'),
    game('spring-week-two', 'spring-2026', 2, '2026-06-01T15:00:00Z'),
    game('spring-week-seven', 'spring-2026', 7, '2026-05-01T15:00:00Z')
  ];

  assert.deepEqual(
    sortPlayerGamesBySeasonAndWeek(games, seasons).map((item) => item.id),
    ['fall-current', 'spring-week-seven', 'spring-week-two', 'old-imported-late']
  );
  assert.deepEqual(games.map((item) => item.id), [
    'old-imported-late',
    'fall-current',
    'spring-week-two',
    'spring-week-seven'
  ]);
});

test('player game ordering uses date tie-breakers and safely places incomplete records last', () => {
  const seasons = [{ id: 'fall-2026', name: 'F2026', year: 2026 }];
  const games = [
    {
      id: 'unknown-newer',
      seasonId: null,
      scheduleEntry: null,
      startedAt: new Date('2026-09-02T15:00:00Z'),
      createdAt: new Date('2026-09-02T15:00:00Z')
    },
    {
      id: 'same-week-older',
      seasonId: 'fall-2026',
      scheduleEntry: { week: 1 },
      startedAt: new Date('2026-08-26T15:00:00Z'),
      createdAt: new Date('2026-08-26T15:00:00Z')
    },
    {
      id: 'same-week-newer',
      seasonId: 'fall-2026',
      scheduleEntry: { week: 1 },
      startedAt: new Date('2026-08-27T15:00:00Z'),
      createdAt: new Date('2026-08-27T15:00:00Z')
    },
    {
      id: 'known-season-no-week',
      seasonId: 'fall-2026',
      scheduleEntry: null,
      startedAt: new Date('2026-09-01T15:00:00Z'),
      createdAt: new Date('2026-09-01T15:00:00Z')
    }
  ];

  assert.deepEqual(
    sortPlayerGamesBySeasonAndWeek(games, seasons).map((item) => item.id),
    ['same-week-newer', 'same-week-older', 'known-season-no-week', 'unknown-newer']
  );
});

test('player dashboard applies season/week ordering only to the all-seasons view', async () => {
  const source = await readSource('../src/components/player-dashboard.tsx');
  assert.match(
    source,
    /seasonValue === 'all' \? sortPlayerGamesBySeasonAndWeek\(games, seasonOptions \?\? \[\]\) : games/
  );
  assert.match(source, chronologicalOrder);
});

test('player profiles still default through current-season resolution', async () => {
  const source = await readSource('../src/app/(app)/players/[id]/page.tsx');
  assert.match(source, /resolveSeasonSelection\(seasons, query\.season\)/);
  assert.match(source, /seasonId=\{season\?\.id \?\? null\}/);
  assert.doesNotMatch(source, /query\.season \?\? 'all'/);
});
