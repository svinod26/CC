import { authOptions } from '@/lib/auth';
import { logAdminAudit } from '@/lib/admin-audit';
import { parseWorkbook } from '@/lib/excel';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const importSchema = z.object({
  seasonName: z.string().trim().min(1).max(50),
  year: z.coerce.number().int().min(2000).max(2100)
});

const MAX_WORKBOOK_BYTES = 10 * 1024 * 1024;

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
          const lookup = player.email
            ? await tx.player.findFirst({
                where: { email: { equals: player.email, mode: 'insensitive' } }
              })
            : await tx.player.findFirst({
                where: { name: { equals: player.name, mode: 'insensitive' } }
              });
          const createdPlayer = lookup
            ? await tx.player.update({
                where: { id: lookup.id },
                data: { name: player.name, email: player.email || lookup.email || null }
              })
            : await tx.player.create({
                data: { name: player.name, email: player.email || null }
              });

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
