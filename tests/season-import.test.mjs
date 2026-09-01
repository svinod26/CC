import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { parseSeasonWorkbook } from '../src/lib/excel.ts';
import { planSeasonImport, seedManualSeasonTeams } from '../src/lib/season-import-plan.ts';
import {
  sameSeasonImportTeamName,
  selectionModeForEditedTeamName
} from '../src/lib/season-import-team.ts';

// These tests import only the pure parser/planner. They never import Prisma or load .env.
const fixturePath = path.resolve('tests/fixtures/ERIC F2026.xlsx');
const fixtureBuffer = fs.readFileSync(fixturePath);
const fixtureArrayBuffer = fixtureBuffer.buffer.slice(
  fixtureBuffer.byteOffset,
  fixtureBuffer.byteOffset + fixtureBuffer.byteLength
);

const catalogPlayer = ({ id, name, email = `${id}@example.com`, aliases = [] }) => ({
  id,
  name,
  email,
  updatedAt: '2026-08-31T12:00:00.000Z',
  aliases: aliases.map((alias) => ({
    alias,
    aliasKey: alias.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
  }))
});

const team = (id, name, selectionMode = 'RENAMED') => ({
  id,
  sourceName: name,
  name,
  selectionMode,
  source: 'Manual entry'
});
const roster = (id, rawName, teamName, playerId = null, rememberAlias = false, entryMode = 'WORKBOOK') => ({
  id,
  entryMode,
  rawName,
  teamId: `team-${teamName.toLowerCase()}`,
  teamName,
  source: 'Manual entry',
  playerId,
  rememberAlias
});
const schedule = (id, week, home, away) => ({
  id,
  week,
  homeTeamId: home ? `team-${home.toLowerCase()}` : '',
  awayTeamId: away ? `team-${away.toLowerCase()}` : '',
  home,
  away,
  source: 'Manual entry'
});
const draft = ({ teams = [team('team-sea', 'Sea')], players = [], games = [] } = {}) => ({
  layout: 'MANUAL',
  seasonName: 'F2026',
  year: 2026,
  teams,
  players,
  schedule: games,
  sourceWarnings: []
});
const teamCatalog = (...names) => ({
  seasonId: 'season-s2026',
  seasonName: 'S2026',
  teams: names.map((name) => ({ name }))
});

test('clears the renamed state when an edited team returns to its prior-season name', () => {
  const previousSeasonNames = ['Candice?', 'E', 'F', 'Garg', 'Migos', 'Sea'];

  assert.equal(selectionModeForEditedTeamName({
    sourceName: 'Candice?',
    nextName: '  CANDICE? ',
    previousSeasonNames
  }), 'EXISTING');
  assert.equal(sameSeasonImportTeamName(' Candice? ', 'CANDICE?'), true);
});

test('retains the renamed state for a new xlsx name or a different existing team', () => {
  const previousSeasonNames = ['E', 'Sea'];

  assert.equal(selectionModeForEditedTeamName({
    sourceName: 'See',
    nextName: 'See',
    previousSeasonNames
  }), 'RENAMED');
  assert.equal(selectionModeForEditedTeamName({
    sourceName: 'Sea',
    nextName: 'E',
    previousSeasonNames
  }), 'RENAMED');
});

