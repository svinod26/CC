import { ResultType } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export type AdminGameSnapshot = {
  game: {
    id: string;
    status: string;
    type: string;
    statsSource: string;
    week: number | null;
    startedAt: string;
    homeTeamName: string;
    awayTeamName: string;
    homeCupsRemaining: number;
    awayCupsRemaining: number;
  };
  players: Array<{
    id: string;
    name: string;
    teamName: string;
    orderIndex: number;
    topRegular: number;
    topIso: number;
    bottomRegular: number;
    bottomIso: number;
    misses: number;
    totalMakes: number;
    attempts: number;
  }>;
};

export async function getAdminGameSnapshot(gameId: string): Promise<AdminGameSnapshot | null> {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      homeTeam: true,
      awayTeam: true,
      state: true,
      scheduleEntry: true,
      lineups: { include: { player: true } },
      events: { orderBy: [{ timestamp: 'asc' }, { id: 'asc' }] }
    }
  });

  if (!game || !game.state) return null;

  const sortedLineups = game.lineups.slice().sort((a, b) => {
    if (a.teamId === game.homeTeamId && b.teamId !== game.homeTeamId) return -1;
    if (a.teamId !== game.homeTeamId && b.teamId === game.homeTeamId) return 1;
    if (a.teamId === game.awayTeamId && b.teamId !== game.awayTeamId) return 1;
    if (a.teamId !== game.awayTeamId && b.teamId === game.awayTeamId) return -1;
    return a.orderIndex - b.orderIndex;
  });

  const playerRows = new Map<
    string,
    {
      id: string;
      name: string;
      teamName: string;
      orderIndex: number;
      topRegular: number;
      topIso: number;
      bottomRegular: number;
      bottomIso: number;
      misses: number;
    }
  >();

  for (const slot of sortedLineups) {
    const teamName =
      slot.teamId === game.homeTeamId
        ? game.homeTeam?.name ?? 'Home'
        : slot.teamId === game.awayTeamId
          ? game.awayTeam?.name ?? 'Away'
          : 'Team';
    playerRows.set(slot.playerId, {
      id: slot.playerId,
      name: slot.player.name ?? 'Unknown',
      teamName,
      orderIndex: slot.orderIndex,
      topRegular: 0,
      topIso: 0,
      bottomRegular: 0,
      bottomIso: 0,
      misses: 0
    });
  }

  for (const event of game.events) {
    if (!event.shooterId) continue;
    const row = playerRows.get(event.shooterId);
    if (!row) continue;
    if (event.resultType === ResultType.TOP_REGULAR) row.topRegular += 1;
    else if (event.resultType === ResultType.TOP_ISO) row.topIso += 1;
    else if (event.resultType === ResultType.BOTTOM_REGULAR) row.bottomRegular += 1;
    else if (event.resultType === ResultType.BOTTOM_ISO) row.bottomIso += 1;
    else if (event.resultType === ResultType.MISS) row.misses += 1;
  }

  const players = Array.from(playerRows.values()).map((row) => {
    const totalMakes = row.topRegular + row.topIso + row.bottomRegular + row.bottomIso;
    return {
      ...row,
      totalMakes,
      attempts: totalMakes + row.misses
    };
  });

  return {
    game: {
      id: game.id,
      status: game.status,
      type: game.type,
      statsSource: game.statsSource,
      week: game.scheduleEntry?.week ?? null,
      startedAt: game.startedAt.toISOString(),
      homeTeamName: game.homeTeam?.name ?? 'Home',
      awayTeamName: game.awayTeam?.name ?? 'Away',
      homeCupsRemaining: game.state.homeCupsRemaining,
      awayCupsRemaining: game.state.awayCupsRemaining
    },
    players
  };
}
