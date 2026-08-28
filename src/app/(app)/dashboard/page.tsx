import { getServerAuthSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { PlayerDashboard } from '@/components/player-dashboard';
import { resolveSeasonSelection } from '@/lib/season';
import { GameType } from '@prisma/client';
import { getCurrentPlayerForUserId } from '@/lib/current-player';

export default async function DashboardPage({
  searchParams
}: {
  searchParams?: Promise<{ season?: string; type?: string }>;
}) {
  const query = (await searchParams) ?? {};
  const session = await getServerAuthSession();
  const userId = session?.user?.id;

  if (!userId) {
    return (
      <div className="rounded-2xl border border-garnet-100 bg-white/85 p-4 text-ink shadow sm:p-6">
        <h1 className="text-2xl font-bold text-ink">My dashboard</h1>
        <p className="mt-2 text-ash">Sign in to see your stats and personal history.</p>
      </div>
    );
  }

  const player = await getCurrentPlayerForUserId(userId);

  if (!player) {
    return (
      <div className="rounded-2xl border border-garnet-100 bg-white/85 p-4 text-ink shadow sm:p-6">
        <h1 className="text-2xl font-bold text-ink">My dashboard</h1>
        <p className="mt-2 text-ash">
          We couldn’t match your email to a player record. Ask an admin to add or correct your email.
        </p>
      </div>
    );
  }

  const seasons = await prisma.season.findMany({ orderBy: { year: 'desc' } });
  const { season, value: seasonValue, seasons: orderedSeasons } = resolveSeasonSelection(seasons, query.season);
  const typeValue = query.type ?? 'LEAGUE';
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