test('parses the exact ERIC F2026 raw workbook into the expected League draft', () => {
  const parsed = parseSeasonWorkbook(fixtureArrayBuffer, 'F2026', 2026);

  assert.equal(parsed.layout, 'CENTURY_CUP_RAW');
  assert.equal(parsed.seasonName, 'F2026');
  assert.equal(parsed.year, 2026);
  assert.deepEqual(parsed.teams.map((item) => item.name), ['E', 'Garg', 'Migos', 'Sea', 'Candice?', 'F']);
  assert.ok(parsed.teams.every((item) => item.sourceName === item.name && item.selectionMode === null));
  assert.equal(parsed.players.length, 42);
  assert.ok(parsed.players.every((item) => item.entryMode === 'WORKBOOK'));
  assert.equal(parsed.schedule.length, 21);
  assert.ok(parsed.players.every((item) => parsed.teams.some((team) => team.id === item.teamId)));
  assert.ok(parsed.schedule.every((item) => (
    parsed.teams.some((team) => team.id === item.homeTeamId) &&
    parsed.teams.some((team) => team.id === item.awayTeamId)
  )));
  assert.deepEqual(parsed.schedule.slice(0, 3).map(({ week, home, away }) => ({ week, home, away })), [
    { week: 1, home: 'Candice?', away: 'Migos' },
    { week: 1, home: 'Garg', away: 'F' },
    { week: 1, home: 'E', away: 'Sea' }
  ]);
  assert.deepEqual(parsed.schedule.slice(-3).map(({ week, home, away }) => ({ week, home, away })), [
    { week: 7, home: 'Migos', away: 'Garg' },
    { week: 7, home: 'Candice?', away: 'Sea' },
    { week: 7, home: 'E', away: 'F' }
  ]);
  assert.ok(parsed.players.some((item) => item.rawName === 'Liam Johnson' && item.teamName === 'Sea'));
  assert.ok(parsed.players.some((item) => item.rawName === 'Owen' && item.teamName === 'Garg'));
  assert.equal(parsed.sourceWarnings.filter((warning) => warning.code === 'MIRRORED_SCHEDULE_ROW').length, 0);
  assert.equal(parsed.sourceWarnings.filter((warning) => warning.code === 'INCOMPLETE_SCHEDULE_ROW').length, 0);
  assert.ok(parsed.schedule.every((item) => /![A-N][3-5]:[A-N][3-5]$/.test(item.source)));
});

test('warns about an incomplete game inside the authoritative raw schedule rows', () => {
  const workbook = XLSX.read(fixtureArrayBuffer, { type: 'array' });
  const scheduleSheet = workbook.Sheets['Full Schedule'];
  assert.ok(scheduleSheet);
  delete scheduleSheet.B3;

  const modifiedWorkbook = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const parsed = parseSeasonWorkbook(modifiedWorkbook, 'F2026', 2026);
  const incompleteWarnings = parsed.sourceWarnings.filter(
    (warning) => warning.code === 'INCOMPLETE_SCHEDULE_ROW'
  );

  assert.equal(parsed.schedule.length, 20);
  assert.deepEqual(incompleteWarnings, [{
    code: 'INCOMPLETE_SCHEDULE_ROW',
    source: 'Full Schedule!A3:B3',
    message: 'Week 1 contains a schedule row with only one team.'
  }]);
});

test('retains compatibility with the existing normalized F2026 import layout', () => {
  const normalizedBuffer = fs.readFileSync(path.resolve('F2026-import.xlsx'));
  const normalizedArrayBuffer = normalizedBuffer.buffer.slice(
    normalizedBuffer.byteOffset,
    normalizedBuffer.byteOffset + normalizedBuffer.byteLength
  );
  const parsed = parseSeasonWorkbook(normalizedArrayBuffer, 'F2026-copy', 2026);

  assert.equal(parsed.layout, 'NORMALIZED');
  assert.equal(parsed.teams.length, 6);
  assert.equal(parsed.players.length, 42);
  assert.equal(parsed.schedule.length, 21);
});

test('carries forward exact normalized team names from the latest League season', () => {
  const parsed = parseSeasonWorkbook(fixtureArrayBuffer, 'F2026', 2026);
  const result = planSeasonImport(
    parsed,
    [],
    teamCatalog('E', 'Garg', 'Migos', 'Sea', 'Candice?', 'F')
  );

  assert.ok(result.draft.teams.every((item) => item.selectionMode === 'EXISTING'));
  assert.equal(result.issues.some((issue) => issue.code === 'NEW_TEAM_NAME'), false);
  assert.equal(result.teamSourceSeason?.name, 'S2026');
  assert.deepEqual(result.teamOptions.map((item) => item.name), ['Candice?', 'E', 'F', 'Garg', 'Migos', 'Sea']);
});

