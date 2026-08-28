import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AdminEmailPlanError,
  planAdminEmailUpdate
} from '../src/lib/admin-email-plan.ts';

const normalize = (value) => value.trim().toLowerCase();
const canonical = (value) => {
  const normalized = normalize(value);
  const at = normalized.indexOf('@');
  if (at < 1) return normalized;
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  if (domain !== 'gmail.com' && domain !== 'googlemail.com') return normalized;
  return `${(local.split('+')[0] ?? local).replaceAll('.', '')}@gmail.com`;
};
const record = (id, email) => ({
  id,
  email,
  normalizedEmail: email ? normalize(email) : null,
  canonicalEmail: email ? canonical(email) : null
});
const plan = ({
  players = [],
  users = [],
  targetType = 'PLAYER',
  targetId = 'player-1',
  expectedCurrentEmail = null,
  newEmail = 'new@example.com'
} = {}) =>
  planAdminEmailUpdate({
    players,
    users,
    targetType,
    targetId,
    expectedCurrentEmail,
    newEmail: normalize(newEmail),
    newCanonicalEmail: canonical(newEmail)
  });

const expectCode = (code, callback) => {
  assert.throws(callback, (error) => error instanceof AdminEmailPlanError && error.code === code);
};

test('assigns an unused email to a null-email Player only', () => {
  const result = plan({ players: [record('player-1', null)] });
  assert.deepEqual(result, {
    targetCurrentEmail: null,
    linkedPlayerId: 'player-1',
    linkedUserId: null,
    playerEmailUpdated: true,
    userEmailUpdated: false
  });
});

test('updates a Player and its canonically linked User together', () => {
  const oldEmail = 'linked@example.com';
  const result = plan({
    players: [record('player-1', oldEmail)],
    users: [record('user-1', oldEmail)],
    expectedCurrentEmail: oldEmail
  });
  assert.equal(result.linkedPlayerId, 'player-1');
  assert.equal(result.linkedUserId, 'user-1');
  assert.equal(result.playerEmailUpdated, true);
  assert.equal(result.userEmailUpdated, true);
});

test('updates a standalone User without inventing a Player link', () => {
  const oldEmail = 'commissioner@example.com';
  const result = plan({
    targetType: 'USER',
    targetId: 'user-1',
    users: [record('user-1', oldEmail)],
    expectedCurrentEmail: oldEmail
  });
  assert.equal(result.linkedPlayerId, null);
  assert.equal(result.linkedUserId, 'user-1');
  assert.equal(result.playerEmailUpdated, false);
  assert.equal(result.userEmailUpdated, true);
});

test('treats the same normalized email as a no-op', () => {
  const currentEmail = 'same@example.com';
  const result = plan({
    players: [record('player-1', currentEmail)],
    expectedCurrentEmail: currentEmail,
    newEmail: ' SAME@example.com '
  });
  assert.equal(result.playerEmailUpdated, false);
  assert.equal(result.userEmailUpdated, false);
});

test('rejects a stale current email', () => {
  expectCode('STALE', () =>
    plan({
      players: [record('player-1', 'current@example.com')],
      expectedCurrentEmail: 'old@example.com'
    })
  );
});

test('rejects an email owned by another Player', () => {
  expectCode('CONFLICT', () =>
    plan({
      players: [record('player-1', null), record('player-2', 'taken@example.com')],
      newEmail: 'taken@example.com'
    })
  );
});

test('rejects an email owned by an unrelated User', () => {
  expectCode('CONFLICT', () =>
    plan({
      players: [record('player-1', null)],
      users: [record('user-2', 'taken@example.com')],
      newEmail: 'taken@example.com'
    })
  );
});

test('rejects Gmail dot, plus, and googlemail variants owned by another identity', () => {
  expectCode('CONFLICT', () =>
    plan({
      players: [record('player-1', null), record('player-2', 'first.last@gmail.com')],
      newEmail: 'firstlast+test@googlemail.com'
    })
  );
});

test('rejects an ambiguous old Player-to-User relationship', () => {
  const oldEmail = 'first.last@gmail.com';
  expectCode('AMBIGUOUS', () =>
    plan({
      players: [record('player-1', oldEmail)],
      users: [record('user-1', oldEmail), record('user-2', 'firstlast+other@gmail.com')],
      expectedCurrentEmail: oldEmail
    })
  );
});

test('rejects an unknown target ID', () => {
  expectCode('NOT_FOUND', () => plan({ players: [] }));
});
