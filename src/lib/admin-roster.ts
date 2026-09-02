import { createHash } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import {
  AdminRosterPlanError,
  planAdminRosterAddition,
  planAdminRosterAssignment,
  type AdminRosterConfirmation
} from '@/lib/admin-roster-plan';
import { canonicalizeEmail, normalizeEmail } from '@/lib/email';
import {
  normalizePlayerKey,
  normalizePlayerName,
  normalizePlayerNameKey
} from '@/lib/player-name';
import { prisma } from '@/lib/prisma';
import { sortSeasons } from '@/lib/season';

type RosterDb = PrismaClient | Prisma.TransactionClient;

export const adminRosterRequestSchema = z
  .object({
    name: z.string().transform(normalizePlayerName).pipe(z.string().min(1).max(100)),
    email: z.string().transform(normalizeEmail).pipe(z.string().email().max(254)),
    teamId: z.string().min(1).max(100)
  })
  .strict();

export type AdminRosterRequest = z.infer<typeof adminRosterRequestSchema>;

export const adminRosterConfirmationSchema = z.enum([
  'REUSE_DIFFERENT_NAME',
  'LINK_EXISTING_USER',
  'MOVE_TEAM',
  'UNASSIGN_PLAYER'
]);

export const adminRosterAssignmentRequestSchema = z
  .object({
    playerId: z.string().min(1).max(100),
    teamId: z.string().min(1).max(100).nullable()
  })
  .strict();

export type AdminRosterAssignmentRequest = z.infer<
  typeof adminRosterAssignmentRequestSchema
>;

export class AdminRosterError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'STALE' | 'CONFLICT' | 'AMBIGUOUS' | 'FORBIDDEN',
    message: string,
    readonly status: 403 | 404 | 409
  ) {
    super(message);
    this.name = 'AdminRosterError';
  }
}