test('keeps a different workbook team name and warns the admin to verify it', () => {
  const result = planSeasonImport(
    draft({ teams: [team('team-see', 'See', null)] }),
    [],
    teamCatalog('Sea', 'E', 'Garg', 'Migos', 'Candice?', 'F')
  );

  assert.equal(result.draft.teams[0].name, 'See');
  assert.equal(result.draft.teams[0].selectionMode, 'RENAMED');
  assert.ok(result.issues.some((issue) => issue.code === 'NEW_TEAM_NAME' && issue.path === 'team-see' && !issue.blocking));
  assert.ok(result.issues.some((issue) => issue.code === 'PREVIOUS_TEAMS_NOT_USED' && issue.message.includes('Sea')));
});

test('blocks duplicate team names and treats an unfamiliar submitted name as new', () => {
  const result = planSeasonImport(
    draft({
      teams: [
        team('first', 'Sea', 'EXISTING'),
        team('second', 'Sea', 'EXISTING'),
        team('third', 'Retired Team', 'EXISTING')
      ]
    }),
    [],
    teamCatalog('Sea', 'E')
  );

  assert.ok(result.issues.some((issue) => issue.code === 'DUPLICATE_TEAM'));
  assert.ok(result.issues.some((issue) => issue.code === 'NEW_TEAM_NAME' && issue.path === 'third' && !issue.blocking));
});

test('allows an explicit new team name and canonicalizes an existing name automatically', () => {
  const renamed = planSeasonImport(
    draft({ teams: [team('renamed', 'Ocean', 'RENAMED')] }),
    [],
    teamCatalog('Sea')
  );
  const existingAsRename = planSeasonImport(
    draft({ teams: [team('existing', 'Sea', 'RENAMED')] }),
    [],
    teamCatalog('Sea')
  );
  const changedToAnotherExisting = planSeasonImport(
    draft({ teams: [{ ...team('changed', 'Sea', 'RENAMED'), name: 'E' }] }),
    [],
    teamCatalog('Sea', 'E')
  );

  assert.ok(renamed.issues.some((issue) => issue.code === 'NEW_TEAM_NAME' && !issue.blocking));
  assert.equal(existingAsRename.draft.teams[0].selectionMode, 'EXISTING');
  assert.equal(existingAsRename.issues.some((issue) => issue.code === 'NEW_TEAM_NAME'), false);
  assert.ok(changedToAnotherExisting.issues.some((issue) => issue.code === 'TEAM_CHANGED_TO_DIFFERENT_EXISTING' && issue.blocking));
});

test('keeps roster and schedule assignments attached by team ID when a team is renamed', () => {
  const existingPlayer = catalogPlayer({ id: 'player-one', name: 'Player One' });
  const submitted = draft({
    teams: [team('team-sea', 'Ocean', 'RENAMED'), team('team-e', 'E', 'EXISTING')],
    players: [{ ...roster('player-row', 'Player One', 'Sea', existingPlayer.id), teamName: 'Sea' }],
    games: [schedule('game-one', 1, 'Sea', 'E')]
  });
  const result = planSeasonImport(submitted, [existingPlayer], teamCatalog('Sea', 'E'));

  assert.equal(result.draft.players[0].teamId, 'team-sea');
  assert.equal(result.draft.players[0].teamName, 'Ocean');
  assert.equal(result.draft.schedule[0].homeTeamId, 'team-sea');
  assert.equal(result.draft.schedule[0].home, 'Ocean');
  assert.equal(result.issues.some((issue) => issue.code === 'UNKNOWN_ROSTER_TEAM' || issue.code === 'UNKNOWN_SCHEDULE_TEAM'), false);
});

