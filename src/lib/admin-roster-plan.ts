export type AdminRosterConfirmation =
  | 'REUSE_DIFFERENT_NAME'
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
  memberships,
  teamId,
  submittedName,
  submittedNameKey,
  submittedAliasKey,
  submittedEmail,
  submittedCanonicalEmail,
  openLeagueGamePlayerIds = []
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
  openLeagueGamePlayerIds?: string[];
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
  const assignmentPlan = planAdminRosterAssignment({
    playerId: player?.id ?? '__new_player__',
    playerName: player?.name ?? submittedName,
    memberships: existingMemberships,
    destinationTeamId: teamId,
    hasOpenLeagueGame: Boolean(
      player && openLeagueGamePlayerIds.includes(player.id)
    )
  });
  const selectedMembership = assignmentPlan.destinationMembership;
  const otherMemberships = existingMemberships.filter(
    (membership) => membership.teamId !== teamId
  );

  const playerWillBeCreated = !player;
  const playerEmailWillBeAssigned = Boolean(
    player && !player.email && assignmentPlan.changed
  );
  const resolvedEmail = player?.email
    ? player.normalizedEmail!
    : linkedUser?.normalizedEmail ?? submittedEmail;
  const requiredConfirmations: AdminRosterConfirmation[] = [];
  const warnings: Array<{ code: AdminRosterConfirmation; message: string }> = [];

  if (assignmentPlan.changed && player && !matchedBySubmittedName) {
    requiredConfirmations.push('REUSE_DIFFERENT_NAME');
    warnings.push({
      code: 'REUSE_DIFFERENT_NAME',
      message: `The email belongs to the existing Player “${player.name}”. The submitted name “${submittedName}” will not replace the existing name.`
    });
  }

  const userIsAlreadyLinkedToPlayer = Boolean(
    player?.canonicalEmail && player.canonicalEmail === linkedUser?.canonicalEmail
  );
  if (assignmentPlan.changed && linkedUser && !userIsAlreadyLinkedToPlayer) {
    requiredConfirmations.push('LINK_EXISTING_USER');
    warnings.push({
      code: 'LINK_EXISTING_USER',
      message: `This email already belongs to the registered account “${linkedUser.name ?? linkedUser.email}”. Creating or updating the Player email will link it to that account.`
    });
  }

  requiredConfirmations.push(...assignmentPlan.requiredConfirmations);
  warnings.push(...assignmentPlan.warnings);

  return {
    action: playerWillBeCreated ? 'CREATE_PLAYER' as const : assignmentPlan.action,
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
    activeMembership: assignmentPlan.activeMembership,
    destinationMembership: assignmentPlan.destinationMembership,
    existingMemberships,
    otherMemberships,
    changed: playerWillBeCreated || assignmentPlan.changed,
    requiredConfirmations,
    warnings
  };
}