async function buildAdminRosterPlan(db: RosterDb, request: AdminRosterRequest) {
  const seasons = await db.season.findMany({
    select: { id: true, name: true, year: true }
  });
  const latestSeason = sortSeasons(seasons)[0] ?? null;
  if (!latestSeason) {
    throw new AdminRosterError(
      'NOT_FOUND',
      'No season exists. Import a season before adding a roster player.',
      404
    );
  }

  const [team, players, users, memberships, openGameLineups] = await Promise.all([
    db.team.findUnique({
      where: { id: request.teamId },
      select: { id: true, name: true, seasonId: true }
    }),
    db.player.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        updatedAt: true,
        aliases: { select: { aliasKey: true } }
      }
    }),
    db.user.findMany({
      select: { id: true, name: true, email: true }
    }),
    db.teamRoster.findMany({
      where: { seasonId: latestSeason.id },
      select: {
        id: true,
        playerId: true,
        teamId: true,
        isActive: true,
        team: { select: { name: true } }
      },
      orderBy: { id: 'asc' }
    }),
    db.gameLineup.findMany({
      where: {
        game: {
          seasonId: latestSeason.id,
          type: 'LEAGUE',
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] }
        }
      },
      select: { playerId: true }
    })
  ]);

  if (!team) {
    throw new AdminRosterError('NOT_FOUND', 'The selected team no longer exists.', 404);
  }
  if (team.seasonId !== latestSeason.id) {
    throw new AdminRosterError(
      'STALE',
      `The selected team is not part of the latest season (${latestSeason.name}). Refresh and try again.`,
      409
    );
  }

  const submittedName = normalizePlayerName(request.name);
  const submittedEmail = normalizeEmail(request.email);
  let identityPlan;
  try {
    identityPlan = planAdminRosterAddition({
      players: players.map((player) => ({
        id: player.id,
        name: player.name,
        email: player.email,
        normalizedEmail: player.email ? normalizeEmail(player.email) : null,
        canonicalEmail: player.email ? canonicalizeEmail(player.email) : null,
        nameKey: normalizePlayerNameKey(player.name),
        identityKey: normalizePlayerKey(player.name),
        aliasKeys: player.aliases.map((alias) => alias.aliasKey),
        updatedAt: player.updatedAt.toISOString()
      })),
      users: users.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        normalizedEmail: normalizeEmail(user.email),
        canonicalEmail: canonicalizeEmail(user.email)
      })),
      memberships: memberships.map((membership) => ({
        id: membership.id,
        playerId: membership.playerId,
        teamId: membership.teamId ?? '',
        teamName: membership.team?.name ?? 'Unknown team',
        isActive: membership.isActive
      })),
      teamId: team.id,
      submittedName,
      submittedNameKey: normalizePlayerNameKey(submittedName),
      submittedAliasKey: normalizePlayerKey(submittedName),
      submittedEmail,
      submittedCanonicalEmail: canonicalizeEmail(submittedEmail),
      openLeagueGamePlayerIds: openGameLineups.map((lineup) => lineup.playerId)
    });
  } catch (error) {
    if (error instanceof AdminRosterPlanError) {
      throw new AdminRosterError(error.code, error.message, 409);
    }
    throw error;
  }

  const snapshot = {
    request: { name: submittedName, email: submittedEmail, teamId: team.id },
    season: latestSeason,
    team,
    player: {
      id: identityPlan.playerId,
      name: identityPlan.playerName,
      currentEmail: identityPlan.currentPlayerEmail,
      resolvedEmail: identityPlan.resolvedEmail,
      updatedAt: identityPlan.playerUpdatedAt
    },
    linkedUserId: identityPlan.linkedUserId,
    action: identityPlan.action,
    selectedMembershipId: identityPlan.selectedMembershipId,
    activeMembershipId: identityPlan.activeMembership?.id ?? null,
    destinationMembershipId: identityPlan.destinationMembership?.id ?? null,
    memberships: identityPlan.existingMemberships
      .map((membership) => ({
        id: membership.id,
        teamId: membership.teamId,
        teamName: membership.teamName,
        isActive: membership.isActive
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    requiredConfirmations: [...identityPlan.requiredConfirmations].sort()
  };
  const fingerprint = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');

  return {
    fingerprint,
    request: snapshot.request,
    season: { id: latestSeason.id, name: latestSeason.name },
    team: { id: team.id, name: team.name },
    action: identityPlan.action,
    player: {
      id: identityPlan.playerId,
      name: identityPlan.playerName,
      currentEmail: identityPlan.currentPlayerEmail,
      email: identityPlan.resolvedEmail,
      willCreate: identityPlan.playerWillBeCreated,
      emailWillBeAssigned: identityPlan.playerEmailWillBeAssigned
    },
    linkedUser: identityPlan.linkedUserId
      ? {
          id: identityPlan.linkedUserId,
          name: identityPlan.linkedUserName
        }
      : null,
    existingSeasonTeams: identityPlan.existingMemberships.map((membership) => ({
      id: membership.teamId,
      name: membership.teamName,
      isActive: membership.isActive
    })),
    activeMembershipId: identityPlan.activeMembership?.id ?? null,
    destinationMembershipId: identityPlan.destinationMembership?.id ?? null,
    alreadyRostered: Boolean(identityPlan.selectedMembershipId),
    changed: identityPlan.changed,
    requiredConfirmations: identityPlan.requiredConfirmations,
    warnings: identityPlan.warnings
  };
}

export async function previewAdminRosterAddition(
  actorUserId: string,
  request: AdminRosterRequest
) {
  const actor = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: { role: true }
  });
  if (actor?.role !== 'ADMIN') {
    throw new AdminRosterError('FORBIDDEN', 'Admin only', 403);
  }
  return buildAdminRosterPlan(prisma, request);
}

