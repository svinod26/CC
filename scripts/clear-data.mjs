import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.gameState.deleteMany();
  await prisma.shotEvent.deleteMany();
  await prisma.turn.deleteMany();
  await prisma.gameLineup.deleteMany();
  await prisma.legacyPlayerStat.deleteMany();
  await prisma.legacyTeamStat.deleteMany();
  await prisma.schedule.deleteMany();
  await prisma.game.deleteMany();
  await prisma.teamRoster.deleteMany();
  await prisma.team.deleteMany();
  await prisma.conference.deleteMany();
  await prisma.season.deleteMany();
  await prisma.playerAlias.deleteMany();
  await prisma.player.deleteMany();
  console.log('Cleared all league data (users preserved).');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
