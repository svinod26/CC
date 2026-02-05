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
  makes: number;
  attempts: number;
  trackedAttempts: number;
  tops: number;
  topIsos: number;
  bottoms: number;
  bottomIsos: number;
  misses: number;
  weightedPoints: number;
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

  const events = await prisma.shotEvent.findMany({
    where: {
      shooterId: { not: null },
      resultType: { notIn: ['PULL_HOME', 'PULL_AWAY'] },
      ...(season ? { game: { seasonId: season.id } } : {}),
      ...(typeFilter ? { game: { type: typeFilter } } : {})
    },
    include: { shooter: true, game: { include: { scheduleEntry: true } } },
    orderBy: { timestamp: 'desc' }
  });
  const legacyStats = await prisma.legacyPlayerStat.findMany({
    where: {
      ...(season ? { game: { seasonId: season.id } } : {}),
      ...(typeFilter ? { game: { type: typeFilter } } : {})
    },
    include: { player: true, game: { include: { scheduleEntry: true } } }
  });

  const players = new Map<string, PlayerAgg>();

  for (const event of events) {
    if (!event.shooterId || !event.shooter) continue;
    const current =
      players.get(event.shooterId) ??
      {
        id: event.shooterId,
        name: event.shooter.name ?? 'Unknown',
        makes: 0,
        attempts: 0,
        trackedAttempts: 0,
        tops: 0,
        topIsos: 0,
        bottoms: 0,
        bottomIsos: 0,
        misses: 0,
        weightedPoints: 0,
        clutchMakes: 0,
        weekMakes: new Array(weekCount).fill(0)
      };

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
        makes: 0,
        attempts: 0,
        trackedAttempts: 0,
        tops: 0,
        topIsos: 0,
        bottoms: 0,
        bottomIsos: 0,
        misses: 0,
        weightedPoints: 0,
        clutchMakes: 0,
        weekMakes: new Array(weekCount).fill(0)
      };

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
  const topBy = (key: keyof PlayerAgg, n = 20) =>
    [...list].sort((a, b) => Number(b[key]) - Number(a[key])).slice(0, n);
  const topFG = [...list]
    .filter((p) => p.attempts >= 15)
    .sort((a, b) => b.makes / b.attempts - a.makes / a.attempts)
    .slice(0, 20);
  const topPPS = [...list]
    .filter((p) => p.attempts >= 15)
    .sort((a, b) => b.weightedPoints / b.attempts - a.weightedPoints / a.attempts)
    .slice(0, 20);
  const topIso = [...list]
    .sort((a, b) => b.topIsos + b.bottomIsos - (a.topIsos + a.bottomIsos))
    .slice(0, 20);

  const sections = [
    {
      title: 'Top total makes',
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
      subtitle: 'Player rating per shot (legacy uses base weights).',
      rows: topPPS,
      valueFor: (row: PlayerAgg) =>
        Number(((row.weightedPoints / (row.attempts || 1)) || 0).toFixed(2)),
      suffix: ''
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-wide text-garnet-600">Player hub</p>
          <h1 className="text-3xl font-bold text-ink">League analytics</h1>
          <p className="text-sm text-ash">
            Compare players, spot trends, and dig into advanced stats across the entire league.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <SeasonSelect seasons={orderedSeasons} value={seasonValue} />
          <GameTypeSelect value={typeValue} />
        </div>
      </div>
      <PlayerSearch players={list.map((player) => ({ id: player.id, name: player.name }))} />

      <section className="grid items-start gap-4 lg:grid-cols-2">
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
            {topBy('clutchMakes', 10).map((row) => (
              <div key={row.id} className="rounded-xl border border-garnet-100 bg-parchment/70 px-4 py-3 text-sm">
                <p className="font-semibold text-ink">
                  <PlayerLink id={row.id} name={row.name} className="text-ink hover:text-garnet-600" />
                </p>
                <p className="text-garnet-600">{row.clutchMakes} clutch makes</p>
              </div>
            ))}
            {topBy('clutchMakes', 10).length === 0 && <p className="text-sm text-ash">No data yet.</p>}
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
    <details className="group self-start rounded-2xl border border-garnet-100 bg-white/85 shadow">
      <summary className="flex cursor-pointer items-center justify-between px-5 py-4 text-ink">
        <div>
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          {subtitle && <p className="text-xs text-ash">{subtitle}</p>}
        </div>
        <span className="text-xs font-semibold text-garnet-600 transition group-open:rotate-180">▾</span>
      </summary>
      <div className="border-t border-garnet-100 px-5 pb-5 pt-4">{children}</div>
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
    <div className="flex items-center gap-3 rounded-lg border border-garnet-100 bg-parchment/70 px-3 py-2 text-sm">
      <div className="w-36 truncate font-semibold text-ink">
        <PlayerLink id={id} name={label} className="text-ink hover:text-garnet-600" />
      </div>
      <div className="flex-1">
        <div className="h-2 w-full overflow-hidden rounded-full bg-gold-100">
          <div className="h-full bg-garnet-500" style={{ width: `${percent}%` }} />
        </div>
      </div>
      <div className="w-16 text-right text-garnet-600">
        {value}
        {suffix ?? ''}
      </div>
      {children}
    </div>
  );
}