async function buildAdminRosterAssignmentPlan(
  db: RosterDb,
  request: AdminRosterAssignmentRequest
) {
  const seasons = await db.season.findMany({
    select: { id: true, name: true, year: true }
  });
  const latestSeason = sortSeasons(seasons)[0] ?? null;
  if (!latestSeason) {
    throw new AdminRosterError('NOT_FOUND', 'No season exists.', 404);
  }

  const [player, destinationTeam, memberships, openGameLineup] = await Promise.all([
    db.player.findUnique({
      where: { id: request.playerId },
      select: { id: true, name: true, email: true, updatedAt: true }
    }),
    request.teamId
      ? db.team.findUnique({
          where: { id: request.teamId },
          select: { id: true, name: true, seasonId: true }
        })
      : Promise.resolve(null),
    db.teamRoster.findMany({
      where: { seasonId: latestSeason.id, playerId: request.playerId },
      select: {
        id: true,
        playerId: true,
        teamId: true,
        isActive: true,
        team: { select: { name: true } }
      },
      orderBy: { id: 'asc' }
    }),
    db.gameLineup.findFirst({
      where: {
        playerId: request.playerId,
        game: {
          seasonId: latestSeason.id,
          type: 'LEAGUE',
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] }
        }
      },
      select: { id: true, gameId: true }
    })
  ]);

  if (!player) {
    throw new AdminRosterError('NOT_FOUND', 'The selected Player no longer exists.', 404);
  }
  if (request.teamId && !destinationTeam) {
    throw new AdminRosterError('NOT_FOUND', 'The selected team no longer exists.', 404);
  }
  if (destinationTeam && destinationTeam.seasonId !== latestSeason.id) {
    throw new AdminRosterError(
      'STALE',
      `The selected team is not part of the latest season (${latestSeason.name}). Refresh and try again.`,
      409
    );
  }

  let assignmentPlan;
  try {
    assignmentPlan = planAdminRosterAssignment({
      playerId: player.id,
      playerName: player.name,
      memberships: memberships.map((membership) => ({
        id: membership.id,
        playerId: membership.playerId,
        teamId: membership.teamId ?? '',
        teamName: membership.team?.name ?? 'Unknown team',
        isActive: membership.isActive
      })),
      destinationTeamId: destinationTeam?.id ?? null,
      hasOpenLeagueGame: Boolean(openGameLineup)
    });
  } catch (error) {
    if (error instanceof AdminRosterPlanError) {
      throw new AdminRosterError(error.code, error.message, 409);
    }
    throw error;
  }

  const snapshot = {
    request: { playerId: player.id, teamId: destinationTeam?.id ?? null },
    season: latestSeason,
    player: {
      id: player.id,
      name: player.name,
      email: player.email,
      updatedAt: player.updatedAt.toISOString()
    },
    action: assignmentPlan.action,
    activeMembershipId: assignmentPlan.activeMembership?.id ?? null,
    destinationMembershipId: assignmentPlan.destinationMembership?.id ?? null,
    memberships: assignmentPlan.playerMemberships
      .map((membership) => ({
        id: membership.id,
        teamId: membership.teamId,
        teamName: membership.teamName,
        isActive: membership.isActive
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    openGameId: openGameLineup?.gameId ?? null,
    requiredConfirmations: [...assignmentPlan.requiredConfirmations].sort()
  };

  return {
    fingerprint: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
    request: snapshot.request,
    season: { id: latestSeason.id, name: latestSeason.name },
    player: { id: player.id, name: player.name, email: player.email },
    destinationTeam: destinationTeam
      ? { id: destinationTeam.id, name: destinationTeam.name }
      : null,
    currentTeam: assignmentPlan.activeMembership
      ? {
          id: assignmentPlan.activeMembership.teamId,
          name: assignmentPlan.activeMembership.teamName
        }
      : null,
    action: assignmentPlan.action,
    changed: assignmentPlan.changed,
    activeMembershipId: assignmentPlan.activeMembership?.id ?? null,
    destinationMembershipId: assignmentPlan.destinationMembership?.id ?? null,
    requiredConfirmations: assignmentPlan.requiredConfirmations,
    warnings: assignmentPlan.warnings
  };
}

export async function previewAdminRosterAssignment(
  actorUserId: string,
  request: AdminRosterAssignmentRequest
) {
  const actor = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: { role: true }
  });
  if (actor?.role !== 'ADMIN') {
    throw new AdminRosterError('FORBIDDEN', 'Admin only', 403);
  }
  return buildAdminRosterAssignmentPlan(prisma, request);
}

const isPrismaCode = (error: unknown, code: string) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;

async function applyActiveRosterChange(
  tx: Prisma.TransactionClient,
  {
    seasonId,
    playerId,
    destinationTeamId,
    activeMembershipId,
    destinationMembershipId
  }: {
    seasonId: string;
    playerId: string;
    destinationTeamId: string | null;
    activeMembershipId: string | null;
    destinationMembershipId: string | null;
  }
) {
  if (activeMembershipId) {
    const deactivated = await tx.teamRoster.updateMany({
      where: {
        id: activeMembershipId,
        seasonId,
        playerId,
        isActive: true
      },
      data: { isActive: false }
    });
    if (deactivated.count !== 1) {
      throw new AdminRosterError(
        'STALE',
        'The active roster membership changed before it could be updated. No changes were made.',
        409
      );
    }
  }

  if (!destinationTeamId) return null;

  if (destinationMembershipId) {
    const activated = await tx.teamRoster.updateMany({
      where: {
        id: destinationMembershipId,
        seasonId,
        playerId,
        teamId: destinationTeamId,
        isActive: false
      },
      data: { isActive: true }
    });
    if (activated.count !== 1) {
      throw new AdminRosterError(
        'STALE',
        'The destination roster membership changed before it could be activated. No changes were made.',
        409
      );
    }
    return { id: destinationMembershipId };
  }

  return tx.teamRoster.create({
    data: {
      seasonId,
      teamId: destinationTeamId,
      playerId,
      isActive: true
    },
    select: { id: true }
  });
}

