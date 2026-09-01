import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AdminRosterPlanError,
  planAdminRosterAddition
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
  email,
  normalizedEmail: email ? normalizeEmail(email) : null,
  canonicalEmail: email ? canonicalizeEmail(email) : null,
  nameKey: nameKey(name),
  identityKey: aliasKey(name),
  aliasKeys: aliases.map(aliasKey),
  updatedAt: '2026-08-31T12:00:00.000Z'
});
const user = ({ id, name, email }) => ({
  id,
  name,
  email,
  normalizedEmail: normalizeEmail(email),
  canonicalEmail: canonicalizeEmail(email)
});
const membership = ({ id, playerId, teamId, teamName }) => ({
  id,
  playerId,
  teamId,
  teamName
});
const plan = ({
  players = [],
  users = [],
  memberships = [],
  teamId = 'team-sea',
  name = 'New Player',
  email = 'new.player@example.com'
} = {}) =>
  planAdminRosterAddition({
    players,
    users,
    memberships,
    teamId,
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
  assert.equal(result.playerWillBeCreated, true);
  assert.equal(result.playerName, 'New Player');
  assert.equal(result.resolvedEmail, 'new.player@example.com');
  assert.equal(result.changed, true);
  assert.deepEqual(result.requiredConfirmations, []);
});

test('reuses an existing Player matched by the same name and email', () => {
  const existing = player({ id: 'player-1', name: 'Returning Player', email: 'returning@example.com' });
  const result = plan({ players: [existing], name: 'Returning Player', email: 'returning@example.com' });
  assert.equal(result.playerId, 'player-1');
  assert.equal(result.playerWillBeCreated, false);
  assert.equal(result.playerEmailWillBeAssigned, false);
  assert.deepEqual(result.requiredConfirmations, []);
});

test('reuses a name-matched Player with no email and assigns the submitted email', () => {
  const existing = player({ id: 'player-1', name: 'Returning Player' });
  const result = plan({ players: [existing], name: 'Returning Player', email: 'returning@example.com' });
  assert.equal(result.playerId, 'player-1');
  assert.equal(result.playerEmailWillBeAssigned, true);
  assert.equal(result.resolvedEmail, 'returning@example.com');
});

test('reuses a Player through an explicit alias while preserving the canonical name', () => {
  const existing = player({ id: 'player-1', name: 'William He', email: 'will@example.com', aliases: ['Will He'] });
  const result = plan({ players: [existing], name: 'Will He', email: 'will@example.com' });
  assert.equal(result.playerId, 'player-1');
  assert.equal(result.playerName, 'William He');
  assert.deepEqual(result.requiredConfirmations, []);
});

test('reuses a punctuation-equivalent canonical Player name', () => {
  const existing = player({ id: 'player-1', name: "O'Wen Danganan", email: 'owen@example.com' });
  const result = plan({ players: [existing], name: 'Owen-Danganan', email: 'owen@example.com' });
  assert.equal(result.playerId, 'player-1');
  assert.equal(result.playerName, "O'Wen Danganan");
  assert.deepEqual(result.requiredConfirmations, ['REUSE_DIFFERENT_NAME']);
});

test('requires confirmation when only the email matches a differently named Player', () => {
  const existing = player({ id: 'player-1', name: 'Canonical Name', email: 'same@example.com' });
  const result = plan({ players: [existing], name: 'Different Name', email: 'same@example.com' });
  assert.deepEqual(result.requiredConfirmations, ['REUSE_DIFFERENT_NAME']);
  assert.equal(result.playerName, 'Canonical Name');
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

test('does not request a linking confirmation for an already linked Player and User', () => {
  const existingPlayer = player({ id: 'player-1', name: 'Registered Player', email: 'linked@example.com' });
  const result = plan({
    players: [existingPlayer],
    users: [user({ id: 'user-1', name: 'Registered Player', email: 'linked@example.com' })],
    name: 'Registered Player',
    email: 'linked@example.com'
  });
  assert.equal(result.linkedUserId, 'user-1');
  assert.deepEqual(result.requiredConfirmations, []);
});

test('requires confirmation before adding an existing Player to another team in the latest season', () => {
  const existing = player({ id: 'player-1', name: 'Returning Player', email: 'returning@example.com' });
  const result = plan({
    players: [existing],
    memberships: [membership({ id: 'roster-1', playerId: 'player-1', teamId: 'team-e', teamName: 'E' })],
    name: 'Returning Player',
    email: 'returning@example.com'
  });
  assert.equal(result.changed, true);
  assert.deepEqual(result.requiredConfirmations, ['ADDITIONAL_TEAM']);
});

test('returns an idempotent no-op when the Player is already on the selected team', () => {
  const existing = player({ id: 'player-1', name: 'Returning Player', email: 'returning@example.com' });
  const result = plan({
    players: [existing],
    memberships: [membership({ id: 'roster-1', playerId: 'player-1', teamId: 'team-sea', teamName: 'Sea' })],
    name: 'Returning Player',
    email: 'returning@example.com'
  });
  assert.equal(result.changed, false);
  assert.equal(result.selectedMembershipId, 'roster-1');
  assert.deepEqual(result.requiredConfirmations, []);
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
