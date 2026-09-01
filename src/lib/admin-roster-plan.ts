export type AdminRosterConfirmation =
  | 'REUSE_DIFFERENT_NAME'
  | 'LINK_EXISTING_USER'
  | 'ADDITIONAL_TEAM';

export type AdminRosterPlanPlayer = {
  id: string;
  name: string;
  email: string | null;
  normalizedEmail: string | null;
  canonicalEmail: string | null;
  nameKey: string;
  identityKey: string;
  aliasKeys: string[];
  updatedAt: string;
};

export type AdminRosterPlanUser = {
  id: string;
  name: string | null;
  email: string;
  normalizedEmail: string;
  canonicalEmail: string;
};

export type AdminRosterPlanMembership = {
  id: string;
  playerId: string;
  teamId: string;
  teamName: string;
};

export class AdminRosterPlanError extends Error {
  readonly code: 'CONFLICT' | 'AMBIGUOUS';

  constructor(
    code: 'CONFLICT' | 'AMBIGUOUS',
    message: string
  ) {
    super(message);
    this.code = code;
    this.name = 'AdminRosterPlanError';
  }
}

const uniquePlayers = (players: AdminRosterPlanPlayer[]) => {
  const byId = new Map(players.map((player) => [player.id, player]));
  return [...byId.values()];
};

export function planAdminRosterAddition({
  players,
  users,
  memberships,
  teamId,
  submittedName,
  submittedNameKey,
  submittedAliasKey,
  submittedEmail,
  submittedCanonicalEmail
}: {
  players: AdminRosterPlanPlayer[];
  users: AdminRosterPlanUser[];
  memberships: AdminRosterPlanMembership[];
  teamId: string;
  submittedName: string;
  submittedNameKey: string;
  submittedAliasKey: string;
  submittedEmail: string;
  submittedCanonicalEmail: string;
}) {
  const emailPlayers = players.filter(
    (player) => player.canonicalEmail === submittedCanonicalEmail
  );
  const emailUsers = users.filter(
    (user) => user.canonicalEmail === submittedCanonicalEmail
  );
  const namePlayers = players.filter((player) => player.nameKey === submittedNameKey);
  const identityKeyPlayers = submittedAliasKey
    ? players.filter((player) => player.identityKey === submittedAliasKey)
    : [];
  const aliasPlayers = submittedAliasKey
    ? players.filter((player) => player.aliasKeys.includes(submittedAliasKey))
    : [];

  if (emailPlayers.length > 1 || emailUsers.length > 1) {
    throw new AdminRosterPlanError(
      'AMBIGUOUS',
      'Multiple existing identities use an equivalent email address. Resolve them before adding this player.'
    );
  }

  const nameOrAliasPlayers = uniquePlayers([
    ...namePlayers,
    ...identityKeyPlayers,
    ...aliasPlayers
  ]);
  if (nameOrAliasPlayers.length > 1) {
    throw new AdminRosterPlanError(
      'AMBIGUOUS',
      'That name resolves to multiple existing players. Resolve the player identities before adding a roster entry.'
    );
  }

  const emailPlayer = emailPlayers[0] ?? null;
  const nameOrAliasPlayer = nameOrAliasPlayers[0] ?? null;
  if (emailPlayer && nameOrAliasPlayer && emailPlayer.id !== nameOrAliasPlayer.id) {
    throw new AdminRosterPlanError(
      'CONFLICT',
      'The submitted name and email resolve to different existing players. No changes can be made.'
    );
  }

  const player = emailPlayer ?? nameOrAliasPlayer;
  if (
    player?.canonicalEmail &&
    player.canonicalEmail !== submittedCanonicalEmail
  ) {
    throw new AdminRosterPlanError(
      'CONFLICT',
      `${player.name} already has a different email. Use Email management to review or correct it first.`
    );
  }

  const linkedUser = emailUsers[0] ?? null;
  const matchedBySubmittedName = Boolean(
    player &&
      (namePlayers.some((candidate) => candidate.id === player.id) ||
        aliasPlayers.some((candidate) => candidate.id === player.id))
  );
  const existingMemberships = player
    ? memberships.filter((membership) => membership.playerId === player.id)
    : [];
  const selectedMembership = existingMemberships.find(
    (membership) => membership.teamId === teamId
  ) ?? null;
  const otherMemberships = existingMemberships.filter(
    (membership) => membership.teamId !== teamId
  );

  const playerWillBeCreated = !player;
  const playerEmailWillBeAssigned = Boolean(player && !player.email && !selectedMembership);
  const resolvedEmail = player?.email
    ? player.normalizedEmail!
    : linkedUser?.normalizedEmail ?? submittedEmail;
  const requiredConfirmations: AdminRosterConfirmation[] = [];
  const warnings: Array<{ code: AdminRosterConfirmation; message: string }> = [];

  if (!selectedMembership && player && !matchedBySubmittedName) {
    requiredConfirmations.push('REUSE_DIFFERENT_NAME');
    warnings.push({
      code: 'REUSE_DIFFERENT_NAME',
      message: `The email belongs to the existing Player “${player.name}”. The submitted name “${submittedName}” will not replace the existing name.`
    });
  }

  const userIsAlreadyLinkedToPlayer = Boolean(
    player?.canonicalEmail && player.canonicalEmail === linkedUser?.canonicalEmail
  );
  if (!selectedMembership && linkedUser && !userIsAlreadyLinkedToPlayer) {
    requiredConfirmations.push('LINK_EXISTING_USER');
    warnings.push({
      code: 'LINK_EXISTING_USER',
      message: `This email already belongs to the registered account “${linkedUser.name ?? linkedUser.email}”. Creating or updating the Player email will link it to that account.`
    });
  }

  if (!selectedMembership && otherMemberships.length > 0) {
    requiredConfirmations.push('ADDITIONAL_TEAM');
    warnings.push({
      code: 'ADDITIONAL_TEAM',
      message: `${player!.name} is already rostered on ${otherMemberships.map((membership) => membership.teamName).join(', ')} in this season. That membership will remain; this adds another team.`
    });
  }

  return {
    playerId: player?.id ?? null,
    playerName: player?.name ?? submittedName,
    currentPlayerEmail: player?.normalizedEmail ?? null,
    resolvedEmail,
    playerUpdatedAt: player?.updatedAt ?? null,
    playerWillBeCreated,
    playerEmailWillBeAssigned,
    linkedUserId: linkedUser?.id ?? null,
    linkedUserName: linkedUser?.name ?? null,
    selectedMembershipId: selectedMembership?.id ?? null,
    existingMemberships,
    otherMemberships,
    changed: !selectedMembership,
    requiredConfirmations,
    warnings
  };
}