export async function addAdminRosterPlayer({
  actorUserId,
  request,
  fingerprint,
  confirmations
}: {
  actorUserId: string;
  request: AdminRosterRequest;
  fingerprint: string;
  confirmations: AdminRosterConfirmation[];
}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const actor = await tx.user.findUnique({
            where: { id: actorUserId },
            select: { role: true }
          });
          if (actor?.role !== 'ADMIN') {
            throw new AdminRosterError('FORBIDDEN', 'Admin only', 403);
          }

          const plan = await buildAdminRosterPlan(tx, request);
          if (plan.fingerprint !== fingerprint) {
            throw new AdminRosterError(
              'STALE',
              'The player, team, or roster changed after the preview. Review the refreshed preview before confirming.',
              409
            );
          }

          const confirmationSet = new Set(confirmations);
          const missingConfirmation = plan.requiredConfirmations.find(
            (confirmation) => !confirmationSet.has(confirmation)
          );
          if (missingConfirmation) {
            throw new AdminRosterError(
              'CONFLICT',
              'A required safety confirmation was not accepted. No changes were made.',
              409
            );
          }

          if (!plan.changed) {
            return {
              changed: false,
              action: plan.action,
              playerCreated: false,
              playerId: plan.player.id!,
              playerName: plan.player.name,
              email: plan.player.currentEmail,
              seasonId: plan.season.id,
              seasonName: plan.season.name,
              teamId: plan.team.id,
              teamName: plan.team.name,
              rosterId: null
            };
          }

          const player = plan.player.willCreate
            ? await tx.player.create({
                data: { name: plan.request.name, email: plan.player.email },
                select: { id: true, name: true, email: true }
              })
            : plan.player.emailWillBeAssigned
              ? await tx.player.update({
                  where: { id: plan.player.id! },
                  data: { email: plan.player.email },
                  select: { id: true, name: true, email: true }
                })
              : await tx.player.findUniqueOrThrow({
                  where: { id: plan.player.id! },
                  select: { id: true, name: true, email: true }
                });

          const roster = await applyActiveRosterChange(tx, {
            seasonId: plan.season.id,
            playerId: player.id,
            destinationTeamId: plan.team.id,
            activeMembershipId: plan.activeMembershipId,
            destinationMembershipId: plan.destinationMembershipId
          });
          if (!roster) {
            throw new AdminRosterError(
              'CONFLICT',
              'A destination roster could not be activated. No changes were made.',
              409
            );
          }

          await tx.adminAuditLog.create({
            data: {
              actorUserId,
              gameId: null,
              action:
                plan.action === 'MOVE_PLAYER'
                  ? 'ROSTER_PLAYER_MOVE'
                  : 'ROSTER_PLAYER_ASSIGN',
              entityType: 'TeamRoster',
              entityId: roster.id,
              details: {
                playerCreated: plan.player.willCreate,
                playerEmailAssigned: plan.player.emailWillBeAssigned,
                playerId: player.id,
                playerName: player.name,
                playerEmail: player.email,
                seasonId: plan.season.id,
                seasonName: plan.season.name,
                teamId: plan.team.id,
                teamName: plan.team.name,
                linkedUserId: plan.linkedUser?.id ?? null,
                existingSeasonTeams: plan.existingSeasonTeams,
                rosterAction: plan.action,
                priorActiveRosterId: plan.activeMembershipId,
                reusedRosterId: plan.destinationMembershipId,
                confirmations
              }
            }
          });

          return {
            changed: true,
            action: plan.action,
            playerCreated: plan.player.willCreate,
            playerId: player.id,
            playerName: player.name,
            email: player.email,
            seasonId: plan.season.id,
            seasonName: plan.season.name,
            teamId: plan.team.id,
            teamName: plan.team.name,
            rosterId: roster.id
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 10_000
        }
      );
    } catch (error) {
      if (error instanceof AdminRosterError) throw error;
      if (isPrismaCode(error, 'P2034') && attempt < 2) continue;
      if (isPrismaCode(error, 'P2002')) {
        throw new AdminRosterError(
          'CONFLICT',
          'That Player or roster membership was created concurrently. Refresh and review the latest data.',
          409
        );
      }
      if (isPrismaCode(error, 'P2034')) {
        throw new AdminRosterError(
          'STALE',
          'Another roster update completed at the same time. Refresh and try again.',
          409
        );
      }
      throw error;
    }
  }

  throw new AdminRosterError(
    'STALE',
    'Another roster update completed at the same time. Refresh and try again.',
    409
  );
}

