import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const season = await prisma.season.findFirst({ where: { name: 'S2026' } });
  if (!season) {
    console.log('No S2026 season found. Nothing to clear.');
    return;
  }

  const games = await prisma.game.findMany({ where: { seasonId: season.id }, select: { id: true } });
  const gameIds = games.map((g) => g.id);

  if (gameIds.length > 0) {
    await prisma.gameState.deleteMany({ where: { gameId: { in: gameIds } } });
    await prisma.shotEvent.deleteMany({ where: { gameId: { in: gameIds } } });
    await prisma.turn.deleteMany({ where: { gameId: { in: gameIds } } });
    await prisma.gameLineup.deleteMany({ where: { gameId: { in: gameIds } } });
    await prisma.legacyPlayerStat.deleteMany({ where: { gameId: { in: gameIds } } });
    await prisma.legacyTeamStat.deleteMany({ where: { gameId: { in: gameIds } } });
  }

  await prisma.game.deleteMany({ where: { seasonId: season.id } });
  await prisma.schedule.deleteMany({ where: { seasonId: season.id } });
  await prisma.teamRoster.deleteMany({ where: { seasonId: season.id } });
  await prisma.team.deleteMany({ where: { seasonId: season.id } });
  await prisma.conference.deleteMany({ where: { seasonId: season.id } });
  await prisma.season.delete({ where: { id: season.id } });

  console.log('Cleared S2026 season data.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
