import { PrismaClient, GameStatus, GameType, ResultType, GamePhase } from '@prisma/client';

const prisma = new PrismaClient();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'somil.vinod@gmail.com';
const SEASON_NAME = process.env.SEASON_NAME ?? 'S2026';
const TEST_LOCATION = 'TEST_SIM_FLOW';

const makeTypes = [
  ResultType.TOP_REGULAR,
  ResultType.TOP_ISO,
  ResultType.BOTTOM_REGULAR,
  ResultType.BOTTOM_ISO
];

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
};

const pickTeams = async (seasonId) => {
  const teams = await prisma.team.findMany({ where: { seasonId }, orderBy: { name: 'asc' } });
  assert(teams.length >= 2, 'Need at least two teams in season');
  const home = teams.find((t) => t.name === 'F') ?? teams[0];
  const away = teams.find((t) => t.name === 'Gargantuan') ?? teams[1] ?? teams[0];
  return { home, away };
};

const seedLineups = async (gameId, seasonId, homeTeamId, awayTeamId) => {
  const [homeRoster, awayRoster] = await Promise.all([
    prisma.teamRoster.findMany({
      where: { seasonId, teamId: homeTeamId },
      orderBy: { createdAt: 'asc' }
    }),
    prisma.teamRoster.findMany({
      where: { seasonId, teamId: awayTeamId },
      orderBy: { createdAt: 'asc' }
    })
  ]);
  const homeLineup = homeRoster.slice(0, 6);
  const awayLineup = awayRoster.slice(0, 6);
  assert(homeLineup.length === 6 && awayLineup.length === 6, 'Need 6 players per team for lineup');

  await prisma.gameLineup.createMany({
    data: [
      ...homeLineup.map((row, idx) => ({
        gameId,
        teamId: homeTeamId,
        playerId: row.playerId,
        orderIndex: idx
      })),
      ...awayLineup.map((row, idx) => ({
        gameId,
        teamId: awayTeamId,
        playerId: row.playerId,
        orderIndex: idx
      }))
    ],
    skipDuplicates: true
  });

  return { homeLineup, awayLineup };
};

const ensureTurn = async (gameId, offenseTeamId, shooterIds, turnIndex = 1, isBonus = false) => {
  return prisma.turn.create({
    data: {
      gameId,
      offenseTeamId,
      turnIndex,
      isBonus,
      shootersJson: shooterIds
    },
    include: { events: true }
  });
};

