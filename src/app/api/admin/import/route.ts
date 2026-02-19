import { authOptions } from '@/lib/auth';
import { logAdminAudit } from '@/lib/admin-audit';
import { parseWorkbook } from '@/lib/excel';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const importSchema = z.object({
  filePath: z.string().optional(),
  seasonName: z.string().optional(),
  year: z.number().optional()
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const json = await req.json().catch(() => ({}));
  const parsed = importSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const parsedWorkbook = parseWorkbook(parsed.data.filePath);

  const season = await prisma.season.create({
    data: {
      name: parsed.data.seasonName ?? 'Imported Season',
      year: parsed.data.year ?? new Date().getFullYear()
    }
  });

  const conferenceMap = new Map<string, string>();
  for (const confName of parsedWorkbook.conferences) {
    const conf = await prisma.conference.create({
      data: {
        name: confName,
        seasonId: season.id
      }
    });
    conferenceMap.set(confName, conf.id);
  }

  const teamMap = new Map<string, string>();
  for (const team of parsedWorkbook.teams) {
    const confId = team.conference ? conferenceMap.get(team.conference) : undefined;
    const created = await prisma.team.create({
      data: {
        name: team.name,
        seasonId: season.id,
        conferenceId: confId
      }
    });
    teamMap.set(team.name, created.id);
  }

  for (const player of parsedWorkbook.players) {
    const lookup = player.email
      ? await prisma.player.findFirst({ where: { email: player.email } })
      : await prisma.player.findFirst({ where: { name: player.name } });
    const createdPlayer = lookup
      ? await prisma.player.update({
          where: { id: lookup.id },
          data: { name: player.name, email: player.email || lookup.email || null }
        })
      : await prisma.player.create({
          data: { name: player.name, email: player.email || null }
        });

    const teamId = player.team ? teamMap.get(player.team) : undefined;
    if (teamId) {
      await prisma.teamRoster.upsert({
        where: {
          seasonId_playerId_teamId: {
            seasonId: season.id,
            playerId: createdPlayer.id,
            teamId
          }
        },
        update: {},
        create: {
          seasonId: season.id,
          playerId: createdPlayer.id,
          teamId
        }
      });
    }
  }

  for (const row of parsedWorkbook.schedule) {
    const homeId = row.home ? teamMap.get(row.home) : undefined;
    const awayId = row.away ? teamMap.get(row.away) : undefined;
    await prisma.schedule.create({
      data: {
        seasonId: season.id,
        week: row.week || 0,
        homeTeamId: homeId,
        awayTeamId: awayId
      }
    });
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
