import { getServerAuthSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { PlayerDashboard } from '@/components/player-dashboard';
import { resolveSeasonSelection } from '@/lib/season';
import { SeasonSelect } from '@/components/season-select';
import { GameTypeSelect } from '@/components/game-type-select';
import { GameType } from '@prisma/client';

export default async function DashboardPage({
  searchParams
}: {
  searchParams?: { season?: string; type?: string };
}) {
  const session = await getServerAuthSession();
  const email = session?.user?.email;

  if (!email) {
    return (
      <div className="rounded-2xl border border-garnet-100 bg-white/85 p-4 text-ink shadow sm:p-6">
        <h1 className="text-2xl font-bold text-ink">My dashboard</h1>
        <p className="mt-2 text-ash">Sign in to see your stats and personal history.</p>
      </div>
    );
  }

  const player = await prisma.player.findFirst({ where: { email } });

  if (!player) {
    return (
      <div className="rounded-2xl border border-garnet-100 bg-white/85 p-4 text-ink shadow sm:p-6">
        <h1 className="text-2xl font-bold text-ink">My dashboard</h1>
        <p className="mt-2 text-ash">
          We couldn’t match your email to a player record. Ask an admin to link your email in the roster import.
        </p>
      </div>
    );
  }

  const seasons = await prisma.season.findMany({ orderBy: { year: 'desc' } });
  const { season, value: seasonValue, seasons: orderedSeasons } = resolveSeasonSelection(seasons, searchParams?.season);
  const typeValue = searchParams?.type ?? 'LEAGUE';
  const typeFilter = typeValue === 'all' ? null : (typeValue as GameType);

  return (
    <PlayerDashboard
      playerId={player.id}
      seasonId={season?.id ?? null}
      gameType={typeFilter}
      seasonOptions={orderedSeasons}
      seasonValue={seasonValue}
      typeValue={typeValue}
    />
  );
}