test('seeds a new manual import from the latest League team template only once', () => {
  const empty = draft({ teams: [] });
  const catalog = teamCatalog('E', 'Garg', 'Migos', 'Sea', 'Candice?', 'F');
  const seeded = seedManualSeasonTeams(empty, catalog);
  const unchanged = seedManualSeasonTeams(seeded, catalog);

  assert.deepEqual(seeded.teams.map((item) => item.name), ['E', 'Garg', 'Migos', 'Sea', 'Candice?', 'F']);
  assert.ok(seeded.teams.every((item) => item.selectionMode === 'EXISTING'));
  assert.strictEqual(unchanged, seeded);
});

test('derives a manual roster row name from the selected existing Player', () => {
  const existing = catalogPlayer({ id: 'player-manual', name: 'Canonical Player' });
  const manualRow = {
    ...roster('manual-row', 'Forged Name', 'Sea', existing.id, true, 'MANUAL'),
    email: 'forged@example.com'
  };
  const result = planSeasonImport(draft({ players: [manualRow] }), [existing]);

  assert.equal(result.draft.players[0].rawName, 'Canonical Player');
  assert.equal(result.draft.players[0].email, undefined);
  assert.equal(result.draft.players[0].rememberAlias, false);
  assert.equal(result.playerRows[0].status, 'MANUAL');
  assert.equal(result.playerRows[0].canRememberAlias, false);
  assert.equal(result.canCommit, true);
});

test('requires an existing Player selection for a manual roster row without inventing a name', () => {
  const result = planSeasonImport(
    draft({ players: [roster('manual-empty', '', 'Sea', null, false, 'MANUAL')] }),
    []
  );

  assert.ok(result.issues.some((issue) => issue.code === 'MISSING_PLAYER_SELECTION' && issue.path === 'manual-empty'));
  assert.equal(result.issues.some((issue) => issue.code === 'MISSING_PLAYER_NAME' && issue.path === 'manual-empty'), false);
  assert.equal(result.canCommit, false);
});

test('does not auto-resolve a short name when an alias and another plausible Player conflict', () => {
  const players = [
    catalogPlayer({ id: 'owen-danganan', name: 'Owen Danganan' }),
    catalogPlayer({ id: 'owen-hershey', name: 'Owen Hershey', aliases: ['Owen'] })
  ];
  const result = planSeasonImport(
    draft({ players: [roster('row-owen', 'Owen', 'Sea')] }),
    players
  );

  assert.equal(result.playerRows[0].status, 'AMBIGUOUS');
  assert.equal(result.playerRows[0].resolvedPlayerId, null);
  assert.deepEqual(new Set(result.playerRows[0].candidates.map((item) => item.id)), new Set(['owen-danganan', 'owen-hershey']));
  assert.ok(result.issues.some((issue) => issue.code === 'AMBIGUOUS_PLAYER' && issue.blocking));
  assert.equal(result.canCommit, false);
});

test('keeps a distinctive explicit alias when it merely begins with another first name', () => {
  const samos = catalogPlayer({ id: 'samos', name: 'Miguel Samos Rivas', aliases: ['Samos'] });
  const sam = catalogPlayer({ id: 'sam', name: 'Sam Ram' });
  const result = planSeasonImport(
    draft({ players: [roster('row-samos', 'Samos', 'Sea')] }),
    [samos, sam]
  );

  assert.equal(result.playerRows[0].status, 'ALIAS');
  assert.equal(result.playerRows[0].resolvedPlayerId, samos.id);
});

test('flags a missing player name instead of silently dropping the row', () => {
  const result = planSeasonImport(
    draft({ players: [roster('missing-name', '   ', 'Sea')] }),
    []
  );

  assert.ok(result.issues.some((issue) => issue.code === 'MISSING_PLAYER_NAME' && issue.path === 'missing-name'));
  assert.equal(result.canCommit, false);
});

