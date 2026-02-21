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
  seasonId: z.string().optional(),
  homeTeamId: z.string().optional(),
  awayTeamId: z.string().optional(),
  homeTeamName: z.string().optional(),
  awayTeamName: z.string().optional(),
  location: z.string().optional(),
  scheduledAt: z.string().optional(),
  week: z.number().int().positive().optional(),
  homeLineupIds: z.array(z.string()).default([]),
  awayLineupIds: z.array(z.string()).default([])
});

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

  const json = await req.json();
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const data = parsed.data;
  const scheduledDate = data.scheduledAt ? new Date(data.scheduledAt) : null;
  const status = scheduledDate && scheduledDate.getTime() > Date.now() ? GameStatus.SCHEDULED : GameStatus.IN_PROGRESS;

  let game;
  try {
    game = await prisma.$transaction(async (tx) => {
      let homeTeamId = data.homeTeamId;
      let awayTeamId = data.awayTeamId;

      if (data.type === GameType.EXHIBITION) {
        const homeName = (data.homeTeamName ?? '').trim() || 'Exhibition Home';
        const awayName = (data.awayTeamName ?? '').trim() || 'Exhibition Away';

        if (homeName.toLowerCase() === awayName.toLowerCase()) {
          throw new Error('Home and away teams must differ.');
        }

        const [homeTeam, awayTeam] = await Promise.all([
          tx.team.findFirst({ where: { seasonId: null, name: homeName } }),
          tx.team.findFirst({ where: { seasonId: null, name: awayName } })
        ]);

        const createdHome = homeTeam ?? (await tx.team.create({ data: { name: homeName } }));
        const createdAway = awayTeam ?? (await tx.team.create({ data: { name: awayName } }));
        homeTeamId = createdHome.id;
        awayTeamId = createdAway.id;
      }

      if (!homeTeamId || !awayTeamId) {
        throw new Error('Missing teams');
      }

      if (homeTeamId === awayTeamId) {
        throw new Error('Teams must differ');
      }

      if (data.type === GameType.LEAGUE && !data.seasonId) {
        throw new Error('League games require a season.');
      }
      if (data.type === GameType.LEAGUE && !data.week) {
        throw new Error('League games require a week selection.');
      }

      let scheduleEntry: { id: string } | null = null;
      if (data.type === GameType.LEAGUE && data.seasonId && data.week) {
        scheduleEntry = await tx.schedule.findFirst({
          where: {
            seasonId: data.seasonId,
            week: data.week,
            gameId: null,
            OR: [
              { homeTeamId, awayTeamId },
              { homeTeamId: awayTeamId, awayTeamId: homeTeamId }
            ]
          },
          select: { id: true }
        });

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
          seasonId: data.seasonId,
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
        ...data.homeLineupIds.map((playerId, index) => ({
          gameId: createdGame.id,
          teamId: homeTeamId,
          playerId,
          orderIndex: index
        })),
        ...data.awayLineupIds.map((playerId, index) => ({
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
          shootersJson: data.homeLineupIds
        }
      });

      if (scheduleEntry) {
        await tx.schedule.update({
          where: { id: scheduleEntry.id },
          data: { gameId: createdGame.id }
        });
      }

      return createdGame;
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? 'Failed to create game' }, { status: 400 });
  }

  return NextResponse.json({ id: game.id });
}
