import { prisma } from '@/lib/prisma';
import { defaultMultipliers, isMake, isShot } from '@/lib/stats';
import { Sparkline } from '@/components/sparkline';
import { PlayerLink } from '@/components/player-link';
import { PlayerSearch } from '@/components/player-search';
import { resolveSeasonSelection } from '@/lib/season';
import { SeasonSelect } from '@/components/season-select';
import { GameTypeSelect } from '@/components/game-type-select';
import { GameType } from '@prisma/client';

export const metadata = {
  title: 'Player Hub | Century Cup'
};

type PlayerAgg = {
  id: string;
  name: string;
  games: number;
  trackedGames: number;
  makes: number;
  attempts: number;
  trackedAttempts: number;
  tops: number;
  topIsos: number;
  bottoms: number;
  bottomIsos: number;
  misses: number;
  weightedPoints: number;
  playerRating: number;
  ratingPerShot: number;
  clutchMakes: number;
  weekMakes: number[];
};

const weightFor = (resultType: string) => {
  return resultType === 'TOP_REGULAR'
    ? defaultMultipliers.top
    : resultType === 'TOP_ISO'
      ? defaultMultipliers.topIso
      : resultType === 'BOTTOM_ISO'
        ? defaultMultipliers.bottomIso
        : defaultMultipliers.bottom;
};

const maxFrom = (rows: PlayerAgg[], valueFor: (row: PlayerAgg) => number) => {
  if (rows.length === 0) return 1;
  return Math.max(...rows.map((row) => valueFor(row))) || 1;
};

