import { authOptions } from '@/lib/auth';
import { logAdminAudit } from '@/lib/admin-audit';
import { canonicalizeEmail, normalizeEmail } from '@/lib/email';
import { parseWorkbook } from '@/lib/excel';
import { normalizePlayerKey } from '@/lib/player-name';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const importSchema = z.object({
  seasonName: z.string().trim().min(1).max(50),
  year: z.coerce.number().int().min(2000).max(2100)
});

const MAX_WORKBOOK_BYTES = 10 * 1024 * 1024;
const workbookEmailSchema = z.string().email().max(254);

class ImportValidationError extends Error {}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const formData = await req.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: 'Expected a workbook upload.' }, { status: 400 });
  }

  const file = formData.get('file');
  const parsed = importSchema.safeParse({
    seasonName: formData.get('seasonName'),
    year: formData.get('year')
  });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Choose a non-empty Excel workbook.' }, { status: 400 });
  }
  if (file.size > MAX_WORKBOOK_BYTES) {
    return NextResponse.json({ error: 'Workbook must be 10 MB or smaller.' }, { status: 413 });
  }
  if (!/\.(xlsx|xls)$/i.test(file.name)) {
    return NextResponse.json({ error: 'Workbook must be an .xlsx or .xls file.' }, { status: 400 });
  }

  let parsedWorkbook;
  try {
    parsedWorkbook = parseWorkbook(await file.arrayBuffer());
  } catch (error) {
    console.error('Workbook parse failed', error);
    return NextResponse.json({ error: 'Could not read that Excel workbook.' }, { status: 400 });
  }

  if (parsedWorkbook.players.length === 0 || parsedWorkbook.teams.length === 0) {
    return NextResponse.json(
      { error: 'Workbook must contain players and teams.' },
      { status: 400 }
    );
  }

  const teamNames = new Set(parsedWorkbook.teams.map((team) => team.name));
  const invalidSchedule = parsedWorkbook.schedule.find(
    (row) =>
      !Number.isInteger(row.week) ||
      row.week < 1 ||
      !row.home ||
      !row.away ||
      row.home === row.away ||
      !teamNames.has(row.home) ||
      !teamNames.has(row.away)
  );
  if (invalidSchedule) {
    return NextResponse.json(
      { error: 'Every schedule row needs a valid week and two known, different teams.' },
      { status: 400 }
    );
  }

  const duplicateSeason = await prisma.season.findFirst({
    where: { name: { equals: parsed.data.seasonName, mode: 'insensitive' } },
    select: { id: true }
  });
  if (duplicateSeason) {
    return NextResponse.json({ error: 'A season with that name already exists.' }, { status: 409 });
  }

  let season;
  try {
    season = await prisma.$transaction(
      async (tx) => {
        const createdSeason = await tx.season.create({
          data: { name: parsed.data.seasonName, year: parsed.data.year }
        });

        const conferenceMap = new Map<string, string>();
        for (const confName of parsedWorkbook.conferences) {
          const conf = await tx.conference.create({
            data: { name: confName, seasonId: createdSeason.id }
          });
          conferenceMap.set(confName, conf.id);
        }

        const teamMap = new Map<string, string>();
        for (const team of parsedWorkbook.teams) {
          const confId = team.conference ? conferenceMap.get(team.conference) : undefined;
          if (team.conference && !confId) {
            throw new ImportValidationError(`Unknown conference for ${team.name}.`);
          }
          const created = await tx.team.create({
            data: {
              name: team.name,
              seasonId: createdSeason.id,
              conferenceId: confId
            }
          });
          teamMap.set(team.name, created.id);
        }

        for (const player of parsedWorkbook.players) {
          const workbookEmail = player.email ? normalizeEmail(player.email) : null;
          if (workbookEmail && !workbookEmailSchema.safeParse(workbookEmail).success) {
            throw new ImportValidationError(`Invalid email for ${player.name}.`);
          }

          const [emailedPlayers, nameMatches, alias] = await Promise.all([
            workbookEmail
              ? tx.player.findMany({ where: { email: { not: null } } })
              : Promise.resolve([]),
            tx.player.findMany({
              where: { name: { equals: player.name, mode: 'insensitive' } }
            }),
            tx.playerAlias.findUnique({
              where: { aliasKey: normalizePlayerKey(player.name) },
              include: { player: true }
            })
          ]);

          if (nameMatches.length > 1) {
            throw new ImportValidationError(
              `Multiple existing players use the name ${player.name}. Resolve them before importing.`
            );
          }

          const canonicalWorkbookEmail = workbookEmail
            ? canonicalizeEmail(workbookEmail)
            : null;
          const emailMatches = canonicalWorkbookEmail
            ? emailedPlayers.filter(
                (existing) =>
                  existing.email && canonicalizeEmail(existing.email) === canonicalWorkbookEmail
              )
            : [];
          if (emailMatches.length > 1) {
            throw new ImportValidationError(
              `Multiple existing players use the email for ${player.name}. Resolve them before importing.`
            );
          }

          const candidates = [emailMatches[0] ?? null, nameMatches[0] ?? null, alias?.player ?? null]
            .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));
          const candidateIds = new Set(candidates.map((candidate) => candidate.id));
          if (candidateIds.size > 1) {
            throw new ImportValidationError(
              `The name and email for ${player.name} resolve to different Player records.`
            );
          }

          const lookup = candidates[0] ?? null;
          let createdPlayer;
          if (lookup) {
            if (
              workbookEmail &&
              lookup.email &&
              canonicalizeEmail(lookup.email) !== canonicalWorkbookEmail
            ) {
              throw new ImportValidationError(
                `${player.name} already has a different database email. Correct the workbook before importing.`
              );
            }

            const matchedByAlias = Boolean(
              alias?.playerId === lookup.id &&
                player.name.trim().toLocaleLowerCase() !== lookup.name.trim().toLocaleLowerCase()
            );
            const nextName = matchedByAlias ? lookup.name : player.name;
            const nextEmail = lookup.email ?? workbookEmail;
            createdPlayer =
              nextName === lookup.name && nextEmail === lookup.email
                ? lookup
                : await tx.player.update({
                    where: { id: lookup.id },
                    data: { name: nextName, email: nextEmail }
                  });
          } else {
            createdPlayer = await tx.player.create({
              data: { name: player.name, email: workbookEmail }
            });
          }

          const teamId = player.team ? teamMap.get(player.team) : undefined;
          if (player.team && !teamId) {
            throw new ImportValidationError(`Unknown team for ${player.name}.`);
          }
          if (teamId) {
            await tx.teamRoster.upsert({
              where: {
                seasonId_playerId_teamId: {
                  seasonId: createdSeason.id,
                  playerId: createdPlayer.id,
                  teamId
                }
              },
              update: {},
              create: {
                seasonId: createdSeason.id,
                playerId: createdPlayer.id,
                teamId
              }
            });
          }
        }

        if (parsedWorkbook.schedule.length > 0) {
          await tx.schedule.createMany({
            data: parsedWorkbook.schedule.map((row) => ({
              seasonId: createdSeason.id,
              week: row.week,
              homeTeamId: teamMap.get(row.home!),
              awayTeamId: teamMap.get(row.away!)
            }))
          });
        }

        return createdSeason;
      },
      { timeout: 30_000 }
    );
  } catch (error) {
    console.error('Season import failed', error);
    const message =
      error instanceof ImportValidationError ? error.message : 'Import failed without changing league data.';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  await logAdminAudit({
    actorUserId: session.user.id,
    gameId: null,
    action: 'SEASON_IMPORT',
    entityType: 'Season',
    entityId: season.id,
    details: {
      seasonName: season.name,
      year: season.year,
      conferences: parsedWorkbook.conferences.length,
      teams: parsedWorkbook.teams.length,
      players: parsedWorkbook.players.length,
      scheduleRows: parsedWorkbook.schedule.length
    }
  });

  return NextResponse.json({ ok: true, seasonId: season.id });
}
