import { getServerAuthSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { formatGameType } from '@/lib/format';
import { AdminAuditLog } from '@/components/admin-audit-log';
import { AdminEmailManager, type AdminEmailIdentityRow } from '@/components/admin-email-manager';
import { AdminGameWorkbench } from '@/components/admin-game-workbench';
import { AdminRosterManager } from '@/components/admin-roster-manager';
import { AdminUsersTable } from '@/components/admin-users-table';
import { canonicalizeEmail } from '@/lib/email';
import { sortSeasons } from '@/lib/season';
import Link from 'next/link';

export const metadata = {
  title: 'Admin | Century Cup'
};

export default async function AdminPage({
  searchParams
}: {
  searchParams?: Promise<{ game?: string }>;
}) {
  const query = (await searchParams) ?? {};
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

  const seasons = await prisma.season.findMany({
    select: {
      id: true,
      name: true,
      year: true,
      teams: {
        select: { id: true, name: true },
        orderBy: { name: 'asc' }
      }
    }
  });
  const latestSeason = sortSeasons(seasons)[0] ?? null;

  const [gamesRaw, users, players] = await Promise.all([
    latestSeason
      ? prisma.game.findMany({
          where: {
            statsSource: 'TRACKED',
            status: 'FINAL',
            type: 'LEAGUE',
            seasonId: latestSeason.id
          },
          include: {
            homeTeam: true,
            awayTeam: true,
            scheduleEntry: true,
            lineups: { include: { player: true } }
          },
          orderBy: [{ startedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
        })
      : Promise.resolve([]),
    prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, email: true, role: true, createdAt: true }
    }),
    prisma.player.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        rosters: {
          select: {
            createdAt: true,
            team: { select: { name: true } },
            season: { select: { name: true, year: true } }
          }
        }
      }
    })
  ]);

  const usersByCanonicalEmail = new Map<string, typeof users>();
  for (const user of users) {
    const key = canonicalizeEmail(user.email);
    usersByCanonicalEmail.set(key, [...(usersByCanonicalEmail.get(key) ?? []), user]);
  }
  const linkedUserIds = new Set<string>();
  const emailIdentities: AdminEmailIdentityRow[] = players.map((player) => {
    const matchingUsers = player.email
      ? usersByCanonicalEmail.get(canonicalizeEmail(player.email)) ?? []
      : [];
    const linkedUser = matchingUsers.length === 1 ? matchingUsers[0] : null;
    if (linkedUser) linkedUserIds.add(linkedUser.id);

    const latestRoster = [...player.rosters].sort((a, b) => {
      const yearDifference = (b.season?.year ?? -1) - (a.season?.year ?? -1);
      if (yearDifference !== 0) return yearDifference;
      return b.createdAt.getTime() - a.createdAt.getTime();
    })[0];
    const teamContext = latestRoster
      ? [latestRoster.team?.name, latestRoster.season?.name].filter(Boolean).join(' · ') || null
      : null;

    return {
      targetType: 'PLAYER',
      targetId: player.id,
      name: player.name,
      email: player.email,
      teamContext,
      userId: linkedUser?.id ?? null,
      userRole: linkedUser?.role ?? null
    };
  });

  for (const user of users) {
    if (linkedUserIds.has(user.id)) continue;
    emailIdentities.push({
      targetType: 'USER',
      targetId: user.id,
      name: user.name ?? 'Standalone account',
      email: user.email,
      teamContext: null,
      userId: user.id,
      userRole: user.role
    });
  }
  emailIdentities.sort((a, b) => a.name.localeCompare(b.name));

  const games = gamesRaw;

  const selectedGameId =
    query.game && games.some((game) => game.id === query.game)
      ? query.game
      : games[0]?.id ?? null;

  const gameOptions = games.map((game) => {
    const week = game.scheduleEntry?.week ? `Week ${game.scheduleEntry.week}` : formatGameType(game.type);
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

      <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(20rem,0.9fr)]">
        <AdminGameWorkbench games={gameOptions} initialGameId={selectedGameId} />
        <AdminUsersTable
          users={users.map((user) => ({
            ...user,
            createdAt: user.createdAt.toISOString()
          }))}
        />
      </section>

      <AdminRosterManager
        latestSeason={latestSeason
          ? {
              id: latestSeason.id,
              name: latestSeason.name,
              teams: latestSeason.teams
            }
          : null}
      />

      <AdminEmailManager identities={emailIdentities} />

      <AdminAuditLog />
    </div>
  );
}
