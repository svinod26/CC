import { getServerAuthSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { AdminAuditLog } from '@/components/admin-audit-log';
import { AdminGameWorkbench } from '@/components/admin-game-workbench';
import { AdminUsersTable } from '@/components/admin-users-table';
import Link from 'next/link';

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

  const selectedGameId =
    searchParams?.game && games.some((game) => game.id === searchParams.game)
      ? searchParams.game
      : games[0]?.id ?? null;

  const gameOptions = games.map((game) => {
    const week = game.scheduleEntry?.week ? `Week ${game.scheduleEntry.week}` : game.type;
    const matchup = `${game.homeTeam?.name ?? 'Home'} vs ${game.awayTeam?.name ?? 'Away'}`;
    return {
      id: game.id,
      label: matchup,
      sublabel: `${week} · ${new Date(game.startedAt).toLocaleDateString()}`
    };
  });

  return (
    <div className="w-full min-w-0 space-y-5 overflow-x-hidden sm:space-y-6">
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

      <section className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <AdminGameWorkbench games={gameOptions} initialGameId={selectedGameId} />
        <AdminUsersTable
          users={users.map((user) => ({
            ...user,
            createdAt: user.createdAt.toISOString()
          }))}
        />
      </section>

      <AdminAuditLog />
    </div>
  );
}
