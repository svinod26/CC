import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const between = (source, start, end) => source.split(start)[1]?.split(end)[0] ?? '';

test('home reads weekly events once and keeps performer links scoped to the same game', async () => {
  const source = await readSource('../src/app/page.tsx');
  const gamesQuery = between(source, 'const latestWeekGames =', 'const [weeklyEvents, weeklyLegacy]');
  const weeklyQueries = between(source, 'const [weeklyEvents, weeklyLegacy]', 'const recentPlayerGamesRaw');

  assert.doesNotMatch(gamesQuery, /events:\s*true|legacyStats:\s*true/);
  assert.match(weeklyQueries, /gameId:\s*true/);
  assert.match(source, /stat\.gameId === game\.id && stat\.playerId === player\.id/);
  assert.match(source, /event\.gameId === game\.id && event\.shooterId === player\.id/);
  assert.match(source, /if \(!isShot\(event\.resultType\)\) return/);
});

test('league-wide player reads project only the fields used by their calculations', async () => {
  const [dashboard, hub, compare] = await Promise.all([
    readSource('../src/components/player-dashboard.tsx'),
    readSource('../src/app/(app)/players/hub/page.tsx'),
    readSource('../src/app/(app)/players/compare/page.tsx')
  ]);

  const benchmark = dashboard.split('prisma.game.findMany({')[2] ?? '';
  assert.match(benchmark, /events:\s*\{ select:\s*\{ shooterId: true, resultType: true \} \}/);
  assert.doesNotMatch(benchmark, /events:\s*true|legacyStats:\s*true/);
  for (const source of [hub, compare]) {
    assert.doesNotMatch(source, /include:\s*\{ shooter: true, game:|include:\s*\{ player: true, game:/);
    assert.match(source, /shooter:\s*\{ select:\s*\{ name: true \} \}/);
    assert.match(source, /player:\s*\{ select:\s*\{ name: true \} \}/);
  }
});

test('team profile only fetches its own shot and legacy stat rows', async () => {
  const [profile, list] = await Promise.all([
    readSource('../src/app/(app)/teams/[id]/page.tsx'),
    readSource('../src/app/(app)/teams/page.tsx')
  ]);

  const gamesQuery = between(profile, 'const gamesRaw =', 'const games =');
  assert.match(gamesQuery, /events:\s*\{\s*where:\s*\{ offenseTeamId: team\.id \}/);
  assert.match(gamesQuery, /legacyStats:\s*\{\s*where:\s*\{ teamId: team\.id \}/);
  assert.match(gamesQuery, /legacyTeamStats:\s*\{ where:\s*\{ teamId: team\.id \}/);
  assert.doesNotMatch(list, /include:\s*\{ player: true \}/);
  assert.match(list, /select:\s*\{ defenseTeamId: true, cupsDelta: true \}/);
});
