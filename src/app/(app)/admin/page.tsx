import Link from 'next/link';
import { getServerAuthSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { AdminGameAdjustments } from '@/components/admin-game-adjustments';
import { AdminGamePicker } from '@/components/admin-game-picker';
import { AdminUsersTable } from '@/components/admin-users-table';

export const metadata = {
  title: 'Admin | Century Cup'
};

export default async function AdminPage({
  searchParams
}: {
  searchParams?: { game?: string };
}) {
  const session = await getServerAuthSession();
  const isAdmin = session?.user?.role === 'ADMIN';

  if (!isAdmin) {
    return (
      <div className="rounded-2xl border border-garnet-100 bg-white/85 p-6 text-ink shadow">
        <h1 className="text-3xl font-bold text-ink">Admin panel</h1>
        <p className="mt-2 text-sm text-ash">You need admin role to access this page.</p>
      </div>
    );
  }

  const [gamesRaw, users] = await Promise.all([
    prisma.game.findMany({
      where: { statsSource: 'TRACKED', status: 'FINAL' },
      include: {
        homeTeam: true,
        awayTeam: true,
        scheduleEntry: true,
        lineups: { include: { player: true } }
      },
      orderBy: { startedAt: 'desc' },
      take: 120
    }),
    prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
      take: 500
    })
  ]);

  const games = gamesRaw.sort((a, b) => {
    const weekA = a.scheduleEntry?.week ?? -1;
    const weekB = b.scheduleEntry?.week ?? -1;
    if (weekA !== weekB) return weekB - weekA;
    return b.startedAt.getTime() - a.startedAt.getTime();
  });

  const selectedGameId = searchParams?.game && games.some((game) => game.id === searchParams.game)
    ? searchParams.game
    : games[0]?.id ?? null;
  const selectedGame = selectedGameId ? games.find((game) => game.id === selectedGameId) ?? null : null;

  const gameOptions = games.map((game) => {
    const week = game.scheduleEntry?.week ? `Week ${game.scheduleEntry.week}` : game.type;
    const matchup = `${game.homeTeam?.name ?? 'Home'} vs ${game.awayTeam?.name ?? 'Away'}`;
    return {
      id: game.id,
      label: matchup,
      sublabel: `${week} · ${new Date(game.startedAt).toLocaleDateString()}`
    };
  });

  const selectedPlayers = selectedGame
    ? Array.from(
        new Map(
          selectedGame.lineups
            .sort((a, b) => {
              if (a.teamId === selectedGame.homeTeamId && b.teamId !== selectedGame.homeTeamId) return -1;
              if (a.teamId !== selectedGame.homeTeamId && b.teamId === selectedGame.homeTeamId) return 1;
              if (a.teamId === selectedGame.awayTeamId && b.teamId !== selectedGame.awayTeamId) return 1;
              if (a.teamId !== selectedGame.awayTeamId && b.teamId === selectedGame.awayTeamId) return -1;
              return a.orderIndex - b.orderIndex;
            })
            .map((slot) => [
              slot.playerId,
              {
                id: slot.playerId,
                name: slot.player.name ?? 'Unknown',
                teamName:
                  slot.teamId === selectedGame.homeTeamId
                    ? selectedGame.homeTeam?.name ?? 'Home'
                    : slot.teamId === selectedGame.awayTeamId
                      ? selectedGame.awayTeam?.name ?? 'Away'
                      : 'Team'
              }
            ])
        ).values()
      )
    : [];

  return (
    <div className="space-y-5 sm:space-y-6">
      <section className="rounded-3xl border border-garnet-100 bg-white/85 p-4 shadow sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-garnet-600">Admin</p>
            <h1 className="mt-1 text-2xl font-bold text-ink sm:text-3xl">Commissioner panel</h1>
            <p className="mt-1 text-sm text-ash">
              Correct game scoring, review registered users, and manage league operations.
            </p>
          </div>
          <Link
            href="/admin/import"
            className="rounded-full border border-garnet-200 px-4 py-2 text-sm font-semibold text-garnet-600 hover:bg-gold-100"
          >
            Import tools
          </Link>
        </div>
      </section>

      <section className="grid items-start gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-3 rounded-2xl border border-garnet-100 bg-white/85 p-4 shadow sm:p-5">
          <div>
            <p className="text-xs uppercase tracking-wide text-garnet-600">Corrections</p>
            <h2 className="text-lg font-semibold text-ink">Game score editor</h2>
            <p className="text-xs text-ash">
              Choose a finalized tracked game, then add/remove player shots or pull/add cups on either side.
            </p>
          </div>

          <AdminGamePicker games={gameOptions} selectedGameId={selectedGameId} />

          {selectedGame ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-garnet-100 bg-parchment/70 p-3">
                <p className="text-sm font-semibold text-ink">
                  {selectedGame.homeTeam?.name ?? 'Home'} vs {selectedGame.awayTeam?.name ?? 'Away'}
                </p>
                <p className="text-xs text-ash">
                  {selectedGame.scheduleEntry?.week ? `Week ${selectedGame.scheduleEntry.week}` : selectedGame.type} ·{' '}
                  {new Date(selectedGame.startedAt).toLocaleDateString()}
                </p>
                <Link
                  href={`/games/${selectedGame.id}`}
                  className="mt-2 inline-flex text-xs font-semibold text-garnet-600 hover:text-garnet-500"
                >
                  Open game page
                </Link>
              </div>
              <AdminGameAdjustments
                gameId={selectedGame.id}
                players={selectedPlayers}
                homeTeamName={selectedGame.homeTeam?.name ?? 'Home'}
                awayTeamName={selectedGame.awayTeam?.name ?? 'Away'}
              />
            </div>
          ) : (
            <p className="rounded-xl border border-garnet-100 bg-parchment/70 p-3 text-sm text-ash">
              No finalized tracked games available.
            </p>
          )}
        </div>

        <AdminUsersTable
          users={users.map((user) => ({
            ...user,
            createdAt: user.createdAt.toISOString()
          }))}
        />
      </section>
    </div>
  );
}