export default async function PlayerHubPage({
  searchParams
}: {
  searchParams?: { season?: string; type?: string };
}) {
  const seasons = await prisma.season.findMany({ orderBy: { year: 'desc' } });
  const { season, value: seasonValue, seasons: orderedSeasons } = resolveSeasonSelection(seasons, searchParams?.season);
  const typeValue = searchParams?.type ?? 'LEAGUE';
  const typeFilter = typeValue === 'all' ? undefined : (typeValue as GameType);
  const maxWeekRow = await prisma.schedule.aggregate({
    where: season ? { seasonId: season.id } : {},
    _max: { week: true }
  });
  const weekCount = Math.max(maxWeekRow._max.week ?? 7, 7);
  const gameWhere = {
    ...(season ? { seasonId: season.id } : {}),
    ...(typeFilter ? { type: typeFilter } : {})
  };
  const hasGameWhere = Object.keys(gameWhere).length > 0;

  const events = await prisma.shotEvent.findMany({
    where: {
      shooterId: { not: null },
      resultType: { notIn: ['PULL_HOME', 'PULL_AWAY'] },
      ...(hasGameWhere ? { game: gameWhere } : {})
    },
    include: { shooter: true, game: { include: { scheduleEntry: true } } },
    orderBy: { timestamp: 'desc' }
  });
  const legacyStats = await prisma.legacyPlayerStat.findMany({
    where: {
      ...(hasGameWhere ? { game: gameWhere } : {})
    },
    include: { player: true, game: { include: { scheduleEntry: true } } }
  });

  const players = new Map<string, PlayerAgg>();
  const playerGameIds = new Map<string, Set<string>>();
  const trackedGameIds = new Map<string, Set<string>>();

  for (const event of events) {
    if (!event.shooterId || !event.shooter) continue;
    const current =
      players.get(event.shooterId) ??
      {
        id: event.shooterId,
        name: event.shooter.name ?? 'Unknown',
        games: 0,
        trackedGames: 0,
        makes: 0,
        attempts: 0,
        trackedAttempts: 0,
        tops: 0,
        topIsos: 0,
        bottoms: 0,
        bottomIsos: 0,
        misses: 0,
        weightedPoints: 0,
        playerRating: 0,
        ratingPerShot: 0,
        clutchMakes: 0,
        weekMakes: new Array(weekCount).fill(0)
      };
    const eventGameId = event.gameId;
    if (eventGameId) {
      const gameSet = playerGameIds.get(event.shooterId) ?? new Set<string>();
      gameSet.add(eventGameId);
      playerGameIds.set(event.shooterId, gameSet);
      const trackedSet = trackedGameIds.get(event.shooterId) ?? new Set<string>();
      trackedSet.add(eventGameId);
      trackedGameIds.set(event.shooterId, trackedSet);
    }

    if (isShot(event.resultType as any)) {
      current.attempts += 1;
      current.trackedAttempts += 1;
      if (event.resultType === 'MISS') {
        current.misses += 1;
      }
    }

    if (isMake(event.resultType as any)) {
      const remaining =
        typeof event.remainingCupsBefore === 'number'
          ? event.remainingCupsBefore
          : typeof event.remainingCupsAfter === 'number'
            ? event.remainingCupsAfter
            : 100;
      current.makes += 1;
      if (event.resultType === 'TOP_REGULAR' || event.resultType === 'TOP_ISO') current.tops += 1;
      if (event.resultType === 'TOP_ISO') current.topIsos += 1;
      if (event.resultType === 'BOTTOM_REGULAR' || event.resultType === 'BOTTOM_ISO') current.bottoms += 1;
      if (event.resultType === 'BOTTOM_ISO') current.bottomIsos += 1;

      current.weightedPoints += weightFor(event.resultType);

      if (remaining <= 20) current.clutchMakes += 1;
      const week = event.game?.scheduleEntry?.week;
      if (week && week >= 1 && week <= weekCount) {
        current.weekMakes[week - 1] += 1;
      }
    }

    players.set(event.shooterId, current);
  }

  for (const stat of legacyStats) {
    if (!stat.playerId || !stat.player) continue;
    const current =
      players.get(stat.playerId) ??
      {
        id: stat.playerId,
        name: stat.player.name ?? 'Unknown',
        games: 0,
        trackedGames: 0,
        makes: 0,
        attempts: 0,
        trackedAttempts: 0,
        tops: 0,
        topIsos: 0,
        bottoms: 0,
        bottomIsos: 0,
        misses: 0,
        weightedPoints: 0,
        playerRating: 0,
        ratingPerShot: 0,
        clutchMakes: 0,
        weekMakes: new Array(weekCount).fill(0)
      };
    const statGameId = stat.gameId;
    if (statGameId) {
      const gameSet = playerGameIds.get(stat.playerId) ?? new Set<string>();
      gameSet.add(statGameId);
      playerGameIds.set(stat.playerId, gameSet);
    }

    const breakdown = stat.topRegular + stat.topIso + stat.bottomRegular + stat.bottomIso;
    const makes = stat.totalCups > 0 ? stat.totalCups : breakdown;
    const attempts = makes + stat.misses;

    current.makes += makes;
    current.attempts += attempts;
    current.tops += stat.topRegular + stat.topIso;
    current.topIsos += stat.topIso;
    current.bottoms += stat.bottomRegular + stat.bottomIso;
    current.bottomIsos += stat.bottomIso;
    current.misses += stat.misses;
    current.weightedPoints +=
      stat.topRegular * defaultMultipliers.top +
      stat.topIso * defaultMultipliers.topIso +
      stat.bottomRegular * defaultMultipliers.bottom +
      stat.bottomIso * defaultMultipliers.bottomIso;

    const week = stat.game?.scheduleEntry?.week;
    if (week && week >= 1 && week <= weekCount) {
      current.weekMakes[week - 1] += makes;
    }

    players.set(stat.playerId, current);
  }

  const list = Array.from(players.values());
  const ratedRows = list.filter((row) => row.attempts > 0);
  const avgAdjusted =
    ratedRows.length > 0
      ? ratedRows.reduce((sum, row) => {
          const games = playerGameIds.get(row.id)?.size ?? 0;
          return sum + (games > 0 ? row.weightedPoints / games : 0);
        }, 0) / ratedRows.length
      : 0;
  const avgFg =
    ratedRows.length > 0
      ? ratedRows.reduce((sum, row) => sum + row.makes / row.attempts, 0) / ratedRows.length
      : 0;
  list.forEach((row) => {
    const games = playerGameIds.get(row.id)?.size ?? 0;
    const trackedGames = trackedGameIds.get(row.id)?.size ?? 0;
    row.games = games;
    row.trackedGames = trackedGames;
    const adjustedFgm = games > 0 ? row.weightedPoints / games : 0;
    const fg = row.attempts ? row.makes / row.attempts : 0;
    const rating =
      row.attempts > 0 && adjustedFgm > 0 && avgAdjusted > 0 && avgFg > 0 ? adjustedFgm * fg * avgAdjusted * avgFg : 0;
    row.playerRating = rating;
    row.ratingPerShot = row.attempts > 0 ? rating / row.attempts : 0;
  });
  const topBy = (key: keyof PlayerAgg, n = 20) =>
    [...list].sort((a, b) => Number(b[key]) - Number(a[key])).slice(0, n);
  const topFG = [...list]
    .filter((p) => p.attempts >= 15)
    .sort((a, b) => b.makes / b.attempts - a.makes / a.attempts)
    .slice(0, 20);
  const topPPS = [...list]
    .filter((p) => p.attempts >= 15)
    .sort((a, b) => b.ratingPerShot - a.ratingPerShot)
    .slice(0, 20);
  const topIso = [...list]
    .sort((a, b) => b.topIsos + b.bottomIsos - (a.topIsos + a.bottomIsos))
    .slice(0, 20);
  const topClutch = topBy('clutchMakes', 10).filter((row) => row.clutchMakes > 0);

  const sections = [
    {
      title: 'Most total makes',
      subtitle: 'Raw cup makes across the season.',
      rows: topBy('makes'),
      valueFor: (row: PlayerAgg) => row.makes,
      suffix: ''
    },
    {
      title: 'Top FG%',
      subtitle: 'Minimum 15 attempts to qualify.',
      rows: topFG,
      valueFor: (row: PlayerAgg) => Number(((row.makes / row.attempts) * 100).toFixed(1)),
      suffix: '%'
    },
    {
      title: 'Top tops',
      subtitle: 'Top total (regular + ISO).',
      rows: topBy('tops'),
      valueFor: (row: PlayerAgg) => row.tops,
      suffix: ''
    },
    {
      title: 'Top bottoms',
      subtitle: 'Bottom total (regular + ISO).',
      rows: topBy('bottoms'),
      valueFor: (row: PlayerAgg) => row.bottoms,
      suffix: ''
    },
    {
      title: 'Top ISO makes',
      subtitle: 'ISO makes (top + bottom).',
      rows: topIso,
      valueFor: (row: PlayerAgg) => row.topIsos + row.bottomIsos,
      suffix: ''
    },
    {
      title: 'Top rating per shot',
      subtitle: 'Player rating per shot ((Adjusted FGM / game) × FG% scaled by league averages).',
      rows: topPPS,
      valueFor: (row: PlayerAgg) => Number((row.ratingPerShot || 0).toFixed(2)),
      suffix: ''
    }
  ];

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-garnet-600">Player hub</p>
          <h1 className="text-xl font-bold text-ink sm:text-3xl">League analytics</h1>
          <p className="hidden text-[11px] text-ash sm:block sm:text-sm">
            Compare players, spot trends, and dig into advanced stats across the entire league.
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <SeasonSelect seasons={orderedSeasons} value={seasonValue} showLabel={false} />
          <GameTypeSelect value={typeValue} showLabel={false} />
        </div>
      </div>
      <PlayerSearch players={list.map((player) => ({ id: player.id, name: player.name }))} />

      <section className="grid items-start gap-3 lg:grid-cols-2">
        {sections.map((section) => (
          <CollapsibleCard key={section.title} title={section.title} subtitle={section.subtitle}>
            <div className="space-y-2">
              {section.rows.slice(0, 20).map((row) => (
                <BarRow
                  key={row.id}
                  id={row.id}
                  label={row.name}
                  value={section.valueFor(row)}
                  max={maxFrom(section.rows, section.valueFor)}
                  suffix={section.suffix}
                >
                  <Sparkline data={row.weekMakes} />
                </BarRow>
              ))}
              {section.rows.length === 0 && <p className="text-sm text-ash">No data yet.</p>}
            </div>
          </CollapsibleCard>
        ))}
      </section>

      <section>
        <CollapsibleCard title="Clutch finishers" subtitle="Makes with 20 or fewer cups remaining (tracked only).">
          <div className="grid gap-3 md:grid-cols-2">
            {topClutch.map((row) => (
              <div key={row.id} className="rounded-xl border border-garnet-100 bg-parchment/70 px-4 py-3 text-sm">
                <p className="font-semibold text-ink">
                  <PlayerLink id={row.id} name={row.name} className="text-ink hover:text-garnet-600" />
                </p>
                <p className="text-garnet-600">
                  {row.clutchMakes} clutch makes · {row.trackedGames} tracked {row.trackedGames === 1 ? 'game' : 'games'}
                </p>
              </div>
            ))}
            {topClutch.length === 0 && <p className="text-sm text-ash">No data yet.</p>}
          </div>
        </CollapsibleCard>
      </section>
    </div>
  );
}

