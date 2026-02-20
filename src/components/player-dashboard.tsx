import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { GameType, ResultType } from '@prisma/client';
import { advancedStats, baseRatingStats, boxScore, defaultMultipliers, isMake } from '@/lib/stats';
import { PlayerLink } from '@/components/player-link';
import { SeasonSelect } from '@/components/season-select';
import { GameTypeSelect } from '@/components/game-type-select';

type LeagueAgg = {
  games: number;
  sumMakes: number;
  sumTops: number;
  sumBottoms: number;
  sumFg: number;
  fgGames: number;
  sumAdjusted: number;
};

type PlayerGameRow = {
  id: string;
  weekLabel: string;
  weekNumber: number | null;
  matchup: string;
  date: string;
  startedAtMs: number;
  makes: number;
  attempts: number;
  tops: number;
  bottoms: number;
  fg: number;
  isLegacy: boolean;
};

const percentile = (values: number[], value: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = sorted.filter((v) => v <= value).length;
  return Math.round((rank / sorted.length) * 100);
};

export async function PlayerDashboard({
  playerId,
  seasonId,
  gameType,
  seasonOptions,
  seasonValue,
  typeValue
}: {
  playerId: string;
  seasonId?: string | null;
  gameType?: GameType | null;
  seasonOptions?: { id: string; name: string }[];
  seasonValue?: string;
  typeValue?: string;
}) {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player) return notFound();

  const [games, leagueGames] = await Promise.all([
    prisma.game.findMany({
      where: {
        ...(seasonId ? { seasonId } : {}),
        ...(gameType ? { type: gameType } : {}),
        OR: [
          { events: { some: { shooterId: player.id } } },
          { legacyStats: { some: { playerId: player.id } } }
        ]
      },
      orderBy: { startedAt: 'desc' },
      include: {
        homeTeam: true,
        awayTeam: true,
        scheduleEntry: true,
        events: {
          where: { shooterId: player.id, resultType: { notIn: [ResultType.PULL_HOME, ResultType.PULL_AWAY] } },
          orderBy: { timestamp: 'asc' }
        },
        legacyStats: { where: { playerId: player.id } }
      }
    }),
    prisma.game.findMany({
      where: {
        ...(seasonId ? { seasonId } : {}),
        ...(gameType ? { type: gameType } : {}),
        OR: [{ events: { some: {} } }, { legacyStats: { some: {} } }]
      },
      include: {
        events: true,
        legacyStats: true
      }
    })
  ]);

  const trackedEvents = games.flatMap((game) => game.events);
  const legacyStats = games.flatMap((game) => game.legacyStats);

  const playerBox = boxScore(trackedEvents).get(player.id);
  const tempoStats = advancedStats(trackedEvents, defaultMultipliers).get(player.id);
  const baseStats = baseRatingStats(trackedEvents, defaultMultipliers).get(player.id);
  const trackedAttempts = playerBox?.attempts ?? 0;
  const trackedMakes = playerBox?.makes ?? 0;
  const legacyTotals = legacyStats.reduce(
    (acc, stat) => {
      const breakdown = stat.topRegular + stat.topIso + stat.bottomRegular + stat.bottomIso;
      const makes = stat.totalCups > 0 ? stat.totalCups : breakdown;
      const attempts = makes + stat.misses;
      acc.makes += makes;
      acc.attempts += attempts;
      acc.topRegular += stat.topRegular;
      acc.topIso += stat.topIso;
      acc.bottomRegular += stat.bottomRegular;
      acc.bottomIso += stat.bottomIso;
      acc.misses += stat.misses;
      return acc;
    },
    { makes: 0, attempts: 0, topRegular: 0, topIso: 0, bottomRegular: 0, bottomIso: 0, misses: 0 }
  );

  const attempts = trackedAttempts + legacyTotals.attempts;
  const makes = trackedMakes + legacyTotals.makes;
  const legacyWeightedPoints =
    legacyTotals.topRegular * defaultMultipliers.top +
    legacyTotals.topIso * defaultMultipliers.topIso +
    legacyTotals.bottomRegular * defaultMultipliers.bottom +
    legacyTotals.bottomIso * defaultMultipliers.bottomIso;
  const baseTrackedPoints = baseStats?.weightedPoints ?? 0;
  const adjustedFgm = baseTrackedPoints + legacyWeightedPoints;
  const fgPct = attempts ? makes / attempts : 0;
  const tempoRating = tempoStats?.weightedPoints ?? 0;
  const tempoPerShot = trackedAttempts ? tempoRating / trackedAttempts : 0;
  const clutchMakes = trackedEvents.filter(
    (event) => isMake(event.resultType) && (event.remainingCupsBefore ?? 100) <= 20
  ).length;
  const clutchShare = trackedMakes ? clutchMakes / trackedMakes : 0;
  const hasTracked = trackedAttempts > 0;
  const hasLegacy = legacyTotals.attempts > 0;

  const gameRows: PlayerGameRow[] = games
    .map((game) => {
      const isLegacy = game.statsSource === 'LEGACY';
      let rowMakes = 0;
      let rowAttempts = 0;
      let tops = 0;
      let bottoms = 0;

      if (isLegacy) {
        const legacy = game.legacyStats[0];
        if (legacy) {
          const breakdown = legacy.topRegular + legacy.topIso + legacy.bottomRegular + legacy.bottomIso;
          rowMakes = legacy.totalCups > 0 ? legacy.totalCups : breakdown;
          rowAttempts = rowMakes + legacy.misses;
          tops = legacy.topRegular + legacy.topIso;
          bottoms = legacy.bottomRegular + legacy.bottomIso;
        }
      } else {
        for (const event of game.events) {
          rowAttempts += 1;
          if (isMake(event.resultType)) {
            rowMakes += 1;
            if (event.resultType === ResultType.TOP_REGULAR || event.resultType === ResultType.TOP_ISO) tops += 1;
            if (event.resultType === ResultType.BOTTOM_REGULAR || event.resultType === ResultType.BOTTOM_ISO) bottoms += 1;
          }
        }
      }

      const fg = rowAttempts ? rowMakes / rowAttempts : 0;
      const weekNumber = game.scheduleEntry?.week ?? null;
      const weekLabel = weekNumber ? `Week ${weekNumber}` : '—';
      const matchup = `${game.homeTeam?.name ?? 'Home'} vs ${game.awayTeam?.name ?? 'Away'}`;
      const date = game.startedAt?.toLocaleDateString?.() ?? '';
      const startedAtMs = game.startedAt?.getTime?.() ?? 0;

      return {
        id: game.id,
        weekLabel,
        weekNumber,
        matchup,
        date,
        startedAtMs,
        makes: rowMakes,
        attempts: rowAttempts,
        tops,
        bottoms,
        fg,
        isLegacy
      };
    })
    .sort((a, b) => {
      if (a.weekNumber !== b.weekNumber) {
        if (a.weekNumber === null) return 1;
        if (b.weekNumber === null) return -1;
        return b.weekNumber - a.weekNumber;
      }
      return b.startedAtMs - a.startedAtMs;
    });

  const gamesPlayed = gameRows.length;
  const avgMakes = gamesPlayed ? gameRows.reduce((sum, row) => sum + row.makes, 0) / gamesPlayed : 0;
  const avgTops = gamesPlayed ? gameRows.reduce((sum, row) => sum + row.tops, 0) / gamesPlayed : 0;
  const avgBottoms = gamesPlayed ? gameRows.reduce((sum, row) => sum + row.bottoms, 0) / gamesPlayed : 0;
  const avgFg = gamesPlayed ? gameRows.reduce((sum, row) => sum + row.fg, 0) / gamesPlayed : 0;

  const leagueAgg = new Map<string, LeagueAgg>();

  for (const game of leagueGames) {
    if (game.statsSource === 'LEGACY') {
      for (const stat of game.legacyStats) {
        const breakdown = stat.topRegular + stat.topIso + stat.bottomRegular + stat.bottomIso;
        const rowMakes = stat.totalCups > 0 ? stat.totalCups : breakdown;
        const rowAttempts = rowMakes + stat.misses;
        const rowTops = stat.topRegular + stat.topIso;
        const rowBottoms = stat.bottomRegular + stat.bottomIso;
        const fg = rowAttempts ? rowMakes / rowAttempts : 0;

        const adjusted =
          stat.topRegular * defaultMultipliers.top +
          stat.topIso * defaultMultipliers.topIso +
          stat.bottomRegular * defaultMultipliers.bottom +
          stat.bottomIso * defaultMultipliers.bottomIso;

        const current = leagueAgg.get(stat.playerId) ?? {
          games: 0,
          sumMakes: 0,
          sumTops: 0,
          sumBottoms: 0,
          sumFg: 0,
          fgGames: 0,
          sumAdjusted: 0
        };
        current.games += 1;
        current.sumMakes += rowMakes;
        current.sumTops += rowTops;
        current.sumBottoms += rowBottoms;
        current.sumAdjusted += adjusted;
        if (rowAttempts > 0) {
          current.sumFg += fg;
          current.fgGames += 1;
        }
        leagueAgg.set(stat.playerId, current);
      }
      continue;
    }

    if (!game.events.length) continue;
    const perPlayer = new Map<
      string,
      { makes: number; attempts: number; tops: number; bottoms: number; adjusted: number }
    >();
    for (const event of game.events) {
      if (!event.shooterId) continue;
      if (event.resultType === ResultType.PULL_HOME || event.resultType === ResultType.PULL_AWAY) continue;
      const current = perPlayer.get(event.shooterId) ?? {
        makes: 0,
        attempts: 0,
        tops: 0,
        bottoms: 0,
        adjusted: 0
      };
      current.attempts += 1;
      if (isMake(event.resultType)) {
        current.makes += 1;
        if (event.resultType === ResultType.TOP_REGULAR || event.resultType === ResultType.TOP_ISO) current.tops += 1;
        if (event.resultType === ResultType.BOTTOM_REGULAR || event.resultType === ResultType.BOTTOM_ISO) current.bottoms += 1;
        current.adjusted +=
          event.resultType === ResultType.TOP_REGULAR
            ? defaultMultipliers.top
            : event.resultType === ResultType.TOP_ISO
              ? defaultMultipliers.topIso
              : event.resultType === ResultType.BOTTOM_ISO
                ? defaultMultipliers.bottomIso
                : defaultMultipliers.bottom;
      }
      perPlayer.set(event.shooterId, current);
    }
    perPlayer.forEach((row, pid) => {
      const fg = row.attempts ? row.makes / row.attempts : 0;
      const current = leagueAgg.get(pid) ?? {
        games: 0,
        sumMakes: 0,
        sumTops: 0,
        sumBottoms: 0,
        sumFg: 0,
        fgGames: 0,
        sumAdjusted: 0
      };
      current.games += 1;
      current.sumMakes += row.makes;
      current.sumTops += row.tops;
      current.sumBottoms += row.bottoms;
      current.sumAdjusted += row.adjusted;
      if (row.attempts > 0) {
        current.sumFg += fg;
        current.fgGames += 1;
      }
      leagueAgg.set(pid, current);
    });
  }

  const leagueValues = Array.from(leagueAgg.values()).filter((entry) => entry.games > 0);
  const makesList = leagueValues.map((entry) => entry.sumMakes / entry.games);
  const topsList = leagueValues.map((entry) => entry.sumTops / entry.games);
  const bottomsList = leagueValues.map((entry) => entry.sumBottoms / entry.games);
  const adjustedList = leagueValues.map((entry) => entry.sumAdjusted / entry.games);
  const fgList = leagueValues
    .filter((entry) => entry.fgGames > 0)
    .map((entry) => entry.sumFg / entry.fgGames);

  const pctMakes = gamesPlayed ? percentile(makesList, avgMakes) : null;
  const pctTops = gamesPlayed ? percentile(topsList, avgTops) : null;
  const pctBottoms = gamesPlayed ? percentile(bottomsList, avgBottoms) : null;
  const pctFg = gamesPlayed ? percentile(fgList, avgFg) : null;
  const adjustedFgmPerGame = gamesPlayed > 0 ? adjustedFgm / gamesPlayed : 0;
  const leagueAvgAdjusted =
    adjustedList.length > 0 ? adjustedList.reduce((sum, val) => sum + val, 0) / adjustedList.length : 0;
  const leagueAvgFg = fgList.length > 0 ? fgList.reduce((sum, val) => sum + val, 0) / fgList.length : 0;
  const canRate = attempts > 0 && adjustedFgmPerGame > 0 && leagueAvgAdjusted > 0 && leagueAvgFg > 0;
  const playerRating = canRate ? adjustedFgmPerGame * fgPct * leagueAvgAdjusted * leagueAvgFg : 0;
  const ratingPerShot = canRate ? playerRating / attempts : 0;

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-garnet-600">Player dashboard</p>
          <h1 className="text-2xl font-bold text-ink sm:text-3xl">
            <PlayerLink id={player.id} name={player.name} className="text-ink hover:text-garnet-600" />
          </h1>
        </div>
        {seasonOptions && seasonValue && typeValue && (
          <div className="flex flex-wrap items-start gap-2">
            <SeasonSelect seasons={seasonOptions} value={seasonValue} showLabel={false} />
            <GameTypeSelect value={typeValue} showLabel={false} />
          </div>
        )}
      </div>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink sm:text-lg">
            <span className="sm:hidden">Per-game</span>
            <span className="hidden sm:inline">Per-game averages</span>
          </h2>
          <p className="hidden text-[11px] text-ash sm:block sm:text-xs">
            Percentiles vs league players (min 1 game).
          </p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:gap-4 md:grid-cols-4">
          <AvgCard label="Cups per game" value={gamesPlayed ? avgMakes.toFixed(1) : '—'} percentile={pctMakes} />
          <AvgCard label="Tops per game" value={gamesPlayed ? avgTops.toFixed(1) : '—'} percentile={pctTops} />
          <AvgCard label="Bottoms per game" value={gamesPlayed ? avgBottoms.toFixed(1) : '—'} percentile={pctBottoms} />
          <AvgCard label="FG% avg" value={gamesPlayed ? `${(avgFg * 100).toFixed(1)}%` : '—'} percentile={pctFg} />
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <StatCard label="Total makes" value={makes} />
        <StatCard label="Total shots" value={attempts} />
        <StatCard label="Games played" value={gamesPlayed} />
      </section>

      <section className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-2xl border border-garnet-100 bg-white/85 p-4 shadow sm:p-5">
          <h2 className="text-base font-semibold text-ink sm:text-lg">Shot breakdown</h2>
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm text-ink sm:gap-3 md:grid-cols-2">
            <BreakdownCard label="Top regular" value={(playerBox?.topRegular ?? 0) + legacyTotals.topRegular} />
            <BreakdownCard label="Top ISO" value={(playerBox?.topIso ?? 0) + legacyTotals.topIso} />
            <BreakdownCard label="Bottom regular" value={(playerBox?.bottomRegular ?? 0) + legacyTotals.bottomRegular} />
            <BreakdownCard label="Bottom ISO" value={(playerBox?.bottomIso ?? 0) + legacyTotals.bottomIso} />
            <BreakdownCard label="Misses" value={(playerBox?.misses ?? 0) + legacyTotals.misses} />
          </div>
        </div>

        <div className="rounded-2xl border border-garnet-100 bg-white/85 p-4 shadow sm:p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-ink sm:text-lg">Player ratings</h2>
            <span className="rounded-full border border-gold-300 bg-gold-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-garnet-600">
              {hasTracked ? 'Tracked' : hasLegacy ? 'Legacy estimate' : 'Tracked'}
            </span>
          </div>
          <p className="mt-2 hidden text-xs text-ash sm:block">
            Adjusted FGM weights: top {defaultMultipliers.top}, bottom {defaultMultipliers.bottom}, iso top{' '}
            {defaultMultipliers.topIso}, iso bottom {defaultMultipliers.bottomIso}. Player rating = (Adjusted FGM / game)
            × FG% × league avg (Adjusted FGM / game) × league avg FG%.
            {hasTracked ? ' Tempo rating applies temporal scaling.' : ''}
          </p>
          <div className="mt-4 space-y-3 text-sm text-ink">
            <MetricRow label="Adjusted FGM / game" value={gamesPlayed > 0 ? adjustedFgmPerGame.toFixed(2) : '—'} />
            <MetricRow label="Player rating" value={canRate ? playerRating.toFixed(2) : '—'} />
            <MetricRow label="Rating per shot" value={canRate ? ratingPerShot.toFixed(2) : '—'} />
            <MetricRow label="Tempo rating (tracked)" value={hasTracked ? tempoRating.toFixed(2) : '—'} />
            <MetricRow label="Tempo per shot (tracked)" value={hasTracked ? tempoPerShot.toFixed(2) : '—'} />
            <MetricRow label="Clutch share (tracked)" value={hasTracked ? `${(clutchShare * 100).toFixed(1)}%` : '—'} />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-garnet-100 bg-white/85 p-4 shadow sm:p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink sm:text-lg">Game log</h2>
          <span className="text-[11px] text-ash sm:text-xs">Per-game stats for every appearance.</span>
        </div>
        <div className="mt-4 overflow-auto">
          <table className="min-w-full text-sm text-ink">
            <thead className="bg-parchment/80 text-ash">
              <tr>
                <th className="px-3 py-2 text-left">Week</th>
                <th className="px-3 py-2 text-left">Matchup</th>
                <th className="px-3 py-2 text-center">Cups</th>
                <th className="px-3 py-2 text-center">Tops</th>
                <th className="px-3 py-2 text-center">Bottoms</th>
                <th className="px-3 py-2 text-center">FG%</th>
                <th className="px-3 py-2 text-center">Source</th>
              </tr>
            </thead>
            <tbody>
              {gameRows.map((row, idx) => {
                const href = `/games/${row.id}`;
                return (
                  <tr key={row.id} className={idx % 2 === 1 ? 'bg-gold-50/50' : 'bg-white'}>
                    <td className="p-0 text-ash">
                      <Link href={href} className="block px-3 py-2">
                        {row.weekLabel}
                      </Link>
                    </td>
                    <td className="p-0">
                      <Link href={href} className="block px-3 py-2">
                        <div className="font-semibold text-ink">{row.matchup}</div>
                        <div className="text-xs text-ash">{row.date}</div>
                      </Link>
                    </td>
                    <td className="p-0 text-center font-semibold text-garnet-600">
                      <Link href={href} className="block px-3 py-2">
                        {row.makes}
                      </Link>
                    </td>
                    <td className="p-0 text-center">
                      <Link href={href} className="block px-3 py-2">
                        {row.tops}
                      </Link>
                    </td>
                    <td className="p-0 text-center">
                      <Link href={href} className="block px-3 py-2">
                        {row.bottoms}
                      </Link>
                    </td>
                    <td className="p-0 text-center">
                      <Link href={href} className="block px-3 py-2">
                        {row.attempts ? (row.fg * 100).toFixed(1) : '—'}%
                      </Link>
                    </td>
                    <td className="p-0 text-center">
                      <Link href={href} className="block px-3 py-2">
                        {row.isLegacy ? (
                          <span className="rounded-full border border-gold-300 bg-gold-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-garnet-600">
                            Legacy
                          </span>
                        ) : (
                          <span className="rounded-full border border-emerald-200 bg-emerald-50/70 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">
                            Tracked
                          </span>
                        )}
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {gameRows.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-center text-ash" colSpan={7}>
                    No games logged yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function AvgCard({
  label,
  value,
  percentile
}: {
  label: string;
  value: string;
  percentile: number | null;
}) {
  return (
    <div className="min-h-[76px] rounded-xl border border-garnet-100 bg-white/85 p-2.5 shadow sm:min-h-[112px] sm:p-4">
      <p className="text-[9px] uppercase tracking-wide text-ash sm:text-xs">{label}</p>
      <p className="mt-1 text-base font-bold text-garnet-600 sm:mt-2 sm:text-2xl">{value}</p>
      <p className="mt-1 text-[10px] text-ash sm:mt-2 sm:text-xs">
        {percentile === null ? 'Percentile —' : `Percentile: ${percentile}th`}
      </p>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-h-[76px] rounded-xl border border-garnet-100 bg-white/85 p-2.5 shadow sm:min-h-[112px] sm:p-4">
      <p className="text-[9px] uppercase tracking-wide text-ash sm:text-xs">{label}</p>
      <p className="text-base font-bold text-garnet-600 sm:text-2xl">{value}</p>
    </div>
  );
}

function BreakdownCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-garnet-100 bg-parchment/70 p-3">
      <p className="text-[10px] uppercase tracking-wide text-ash sm:text-xs">{label}</p>
      <p className="text-sm font-semibold text-ink sm:text-lg">{value}</p>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-garnet-100 bg-parchment/70 px-3 py-2 text-xs sm:px-4 sm:py-3 sm:text-sm">
      <span className="text-ash">{label}</span>
      <span className="font-semibold text-garnet-600">{value}</span>
    </div>
  );
}