test('blocks the same existing Player from being assigned twice', () => {
  const existing = catalogPlayer({ id: 'william', name: 'William He', aliases: ['Will He'] });
  const result = planSeasonImport(
    draft({
      teams: [team('team-sea', 'Sea'), team('team-e', 'E')],
      players: [
        roster('will-one', 'William He', 'Sea', existing.id),
        roster('will-two', 'Will He', 'E', existing.id)
      ]
    }),
    [existing]
  );

  assert.ok(result.issues.some((issue) => issue.code === 'DUPLICATE_PLAYER' && issue.blocking));
  assert.equal(result.canCommit, false);
});

test('blocks a roster row containing an incorrect team name', () => {
  const existing = catalogPlayer({ id: 'ryan', name: 'Ryan Dannegger' });
  const result = planSeasonImport(
    draft({ players: [roster('bad-team', 'Ryan Dannegger', 'See', existing.id)] }),
    [existing]
  );

  assert.ok(result.issues.some((issue) => issue.code === 'UNKNOWN_ROSTER_TEAM' && issue.path === 'bad-team'));
  assert.equal(result.canCommit, false);
});

test('blocks duplicate team names after trimming and case normalization', () => {
  const result = planSeasonImport(
    draft({ teams: [team('one', 'Sea'), team('two', ' sea ')], players: [roster('row', 'Player', 'Sea')] }),
    []
  );

  assert.ok(result.issues.some((issue) => issue.code === 'DUPLICATE_TEAM'));
});

test('blocks unknown schedule teams and double-booked teams', () => {
  const teams = [team('team-sea', 'Sea'), team('team-e', 'E'), team('team-garg', 'Garg')];
  const existing = catalogPlayer({ id: 'player', name: 'Existing Player' });
  const result = planSeasonImport(
    draft({
      teams,
      players: [roster('player-row', existing.name, 'Sea', existing.id)],
      games: [
        schedule('game-one', 1, 'Sea', 'E'),
        schedule('game-two', 1, 'Sea', 'Garg'),
        schedule('game-three', 2, 'Sea', 'Typo Team')
      ]
    }),
    [existing]
  );

  assert.ok(result.issues.some((issue) => issue.code === 'TEAM_DOUBLE_BOOKED'));
  assert.ok(result.issues.some((issue) => issue.code === 'UNKNOWN_SCHEDULE_TEAM' && issue.path === 'game-three'));
  assert.equal(result.canCommit, false);
});

test('allows a manually confirmed existing Player and an optional empty schedule', () => {
  const existing = catalogPlayer({ id: 'ryan', name: 'Ryan Dannegger' });
  const result = planSeasonImport(
    draft({ players: [roster('shmam', 'Shmam', 'Sea', existing.id, true)] }),
    [existing]
  );

  assert.equal(result.playerRows[0].status, 'MANUAL');
  assert.equal(result.playerRows[0].canRememberAlias, true);
  assert.ok(result.issues.some((issue) => issue.code === 'NO_SCHEDULE' && !issue.blocking));
  assert.equal(result.canCommit, true);
});

test('allows a file-scoped Owen choice but blocks saving the ambiguous name globally', () => {
  const danganan = catalogPlayer({ id: 'owen-danganan', name: 'Owen Danganan' });
  const hershey = catalogPlayer({ id: 'owen-hershey', name: 'Owen Hershey', aliases: ['Owen'] });
  const result = planSeasonImport(
    draft({ players: [roster('owen', 'Owen', 'Sea', danganan.id, true)] }),
    [danganan, hershey]
  );

  assert.equal(result.playerRows[0].resolvedPlayerId, danganan.id);
  assert.equal(result.playerRows[0].canRememberAlias, false);
  assert.ok(result.issues.some((issue) => issue.code === 'UNSAFE_ALIAS' && issue.blocking));
});

test('season import implementation contains no Player or User mutations', () => {
  const source = fs.readFileSync(path.resolve('src/lib/admin-season-import.ts'), 'utf8');
  assert.doesNotMatch(source, /\b(?:tx|prisma)\.player\.(?:create|update|upsert|delete)/);
  assert.doesNotMatch(source, /\b(?:tx|prisma)\.user\.(?:create|update|upsert|delete)/);
});
