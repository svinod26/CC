import { createHash } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import {
  AdminRosterPlanError,
  planAdminRosterAddition,
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
  'ADDITIONAL_TEAM'
]);

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

  const [team, players, users, memberships] = await Promise.all([
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
        team: { select: { name: true } }
      },
      orderBy: { id: 'asc' }
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
        teamName: membership.team?.name ?? 'Unknown team'
      })),
      teamId: team.id,
      submittedName,
      submittedNameKey: normalizePlayerNameKey(submittedName),
      submittedAliasKey: normalizePlayerKey(submittedName),
      submittedEmail,
      submittedCanonicalEmail: canonicalizeEmail(submittedEmail)
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
    selectedMembershipId: identityPlan.selectedMembershipId,
    memberships: identityPlan.existingMemberships
      .map((membership) => ({
        id: membership.id,
        teamId: membership.teamId,
        teamName: membership.teamName
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
      name: membership.teamName
    })),
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

const isPrismaCode = (error: unknown, code: string) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;

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

          const roster = await tx.teamRoster.create({
            data: {
              seasonId: plan.season.id,
              teamId: plan.team.id,
              playerId: player.id
            },
            select: { id: true }
          });

          await tx.adminAuditLog.create({
            data: {
              actorUserId,
              gameId: null,
              action: 'ROSTER_PLAYER_ADD',
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
                confirmations
              }
            }
          });

          return {
            changed: true,
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
