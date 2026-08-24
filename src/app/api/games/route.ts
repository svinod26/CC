import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { GameStatus, GameType } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const schema = z.object({
  type: z.nativeEnum(GameType),
  seasonId: z.string().min(1).optional(),
  homeTeamId: z.string().min(1).optional(),
  awayTeamId: z.string().min(1).optional(),
  homeTeamName: z.string().max(80).optional(),
  awayTeamName: z.string().max(80).optional(),
  location: z.string().trim().max(120).optional(),
  scheduledAt: z.string().datetime().optional(),
  week: z.number().int().positive().optional(),
  homeLineupIds: z.array(z.string()).max(6).default([]),
  awayLineupIds: z.array(z.string()).max(6).default([]),
  homeLineupNames: z.array(z.string().max(100)).max(6).default([]),
  awayLineupNames: z.array(z.string().max(100)).max(6).default([])
}).strict();

class GameSetupError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let userId = session.user.id;
  let user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    const email = session.user.email ?? null;
    if (email) {
      user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        const passwordHash = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);
        user = await prisma.user.create({
          data: {
            email,
            name: session.user.name ?? null,
            passwordHash,
            role: session.user.role === 'ADMIN' ? 'ADMIN' : 'USER'
          }
        });
      }
      userId = user.id;
    }
  }
  if (!userId || !user) {
    return NextResponse.json({ error: 'Account not found. Please sign out and sign in again.' }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const data = parsed.data;
  const scheduledDate = data.scheduledAt ? new Date(data.scheduledAt) : null;
  const status = scheduledDate && scheduledDate.getTime() > Date.now() ? GameStatus.SCHEDULED : GameStatus.IN_PROGRESS;

  const normalizeName = (value: string) => value.trim().replace(/\s+/g, ' ');
  const normalizedHomeNames = data.homeLineupNames.map(normalizeName);
  const normalizedAwayNames = data.awayLineupNames.map(normalizeName);

  if (data.type === GameType.EXHIBITION) {
    if (
      normalizedHomeNames.length !== 6 ||
      normalizedAwayNames.length !== 6 ||
      normalizedHomeNames.some((name) => !name) ||
      normalizedAwayNames.some((name) => !name)
    ) {
      return NextResponse.json({ error: 'Set all six shooters for each side.' }, { status: 400 });
    }
    const normalizedKeys = [...normalizedHomeNames, ...normalizedAwayNames].map((name) =>
      name.toLocaleLowerCase()
    );
    if (new Set(normalizedKeys).size !== normalizedKeys.length) {
      return NextResponse.json({ error: 'Every shooter must appear only once.' }, { status: 400 });
    }
  }

  let game;
  try {
    let resolvedHomeLineupIds = data.homeLineupIds;
    let resolvedAwayLineupIds = data.awayLineupIds;

    game = await prisma.$transaction(async (tx) => {
      let homeTeamId = data.homeTeamId;
      let awayTeamId = data.awayTeamId;

      if (data.type === GameType.EXHIBITION) {
        const allNames = [...normalizedHomeNames, ...normalizedAwayNames];
        const existingPlayers = await tx.player.findMany({
          where: {
            OR: allNames.map((name) => ({ name: { equals: name, mode: 'insensitive' } }))
          },
          orderBy: { createdAt: 'asc' }
        });
        const playerByName = new Map<string, string>();
        for (const player of existingPlayers) {
          const key = normalizeName(player.name).toLocaleLowerCase();
          if (!playerByName.has(key)) playerByName.set(key, player.id);
        }
        const resolvePlayerIds = async (names: string[]) => {
          const ids: string[] = [];
          for (const name of names) {
            const key = name.toLocaleLowerCase();
            let playerId = playerByName.get(key);
            if (!playerId) {
              const created = await tx.player.create({ data: { name } });
              playerId = created.id;
              playerByName.set(key, playerId);
            }
            ids.push(playerId);
          }
          return ids;
        };
        resolvedHomeLineupIds = await resolvePlayerIds(normalizedHomeNames);
        resolvedAwayLineupIds = await resolvePlayerIds(normalizedAwayNames);

        const homeName = normalizeName(data.homeTeamName ?? '') || 'Exhibition Home';
        const awayName = normalizeName(data.awayTeamName ?? '') || 'Exhibition Away';

        if (homeName.toLowerCase() === awayName.toLowerCase()) {
          throw new GameSetupError('Home and away teams must differ.');
        }

        const [homeTeam, awayTeam] = await Promise.all([
          tx.team.findFirst({
            where: { seasonId: null, name: { equals: homeName, mode: 'insensitive' } }
          }),
          tx.team.findFirst({
            where: { seasonId: null, name: { equals: awayName, mode: 'insensitive' } }
          })
        ]);

        const createdHome = homeTeam ?? (await tx.team.create({ data: { name: homeName } }));
        const createdAway = awayTeam ?? (await tx.team.create({ data: { name: awayName } }));
        homeTeamId = createdHome.id;
        awayTeamId = createdAway.id;
      }

      if (!homeTeamId || !awayTeamId) {
        throw new GameSetupError('Select both teams.');
      }

      if (homeTeamId === awayTeamId) {
        throw new GameSetupError('Home and away teams must differ.');
      }

      if (data.type === GameType.LEAGUE && !data.seasonId) {
        throw new GameSetupError('League games require a season.');
      }
      if (data.type === GameType.LEAGUE && !data.week) {
        throw new GameSetupError('League games require a week selection.');
      }

      if (data.type === GameType.LEAGUE) {
        if (
          resolvedHomeLineupIds.length !== 6 ||
          resolvedAwayLineupIds.length !== 6 ||
          resolvedHomeLineupIds.some((id) => !id) ||
          resolvedAwayLineupIds.some((id) => !id)
        ) {
          throw new GameSetupError('Set all six shooters for each side.');
        }
        if (
          new Set(resolvedHomeLineupIds).size !== resolvedHomeLineupIds.length ||
          new Set(resolvedAwayLineupIds).size !== resolvedAwayLineupIds.length ||
          resolvedHomeLineupIds.some((id) => resolvedAwayLineupIds.includes(id))
        ) {
          throw new GameSetupError('Every shooter must appear only once.');
        }

        const selectedTeams = await tx.team.findMany({
          where: {
            id: { in: [homeTeamId, awayTeamId] },
            seasonId: data.seasonId
          },
          select: { id: true }
        });
        if (selectedTeams.length !== 2) {
          throw new GameSetupError('Teams must belong to the selected season.');
        }

        const rosterSlots = await tx.teamRoster.findMany({
          where: {
            seasonId: data.seasonId,
            OR: [
              { teamId: homeTeamId, playerId: { in: resolvedHomeLineupIds } },
              { teamId: awayTeamId, playerId: { in: resolvedAwayLineupIds } }
            ]
          },
          select: { teamId: true, playerId: true }
        });
        const validRosterKeys = new Set(
          rosterSlots.map((slot) => `${slot.teamId}:${slot.playerId}`)
        );
        const hasInvalidShooter =
          resolvedHomeLineupIds.some((id) => !validRosterKeys.has(`${homeTeamId}:${id}`)) ||
          resolvedAwayLineupIds.some((id) => !validRosterKeys.has(`${awayTeamId}:${id}`));
        if (hasInvalidShooter) {
          throw new GameSetupError('Every league shooter must be on that team’s roster.');
        }
      }

      let scheduleEntry: { id: string } | null = null;
      if (data.type === GameType.LEAGUE && data.seasonId && data.week) {
        const existingSchedule = await tx.schedule.findFirst({
          where: {
            seasonId: data.seasonId,
            week: data.week,
            OR: [
              { homeTeamId, awayTeamId },
              { homeTeamId: awayTeamId, awayTeamId: homeTeamId }
            ]
          },
          select: { id: true, gameId: true }
        });

        if (existingSchedule?.gameId) {
          throw new GameSetupError('That scheduled matchup already has a game.', 409);
        }
        scheduleEntry = existingSchedule;

        if (!scheduleEntry) {
          const createdSchedule = await tx.schedule.create({
            data: {
              seasonId: data.seasonId,
              week: data.week,
              homeTeamId,
              awayTeamId
            },
            select: { id: true }
          });
          scheduleEntry = createdSchedule;
        }
      }

      const createdGame = await tx.game.create({
        data: {
          type: data.type,
          seasonId: data.type === GameType.LEAGUE ? data.seasonId : null,
          homeTeamId,
          awayTeamId,
          location: data.location,
          startedAt: scheduledDate ?? new Date(),
          scheduledAt: scheduledDate ?? undefined,
          status,
          createdById: userId,
          statTakerId: userId,
          state: {
            create: {
              possessionTeamId: homeTeamId,
              homeCupsRemaining: 100,
              awayCupsRemaining: 100,
              status,
              phase: 'REGULATION'
            }
          }
        }
      });

      const lineupCreates = [
        ...resolvedHomeLineupIds.map((playerId, index) => ({
          gameId: createdGame.id,
          teamId: homeTeamId,
          playerId,
          orderIndex: index
        })),
        ...resolvedAwayLineupIds.map((playerId, index) => ({
          gameId: createdGame.id,
          teamId: awayTeamId,
          playerId,
          orderIndex: index
        }))
      ];

      if (lineupCreates.length > 0) {
        await tx.gameLineup.createMany({ data: lineupCreates });
      }

      await tx.turn.create({
        data: {
          gameId: createdGame.id,
          offenseTeamId: homeTeamId,
          turnIndex: 1,
          isBonus: false,
          shootersJson: resolvedHomeLineupIds
        }
      });

      if (scheduleEntry) {
        await tx.schedule.update({
          where: { id: scheduleEntry.id },
          data: { gameId: createdGame.id }
        });
      }

      return createdGame;
    }, { timeout: 15_000, isolationLevel: 'Serializable' });
  } catch (error: unknown) {
    if (error instanceof GameSetupError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034') {
      return NextResponse.json(
        { error: 'Another game setup finished first. Refresh and try again.' },
        { status: 409 }
      );
    }
    console.error('Game creation failed', error);
    return NextResponse.json({ error: 'Failed to create game.' }, { status: 500 });
  }

  return NextResponse.json({ id: game.id });
}