export async function updateAdminRosterAssignment({
  actorUserId,
  request,
  fingerprint,
  confirmations
}: {
  actorUserId: string;
  request: AdminRosterAssignmentRequest;
  fingerprint: string;
  confirmations: AdminRosterConfirmation[];
}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const actor = await tx.user.findUnique({
            where: { id: actorUserId },
            select: { role: true }
          });
          if (actor?.role !== 'ADMIN') {
            throw new AdminRosterError('FORBIDDEN', 'Admin only', 403);
          }

          const plan = await buildAdminRosterAssignmentPlan(tx, request);
          if (plan.fingerprint !== fingerprint) {
            throw new AdminRosterError(
              'STALE',
              'The player, team, active game, or roster changed after the preview. Review the refreshed preview before confirming.',
              409
            );
          }

          const confirmationSet = new Set(confirmations);
          if (
            plan.requiredConfirmations.some(
              (confirmation) => !confirmationSet.has(confirmation)
            )
          ) {
            throw new AdminRosterError(
              'CONFLICT',
              'A required safety confirmation was not accepted. No changes were made.',
              409
            );
          }

          if (!plan.changed) {
            return {
              changed: false,
              action: plan.action,
              playerId: plan.player.id,
              playerName: plan.player.name,
              seasonId: plan.season.id,
              seasonName: plan.season.name,
              teamId: plan.currentTeam?.id ?? null,
              teamName: plan.currentTeam?.name ?? null,
              rosterId: plan.activeMembershipId
            };
          }

          const roster = await applyActiveRosterChange(tx, {
            seasonId: plan.season.id,
            playerId: plan.player.id,
            destinationTeamId: plan.destinationTeam?.id ?? null,
            activeMembershipId: plan.activeMembershipId,
            destinationMembershipId: plan.destinationMembershipId
          });

          const action =
            plan.action === 'MOVE_PLAYER'
              ? 'ROSTER_PLAYER_MOVE'
              : plan.action === 'UNASSIGN_PLAYER'
                ? 'ROSTER_PLAYER_UNASSIGN'
                : 'ROSTER_PLAYER_ASSIGN';
          await tx.adminAuditLog.create({
            data: {
              actorUserId,
              gameId: null,
              action,
              entityType: 'TeamRoster',
              entityId: roster?.id ?? plan.activeMembershipId,
              details: {
                playerId: plan.player.id,
                playerName: plan.player.name,
                seasonId: plan.season.id,
                seasonName: plan.season.name,
                rosterAction: plan.action,
                fromTeam: plan.currentTeam,
                toTeam: plan.destinationTeam,
                priorActiveRosterId: plan.activeMembershipId,
                reusedRosterId: plan.destinationMembershipId,
                activeRosterId: roster?.id ?? null,
                confirmations
              }
            }
          });

          return {
            changed: true,
            action: plan.action,
            playerId: plan.player.id,
            playerName: plan.player.name,
            seasonId: plan.season.id,
            seasonName: plan.season.name,
            teamId: plan.destinationTeam?.id ?? null,
            teamName: plan.destinationTeam?.name ?? null,
            rosterId: roster?.id ?? null
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 10_000
        }
      );
    } catch (error) {
      if (error instanceof AdminRosterError) throw error;
      if (isPrismaCode(error, 'P2034') && attempt < 2) continue;
      if (isPrismaCode(error, 'P2002')) {
        throw new AdminRosterError(
          'CONFLICT',
          'That roster changed concurrently. Refresh and review the latest assignment.',
          409
        );
      }
      if (isPrismaCode(error, 'P2034')) {
        throw new AdminRosterError(
          'STALE',
          'Another roster update completed at the same time. Refresh and try again.',
          409
        );
      }
      throw error;
    }
  }

  throw new AdminRosterError(
    'STALE',
    'Another roster update completed at the same time. Refresh and try again.',
    409
  );
}
