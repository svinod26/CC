import Link from 'next/link';
import { getServerAuthSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { ResultType } from '@prisma/client';
import { isMake, isShot, winnerFromRemaining } from '@/lib/stats';
import { getWeeklyRecap } from '@/lib/ai';
import { resolveSeasonSelection } from '@/lib/season';

export default async function HomePage() {
  const session = await getServerAuthSession();
  if (!session) {
    redirect('/signin');
  }
  const seasons = await prisma.season.findMany({ orderBy: { year: 'desc' } });
  const { season: currentSeason } = resolveSeasonSelection(seasons);

  if (!currentSeason) {
    return (
      <div className="rounded-2xl border border-garnet-100 bg-white/85 p-4 text-ink shadow sm:p-6">
        <h1 className="text-2xl font-bold text-ink">Century Cup Hub</h1>
        <p className="mt-2 text-ash">No seasons found. Import a season to get started.</p>
      </div>
    );
  }

  const latestWeekPromise = prisma.schedule.findFirst({
    where: {
      seasonId: currentSeason.id,
      game: {
        OR: [
          {
            events: {
              some: { resultType: { notIn: [ResultType.PULL_HOME, ResultType.PULL_AWAY] } }
            }
          },
          { legacyStats: { some: {} } }
        ]
      }
    },
    orderBy: { week: 'desc' }
  });
  const recentGamesPromise = prisma.game.findMany({
    where: {
      seasonId: currentSeason.id,
      type: 'LEAGUE',
      OR: [
        {
          events: {
            some: { resultType: { notIn: [ResultType.PULL_HOME, ResultType.PULL_AWAY] } }
          }
        },
        { legacyStats: { some: {} } }
      ]
    },
    take: 24,
    include: {
      homeTeam: true,
      awayTeam: true,
      state: true,
      scheduleEntry: true,
      events: {
        where: { resultType: { notIn: [ResultType.PULL_HOME, ResultType.PULL_AWAY] } },
        orderBy: { timestamp: 'desc' },
        take: 1,
        select: { timestamp: true }
      }
    }
  });
  const inProgressPromise = prisma.game.findMany({
    where: { status: 'IN_PROGRESS', seasonId: currentSeason.id },
    orderBy: { startedAt: 'desc' },
    take: 6,
    include: { homeTeam: true, awayTeam: true, scheduleEntry: true, state: true }
  });

  const playerPromise = session?.user?.email
    ? prisma.player.findFirst({ where: { email: session.user.email } })
    : Promise.resolve(null);

  const [recentLeagueGamesRaw, player, latestWeekEntry, inProgressGames] = await Promise.all([
    recentGamesPromise,
    playerPromise,
    latestWeekPromise,
    inProgressPromise
  ]);
  const recentGames = recentLeagueGamesRaw
    .sort((a, b) => {
      const weekA = a.scheduleEntry?.week ?? -1;
      const weekB = b.scheduleEntry?.week ?? -1;
      if (weekA !== weekB) return weekB - weekA;
      const activityA = a.events[0]?.timestamp?.getTime?.() ?? a.startedAt.getTime();
      const activityB = b.events[0]?.timestamp?.getTime?.() ?? b.startedAt.getTime();
      return activityB - activityA;
    })
    .slice(0, 6);

  const latestWeek = latestWeekEntry?.week ?? null;
  const latestWeekGames = latestWeek
    ? await prisma.game.findMany({
        where: { seasonId: currentSeason.id, scheduleEntry: { week: latestWeek } },
        include: { homeTeam: true, awayTeam: true, state: true, events: true, legacyStats: true }
      })
    : [];
  const [weeklyEvents, weeklyLegacy] = latestWeek
    ? await Promise.all([
        prisma.shotEvent.findMany({
          where: {
            shooterId: { not: null },
            resultType: { notIn: [ResultType.PULL_HOME, ResultType.PULL_AWAY] },
            game: { seasonId: currentSeason.id, scheduleEntry: { week: latestWeek } }
          },
          include: { shooter: true }
        }),
        prisma.legacyPlayerStat.findMany({
          where: { game: { seasonId: currentSeason.id, scheduleEntry: { week: latestWeek } } },
          include: { player: true }
        })
      ])
    : [[], []];

  const recentPlayerGames = player
    ? await prisma.game.findMany({
        where: {
          OR: [
            { events: { some: { shooterId: player.id } } },
            { legacyStats: { some: { playerId: player.id } } }
          ],
          seasonId: currentSeason.id
        },
        orderBy: { startedAt: 'desc' },
        take: 5,
        include: {
          homeTeam: true,
          awayTeam: true,
          events: { where: { shooterId: player.id }, orderBy: { timestamp: 'asc' } },
          legacyStats: { where: { playerId: player.id } }
        }
      })
    : [];

  const topPerformers = new Map<
    string,
    { id?: string; name: string; makes: number; attempts: number; fg: number; tops: number; bottoms: number }
  >();
  weeklyEvents.forEach((event) => {
    if (!isShot(event.resultType) || !event.shooterId) return;
    const existing = topPerformers.get(event.shooterId) ?? {
      id: event.shooterId,
      name: event.shooter?.name ?? 'Unknown',
      makes: 0,
      attempts: 0,
      fg: 0,
      tops: 0,
      bottoms: 0
    };
    existing.attempts += 1;
    if (isMake(event.resultType)) {
      existing.makes += 1;
      if (event.resultType === ResultType.TOP_REGULAR || event.resultType === ResultType.TOP_ISO) {
        existing.tops += 1;
      }
      if (event.resultType === ResultType.BOTTOM_REGULAR || event.resultType === ResultType.BOTTOM_ISO) {
        existing.bottoms += 1;
      }
    }
    existing.fg = existing.attempts ? existing.makes / existing.attempts : 0;
    topPerformers.set(event.shooterId, existing);
  });

  weeklyLegacy.forEach((stat) => {
    if (!stat.playerId) return;
    const existing = topPerformers.get(stat.playerId) ?? {
      id: stat.playerId,
      name: stat.player?.name ?? 'Unknown',
      makes: 0,
      attempts: 0,
      fg: 0,
      tops: 0,
      bottoms: 0
    };
    const breakdown = stat.topRegular + stat.topIso + stat.bottomRegular + stat.bottomIso;
    const makes = stat.totalCups > 0 ? stat.totalCups : breakdown;
    const attempts = makes + stat.misses;
    existing.makes += makes;
    existing.attempts += attempts;
    existing.tops += stat.topRegular + stat.topIso;
    existing.bottoms += stat.bottomRegular + stat.bottomIso;
    existing.fg = existing.attempts ? existing.makes / existing.attempts : 0;
    topPerformers.set(stat.playerId, existing);
  });

  const topList = Array.from(topPerformers.values())
    .sort((a, b) => b.makes - a.makes || b.fg - a.fg)
    .slice(0, 6);

  const weeklyMargins = latestWeekGames
    .map((game) =>
      game.state
        ? {
            gameId: game.id,
            margin: Math.abs(game.state.homeCupsRemaining - game.state.awayCupsRemaining),
            home: game.homeTeam?.name ?? 'Home',
            away: game.awayTeam?.name ?? 'Away'
          }
        : null
    )
    .filter((row): row is { gameId: string; margin: number; home: string; away: string } => Boolean(row));
  const averageMargin =
    weeklyMargins.length > 0 ? weeklyMargins.reduce((sum, row) => sum + row.margin, 0) / weeklyMargins.length : null;
  const closeGames = weeklyMargins.filter((row) => row.margin <= 5).length;
  const closestGame =
    weeklyMargins.length > 0
      ? [...weeklyMargins].sort((a, b) => a.margin - b.margin || a.home.localeCompare(b.home))[0]
      : null;

  let topMakes = 0;
  let bottomMakes = 0;
  let isoMakes = 0;
  let totalMakes = 0;
  let totalAttempts = 0;
  let clutchAttempts = 0;
  let clutchMakes = 0;

  weeklyEvents.forEach((event) => {
    if (!isShot(event.resultType)) return;
    totalAttempts += 1;
    const isClutchShot = (event.remainingCupsBefore ?? 101) <= 20;
    if (isClutchShot) clutchAttempts += 1;
    if (!isMake(event.resultType)) return;
    totalMakes += 1;
    if (isClutchShot) clutchMakes += 1;
    if (event.resultType === ResultType.TOP_REGULAR || event.resultType === ResultType.TOP_ISO) topMakes += 1;
    if (event.resultType === ResultType.BOTTOM_REGULAR || event.resultType === ResultType.BOTTOM_ISO) bottomMakes += 1;
    if (event.resultType === ResultType.TOP_ISO || event.resultType === ResultType.BOTTOM_ISO) isoMakes += 1;
  });

  weeklyLegacy.forEach((stat) => {
    const legacyTop = stat.topRegular + stat.topIso;
    const legacyBottom = stat.bottomRegular + stat.bottomIso;
    const breakdown = legacyTop + legacyBottom;
    const makes = stat.totalCups > 0 ? stat.totalCups : breakdown;
    const attempts = makes + stat.misses;
    topMakes += legacyTop;
    bottomMakes += legacyBottom;
    isoMakes += stat.topIso + stat.bottomIso;
    totalMakes += makes;
    totalAttempts += attempts;
  });

  const topShare = totalMakes > 0 ? topMakes / totalMakes : null;
  const isoShare = totalMakes > 0 ? isoMakes / totalMakes : null;
  const clutchFg = clutchAttempts > 0 ? clutchMakes / clutchAttempts : null;
  const pace = latestWeekGames.length > 0 ? totalAttempts / latestWeekGames.length : null;
  const weeklyIntel = [
    {
      label: 'Parity check',
      value:
        weeklyMargins.length > 0
          ? `${closeGames}/${weeklyMargins.length} games within 5 cups`
          : 'No completed margins yet',
      detail:
        weeklyMargins.length > 0
          ? `Avg margin ${averageMargin?.toFixed(1)} cups${
              closestGame ? ` · closest ${closestGame.home} vs ${closestGame.away} (${closestGame.margin})` : ''
            }`
          : 'Margins update when game states are finalized.'
    },
    {
      label: 'Shot profile',
      value:
        totalMakes > 0
          ? `${Math.round((topShare ?? 0) * 100)}% tops · ${Math.round((1 - (topShare ?? 0)) * 100)}% bottoms`
          : 'No makes logged yet',
      detail:
        totalMakes > 0
          ? `${((isoShare ?? 0) * 100).toFixed(1)}% ISO share of makes`
          : 'Profile updates as makes are logged.'
    },
    {
      label: 'Pressure & pace',
      value:
        clutchAttempts > 0
          ? `${((clutchFg ?? 0) * 100).toFixed(1)}% FG at <=20 cups`
          : 'No tracked clutch sample yet',
      detail:
        pace !== null
          ? `${pace.toFixed(1)} tracked attempts per game this week`
          : 'Pace appears once games are recorded.'
    }
  ];

  const recap = await getWeeklyRecap({
    week: latestWeek,
    games: latestWeekGames.map((game) => ({
      id: game.id,
      statsSource: game.statsSource,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      state: game.state
    })),
    topPerformers: topList.map((player) => ({
      name: player.name,
      makes: player.makes,
      fg: player.fg,
      tops: player.tops
    }))
  });

  return (
    <div className="space-y-5 sm:space-y-6">
      {inProgressGames.length > 0 && (
        <div className="space-y-2">
          {inProgressGames.map((liveGame) => (
            <Link
              key={liveGame.id}
              href={`/games/${liveGame.id}`}
              className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm font-semibold text-emerald-800 shadow-sm"
            >
              <span>
                Live now: {liveGame.homeTeam?.name ?? 'Home'} vs {liveGame.awayTeam?.name ?? 'Away'}
              </span>
              <span className="shrink-0 text-xs uppercase tracking-wide text-emerald-700">
                {liveGame.scheduleEntry?.week ? `Week ${liveGame.scheduleEntry.week}` : liveGame.type}
              </span>
            </Link>
          ))}
        </div>
      )}
      <section className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="rounded-2xl border border-garnet-100 bg-white/85 p-3 shadow sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm uppercase tracking-wide text-garnet-600">League latest · {currentSeason.name}</p>
              <h1 className="text-3xl font-bold text-ink">Century Cup Hub</h1>
            </div>
            <div className="flex gap-2">
              <Link
                href="/games/new"
                className="rounded-full bg-garnet-600 px-5 py-2 text-sm font-semibold text-sand shadow hover:bg-garnet-500"
              >
                Start game
              </Link>
              <Link
                href={session ? '/dashboard' : '/signin'}
                className="rounded-full border border-garnet-200 px-5 py-2 text-sm font-semibold text-garnet-600 hover:bg-gold-100"
              >
                {session ? 'My dashboard' : 'Sign in'}
              </Link>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {recentGames.map((game) => (
              <Link
                key={game.id}
                href={`/games/${game.id}`}
                className="flex items-center justify-between rounded-xl border border-garnet-100 bg-parchment/70 px-4 py-3 text-sm transition hover:bg-gold-50/60"
              >
                <div>
                  {(() => {
                    const winner = game.state
                      ? winnerFromRemaining(
                          game.state.homeCupsRemaining,
                          game.state.awayCupsRemaining,
                          game.statsSource
                        )
                      : null;
                    const homeWon = winner === 'home';
                    const awayWon = winner === 'away';
                    const pillClass = (won: boolean, lost: boolean) =>
                      won
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : lost
                          ? 'border-rose-200 bg-rose-50 text-rose-600'
                          : 'border-garnet-100 bg-white/70 text-ink';
                    return (
                      <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${pillClass(
                            homeWon,
                            awayWon
                          )}`}
                        >
                          {game.homeTeam?.name ?? 'Home'}
                        </span>
                        <span className="text-ash">vs</span>
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${pillClass(
                            awayWon,
                            homeWon
                          )}`}
                        >
                          {game.awayTeam?.name ?? 'Away'}
                        </span>
                      </p>
                    );
                  })()}
                  <p className="text-xs uppercase tracking-wide text-ash">
                    {game.scheduleEntry?.week ? `Week ${game.scheduleEntry.week}` : game.status}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-ash">Margin</p>
                  <p
                    className={`font-semibold ${
                      game.state
                        ? game.state.homeCupsRemaining < game.state.awayCupsRemaining ||
                          game.state.awayCupsRemaining < game.state.homeCupsRemaining
                          ? 'text-emerald-700'
                          : 'text-garnet-600'
                        : 'text-garnet-600'
                    }`}
                  >
                    {game.state
                      ? Math.abs(game.state.homeCupsRemaining - game.state.awayCupsRemaining)
                      : '—'}
                  </p>
                </div>
              </Link>
            ))}
            {recentGames.length === 0 && <p className="text-sm text-ash">No games yet.</p>}
          </div>
        </div>

        <div className="rounded-2xl border border-garnet-100 bg-white/80 p-3 shadow sm:p-5">
          <p className="text-sm uppercase tracking-wide text-garnet-600">AI recap</p>
          <h2 className="mt-2 text-xl font-semibold text-ink">Weekly intel (scaffold)</h2>
          <p className="mt-3 text-sm text-ash">
            {latestWeek
              ? `Derived from Week ${latestWeek} league results.`
              : 'Waiting for enough scored games to generate weekly signals.'}
          </p>
          <div className="mt-4 space-y-2">
            {weeklyIntel.map((item) => (
              <div key={item.label} className="rounded-xl border border-garnet-100 bg-parchment/70 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-garnet-600">{item.label}</p>
                <p className="mt-0.5 text-sm font-semibold text-ink">{item.value}</p>
                <p className="mt-0.5 text-xs text-ash">{item.detail}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-xl border border-dashed border-garnet-200 bg-white/70 p-3">
            <p className="text-[11px] uppercase tracking-wide text-ash">Narrative layer</p>
            <p className="mt-1 text-sm text-ash">
              {recap.source === 'gemini'
                ? recap.text
                : recap.reason === 'missing-key'
                  ? 'Set GEMINI_API_KEY to add a short weekly storyline automatically.'
                  : recap.text}
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-garnet-100 bg-white/85 p-3 shadow sm:p-5">
          <p className="text-sm uppercase tracking-wide text-garnet-600">Top performers</p>
          <h2 className="mt-2 text-xl font-semibold text-ink">
            {latestWeek ? `Week ${latestWeek} hot hands` : 'Recent hot hands'}
          </h2>
          <div className="mt-4 space-y-3">
            {topList.map((player) => {
              const gameId =
                latestWeekGames.find((game) =>
                  game.statsSource === 'LEGACY'
                    ? game.legacyStats.some((stat) => stat.playerId === player.id)
                    : game.events.some((event) => event.shooterId === player.id)
                )?.id ?? null;
              const content = (
                <div className="flex w-full flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <p className="min-w-0 break-words font-semibold leading-tight text-ink sm:truncate">
                    {player.name}
                  </p>
                  <p className="text-[11px] text-garnet-600 sm:text-sm sm:text-right">
                    {player.makes} cups · {(player.fg * 100).toFixed(1)}% FG · {player.tops} tops
                  </p>
                </div>
              );
              return gameId ? (
                <Link
                  key={player.id ?? player.name}
                  href={`/games/${gameId}`}
                  className="flex items-center rounded-xl border border-garnet-100 bg-parchment/70 px-3 py-2 text-sm transition hover:bg-gold-50/60 sm:px-4 sm:py-3"
                >
                  {content}
                </Link>
              ) : (
                <div
                  key={player.id ?? player.name}
                  className="flex items-center rounded-xl border border-garnet-100 bg-parchment/70 px-3 py-2 text-sm sm:px-4 sm:py-3"
                >
                  {content}
                </div>
              );
            })}
            {topList.length === 0 && <p className="text-sm text-ash">No Week {latestWeek ?? '—'} data yet.</p>}
          </div>
        </div>

        <div className="rounded-2xl border border-garnet-100 bg-white/85 p-3 shadow sm:p-5">
          <p className="text-sm uppercase tracking-wide text-garnet-600">Your latest</p>
          <h2 className="mt-2 text-xl font-semibold text-ink">Recent performances</h2>
          {!session && (
            <p className="mt-4 text-sm text-ash">
              Sign in to see your personal game log and advanced stats.
            </p>
          )}
          {session && !player && (
            <p className="mt-4 text-sm text-ash">
              We couldn’t match your account email to a player record yet. Ask an admin to link your email in the roster
              import.
            </p>
          )}
          {player && (
            <div className="mt-4 space-y-3">
              {recentPlayerGames.map((game) => {
                const isLegacy = game.statsSource === 'LEGACY';
                const legacy = game.legacyStats[0];
                const legacyBreakdown = legacy
                  ? legacy.topRegular + legacy.topIso + legacy.bottomRegular + legacy.bottomIso
                  : 0;
                const legacyMakes = legacy ? (legacy.totalCups > 0 ? legacy.totalCups : legacyBreakdown) : 0;
                const legacyAttempts = legacy ? legacyMakes + legacy.misses : 0;
                const trackedAttempts = game.events.length;
                const trackedMakes = game.events.filter((e) => isMake(e.resultType)).length;
                const attempts = isLegacy ? legacyAttempts : trackedAttempts;
                const makes = isLegacy ? legacyMakes : trackedMakes;
                return (
                  <Link
                    key={game.id}
                    href={`/games/${game.id}`}
                    className="flex items-center justify-between rounded-xl border border-garnet-100 bg-parchment/70 px-4 py-3 text-sm transition hover:bg-gold-50/60"
                  >
                    <div>
                      <p className="font-semibold text-ink">
                        {game.homeTeam?.name ?? 'Home'} vs {game.awayTeam?.name ?? 'Away'}
                      </p>
                      <p className="text-xs text-ash">{game.startedAt.toLocaleDateString?.() ?? ''}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-garnet-600">
                        {makes}/{attempts} · {attempts ? ((makes / attempts) * 100).toFixed(1) : '0'}% FG
                      </p>
                      {isLegacy && (
                        <p className="text-[10px] uppercase tracking-wide text-ash">Legacy</p>
                      )}
                    </div>
                  </Link>
                );
              })}
              {recentPlayerGames.length === 0 && <p className="text-sm text-ash">No recent games logged.</p>}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
