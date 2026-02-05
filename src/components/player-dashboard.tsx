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
};

type PlayerGameRow = {
  id: string;
  weekLabel: string;
  matchup: string;
  date: string;
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

  const [shotEvents, legacyStats, games, leagueGames] = await Promise.all([
    prisma.shotEvent.findMany({
      where: {
        shooterId: player.id,
        resultType: { notIn: [ResultType.PULL_HOME, ResultType.PULL_AWAY] },
        ...(seasonId ? { game: { seasonId } } : {}),
        ...(gameType ? { game: { type: gameType } } : {})
      },
      include: { shooter: true },
      orderBy: { timestamp: 'desc' }
    }),
    prisma.legacyPlayerStat.findMany({
      where: {
        playerId: player.id,
        ...(seasonId ? { game: { seasonId } } : {}),
        ...(gameType ? { game: { type: gameType } } : {})
      }
    }),
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

  const playerBox = boxScore(shotEvents).get(player.id);
  const tempoStats = advancedStats(shotEvents, defaultMultipliers).get(player.id);
  const baseStats = baseRatingStats(shotEvents, defaultMultipliers).get(player.id);
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
  const baseRating = baseTrackedPoints + legacyWeightedPoints;
  const ratingPerShot = attempts ? baseRating / attempts : 0;
  const tempoRating = tempoStats?.weightedPoints ?? 0;
  const tempoPerShot = trackedAttempts ? tempoRating / trackedAttempts : 0;
  const clutchMakes = shotEvents.filter(
    (event) => isMake(event.resultType) && (event.remainingCupsBefore ?? 100) <= 20
  ).length;
  const clutchShare = trackedMakes ? clutchMakes / trackedMakes : 0;
  const hasTracked = trackedAttempts > 0;
  const hasLegacy = legacyTotals.attempts > 0;

  const gameRows: PlayerGameRow[] = games.map((game) => {
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
    const weekLabel = game.scheduleEntry?.week ? `Week ${game.scheduleEntry.week}` : '—';
    const matchup = `${game.homeTeam?.name ?? 'Home'} vs ${game.awayTeam?.name ?? 'Away'}`;
    const date = game.startedAt?.toLocaleDateString?.() ?? '';

    return {
      id: game.id,
      weekLabel,
      matchup,
      date,
      makes: rowMakes,
      attempts: rowAttempts,
      tops,
      bottoms,
      fg,
      isLegacy
    };
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

        const current = leagueAgg.get(stat.playerId) ?? {
          games: 0,
          sumMakes: 0,
          sumTops: 0,
          sumBottoms: 0,
          sumFg: 0,
          fgGames: 0
        };
        current.games += 1;
        current.sumMakes += rowMakes;
        current.sumTops += rowTops;
        current.sumBottoms += rowBottoms;
        if (rowAttempts > 0) {
          current.sumFg += fg;
          current.fgGames += 1;
        }
        leagueAgg.set(stat.playerId, current);
      }
      continue;
    }

    if (!game.events.length) continue;
    const perPlayer = new Map<string, { makes: number; attempts: number; tops: number; bottoms: number }>();
    for (const event of game.events) {
      if (!event.shooterId) continue;
      if (event.resultType === ResultType.PULL_HOME || event.resultType === ResultType.PULL_AWAY) continue;
      const current = perPlayer.get(event.shooterId) ?? { makes: 0, attempts: 0, tops: 0, bottoms: 0 };
      current.attempts += 1;
      if (isMake(event.resultType)) {
        current.makes += 1;
        if (event.resultType === ResultType.TOP_REGULAR || event.resultType === ResultType.TOP_ISO) current.tops += 1;
        if (event.resultType === ResultType.BOTTOM_REGULAR || event.resultType === ResultType.BOTTOM_ISO) current.bottoms += 1;
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
        fgGames: 0
      };
      current.games += 1;
      current.sumMakes += row.makes;
      current.sumTops += row.tops;
      current.sumBottoms += row.bottoms;
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
  const fgList = leagueValues
    .filter((entry) => entry.fgGames > 0)
    .map((entry) => entry.sumFg / entry.fgGames);

  const pctMakes = gamesPlayed ? percentile(makesList, avgMakes) : null;
  const pctTops = gamesPlayed ? percentile(topsList, avgTops) : null;
  const pctBottoms = gamesPlayed ? percentile(bottomsList, avgBottoms) : null;
  const pctFg = gamesPlayed ? percentile(fgList, avgFg) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-wide text-garnet-600">Player dashboard</p>
          <h1 className="text-3xl font-bold text-ink">
            <PlayerLink id={player.id} name={player.name} className="text-ink hover:text-garnet-600" />
          </h1>
        </div>
        {seasonOptions && seasonValue && typeValue && (
          <div className="flex flex-wrap items-end gap-3">
            <SeasonSelect seasons={seasonOptions} value={seasonValue} />
            <GameTypeSelect value={typeValue} />
          </div>
        )}
      </div>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">Per-game averages</h2>
          <p className="text-xs text-ash">Percentiles vs league players (min 1 game).</p>
        </div>
        <div className="mt-3 grid gap-4 md:grid-cols-4">
          <AvgCard label="Cups per game" value={gamesPlayed ? avgMakes.toFixed(1) : '—'} percentile={pctMakes} />
          <AvgCard label="Tops per game" value={gamesPlayed ? avgTops.toFixed(1) : '—'} percentile={pctTops} />
          <AvgCard label="Bottoms per game" value={gamesPlayed ? avgBottoms.toFixed(1) : '—'} percentile={pctBottoms} />
          <AvgCard label="FG% avg" value={gamesPlayed ? `${(avgFg * 100).toFixed(1)}%` : '—'} percentile={pctFg} />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <StatCard label="Total makes" value={makes} />
        <StatCard label="Total shots" value={attempts} />
        <StatCard label="Games played" value={gamesPlayed} />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-2xl border border-garnet-100 bg-white/85 p-5 shadow">
          <h2 className="text-lg font-semibold text-ink">Shot breakdown</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2 text-sm text-ink">
            <BreakdownCard label="Top regular" value={(playerBox?.topRegular ?? 0) + legacyTotals.topRegular} />
            <BreakdownCard label="Top ISO" value={(playerBox?.topIso ?? 0) + legacyTotals.topIso} />
            <BreakdownCard label="Bottom regular" value={(playerBox?.bottomRegular ?? 0) + legacyTotals.bottomRegular} />
            <BreakdownCard label="Bottom ISO" value={(playerBox?.bottomIso ?? 0) + legacyTotals.bottomIso} />
            <BreakdownCard label="Misses" value={(playerBox?.misses ?? 0) + legacyTotals.misses} />
          </div>
        </div>

        <div className="rounded-2xl border border-garnet-100 bg-white/85 p-5 shadow">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-ink">Player ratings</h2>
            <span className="rounded-full border border-gold-300 bg-gold-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-garnet-600">
              {hasTracked ? 'Tracked' : hasLegacy ? 'Legacy estimate' : 'Tracked'}
            </span>
          </div>
          <p className="mt-2 text-xs text-ash">
            Player rating = cup weights (top {defaultMultipliers.top}, bottom {defaultMultipliers.bottom}, iso top{' '}
            {defaultMultipliers.topIso}, iso bottom {defaultMultipliers.bottomIso}).{hasTracked ? ' Tempo rating applies temporal scaling.' : ''}
          </p>
          <div className="mt-4 space-y-3 text-sm text-ink">
            <MetricRow label="Player rating" value={attempts ? baseRating.toFixed(2) : '—'} />
            <MetricRow label="Rating per shot" value={attempts ? ratingPerShot.toFixed(2) : '—'} />
            <MetricRow label="Tempo rating (tracked)" value={hasTracked ? tempoRating.toFixed(2) : '—'} />
            <MetricRow label="Tempo per shot (tracked)" value={hasTracked ? tempoPerShot.toFixed(2) : '—'} />
            <MetricRow label="Clutch share (tracked)" value={hasTracked ? `${(clutchShare * 100).toFixed(1)}%` : '—'} />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-garnet-100 bg-white/85 p-5 shadow">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">Game log</h2>
          <span className="text-xs text-ash">Per-game stats for every appearance.</span>
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
    <div className="rounded-xl border border-garnet-100 bg-white/85 p-4 shadow">
      <p className="text-xs uppercase tracking-wide text-ash">{label}</p>
      <p className="mt-2 text-2xl font-bold text-garnet-600">{value}</p>
      <p className="mt-2 text-xs text-ash">
        {percentile === null ? 'Percentile —' : `Percentile: ${percentile}th`}
      </p>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-garnet-100 bg-white/85 p-4 shadow">
      <p className="text-xs uppercase tracking-wide text-ash">{label}</p>
      <p className="text-2xl font-bold text-garnet-600">{value}</p>
    </div>
  );
}

function BreakdownCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-garnet-100 bg-parchment/70 p-3">
      <p className="text-xs uppercase tracking-wide text-ash">{label}</p>
      <p className="text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-garnet-100 bg-parchment/70 px-4 py-3">
      <span className="text-ash">{label}</span>
      <span className="font-semibold text-garnet-600">{value}</span>
    </div>
  );
}
