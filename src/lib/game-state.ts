import { GamePhase, GameStatus, ResultType } from '@prisma/client';
import { prisma } from '@/lib/prisma';

const isPullResult = (resultType: ResultType) =>
  resultType === ResultType.PULL_HOME || resultType === ResultType.PULL_AWAY;

type RecomputeOptions = {
  preserveFinalStatus?: boolean;
};

const clampCups = (value: number) => Math.min(Math.max(value, 0), 100);

export async function recomputeGameState(gameId: string, options: RecomputeOptions = {}) {
  await prisma.$transaction(async (tx) => {
    const game = await tx.game.findUnique({
      where: { id: gameId },
      include: {
        state: true,
        lineups: true,
        turns: {
          orderBy: { turnIndex: 'asc' },
          include: { events: { orderBy: { timestamp: 'asc' } } }
        }
      }
    });

    if (!game || !game.homeTeamId || !game.awayTeamId || !game.state) return;

    let turns = game.turns.slice();

    while (turns.length > 1 && turns[turns.length - 1].events.length === 0) {
      const prevTurn = turns[turns.length - 2];
      const prevOffenseId = prevTurn.offenseTeamId ?? game.homeTeamId;
      const prevShooterIds = Array.isArray(prevTurn.shootersJson)
        ? (prevTurn.shootersJson as string[])
        : [];
      const prevLineupLength =
        prevShooterIds.length ||
        game.lineups
          .filter((lineup) => lineup.teamId === prevOffenseId)
          .sort((a, b) => a.orderIndex - b.orderIndex).length ||
        6;
      const prevShots = prevTurn.events.filter((event) => !isPullResult(event.resultType)).length;
      const trailingTurnIsStillValid = prevShots >= Math.max(prevLineupLength, 1);

      if (trailingTurnIsStillValid) break;

      const trailingTurn = turns[turns.length - 1];
      await tx.turn.delete({ where: { id: trailingTurn.id } });
      turns.pop();
    }

    if (turns.length === 0) {
      const offenseTeamId = game.homeTeamId;
      const created = await tx.turn.create({
        data: {
          gameId,
          offenseTeamId,
          turnIndex: 1,
          isBonus: false,
          shootersJson: game.lineups
            .filter((lineup) => lineup.teamId === offenseTeamId)
            .sort((a, b) => a.orderIndex - b.orderIndex)
            .map((lineup) => lineup.playerId)
        },
        include: { events: true }
      });
      turns = [created];
    }

    const allEvents = await tx.shotEvent.findMany({
      where: { gameId },
      orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
      include: {
        turn: {
          select: { offenseTeamId: true }
        }
      }
    });

    let homeCups = 100;
    let awayCups = 100;

    for (const event of allEvents) {
      const offenseTeamId = event.offenseTeamId ?? event.turn?.offenseTeamId ?? game.homeTeamId;
      const target =
        event.resultType === ResultType.PULL_HOME
          ? 'home'
          : event.resultType === ResultType.PULL_AWAY
            ? 'away'
            : offenseTeamId === game.homeTeamId
              ? 'away'
              : 'home';
      const before = target === 'home' ? homeCups : awayCups;
      const after = clampCups(before - event.cupsDelta);

      if (target === 'home') {
        homeCups = after;
      } else {
        awayCups = after;
      }

      if (event.remainingCupsBefore !== before || event.remainingCupsAfter !== after) {
        await tx.shotEvent.update({
          where: { id: event.id },
          data: {
            remainingCupsBefore: before,
            remainingCupsAfter: after
          }
        });
      }
    }

    let currentTurnNumber = 1;
    let currentShooterIndex = 0;

    for (const turn of turns) {
      const offenseId = turn.offenseTeamId ?? game.homeTeamId;
      const shotsThisTurn = turn.events.filter((event) => !isPullResult(event.resultType)).length;

      currentTurnNumber = turn.turnIndex;
      const shooterIds = Array.isArray(turn.shootersJson) ? (turn.shootersJson as string[]) : [];
      const lineupLength =
        shooterIds.length ||
        game.lineups
          .filter((lineup) => lineup.teamId === offenseId)
          .sort((a, b) => a.orderIndex - b.orderIndex).length ||
        6;
      currentShooterIndex = shotsThisTurn % Math.max(lineupLength, 1);
    }

    const lastTurn = turns[turns.length - 1];
    const possessionTeamId = lastTurn?.offenseTeamId ?? game.homeTeamId;
    const zeroTeamId = homeCups <= 0 ? game.homeTeamId : awayCups <= 0 ? game.awayTeamId : null;
    const nextPhase =
      game.state.phase === GamePhase.OVERTIME
        ? GamePhase.OVERTIME
        : zeroTeamId && possessionTeamId === zeroTeamId
          ? GamePhase.REDEMPTION
          : GamePhase.REGULATION;
    const preserveFinal = Boolean(options.preserveFinalStatus && game.status === GameStatus.FINAL);
    const nextStatus = preserveFinal ? GameStatus.FINAL : GameStatus.IN_PROGRESS;

    await tx.gameState.updateMany({
      where: { gameId },
      data: {
        homeCupsRemaining: homeCups,
        awayCupsRemaining: awayCups,
        possessionTeamId,
        currentTurnNumber,
        currentShooterIndex,
        status: nextStatus,
        phase: nextPhase
      }
    });

    await tx.game.update({
      where: { id: gameId },
      data: {
        status: nextStatus,
        endedAt: nextStatus === GameStatus.FINAL ? game.endedAt ?? new Date() : null
      }
    });
  });
}
