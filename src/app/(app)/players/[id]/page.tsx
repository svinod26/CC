import { PlayerDashboard } from '@/components/player-dashboard';
import { prisma } from '@/lib/prisma';
import { resolveSeasonSelection } from '@/lib/season';
import { SeasonSelect } from '@/components/season-select';
import { GameTypeSelect } from '@/components/game-type-select';
import { GameType } from '@prisma/client';

export default async function PlayerProfilePage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams?: { season?: string; type?: string };
}) {
  const seasons = await prisma.season.findMany({ orderBy: { year: 'desc' } });
  const { season, value: seasonValue, seasons: orderedSeasons } = resolveSeasonSelection(seasons, searchParams?.season);
  const typeValue = searchParams?.type ?? 'LEAGUE';
  const typeFilter = typeValue === 'all' ? null : (typeValue as GameType);

  return (
    <PlayerDashboard
      playerId={params.id}
      seasonId={season?.id ?? null}
      gameType={typeFilter}
      seasonOptions={orderedSeasons}
      seasonValue={seasonValue}
      typeValue={typeValue}
    />
  );
}
