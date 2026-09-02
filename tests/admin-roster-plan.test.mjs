import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  AdminRosterPlanError,
  planAdminRosterAddition,
  planAdminRosterAssignment
} from '../src/lib/admin-roster-plan.ts';

const normalizeEmail = (value) => value.trim().toLowerCase();
const canonicalizeEmail = (value) => {
  const normalized = normalizeEmail(value);
  const [local, domain] = normalized.split('@');
  if (domain !== 'gmail.com' && domain !== 'googlemail.com') return normalized;
  return `${local.split('+')[0].replaceAll('.', '')}@gmail.com`;
};
const nameKey = (value) => value.trim().replace(/\s+/g, ' ').toLowerCase();
const aliasKey = (value) => nameKey(value).replace(/[^a-z0-9]/g, '');
const player = ({ id, name, email = null, aliases = [] }) => ({
  id,
  name,
  canonicalEmail: email ? canonicalizeEmail(email) : null,
  nameKey: nameKey(name),
  identityKey: aliasKey(name),
  aliasKeys: aliases.map(aliasKey)
});
const user = ({ id, name, email }) => ({
  id,
  name,
  email,
  normalizedEmail: normalizeEmail(email),
  canonicalEmail: canonicalizeEmail(email)
});
const membership = ({ id, playerId, teamId, teamName, isActive = true }) => ({
  id,
  playerId,
  teamId,
  teamName,
  isActive
});
const plan = ({
  players = [],
  users = [],
  name = 'New Player',
  email = 'new.player@example.com'
} = {}) =>
  planAdminRosterAddition({
    players,
    users,
    submittedName: name,
    submittedNameKey: nameKey(name),
    submittedAliasKey: aliasKey(name),
    submittedEmail: normalizeEmail(email),
    submittedCanonicalEmail: canonicalizeEmail(email)
  });

const expectCode = (code, callback) => {
  assert.throws(callback, (error) => error instanceof AdminRosterPlanError && error.code === code);
};

test('plans one new Player with the mandatory submitted email', () => {
  const result = plan();
  assert.equal(result.action, 'CREATE_PLAYER');
  assert.equal(result.playerName, 'New Player');
  assert.equal(result.resolvedEmail, 'new.player@example.com');
  assert.equal(result.changed, true);
  assert.deepEqual(result.requiredConfirmations, []);
});

test('new-player flow rejects an existing Player matched by the same name and email', () => {
  const existing = player({ id: 'player-1', name: 'Returning Player', email: 'returning@example.com' });
  expectCode('CONFLICT', () =>
    plan({ players: [existing], name: 'Returning Player', email: 'returning@example.com' })
  );
});

test('new-player flow rejects a name-matched Player with no email', () => {
  const existing = player({ id: 'player-1', name: 'Returning Player' });
  expectCode('CONFLICT', () =>
    plan({ players: [existing], name: 'Returning Player', email: 'returning@example.com' })
  );
});

test('new-player flow rejects an existing Player matched through an explicit alias', () => {
  const existing = player({ id: 'player-1', name: 'William He', email: 'will@example.com', aliases: ['Will He'] });
  expectCode('CONFLICT', () =>
    plan({ players: [existing], name: 'Will He', email: 'will@example.com' })
  );
});

test('new-player flow rejects a punctuation-equivalent Player name', () => {
  const existing = player({ id: 'player-1', name: "O'Wen Danganan", email: 'owen@example.com' });
  expectCode('CONFLICT', () =>
    plan({ players: [existing], name: 'Owen-Danganan', email: 'owen@example.com' })
  );
});

test('new-player flow rejects an existing Player matched only by email', () => {
  const existing = player({ id: 'player-1', name: 'Canonical Name', email: 'same@example.com' });
  expectCode('CONFLICT', () =>
    plan({ players: [existing], name: 'Different Name', email: 'same@example.com' })
  );
});

test('rejects changing an existing non-null Player email through roster management', () => {
  const existing = player({ id: 'player-1', name: 'Returning Player', email: 'old@example.com' });
  expectCode('CONFLICT', () =>
    plan({ players: [existing], name: 'Returning Player', email: 'new@example.com' })
  );
});

test('rejects when the submitted name and email resolve to different Players', () => {
  expectCode('CONFLICT', () =>
    plan({
      players: [
        player({ id: 'player-name', name: 'Returning Player', email: 'name@example.com' }),
        player({ id: 'player-email', name: 'Someone Else', email: 'submitted@example.com' })
      ],
      name: 'Returning Player',
      email: 'submitted@example.com'
    })
  );
});

test('rejects ambiguous equivalent Gmail Player emails', () => {
  expectCode('AMBIGUOUS', () =>
    plan({
      players: [
        player({ id: 'player-1', name: 'One', email: 'first.last@gmail.com' }),
        player({ id: 'player-2', name: 'Two', email: 'firstlast+other@googlemail.com' })
      ],
      name: 'Someone',
      email: 'firstlast@gmail.com'
    })
  );
});

