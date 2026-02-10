import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { GameStatus, ResultType } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const game = await prisma.game.findUnique({
    where: { id: params.id },
    include: { statTaker: true }
  });
  if (!game) {
    return NextResponse.json({ error: 'Game not found' }, { status: 404 });
  }
  const isScorer =
    (game.statTakerId && session.user.id === game.statTakerId) ||
    (game.statTaker?.email && session.user.email && game.statTaker.email === session.user.email);
  if (!isScorer) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const lastEvent = await prisma.shotEvent.findFirst({
    where: { gameId: params.id },
    orderBy: { timestamp: 'desc' }
  });

  if (!lastEvent) {
    return NextResponse.json({ error: 'No events to undo' }, { status: 400 });
  }

  await prisma.shotEvent.delete({ where: { id: lastEvent.id } });

  // Clean empty trailing turns
  const turns = await prisma.turn.findMany({
    where: { gameId: params.id },
    orderBy: { turnIndex: 'desc' },
    include: { events: true }
  });

  for (const turn of turns) {
    if (turn.events.length === 0) {
      await prisma.turn.delete({ where: { id: turn.id } });
    } else {
      break;
    }
  }

  await recomputeState(params.id);

  return NextResponse.json({ ok: true });
}

async function recomputeState(gameId: string) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      homeTeam: true,
      awayTeam: true,
      state: true,
      lineups: true,
      turns: {
        orderBy: { turnIndex: 'asc' },
        include: { events: { orderBy: { timestamp: 'asc' } } }
      }
    }
  });

  if (!game || !game.homeTeamId || !game.awayTeamId) return;

  let turns = game.turns.slice();

  while (turns.length > 0 && turns[turns.length - 1].events.length === 0) {
    await prisma.turn.delete({ where: { id: turns[turns.length - 1].id } });
    turns.pop();
  }

  if (turns.length === 0) {
    const offenseTeamId = game.homeTeamId;
    const created = await prisma.turn.create({
      data: {
        gameId,
        offenseTeamId,
        turnIndex: 1,
        isBonus: false,
        shootersJson: game.lineups
          .filter((l) => l.teamId === offenseTeamId)
          .sort((a, b) => a.orderIndex - b.orderIndex)
          .map((l) => l.playerId)
      }
    });
    turns = [{ ...created, events: [] }];
  }

  let homeCups = 100;
  let awayCups = 100;
  let currentTurnNumber = 1;
  let currentShooterIndex = 0;

  for (const turn of turns) {
    const offenseId: string = turn.offenseTeamId ?? game.homeTeamId;
    const defenseId = offenseId === game.homeTeamId ? game.awayTeamId : game.homeTeamId;
    let shotsThisTurn = 0;

    for (const event of turn.events) {
      if (event.resultType === ResultType.PULL_HOME) {
        homeCups = Math.max(homeCups - event.cupsDelta, 0);
      } else if (event.resultType === ResultType.PULL_AWAY) {
        awayCups = Math.max(awayCups - event.cupsDelta, 0);
      } else {
        const isMake =
          event.resultType === ResultType.TOP_REGULAR ||
          event.resultType === ResultType.TOP_ISO ||
          event.resultType === ResultType.BOTTOM_REGULAR ||
          event.resultType === ResultType.BOTTOM_ISO;
        shotsThisTurn += 1;
        if (isMake) {
          if (offenseId === game.homeTeamId) {
            awayCups = Math.max(awayCups - 1, 0);
          } else {
            homeCups = Math.max(homeCups - 1, 0);
          }
        }
      }
    }

    currentTurnNumber = turn.turnIndex;
    const shooterIds = Array.isArray(turn.shootersJson) ? (turn.shootersJson as string[]) : [];
    const lineupLength =
      shooterIds.length ||
      game.lineups.filter((l) => l.teamId === offenseId).sort((a, b) => a.orderIndex - b.orderIndex).length ||
      6;
    currentShooterIndex = shotsThisTurn % Math.max(lineupLength, 1);
  }

  const lastTurn = turns[turns.length - 1];
  const possessionTeamId = lastTurn?.offenseTeamId ?? game.homeTeamId;
  const zeroTeamId =
    homeCups <= 0 ? game.homeTeamId : awayCups <= 0 ? game.awayTeamId : null;
  const nextPhase =
    game.state?.phase === 'OVERTIME'
      ? 'OVERTIME'
      : zeroTeamId && possessionTeamId === zeroTeamId
        ? 'REDEMPTION'
        : 'REGULATION';
  const nextStatus = GameStatus.IN_PROGRESS;

  await prisma.gameState.updateMany({
    where: { gameId },
    data: {
      homeCupsRemaining: homeCups,
      awayCupsRemaining: awayCups,
      possessionTeamId,
      currentTurnNumber,
      currentShooterIndex,
      status: nextStatus,
      phase: nextPhase as any
    }
  });

  await prisma.game.update({
    where: { id: gameId },
    data: {
      status: nextStatus,
      endedAt: null
    }
  });
}
