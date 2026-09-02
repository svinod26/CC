import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { PlayerLink } from '@/components/player-link';
import { sortSeasons } from '@/lib/season';

export const metadata = {
  title: 'Players | Century Cup'
};

export default async function PlayersPage() {
  const [players, seasons] = await Promise.all([
    prisma.player.findMany({
      orderBy: { name: 'asc' },
      include: {
        rosters: {
          include: { team: true, season: true }
        }
      }
    }),
    prisma.season.findMany({ select: { id: true, name: true, year: true } })
  ]);
  const latestSeason = sortSeasons(seasons)[0] ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-garnet-600">Roster</p>
          <h1 className="text-xl font-bold text-ink sm:text-2xl">Players</h1>
        </div>
        <Link
          href="/players/hub"
          className="rounded-full border border-garnet-200 px-4 py-2 text-sm font-semibold text-garnet-600 hover:bg-gold-100"
        >
          Player hub
        </Link>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {players.map((player) => {
          const activeRosters = latestSeason
            ? player.rosters.filter(
                (roster) => roster.seasonId === latestSeason.id && roster.isActive
              )
            : [];
          return (
          <div key={player.id} className="rounded-xl border border-garnet-100 bg-white/80 p-3 shadow sm:p-4">
            <p className="text-base font-semibold text-ink sm:text-lg">
              <PlayerLink id={player.id} name={player.name} className="text-ink hover:text-garnet-600" />
            </p>
            <p className="text-xs text-ash">{player.email ?? 'no email'}</p>
            <div className="mt-2 text-sm text-ink">
              {activeRosters.length === 0 && (
                <span>Unassigned{latestSeason ? ` · ${latestSeason.name}` : ''}</span>
              )}
              {activeRosters.map((r) => (
                <span key={r.id} className="mr-2 inline-flex items-center rounded-full bg-gold-50 px-2 py-0.5 text-xs text-ink">
                  {r.team?.name ?? '—'} · {r.season?.name ?? latestSeason?.name ?? ''}
                </span>
              ))}
            </div>
          </div>
          );
        })}
        {players.length === 0 && <p className="text-sm text-ash">No players yet. Import from Excel.</p>}
      </div>
    </div>
  );
}