test('requires confirmation before linking a new Player to a standalone User', () => {
  const result = plan({
    users: [user({ id: 'user-1', name: 'Existing Account', email: 'account@example.com' })],
    name: 'New Player',
    email: 'account@example.com'
  });
  assert.equal(result.linkedUserId, 'user-1');
  assert.equal(result.resolvedEmail, 'account@example.com');
  assert.deepEqual(result.requiredConfirmations, ['LINK_EXISTING_USER']);
});

test('new-player flow rejects an existing Player even when a User has the same email', () => {
  const existingPlayer = player({ id: 'player-1', name: 'Registered Player', email: 'linked@example.com' });
  expectCode('CONFLICT', () =>
    plan({
      players: [existingPlayer],
      users: [user({ id: 'user-1', name: 'Registered Player', email: 'linked@example.com' })],
      name: 'Registered Player',
      email: 'linked@example.com'
    })
  );
});

test('existing-player assignment reactivates an inactive historical membership', () => {
  const result = planAdminRosterAssignment({
    playerId: 'player-1',
    playerName: 'Returning Player',
    memberships: [
      membership({ id: 'roster-old', playerId: 'player-1', teamId: 'team-sea', teamName: 'Sea', isActive: false })
    ],
    destinationTeamId: 'team-sea',
    hasOpenLeagueGame: false
  });
  assert.equal(result.action, 'ASSIGN_PLAYER');
  assert.equal(result.destinationMembership.id, 'roster-old');
  assert.equal(result.changed, true);
});

test('moves back to a former team by reactivating its existing membership', () => {
  const result = planAdminRosterAssignment({
    playerId: 'player-1',
    playerName: 'Returning Player',
    memberships: [
      membership({ id: 'roster-current', playerId: 'player-1', teamId: 'team-e', teamName: 'E' }),
      membership({ id: 'roster-former', playerId: 'player-1', teamId: 'team-sea', teamName: 'Sea', isActive: false })
    ],
    destinationTeamId: 'team-sea',
    hasOpenLeagueGame: false
  });
  assert.equal(result.action, 'MOVE_PLAYER');
  assert.equal(result.activeMembership.id, 'roster-current');
  assert.equal(result.destinationMembership.id, 'roster-former');
});

test('rejects multiple active memberships instead of guessing which one to change', () => {
  expectCode('CONFLICT', () =>
    planAdminRosterAssignment({
      playerId: 'player-1',
      playerName: 'Returning Player',
      memberships: [
        membership({ id: 'roster-1', playerId: 'player-1', teamId: 'team-e', teamName: 'E' }),
        membership({ id: 'roster-2', playerId: 'player-1', teamId: 'team-f', teamName: 'F' })
      ],
      destinationTeamId: 'team-sea',
      hasOpenLeagueGame: false
    })
  );
});

test('plans an exact-player unassignment and requires confirmation', () => {
  const result = planAdminRosterAssignment({
    playerId: 'player-1',
    playerName: 'Returning Player',
    memberships: [membership({ id: 'roster-1', playerId: 'player-1', teamId: 'team-e', teamName: 'E' })],
    destinationTeamId: null,
    hasOpenLeagueGame: false
  });
  assert.equal(result.action, 'UNASSIGN_PLAYER');
  assert.deepEqual(result.requiredConfirmations, ['UNASSIGN_PLAYER']);
});

test('blocks moving or unassigning a player who is in an open League game', () => {
  expectCode('CONFLICT', () =>
    planAdminRosterAssignment({
      playerId: 'player-1',
      playerName: 'Returning Player',
      memberships: [membership({ id: 'roster-1', playerId: 'player-1', teamId: 'team-e', teamName: 'E' })],
      destinationTeamId: 'team-sea',
      hasOpenLeagueGame: true
    })
  );
});

test('returns a no-op when an unassigned player is unassigned again', () => {
  const result = planAdminRosterAssignment({
    playerId: 'player-1',
    playerName: 'Returning Player',
    memberships: [],
    destinationTeamId: null,
    hasOpenLeagueGame: false
  });
  assert.equal(result.action, 'NO_CHANGE');
  assert.equal(result.changed, false);
});

test('rejects multiple normalized name matches instead of choosing one', () => {
  expectCode('AMBIGUOUS', () =>
    plan({
      players: [
        player({ id: 'player-1', name: 'Same Name' }),
        player({ id: 'player-2', name: ' same   name ' })
      ],
      name: 'Same Name',
      email: 'unique@example.com'
    })
  );
});

test('new-player commit path can only create a Player and initial roster membership', async () => {
  const source = await readFile(new URL('../src/lib/admin-roster.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export async function addAdminRosterPlayer');
  const end = source.indexOf('export async function updateAdminRosterAssignment');
  assert.ok(start >= 0 && end > start);
  const additionSource = source.slice(start, end);

  assert.match(additionSource, /await tx\.player\.create\(/);
  assert.match(additionSource, /await tx\.teamRoster\.create\(/);
  assert.doesNotMatch(additionSource, /tx\.player\.(?:update|upsert|delete)/);
  assert.doesNotMatch(additionSource, /applyActiveRosterChange/);
  assert.doesNotMatch(additionSource, /MOVE_PLAYER|ASSIGN_PLAYER|emailWillBeAssigned/);
});
