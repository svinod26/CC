import { authOptions } from '@/lib/auth';
import { logAdminAudit } from '@/lib/admin-audit';
import { recomputeGameState } from '@/lib/game-state';
import { prisma } from '@/lib/prisma';
import { GameStatus, ResultType } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const adjustmentSchema = z.object({
  playerId: z.string().min(1),
  resultType: z.enum([
    ResultType.TOP_REGULAR,
    ResultType.TOP_ISO,
    ResultType.BOTTOM_REGULAR,
    ResultType.BOTTOM_ISO,
    ResultType.MISS
  ]),
  action: z.enum(['ADD', 'SUBTRACT'])
});

const isMake = (resultType: ResultType) =>
  resultType === ResultType.TOP_REGULAR ||
  resultType === ResultType.TOP_ISO ||
  resultType === ResultType.BOTTOM_REGULAR ||
  resultType === ResultType.BOTTOM_ISO;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const json = await req.json();
  const parsed = adjustmentSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const { playerId, resultType, action } = parsed.data;
  const game = await prisma.game.findUnique({
    where: { id: params.id },
    include: {
      state: true,
      turns: { orderBy: { turnIndex: 'desc' }, take: 1 },
      lineups: true
    }
  });

  if (!game || !game.homeTeamId || !game.awayTeamId || !game.state) {
    return NextResponse.json({ error: 'Game not found' }, { status: 404 });
  }

  if (game.status !== GameStatus.FINAL) {
    return NextResponse.json({ error: 'Only finalized games can be edited' }, { status: 400 });
  }

  if (game.statsSource !== 'TRACKED') {
    return NextResponse.json({ error: 'Legacy games cannot be edited with this tool' }, { status: 400 });
  }

  const lineupSlot = game.lineups.find((slot) => slot.playerId === playerId);
  if (!lineupSlot || !lineupSlot.teamId) {
    return NextResponse.json({ error: 'Player is not in this game lineup' }, { status: 400 });
  }

  if (action === 'ADD') {
    const offenseTeamId = lineupSlot.teamId;
    const defenseTeamId = offenseTeamId === game.homeTeamId ? game.awayTeamId : game.homeTeamId;
    const targetBefore =
      offenseTeamId === game.homeTeamId ? game.state.awayCupsRemaining : game.state.homeCupsRemaining;
    const delta = isMake(resultType) ? 1 : 0;
    const targetAfter = Math.max(0, Math.min(100, targetBefore - delta));

    const createdEvent = await prisma.shotEvent.create({
      data: {
        gameId: game.id,
        turnId: game.turns[0]?.id ?? null,
        offenseTeamId,
        defenseTeamId,
        shooterId: playerId,
        resultType,
        cupsDelta: delta,
        remainingCupsBefore: targetBefore,
        remainingCupsAfter: targetAfter,
        note: 'Admin adjustment'
      }
    });

    await recomputeGameState(game.id, { preserveFinalStatus: true });

    const refreshedState = await prisma.gameState.findUnique({
      where: { gameId: game.id },
      select: { homeCupsRemaining: true, awayCupsRemaining: true, currentTurnNumber: true, phase: true }
    });
    await logAdminAudit({
      actorUserId: session.user.id,
      gameId: game.id,
      action: 'GAME_SCORE_ADJUST_ADD',
      entityType: 'ShotEvent',
      entityId: createdEvent.id,
      details: {
        playerId,
        resultType,
        gameStatus: game.status,
        beforeState: {
          homeCupsRemaining: game.state.homeCupsRemaining,
          awayCupsRemaining: game.state.awayCupsRemaining,
          currentTurnNumber: game.state.currentTurnNumber,
          phase: game.state.phase
        },
        afterState: refreshedState
      }
    });
    return NextResponse.json({ ok: true });
  } else {
    const eventToDelete = await prisma.shotEvent.findFirst({
      where: {
        gameId: game.id,
        shooterId: playerId,
        resultType
      },
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }]
    });

    if (!eventToDelete) {
      return NextResponse.json({ error: 'No matching shot to remove' }, { status: 404 });
    }

    await prisma.shotEvent.delete({ where: { id: eventToDelete.id } });
    await recomputeGameState(game.id, { preserveFinalStatus: true });
    const refreshedState = await prisma.gameState.findUnique({
      where: { gameId: game.id },
      select: { homeCupsRemaining: true, awayCupsRemaining: true, currentTurnNumber: true, phase: true }
    });
    await logAdminAudit({
      actorUserId: session.user.id,
      gameId: game.id,
      action: 'GAME_SCORE_ADJUST_SUBTRACT',
      entityType: 'ShotEvent',
      entityId: eventToDelete.id,
      details: {
        playerId,
        resultType,
        gameStatus: game.status,
        beforeState: {
          homeCupsRemaining: game.state.homeCupsRemaining,
          awayCupsRemaining: game.state.awayCupsRemaining,
          currentTurnNumber: game.state.currentTurnNumber,
          phase: game.state.phase
        },
        removedEvent: {
          shooterId: eventToDelete.shooterId,
          resultType: eventToDelete.resultType,
          cupsDelta: eventToDelete.cupsDelta,
          remainingCupsBefore: eventToDelete.remainingCupsBefore,
          remainingCupsAfter: eventToDelete.remainingCupsAfter
        },
        afterState: refreshedState
      }
    });
    return NextResponse.json({ ok: true });
  }
}
