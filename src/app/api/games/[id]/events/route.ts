import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { GameStatus, ResultType } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const eventSchema = z.object({
  shooterId: z.string().optional(),
  resultType: z.nativeEnum(ResultType),
  teamId: z.string(),
  count: z.number().optional()
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const json = await req.json();
  const parsed = eventSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const { id: gameId } = params;
  const data = parsed.data;
  const resultType = data.resultType;
  const isPull = resultType === ResultType.PULL_HOME || resultType === ResultType.PULL_AWAY;
  const isMake =
    resultType === ResultType.TOP_REGULAR ||
    resultType === ResultType.TOP_ISO ||
    resultType === ResultType.BOTTOM_REGULAR ||
    resultType === ResultType.BOTTOM_ISO;
  const isMakeResult = (value: ResultType) =>
    value === ResultType.TOP_REGULAR ||
    value === ResultType.TOP_ISO ||
    value === ResultType.BOTTOM_REGULAR ||
    value === ResultType.BOTTOM_ISO;

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      state: true,
      lineups: true,
      turns: { orderBy: { turnIndex: 'desc' }, take: 1, include: { events: true } },
      homeTeam: true,
      awayTeam: true,
      statTaker: true
    }
  });

  if (!game || !game.state) {
    return NextResponse.json({ error: 'Game not found' }, { status: 404 });
  }
  const isScorer =
    (game.statTakerId && session.user.id === game.statTakerId) ||
    (game.statTaker?.email && session.user.email && game.statTaker.email === session.user.email);
  if (!isScorer) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (game.status !== GameStatus.IN_PROGRESS) {
    return NextResponse.json({ error: 'Only in-progress games can be edited' }, { status: 403 });
  }

  const currentTurn = game.turns[0];
  const phase = game.state.phase ?? 'REGULATION';
  const offenseTeamId = game.state.possessionTeamId ?? game.homeTeamId ?? data.teamId;
  const defenseTeamId =
    offenseTeamId === game.homeTeamId ? game.awayTeamId ?? null : game.homeTeamId ?? null;

  const offenseLineup = game.lineups
    .filter((l) => l.teamId === offenseTeamId && l.isActive)
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const defenseLineup = game.lineups
    .filter((l) => l.teamId === defenseTeamId && l.isActive)
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const defenseLineupLength = Math.max(defenseLineup.length || 6, 1);

  let ensuredTurn = currentTurn;
  if (!ensuredTurn) {
    ensuredTurn = await prisma.turn.create({
      data: {
        gameId,
        offenseTeamId,
        turnIndex: 1,
        isBonus: false,
        shootersJson: offenseLineup.map((l) => l.playerId)
      },
      include: { events: true }
    });
  }

  const turnShooterIds = Array.isArray(ensuredTurn.shootersJson)
    ? (ensuredTurn.shootersJson as string[])
    : [];
  const eligibleShooterIds = turnShooterIds.length
    ? turnShooterIds
    : offenseLineup.map((lineupSlot) => lineupSlot.playerId);
  if (!isPull && !data.shooterId) {
    return NextResponse.json({ error: 'Shooter is required for shot events' }, { status: 400 });
  }
  if (!isPull && data.shooterId && eligibleShooterIds.length > 0 && !eligibleShooterIds.includes(data.shooterId)) {
    return NextResponse.json({ error: 'Shooter is not active in this turn' }, { status: 400 });
  }
  const turnLineupLength = Math.max((turnShooterIds.length || offenseLineup.length || 6), 1);

  const cupsTargetBefore =
    resultType === ResultType.PULL_HOME
      ? game.state.homeCupsRemaining
      : resultType === ResultType.PULL_AWAY
        ? game.state.awayCupsRemaining
        : offenseTeamId === game.homeTeamId
          ? game.state.awayCupsRemaining
          : game.state.homeCupsRemaining;

  const rawCount = typeof data.count === 'number' ? Math.trunc(data.count) : 1;
  const pullDelta = rawCount === 0 ? 1 : rawCount;
  const cupsDelta = isPull ? pullDelta : isMake ? 1 : 0;
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
  const cupsAfter = clamp(cupsTargetBefore - cupsDelta, 0, 100);
  const pullTargetTeamId =
    resultType === ResultType.PULL_HOME
      ? game.homeTeamId
      : resultType === ResultType.PULL_AWAY
        ? game.awayTeamId
        : null;

  const event = await prisma.$transaction(async (tx) => {
    const createdEvent = await tx.shotEvent.create({
      data: {
        gameId,
        turnId: ensuredTurn.id,
        offenseTeamId,
        defenseTeamId: pullTargetTeamId ?? defenseTeamId,
        shooterId: data.shooterId,
        resultType,
        cupsDelta,
        remainingCupsBefore: cupsTargetBefore,
        remainingCupsAfter: cupsAfter
      }
    });

    let nextHome = game.state!.homeCupsRemaining;
    let nextAway = game.state!.awayCupsRemaining;
    if (resultType === ResultType.PULL_HOME) {
      nextHome = cupsAfter;
    } else if (resultType === ResultType.PULL_AWAY) {
      nextAway = cupsAfter;
    } else if (offenseTeamId === game.homeTeamId) {
      nextAway = cupsAfter;
    } else {
      nextHome = cupsAfter;
    }

    const shotsThisTurn = await tx.shotEvent.count({
      where: {
        turnId: ensuredTurn.id,
        resultType: { notIn: [ResultType.PULL_HOME, ResultType.PULL_AWAY] }
      }
    });
    const makesThisTurn = await tx.shotEvent.count({
      where: {
        turnId: ensuredTurn.id,
        resultType: {
          in: [
            ResultType.TOP_REGULAR,
            ResultType.TOP_ISO,
            ResultType.BOTTOM_REGULAR,
            ResultType.BOTTOM_ISO
          ]
        }
      }
    });
    const turnEvents = await tx.shotEvent.findMany({
      where: {
        turnId: ensuredTurn.id,
        resultType: { notIn: [ResultType.PULL_HOME, ResultType.PULL_AWAY] }
      }
    });
    const clearedThisTurn = turnEvents.some(
      (event) =>
        isMakeResult(event.resultType) &&
        event.remainingCupsBefore > 0 &&
        event.remainingCupsAfter === 0
    );
    const stuffMakesThisTurn = turnEvents.filter(
      (event) => isMakeResult(event.resultType) && event.remainingCupsBefore === 0
    ).length;

    let shooterIndex = isPull ? game.state!.currentShooterIndex : shotsThisTurn;
    let possessionTeamId = offenseTeamId;
    let currentTurnNumber = ensuredTurn.turnIndex;
    let newStatus = game.status;
    let nextPhase = phase;
    let nextLineupLength = turnLineupLength;

    if (nextHome === 0 && nextAway === 0) {
      nextPhase = 'OVERTIME';
      newStatus = GameStatus.FINAL;
      shooterIndex = 0;
    } else if (phase === 'REDEMPTION') {
      const opponentRemaining = offenseTeamId === game.homeTeamId ? nextAway : nextHome;
      if (!isPull) {
        if (!isMake) {
          shooterIndex = game.state!.currentShooterIndex + 1;
        } else {
          shooterIndex = game.state!.currentShooterIndex;
        }
      }

      if (opponentRemaining <= 0 && !isMake) {
        nextPhase = 'OVERTIME';
      } else if (shooterIndex >= turnLineupLength) {
        newStatus = GameStatus.FINAL;
      }
    } else {
      if (!isPull && shotsThisTurn >= turnLineupLength) {
        const nextTurnIndex = ensuredTurn.turnIndex + 1;
        if (clearedThisTurn) {
          if (stuffMakesThisTurn >= 2) {
            newStatus = GameStatus.FINAL;
          } else {
            const redemptionTeamId =
              (nextHome === 0 ? game.homeTeamId : game.awayTeamId) ?? offenseTeamId;
            await tx.turn.create({
              data: {
                gameId,
                offenseTeamId: redemptionTeamId,
                turnIndex: nextTurnIndex,
                isBonus: false,
                shootersJson: game.lineups
                  .filter((l) => l.teamId === redemptionTeamId)
                  .sort((a, b) => a.orderIndex - b.orderIndex)
                  .map((l) => l.playerId)
              }
            });
            possessionTeamId = redemptionTeamId;
            currentTurnNumber = nextTurnIndex;
            shooterIndex = 0;
            nextPhase = 'REDEMPTION';
            nextLineupLength = defenseLineupLength;
          }
        } else if (makesThisTurn >= 2) {
          const shooters = await tx.shotEvent.findMany({
            where: {
              turnId: ensuredTurn.id,
              resultType: {
                in: [
                  ResultType.TOP_REGULAR,
                  ResultType.TOP_ISO,
                  ResultType.BOTTOM_REGULAR,
                  ResultType.BOTTOM_ISO
                ]
              }
            },
            select: { shooterId: true }
          });
          const shooterIds = Array.from(new Set(shooters.map((s) => s.shooterId).filter(Boolean)));
          await tx.turn.create({
            data: {
              gameId,
              offenseTeamId,
              turnIndex: nextTurnIndex,
              isBonus: true,
              shootersJson: shooterIds
            }
          });
          currentTurnNumber = nextTurnIndex;
          shooterIndex = 0;
          nextLineupLength = Math.max(shooterIds.length || offenseLineup.length || 6, 1);
        } else {
          const nextOffense = defenseTeamId ?? offenseTeamId;
          const nextOffenseLineupLength = Math.max(
            game.lineups.filter((l) => l.teamId === nextOffense && l.isActive).length || 6,
            1
          );
          await tx.turn.create({
            data: {
              gameId,
              offenseTeamId: nextOffense,
              turnIndex: nextTurnIndex,
              isBonus: false,
              shootersJson: game.lineups
                .filter((l) => l.teamId === nextOffense)
                .sort((a, b) => a.orderIndex - b.orderIndex)
                .map((l) => l.playerId)
            }
          });
          possessionTeamId = nextOffense;
          currentTurnNumber = nextTurnIndex;
          shooterIndex = 0;
          nextLineupLength = nextOffenseLineupLength;
        }
      }
    }

    await tx.game.update({
      where: { id: gameId },
      data: {
        status: newStatus,
        endedAt: newStatus === GameStatus.FINAL ? new Date() : undefined
      }
    });

    await tx.gameState.update({
      where: { gameId },
      data: {
        homeCupsRemaining: nextHome,
        awayCupsRemaining: nextAway,
        possessionTeamId,
        currentShooterIndex: shooterIndex % nextLineupLength,
        currentTurnNumber,
        status: newStatus,
        phase: nextPhase
      }
    });

    return createdEvent;
  });

  return NextResponse.json({ eventId: event.id });
}
