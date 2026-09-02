export type AdminRosterConfirmation =
  | 'LINK_EXISTING_USER'
  | 'MOVE_TEAM'
  | 'UNASSIGN_PLAYER';

export type AdminRosterAction =
  | 'CREATE_PLAYER'
  | 'ASSIGN_PLAYER'
  | 'MOVE_PLAYER'
  | 'UNASSIGN_PLAYER'
  | 'NO_CHANGE';

export type AdminRosterPlanPlayer = {
  id: string;
  name: string;
  canonicalEmail: string | null;
  nameKey: string;
  identityKey: string;
  aliasKeys: string[];
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
  isActive: boolean;
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

function activeMembershipFor(
  memberships: AdminRosterPlanMembership[],
  playerName: string
) {
  const activeMemberships = memberships.filter((membership) => membership.isActive);
  if (activeMemberships.length > 1) {
    throw new AdminRosterPlanError(
      'CONFLICT',
      `${playerName} has multiple active teams in this season. No roster change was made; resolve the data-integrity issue first.`
    );
  }
  return activeMemberships[0] ?? null;
}

export function planAdminRosterAssignment({
  playerId,
  playerName,
  memberships,
  destinationTeamId,
  hasOpenLeagueGame
}: {
  playerId: string;
  playerName: string;
  memberships: AdminRosterPlanMembership[];
  destinationTeamId: string | null;
  hasOpenLeagueGame: boolean;
}) {
  const playerMemberships = memberships.filter(
    (membership) => membership.playerId === playerId
  );
  const activeMembership = activeMembershipFor(playerMemberships, playerName);
  const destinationMembership = destinationTeamId
    ? playerMemberships.find((membership) => membership.teamId === destinationTeamId) ?? null
    : null;

  let action: AdminRosterAction;
  if (!destinationTeamId) {
    action = activeMembership ? 'UNASSIGN_PLAYER' : 'NO_CHANGE';
  } else if (activeMembership?.teamId === destinationTeamId) {
    action = 'NO_CHANGE';
  } else if (activeMembership) {
    action = 'MOVE_PLAYER';
  } else {
    action = 'ASSIGN_PLAYER';
  }

  if (
    hasOpenLeagueGame &&
    (action === 'MOVE_PLAYER' || action === 'UNASSIGN_PLAYER')
  ) {
    throw new AdminRosterPlanError(
      'CONFLICT',
      `${playerName} is in a scheduled or in-progress League game for the active team. Finish or correct that game before moving or unassigning the player.`
    );
  }

  const requiredConfirmations: AdminRosterConfirmation[] = [];
  const warnings: Array<{ code: AdminRosterConfirmation; message: string }> = [];
  if (action === 'MOVE_PLAYER') {
    requiredConfirmations.push('MOVE_TEAM');
    warnings.push({
      code: 'MOVE_TEAM',
      message: `${playerName} will move from ${activeMembership!.teamName}. Historical roster rows, games, lineups, and stats will remain unchanged.`
    });
  }
  if (action === 'UNASSIGN_PLAYER') {
    requiredConfirmations.push('UNASSIGN_PLAYER');
    warnings.push({
      code: 'UNASSIGN_PLAYER',
      message: `${playerName} will be unassigned from ${activeMembership!.teamName}. Historical roster rows, games, lineups, and stats will remain unchanged.`
    });
  }

  return {
    action,
    changed: action !== 'NO_CHANGE',
    activeMembership,
    destinationMembership,
    playerMemberships,
    requiredConfirmations,
    warnings
  };
}

export function planAdminRosterAddition({
  players,
  users,
  submittedName,
  submittedNameKey,
  submittedAliasKey,
  submittedEmail,
  submittedCanonicalEmail
}: {
  players: AdminRosterPlanPlayer[];
  users: AdminRosterPlanUser[];
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

  const existingPlayer = emailPlayer ?? nameOrAliasPlayer;
  if (existingPlayer) {
    throw new AdminRosterPlanError(
      'CONFLICT',
      `“${existingPlayer.name}” already exists as a Player. Use “Move, assign, or unassign existing player” for team changes, or Email management below for email corrections.`
    );
  }

  const linkedUser = emailUsers[0] ?? null;
  const resolvedEmail = linkedUser?.normalizedEmail ?? submittedEmail;
  const requiredConfirmations: AdminRosterConfirmation[] = [];
  const warnings: Array<{ code: AdminRosterConfirmation; message: string }> = [];

  if (linkedUser) {
    requiredConfirmations.push('LINK_EXISTING_USER');
    warnings.push({
      code: 'LINK_EXISTING_USER',
      message: `This email already belongs to the registered account “${linkedUser.name ?? linkedUser.email}”. Creating the Player with this email will link it to that account.`
    });
  }

  return {
    action: 'CREATE_PLAYER' as const,
    playerName: submittedName,
    resolvedEmail,
    linkedUserId: linkedUser?.id ?? null,
    linkedUserName: linkedUser?.name ?? null,
    changed: true,
    requiredConfirmations,
    warnings
  };
}