function CollapsibleCard({
  title,
  subtitle,
  children
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group w-full self-start overflow-hidden rounded-2xl border border-garnet-100 bg-white/85 shadow">
      <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-ink sm:px-5 sm:py-4">
        <div>
          <h2 className="text-base font-semibold text-ink sm:text-lg">{title}</h2>
          {subtitle && <p className="text-[11px] text-ash sm:text-xs">{subtitle}</p>}
        </div>
        <span className="text-xs font-semibold text-garnet-600 transition group-open:rotate-180">▾</span>
      </summary>
      <div className="border-t border-garnet-100 px-4 pb-4 pt-3 sm:px-5 sm:pb-5 sm:pt-4">{children}</div>
    </details>
  );
}

function BarRow({
  id,
  label,
  value,
  max,
  suffix,
  children
}: {
  id: string;
  label: string;
  value: number;
  max: number;
  suffix?: string;
  children?: React.ReactNode;
}) {
  const percent = max ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-garnet-100 bg-parchment/70 px-3 py-2 text-xs sm:text-sm">
      <div className="min-w-0 flex-[1.2] truncate font-semibold text-ink">
        <PlayerLink id={id} name={label} className="block truncate text-ink hover:text-garnet-600" />
      </div>
      <div className="min-w-[90px] flex-1 sm:min-w-[120px]">
        <div className="h-2 w-full overflow-hidden rounded-full bg-gold-100">
          <div className="h-full bg-garnet-500" style={{ width: `${percent}%` }} />
        </div>
      </div>
      <div className="w-12 text-right text-garnet-600 sm:w-16">
        {value}
        {suffix ?? ''}
      </div>
      <div className="hidden sm:block">{children}</div>
    </div>
  );
}
