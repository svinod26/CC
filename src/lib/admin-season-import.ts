import { createHash } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import type { SeasonImportDraft } from '@/lib/excel';
import { normalizePlayerKey } from '@/lib/player-name';
import { prisma } from '@/lib/prisma';
import { sortSeasons } from '@/lib/season';
import {
  planSeasonImport,
  seedManualSeasonTeams,
  type SeasonImportCatalogPlayer,
  type SeasonImportTeamCatalog
} from '@/lib/season-import-plan';

type SeasonImportDb = PrismaClient | Prisma.TransactionClient;

export class AdminSeasonImportError extends Error {
  constructor(
    readonly code: 'FORBIDDEN' | 'INVALID' | 'STALE' | 'CONFLICT',
    message: string,
    readonly status: 400 | 403 | 409
  ) {
    super(message);
    this.name = 'AdminSeasonImportError';
  }
}

async function loadCatalog(db: SeasonImportDb): Promise<SeasonImportCatalogPlayer[]> {
  const players = await db.player.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      updatedAt: true,
      aliases: { select: { alias: true, aliasKey: true }, orderBy: { aliasKey: 'asc' } }
    },
    orderBy: { id: 'asc' }
  });
  return players.map((player) => ({
    ...player,
    updatedAt: player.updatedAt.toISOString()
  }));
}

async function loadTeamCatalog(db: SeasonImportDb): Promise<SeasonImportTeamCatalog> {
  const seasons = await db.season.findMany({
    where: { conferences: { some: { name: 'League' } } },
    select: {
      id: true,
      name: true,
      year: true,
      teams: {
        where: { conference: { name: 'League' } },
        select: { name: true },
        orderBy: { name: 'asc' }
      }
    }
  });
  const latest = sortSeasons(seasons)[0] ?? null;
  return latest
    ? { seasonId: latest.id, seasonName: latest.name, teams: latest.teams }
    : null;
}

async function buildSeasonImportPlan(
  db: SeasonImportDb,
  submittedDraft: SeasonImportDraft,
  options: { seedManualTeams?: boolean } = {}
) {
  const [catalog, teamCatalog, duplicateSeason] = await Promise.all([
    loadCatalog(db),
    loadTeamCatalog(db),
    db.season.findFirst({
      where: { name: { equals: submittedDraft.seasonName.trim(), mode: 'insensitive' } },
      select: { id: true }
    })
  ]);
  const draft = options.seedManualTeams
    ? seedManualSeasonTeams(submittedDraft, teamCatalog)
    : submittedDraft;
  const plan = planSeasonImport(draft, catalog, teamCatalog);
  if (duplicateSeason) {
    plan.issues.push({
      code: 'DUPLICATE_SEASON',
      message: 'A season with that name already exists.',
      path: 'seasonName',
      blocking: true
    });
    plan.counts.blockingIssues += 1;
    plan.canCommit = false;
  }
  const fingerprint = createHash('sha256').update(JSON.stringify({
    draft: plan.draft,
    duplicateSeasonId: duplicateSeason?.id ?? null,
    teamCatalog,
    catalog: catalog.map((player) => ({
      id: player.id,
      name: player.name,
      email: player.email,
      updatedAt: player.updatedAt,
      aliases: player.aliases
    }))
  })).digest('hex');
  return { ...plan, fingerprint };
}

export async function previewSeasonImport(
  actorUserId: string,
  draft: SeasonImportDraft,
  options: { seedManualTeams?: boolean } = {}
) {
  const actor = await prisma.user.findUnique({ where: { id: actorUserId }, select: { role: true } });
  if (actor?.role !== 'ADMIN') throw new AdminSeasonImportError('FORBIDDEN', 'Admin only', 403);
  return buildSeasonImportPlan(prisma, draft, options);
}

const isPrismaCode = (error: unknown, code: string) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;

export async function commitSeasonImport({
  actorUserId,
  draft,
  fingerprint
}: {
  actorUserId: string;
  draft: SeasonImportDraft;
  fingerprint: string;
}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: { role: true } });
        if (actor?.role !== 'ADMIN') throw new AdminSeasonImportError('FORBIDDEN', 'Admin only', 403);

        const plan = await buildSeasonImportPlan(tx, draft);
        if (plan.fingerprint !== fingerprint) {
          throw new AdminSeasonImportError(
            'STALE',
            'The workbook review or Player identities changed. Review the refreshed import before confirming.',
            409
          );
        }
        if (!plan.canCommit) {
          throw new AdminSeasonImportError('INVALID', 'The import still has blocking validation issues.', 400);
        }

        const duplicateSeason = await tx.season.findFirst({
          where: { name: { equals: plan.draft.seasonName, mode: 'insensitive' } },
          select: { id: true }
        });
        if (duplicateSeason) {
          throw new AdminSeasonImportError('CONFLICT', 'A season with that name already exists.', 409);
        }

        const season = await tx.season.create({
          data: { name: plan.draft.seasonName, year: plan.draft.year },
          select: { id: true, name: true, year: true }
        });
        const conference = await tx.conference.create({
          data: { seasonId: season.id, name: 'League' },
          select: { id: true }
        });

        const teamIds = new Map<string, string>();
        for (const team of plan.draft.teams) {
          const created = await tx.team.create({
            data: { seasonId: season.id, conferenceId: conference.id, name: team.name },
            select: { id: true }
          });
          teamIds.set(team.id, created.id);
        }

        for (const row of plan.draft.players) {
          await tx.teamRoster.create({
            data: {
              seasonId: season.id,
              teamId: teamIds.get(row.teamId)!,
              playerId: row.playerId!
            }
          });
          if (row.rememberAlias) {
            await tx.playerAlias.create({
              data: {
                alias: row.rawName,
                aliasKey: normalizePlayerKey(row.rawName),
                playerId: row.playerId!,
                source: `season-import:${season.name}`
              }
            });
          }
        }

        if (plan.draft.schedule.length > 0) {
          await tx.schedule.createMany({
            data: plan.draft.schedule.map((row) => ({
              seasonId: season.id,
              week: row.week,
              homeTeamId: teamIds.get(row.homeTeamId)!,
              awayTeamId: teamIds.get(row.awayTeamId)!
            }))
          });
        }

        await tx.adminAuditLog.create({
          data: {
            actorUserId,
            gameId: null,
            action: 'SEASON_IMPORT',
            entityType: 'Season',
            entityId: season.id,
            details: {
              seasonName: season.name,
              year: season.year,
              conference: 'League',
              layout: plan.draft.layout,
              teams: plan.counts.teams,
              players: plan.counts.players,
              scheduleRows: plan.counts.schedule,
              aliasesCreated: plan.draft.players.filter((row) => row.rememberAlias).length
            }
          }
        });

        return {
          seasonId: season.id,
          seasonName: season.name,
          teams: plan.counts.teams,
          players: plan.counts.players,
          scheduleRows: plan.counts.schedule
        };
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 30_000
      });
    } catch (error) {
      if (isPrismaCode(error, 'P2034') && attempt < 2) continue;
      if (isPrismaCode(error, 'P2002')) {
        throw new AdminSeasonImportError('CONFLICT', 'The season or an alias now conflicts with existing data. Review the import again.', 409);
      }
      if (isPrismaCode(error, 'P2034')) {
        throw new AdminSeasonImportError('STALE', 'Another admin operation completed at the same time. Review and retry.', 409);
      }
      throw error;
    }
  }
  throw new AdminSeasonImportError('STALE', 'Another admin operation completed at the same time. Review and retry.', 409);
}
