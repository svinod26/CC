import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { resolveSeasonSelection } from '@/lib/season';
import { SeasonSelect } from '@/components/season-select';
import { GameTypeSelect } from '@/components/game-type-select';
import { GameType } from '@prisma/client';
import { winnerFromRemaining } from '@/lib/stats';

export const metadata = {
  title: 'Games | Century Cup'
};

export default async function GamesPage({
  searchParams
}: {
  searchParams?: { season?: string; type?: string };
}) {
  const seasons = await prisma.season.findMany({ orderBy: { year: 'desc' } });
  const { season, value: seasonValue, seasons: orderedSeasons } = resolveSeasonSelection(seasons, searchParams?.season);
  const typeValue = searchParams?.type ?? 'LEAGUE';
  const typeFilter = typeValue === 'all' ? undefined : (typeValue as GameType);

  const games = await prisma.game.findMany({
    where: {
      ...(season ? { seasonId: season.id } : {}),
      ...(typeFilter ? { type: typeFilter } : {})
    },
    orderBy: [{ scheduleEntry: { week: 'desc' } }, { startedAt: 'desc' }],
    include: { homeTeam: true, awayTeam: true, state: true, scheduleEntry: true, season: true }
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-garnet-600">Games</p>
          <h1 className="text-lg font-bold text-ink sm:text-2xl">Game history</h1>
          <p className="hidden text-[11px] text-ash sm:block sm:text-sm">
            {season ? `Viewing ${season.name}` : 'Viewing all seasons'} · {typeFilter ?? 'All types'}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <SeasonSelect seasons={orderedSeasons} value={seasonValue} showLabel={false} />
          <GameTypeSelect value={typeValue} showLabel={false} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-garnet-100 bg-white/80">
        <table className="w-full min-w-[640px] text-sm text-ink">
          <thead className="bg-gold-50 text-ash">
            <tr>
              <th className="px-3 py-2 text-left whitespace-nowrap">Matchup</th>
              <th className="px-3 py-2 text-left whitespace-nowrap">Week</th>
              <th className="px-3 py-2 text-left whitespace-nowrap">Date</th>
              <th className="px-3 py-2 text-left whitespace-nowrap">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {games.map((game) => {
              const homeRemaining = game.state?.homeCupsRemaining ?? null;
              const awayRemaining = game.state?.awayCupsRemaining ?? null;
              const hasResult = homeRemaining !== null && awayRemaining !== null;
              const winner = winnerFromRemaining(homeRemaining, awayRemaining, game.statsSource);
              const homeWon = winner === 'home';
              const awayWon = winner === 'away';
              const remaining = hasResult ? Math.max(homeRemaining, awayRemaining) : '—';
              const weekLabel = game.scheduleEntry?.week ? `Week ${game.scheduleEntry.week}` : '—';
              const dateLabel = game.startedAt ? game.startedAt.toLocaleDateString() : '—';
              const href = `/games/${game.id}`;

              return (
                <tr key={game.id} className="border-t border-garnet-100 transition hover:bg-gold-50/70">
                  <td className="p-0">
                    <Link href={href} className="block px-4 py-3">
                      {(() => {
                        const pillClass = (won: boolean, lost: boolean) =>
                          won
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : lost
                              ? 'border-rose-200 bg-rose-50 text-rose-600'
                              : 'border-garnet-100 bg-white/70 text-ink';
                        return (
                          <span className="flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-semibold ${pillClass(
                                homeWon,
                                awayWon
                              )}`}
                            >
                              {game.homeTeam?.name ?? 'Home'}
                            </span>
                            <span className="text-ash">vs</span>
                            <span
                              className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-semibold ${pillClass(
                                awayWon,
                                homeWon
                              )}`}
                            >
                              {game.awayTeam?.name ?? 'Away'}
                            </span>
                          </span>
                        );
                      })()}
                    </Link>
                  </td>
                  <td className="p-0 text-ash">
                    <Link href={href} className="block px-4 py-3">
                      {weekLabel}
                    </Link>
                  </td>
                  <td className="p-0 text-ash">
                    <Link href={href} className="block px-4 py-3">
                      {dateLabel}
                    </Link>
                  </td>
                  <td className="p-0 text-ash">
                    <Link href={href} className="block px-4 py-3">
                      {remaining}
                    </Link>
                  </td>
                </tr>
              );
            })}
            {games.length === 0 && (
              <tr>
                <td className="px-3 py-6 text-center text-ash" colSpan={4}>
                  No games yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