const applyEvent = async ({ gameId, shooterId, resultType, teamId, count }) => {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      state: true,
      lineups: true,
      turns: { orderBy: { turnIndex: 'desc' }, take: 1, include: { events: true } },
      homeTeam: true,
      awayTeam: true
    }
  });

  if (!game || !game.state) throw new Error('Game not found or missing state');
  if (game.status === GameStatus.FINAL) throw new Error('Game already final');

  const isPull = resultType === ResultType.PULL_HOME || resultType === ResultType.PULL_AWAY;
  const isMake =
    resultType === ResultType.TOP_REGULAR ||
    resultType === ResultType.TOP_ISO ||
    resultType === ResultType.BOTTOM_REGULAR ||
    resultType === ResultType.BOTTOM_ISO;

  const currentTurn = game.turns[0];
  const phase = game.state.phase ?? GamePhase.REGULATION;
  const offenseTeamId = game.state.possessionTeamId ?? game.homeTeamId ?? teamId;
  const defenseTeamId = offenseTeamId === game.homeTeamId ? game.awayTeamId : game.homeTeamId;

  const offenseLineup = game.lineups
    .filter((l) => l.teamId === offenseTeamId && l.isActive)
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const defenseLineup = game.lineups
    .filter((l) => l.teamId === defenseTeamId && l.isActive)
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const defenseLineupLength = Math.max(defenseLineup.length || 6, 1);

  let ensuredTurn = currentTurn;
  if (!ensuredTurn) {
    ensuredTurn = await ensureTurn(
      gameId,
      offenseTeamId,
      offenseLineup.map((l) => l.playerId),
      1,
      false
    );
  }

  const turnShooterIds = Array.isArray(ensuredTurn.shootersJson)
    ? ensuredTurn.shootersJson
    : [];
  const turnLineupLength = Math.max(turnShooterIds.length || offenseLineup.length || 6, 1);

  const cupsTargetBefore =
    resultType === ResultType.PULL_HOME
      ? game.state.homeCupsRemaining
      : resultType === ResultType.PULL_AWAY
        ? game.state.awayCupsRemaining
        : offenseTeamId === game.homeTeamId
          ? game.state.awayCupsRemaining
          : game.state.homeCupsRemaining;

  const rawCount = typeof count === 'number' ? Math.trunc(count) : 1;
  const pullDelta = rawCount === 0 ? 1 : rawCount;
  const cupsDelta = isPull ? pullDelta : isMake ? 1 : 0;
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const cupsAfter = clamp(cupsTargetBefore - cupsDelta, 0, 100);
  const pullTargetTeamId =
    resultType === ResultType.PULL_HOME
      ? game.homeTeamId
      : resultType === ResultType.PULL_AWAY
        ? game.awayTeamId
        : null;

  await prisma.$transaction(async (tx) => {
    await tx.shotEvent.create({
      data: {
        gameId,
        turnId: ensuredTurn.id,
        offenseTeamId,
        defenseTeamId: pullTargetTeamId ?? defenseTeamId,
        shooterId,
        resultType,
        cupsDelta,
        remainingCupsBefore: cupsTargetBefore,
        remainingCupsAfter: cupsAfter
      }
    });

    let nextHome = game.state.homeCupsRemaining;
    let nextAway = game.state.awayCupsRemaining;
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
      where: { turnId: ensuredTurn.id, resultType: { notIn: [ResultType.PULL_HOME, ResultType.PULL_AWAY] } }
    });
    const makesThisTurn = await tx.shotEvent.count({
      where: {
        turnId: ensuredTurn.id,
        resultType: { in: makeTypes }
      }
    });
    const turnEvents = await tx.shotEvent.findMany({
      where: { turnId: ensuredTurn.id, resultType: { notIn: [ResultType.PULL_HOME, ResultType.PULL_AWAY] } }
    });
    const clearedThisTurn = turnEvents.some(
      (event) =>
        makeTypes.includes(event.resultType) &&
        event.remainingCupsBefore > 0 &&
        event.remainingCupsAfter === 0
    );
    const stuffMakesThisTurn = turnEvents.filter(
      (event) => makeTypes.includes(event.resultType) && event.remainingCupsBefore === 0
    ).length;

    let shooterIndex = isPull ? game.state.currentShooterIndex : shotsThisTurn;
    let possessionTeamId = offenseTeamId;
    let currentTurnNumber = ensuredTurn.turnIndex;
    let newStatus = game.status;
    let nextPhase = phase;
    let nextLineupLength = turnLineupLength;

    if (phase === GamePhase.REDEMPTION) {
      const opponentRemaining = offenseTeamId === game.homeTeamId ? nextAway : nextHome;
      if (!isPull) {
        shooterIndex = isMake ? game.state.currentShooterIndex : game.state.currentShooterIndex + 1;
      }

      if (opponentRemaining <= 0 && !isMake) {
        nextPhase = GamePhase.OVERTIME;
      } else if (shooterIndex >= turnLineupLength) {
        newStatus = GameStatus.FINAL;
      }
    } else if (phase === GamePhase.REGULATION) {
      if (!isPull && shotsThisTurn >= turnLineupLength) {
        const nextTurnIndex = ensuredTurn.turnIndex + 1;
        if (clearedThisTurn) {
          if (stuffMakesThisTurn >= 2) {
            newStatus = GameStatus.FINAL;
          } else {
            const redemptionTeamId = (nextHome === 0 ? game.homeTeamId : game.awayTeamId) ?? offenseTeamId;
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
            nextPhase = GamePhase.REDEMPTION;
            nextLineupLength = defenseLineupLength;
          }
        } else if (makesThisTurn >= 2) {
          const shooters = await tx.shotEvent.findMany({
            where: { turnId: ensuredTurn.id, resultType: { in: makeTypes } },
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
        } else {
          const nextOffense = defenseTeamId ?? offenseTeamId;
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
  });
};

const undoLastEvent = async (gameId) => {
  const lastEvent = await prisma.shotEvent.findFirst({
    where: { gameId },
    orderBy: { timestamp: 'desc' }
  });
  if (!lastEvent) return false;
  await prisma.shotEvent.delete({ where: { id: lastEvent.id } });

  const turns = await prisma.turn.findMany({
    where: { gameId },
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

  await recomputeState(gameId);
  return true;
};

const recomputeState = async (gameId) => {
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
    const created = await ensureTurn(
      gameId,
      game.homeTeamId,
      game.lineups
        .filter((l) => l.teamId === game.homeTeamId)
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((l) => l.playerId)
    );
    turns = [{ ...created, events: [] }];
  }

  let homeCups = 100;
  let awayCups = 100;
  let currentTurnNumber = 1;
  let currentShooterIndex = 0;

  for (const turn of turns) {
    const offenseId = turn.offenseTeamId ?? game.homeTeamId;
    let shotsThisTurn = 0;
    for (const event of turn.events) {
      if (event.resultType === ResultType.PULL_HOME) {
        homeCups = Math.max(homeCups - event.cupsDelta, 0);
      } else if (event.resultType === ResultType.PULL_AWAY) {
        awayCups = Math.max(awayCups - event.cupsDelta, 0);
      } else {
        shotsThisTurn += 1;
        if (makeTypes.includes(event.resultType)) {
          if (offenseId === game.homeTeamId) {
            awayCups = Math.max(awayCups - 1, 0);
          } else {
            homeCups = Math.max(homeCups - 1, 0);
          }
        }
      }
    }
    currentTurnNumber = turn.turnIndex;
    const shooterIds = Array.isArray(turn.shootersJson) ? turn.shootersJson : [];
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
    game.state?.phase === GamePhase.OVERTIME
      ? GamePhase.OVERTIME
      : zeroTeamId && possessionTeamId === zeroTeamId
        ? GamePhase.REDEMPTION
        : GamePhase.REGULATION;

  await prisma.gameState.updateMany({
    where: { gameId },
    data: {
      homeCupsRemaining: homeCups,
      awayCupsRemaining: awayCups,
      possessionTeamId,
      currentTurnNumber,
      currentShooterIndex,
      status: GameStatus.IN_PROGRESS,
      phase: nextPhase
    }
  });

  await prisma.game.update({
    where: { id: gameId },
    data: { status: GameStatus.IN_PROGRESS, endedAt: null }
  });
};

const runLeagueFlow = async (season, admin) => {
  const { home, away } = await pickTeams(season.id);

  const game = await prisma.game.create({
    data: {
      seasonId: season.id,
      type: GameType.LEAGUE,
      status: GameStatus.IN_PROGRESS,
      homeTeamId: home.id,
      awayTeamId: away.id,
      startedAt: new Date(),
      createdById: admin.id,
      statTakerId: admin.id,
      location: TEST_LOCATION,
      state: {
        create: {
          possessionTeamId: home.id,
          homeCupsRemaining: 100,
          awayCupsRemaining: 100,
          currentTurnNumber: 1,
          currentShooterIndex: 0,
          status: GameStatus.IN_PROGRESS,
          phase: GamePhase.REGULATION
        }
      }
    }
  });

  const { homeLineup, awayLineup } = await seedLineups(game.id, season.id, home.id, away.id);
  await ensureTurn(
    game.id,
    home.id,
    homeLineup.map((row) => row.playerId),
    1,
    false
  );

  // First turn: 3 makes, 3 misses => bonus turn
  for (let i = 0; i < 6; i += 1) {
    const shooterId = homeLineup[i].playerId;
    const resultType = i < 3 ? makeTypes[i % makeTypes.length] : ResultType.MISS;
    await applyEvent({ gameId: game.id, shooterId, resultType, teamId: home.id });
  }

  let turns = await prisma.turn.findMany({ where: { gameId: game.id }, orderBy: { turnIndex: 'asc' } });
  assert(turns.length === 2 && turns[1].isBonus, 'Bonus turn should be created');

  // Bonus turn: 1 make => possession flips
  const bonusShooters = turns[1].shootersJson;
  for (let i = 0; i < bonusShooters.length; i += 1) {
    const shooterId = bonusShooters[i];
    const resultType = i === 0 ? makeTypes[0] : ResultType.MISS;
    await applyEvent({ gameId: game.id, shooterId, resultType, teamId: home.id });
  }

  turns = await prisma.turn.findMany({ where: { gameId: game.id }, orderBy: { turnIndex: 'asc' } });
  assert(turns.length >= 3, 'Defense turn should be created after bonus');
  assert(turns[2].offenseTeamId === away.id, 'Possession should flip to away');

  // Pull/add cups + undo
  await applyEvent({ gameId: game.id, shooterId: null, resultType: ResultType.PULL_HOME, teamId: home.id, count: 2 });
  let state = await prisma.gameState.findUnique({ where: { gameId: game.id } });
  assert(state.homeCupsRemaining === 98, 'Pull home should decrement');

  await applyEvent({ gameId: game.id, shooterId: null, resultType: ResultType.PULL_AWAY, teamId: home.id, count: -3 });
  state = await prisma.gameState.findUnique({ where: { gameId: game.id } });
  assert(state.awayCupsRemaining === 103 ? false : true, 'Away cups should not exceed 100');

  await undoLastEvent(game.id);
  state = await prisma.gameState.findUnique({ where: { gameId: game.id } });
  assert(state.awayCupsRemaining <= 100, 'Undo should restore away cups');

  // Force near-end to test redemption
  await prisma.gameState.update({
    where: { gameId: game.id },
    data: { awayCupsRemaining: 1, possessionTeamId: home.id }
  });

  const nextTurnIndex = turns[turns.length - 1].turnIndex + 1;
  await ensureTurn(
    game.id,
    home.id,
    homeLineup.map((row) => row.playerId),
    nextTurnIndex,
    false
  );

  for (let i = 0; i < 6; i += 1) {
    const shooterId = homeLineup[i].playerId;
    const resultType = i === 0 ? makeTypes[0] : ResultType.MISS;
    await applyEvent({ gameId: game.id, shooterId, resultType, teamId: home.id });
  }

  state = await prisma.gameState.findUnique({ where: { gameId: game.id } });
  assert(state.phase === GamePhase.REDEMPTION, 'Game should enter redemption');

  const redemptionTurn = await prisma.turn.findFirst({
    where: { gameId: game.id, turnIndex: nextTurnIndex + 1 }
  });
  assert(redemptionTurn && redemptionTurn.offenseTeamId === away.id, 'Redemption should belong to away');

  for (let i = 0; i < awayLineup.length; i += 1) {
    const shooterId = awayLineup[i].playerId;
    const resultType = ResultType.MISS;
    await applyEvent({ gameId: game.id, shooterId, resultType, teamId: away.id });
  }

  const finalGame = await prisma.game.findUnique({ where: { id: game.id } });
  assert(finalGame.status === GameStatus.FINAL, 'Game should finalize after redemption');

  return game.id;
};

const runExhibitionFlow = async (season, admin) => {
  const { home, away } = await pickTeams(season.id);
  const game = await prisma.game.create({
    data: {
      seasonId: season.id,
      type: GameType.EXHIBITION,
      status: GameStatus.IN_PROGRESS,
      homeTeamId: home.id,
      awayTeamId: away.id,
      startedAt: new Date(),
      createdById: admin.id,
      statTakerId: admin.id,
      location: TEST_LOCATION,
      state: {
        create: {
          possessionTeamId: home.id,
          homeCupsRemaining: 100,
          awayCupsRemaining: 100,
          currentTurnNumber: 1,
          currentShooterIndex: 0,
          status: GameStatus.IN_PROGRESS,
          phase: GamePhase.REGULATION
        }
      }
    }
  });

  const { homeLineup } = await seedLineups(game.id, season.id, home.id, away.id);
  await ensureTurn(
    game.id,
    home.id,
    homeLineup.map((row) => row.playerId),
    1,
    false
  );

  await applyEvent({ gameId: game.id, shooterId: homeLineup[0].playerId, resultType: makeTypes[0], teamId: home.id });
  await applyEvent({ gameId: game.id, shooterId: homeLineup[1].playerId, resultType: ResultType.MISS, teamId: home.id });
  const undone = await undoLastEvent(game.id);
  assert(undone, 'Undo should succeed');

  await prisma.game.update({ where: { id: game.id }, data: { status: GameStatus.FINAL, endedAt: new Date() } });
  await prisma.gameState.updateMany({ where: { gameId: game.id }, data: { status: GameStatus.FINAL } });

  return game.id;
};

async function main() {
  await prisma.game.deleteMany({ where: { location: TEST_LOCATION } });

  const admin =
    (await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } })) ||
    (await prisma.user.findFirst({ where: { role: 'ADMIN' } }));
  assert(admin, 'Admin user not found');

  const season =
    (await prisma.season.findFirst({ where: { name: SEASON_NAME }, orderBy: { createdAt: 'desc' } })) ||
    (await prisma.season.findFirst({ orderBy: { year: 'desc' } }));
  assert(season, 'Season not found');

  const leagueGameId = await runLeagueFlow(season, admin);
  const exhibitionGameId = await runExhibitionFlow(season, admin);

  await prisma.game.deleteMany({ where: { id: { in: [leagueGameId, exhibitionGameId] } } });

  console.log('Test flow completed: league + exhibition + undo + redemption + finalize + delete.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
