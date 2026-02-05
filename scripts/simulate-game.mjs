import { PrismaClient, GameStatus, GameType, ResultType, GamePhase } from '@prisma/client';

const prisma = new PrismaClient();

const ADMIN_EMAIL = 'somil.vinod@gmail.com';
const SEASON_NAME = 'S2026';
const HOME_TEAM = 'F';
const AWAY_TEAM = 'Gargantuan';

const makeTypes = [
  ResultType.TOP_REGULAR,
  ResultType.TOP_ISO,
  ResultType.BOTTOM_REGULAR,
  ResultType.BOTTOM_ISO
];

const HOME_MAKES = 100;
const AWAY_MAKES = 85;

async function main() {
  const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!admin) throw new Error(`Admin user not found for ${ADMIN_EMAIL}`);

  const season = await prisma.season.findFirst({
    where: { name: SEASON_NAME },
    orderBy: { createdAt: 'desc' }
  });
  if (!season) throw new Error(`Season ${SEASON_NAME} not found`);

  const [homeTeam, awayTeam] = await Promise.all([
    prisma.team.findFirst({ where: { seasonId: season.id, name: HOME_TEAM } }),
    prisma.team.findFirst({ where: { seasonId: season.id, name: AWAY_TEAM } })
  ]);
  if (!homeTeam || !awayTeam) throw new Error('Home or away team not found');

  const scheduleRow = await prisma.schedule.findFirst({
    where: {
      seasonId: season.id,
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id
    }
  });

  const game = await prisma.game.create({
    data: {
      seasonId: season.id,
      type: GameType.LEAGUE,
      status: GameStatus.IN_PROGRESS,
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      startedAt: new Date(),
      createdById: admin.id,
      statTakerId: admin.id,
      state: {
        create: {
          possessionTeamId: homeTeam.id,
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

  if (scheduleRow) {
    await prisma.schedule.update({ where: { id: scheduleRow.id }, data: { gameId: game.id } });
  }

  const [homeRoster, awayRoster] = await Promise.all([
    prisma.teamRoster.findMany({
      where: { seasonId: season.id, teamId: homeTeam.id },
      include: { player: true },
      orderBy: { createdAt: 'asc' }
    }),
    prisma.teamRoster.findMany({
      where: { seasonId: season.id, teamId: awayTeam.id },
      include: { player: true },
      orderBy: { createdAt: 'asc' }
    })
  ]);

  const homeLineup = homeRoster.slice(0, 6);
  const awayLineup = awayRoster.slice(0, 6);
  if (homeLineup.length === 0 || awayLineup.length === 0) {
    throw new Error('Lineups are empty. Make sure rosters were imported.');
  }

  await prisma.gameLineup.createMany({
    data: [
      ...homeLineup.map((row, idx) => ({
        gameId: game.id,
        teamId: homeTeam.id,
        playerId: row.playerId,
        orderIndex: idx
      })),
      ...awayLineup.map((row, idx) => ({
        gameId: game.id,
        teamId: awayTeam.id,
        playerId: row.playerId,
        orderIndex: idx
      }))
    ],
    skipDuplicates: true
  });

  const homeTurn = await prisma.turn.create({
    data: {
      gameId: game.id,
      offenseTeamId: homeTeam.id,
      turnIndex: 1,
      isBonus: false,
      shootersJson: homeLineup.map((row) => row.playerId)
    }
  });

  const awayTurn = await prisma.turn.create({
    data: {
      gameId: game.id,
      offenseTeamId: awayTeam.id,
      turnIndex: 2,
      isBonus: false,
      shootersJson: awayLineup.map((row) => row.playerId)
    }
  });

  let awayRemaining = 100;
  let homeRemaining = 100;

  for (let i = 0; i < HOME_MAKES; i += 1) {
    const shooterId = homeLineup[i % homeLineup.length].playerId;
    const resultType = makeTypes[i % makeTypes.length];
    const before = awayRemaining;
    const after = Math.max(awayRemaining - 1, 0);
    awayRemaining = after;

    await prisma.shotEvent.create({
      data: {
        gameId: game.id,
        turnId: homeTurn.id,
        offenseTeamId: homeTeam.id,
        defenseTeamId: awayTeam.id,
        shooterId,
        resultType,
        cupsDelta: 1,
        remainingCupsBefore: before,
        remainingCupsAfter: after
      }
    });
  }

  for (let i = 0; i < AWAY_MAKES; i += 1) {
    const shooterId = awayLineup[i % awayLineup.length].playerId;
    const resultType = makeTypes[(i + 1) % makeTypes.length];
    const before = homeRemaining;
    const after = Math.max(homeRemaining - 1, 0);
    homeRemaining = after;

    await prisma.shotEvent.create({
      data: {
        gameId: game.id,
        turnId: awayTurn.id,
        offenseTeamId: awayTeam.id,
        defenseTeamId: homeTeam.id,
        shooterId,
        resultType,
        cupsDelta: 1,
        remainingCupsBefore: before,
        remainingCupsAfter: after
      }
    });
  }

  await prisma.game.update({
    where: { id: game.id },
    data: { status: GameStatus.FINAL, endedAt: new Date() }
  });

  await prisma.gameState.update({
    where: { gameId: game.id },
    data: {
      homeCupsRemaining: homeRemaining,
      awayCupsRemaining: awayRemaining,
      currentShooterIndex: 0,
      status: GameStatus.FINAL,
      phase: GamePhase.REGULATION
    }
  });

  console.log(`Created simulated FINAL game ${homeTeam.name} vs ${awayTeam.name}: ${game.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
