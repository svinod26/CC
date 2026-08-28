export type EmailPlanTargetType = 'PLAYER' | 'USER';

export type EmailPlanRecord = {
  id: string;
  email: string | null;
  normalizedEmail: string | null;
  canonicalEmail: string | null;
};

export class AdminEmailPlanError extends Error {
  readonly code: 'NOT_FOUND' | 'STALE' | 'CONFLICT' | 'AMBIGUOUS';

  constructor(
    code: 'NOT_FOUND' | 'STALE' | 'CONFLICT' | 'AMBIGUOUS',
    message: string
  ) {
    super(message);
    this.code = code;
    this.name = 'AdminEmailPlanError';
  }
}

export function planAdminEmailUpdate({
  players,
  users,
  targetType,
  targetId,
  expectedCurrentEmail,
  newEmail,
  newCanonicalEmail
}: {
  players: EmailPlanRecord[];
  users: EmailPlanRecord[];
  targetType: EmailPlanTargetType;
  targetId: string;
  expectedCurrentEmail: string | null;
  newEmail: string;
  newCanonicalEmail: string;
}) {
  const targetPlayer =
    targetType === 'PLAYER' ? players.find((player) => player.id === targetId) ?? null : null;
  const targetUser =
    targetType === 'USER' ? users.find((user) => user.id === targetId) ?? null : null;

  if (targetType === 'PLAYER' && !targetPlayer) {
    throw new AdminEmailPlanError('NOT_FOUND', 'Player not found.');
  }
  if (targetType === 'USER' && !targetUser) {
    throw new AdminEmailPlanError('NOT_FOUND', 'User not found.');
  }

  const targetCurrentEmail = targetPlayer?.email ?? targetUser?.email ?? null;
  const targetNormalizedEmail = targetPlayer?.normalizedEmail ?? targetUser?.normalizedEmail ?? null;
  if (targetNormalizedEmail !== expectedCurrentEmail) {
    throw new AdminEmailPlanError(
      'STALE',
      'This email changed after the page loaded. Refresh and try again.'
    );
  }

  const oldCanonicalEmail = targetPlayer?.canonicalEmail ?? targetUser?.canonicalEmail ?? null;
  let linkedPlayer = targetPlayer;
  let linkedUser = targetUser;

  if (targetType === 'PLAYER' && oldCanonicalEmail) {
    const matchingUsers = users.filter((user) => user.canonicalEmail === oldCanonicalEmail);
    if (matchingUsers.length > 1) {
      throw new AdminEmailPlanError(
        'AMBIGUOUS',
        'Multiple registered accounts use this player email. No changes were made.'
      );
    }
    linkedUser = matchingUsers[0] ?? null;
  }

  if (targetType === 'USER' && oldCanonicalEmail) {
    const matchingPlayers = players.filter((player) => player.canonicalEmail === oldCanonicalEmail);
    if (matchingPlayers.length > 1) {
      throw new AdminEmailPlanError(
        'AMBIGUOUS',
        'Multiple players use this account email. No changes were made.'
      );
    }
    linkedPlayer = matchingPlayers[0] ?? null;
  }

  const conflictingPlayer = players.find(
    (player) => player.id !== linkedPlayer?.id && player.canonicalEmail === newCanonicalEmail
  );
  const conflictingUser = users.find(
    (user) => user.id !== linkedUser?.id && user.canonicalEmail === newCanonicalEmail
  );
  if (conflictingPlayer || conflictingUser) {
    throw new AdminEmailPlanError(
      'CONFLICT',
      'That email is already assigned to another player or registered account.'
    );
  }

  return {
    targetCurrentEmail,
    linkedPlayerId: linkedPlayer?.id ?? null,
    linkedUserId: linkedUser?.id ?? null,
    playerEmailUpdated: Boolean(linkedPlayer && linkedPlayer.normalizedEmail !== newEmail),
    userEmailUpdated: Boolean(linkedUser && linkedUser.normalizedEmail !== newEmail)
  };
}
