import { prisma } from '@/lib/prisma';
import { defaultMultipliers, isMake, isShot } from '@/lib/stats';
import { Sparkline } from '@/components/sparkline';
import { PlayerLink } from '@/components/player-link';
import { ResultType, GameType } from '@prisma/client';
import { resolveSeasonSelection } from '@/lib/season';
import { SeasonSelect } from '@/components/season-select';
import { GameTypeSelect } from '@/components/game-type-select';

export const metadata = {
  title: 'Compare Players | Century Cup'
};

type SearchParams = {
  a?: string;
  b?: string;
  mode?: string;
  week?: string;
  season?: string;
  type?: string;
};

type PlayerStat = {
  id: string;
  name: string;
  makes: number;
  attempts: number;
  trackedAttempts: number;
  trackedMakes: number;
  topRegular: number;
  topIsos: number;
  bottomRegular: number;
  bottomIsos: number;
  clutchMakes: number;
  playerRating: number;
  tempoRating: number;
  weekMakes: number[];
};

const tempoWeightFor = (remaining: number, resultType: string) => {
  const base =
    resultType === 'TOP_REGULAR'
      ? defaultMultipliers.top
      : resultType === 'TOP_ISO'
        ? defaultMultipliers.topIso
        : resultType === 'BOTTOM_ISO'
          ? defaultMultipliers.bottomIso
          : defaultMultipliers.bottom;
  const temporal = 1 + defaultMultipliers.alpha * Math.pow(1 - remaining / 100, defaultMultipliers.p);
  return base * temporal;
};

const baseWeightFor = (resultType: string) => {
  return resultType === 'TOP_REGULAR'
    ? defaultMultipliers.top
    : resultType === 'TOP_ISO'
      ? defaultMultipliers.topIso
      : resultType === 'BOTTOM_ISO'
        ? defaultMultipliers.bottomIso
        : defaultMultipliers.bottom;
};

const buildEmpty = (id: string, name: string, weekCount: number): PlayerStat => ({
  id,
  name,
  makes: 0,
  attempts: 0,
  trackedAttempts: 0,
  trackedMakes: 0,
  topRegular: 0,
  topIsos: 0,
  bottomRegular: 0,
  bottomIsos: 0,
  clutchMakes: 0,
  playerRating: 0,
  tempoRating: 0,
  weekMakes: new Array(weekCount).fill(0)
});

export default async function PlayerComparePage({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const seasons = await prisma.season.findMany({ orderBy: { year: 'desc' } });
  const { season, value: seasonValue, seasons: orderedSeasons } = resolveSeasonSelection(seasons, searchParams.season);
  const typeValue = searchParams.type ?? 'LEAGUE';
  const typeFilter = typeValue === 'all' ? undefined : (typeValue as GameType);
  const maxWeekRow = await prisma.schedule.aggregate({
    where: season ? { seasonId: season.id } : {},
    _max: { week: true }
  });
  const weekCount = Math.max(maxWeekRow._max.week ?? 7, 7);
  const players = await prisma.player.findMany({ orderBy: { name: 'asc' } });
  const selectedIds = [searchParams.a, searchParams.b].filter((id): id is string => Boolean(id));

  const latestWeekEntry =
    typeFilter === GameType.EXHIBITION
      ? null
      : await prisma.schedule.findFirst({
          where: {
            ...(season ? { seasonId: season.id } : {}),
            game: {
              ...(typeFilter ? { type: typeFilter } : {}),
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
  const latestWeek = latestWeekEntry?.week ?? null;
  const mode = searchParams.mode ?? 'overall';
  const selectedWeek =
    mode === 'latest' ? latestWeek : mode === 'week' ? Number(searchParams.week ?? 0) || null : null;

  const gameWhere = {
    ...(season ? { seasonId: season.id } : {}),
    ...(typeFilter ? { type: typeFilter } : {}),
    ...(selectedWeek ? { scheduleEntry: { week: selectedWeek } } : {})
  };

  const events = selectedIds.length
    ? await prisma.shotEvent.findMany({
        where: {
          shooterId: { in: selectedIds },
          resultType: { notIn: [ResultType.PULL_HOME, ResultType.PULL_AWAY] },
          ...(Object.keys(gameWhere).length ? { game: gameWhere } : {})
        },
        include: { shooter: true, game: { include: { scheduleEntry: true } } },
        orderBy: { timestamp: 'asc' }
      })
    : [];

  const legacyStats = selectedIds.length
    ? await prisma.legacyPlayerStat.findMany({
        where: {
          playerId: { in: selectedIds },
          ...(Object.keys(gameWhere).length ? { game: gameWhere } : {})
        },
        include: { player: true, game: { include: { scheduleEntry: true } } }
      })
    : [];

  const stats = new Map<string, PlayerStat>();
  for (const id of selectedIds) {
    const player = players.find((p) => p.id === id);
    if (player) stats.set(id, buildEmpty(player.id, player.name, weekCount));
  }

  for (const event of events) {
    if (!event.shooterId || !event.shooter) continue;
    const current =
      stats.get(event.shooterId) ?? buildEmpty(event.shooterId, event.shooter.name ?? 'Unknown', weekCount);

    if (isShot(event.resultType as any)) {
      current.attempts += 1;
      current.trackedAttempts += 1;
    }

    if (isMake(event.resultType as any)) {
      current.makes += 1;
      current.trackedMakes += 1;
      if (event.resultType === 'TOP_REGULAR') current.topRegular += 1;
      if (event.resultType === 'TOP_ISO') current.topIsos += 1;
      if (event.resultType === 'BOTTOM_REGULAR') current.bottomRegular += 1;
      if (event.resultType === 'BOTTOM_ISO') current.bottomIsos += 1;

      const remaining = event.remainingCupsBefore ?? 100;
      current.playerRating += baseWeightFor(event.resultType);
      current.tempoRating += tempoWeightFor(remaining, event.resultType);
      if (remaining <= 20) current.clutchMakes += 1;

      const week = event.game?.scheduleEntry?.week;
      if (week && week >= 1 && week <= weekCount) current.weekMakes[week - 1] += 1;
    }

    stats.set(event.shooterId, current);
  }

  for (const stat of legacyStats) {
    if (!stat.playerId || !stat.player) continue;
    const current =
      stats.get(stat.playerId) ?? buildEmpty(stat.playerId, stat.player.name ?? 'Unknown', weekCount);
    const breakdown = stat.topRegular + stat.topIso + stat.bottomRegular + stat.bottomIso;
    const makes = stat.totalCups > 0 ? stat.totalCups : breakdown;
    const attempts = makes + stat.misses;
    current.makes += makes;
    current.attempts += attempts;
    current.topRegular += stat.topRegular;
    current.topIsos += stat.topIso;
    current.bottomRegular += stat.bottomRegular;
    current.bottomIsos += stat.bottomIso;
    current.playerRating +=
      stat.topRegular * defaultMultipliers.top +
      stat.topIso * defaultMultipliers.topIso +
      stat.bottomRegular * defaultMultipliers.bottom +
      stat.bottomIso * defaultMultipliers.bottomIso;
    const week = stat.game?.scheduleEntry?.week;
    if (week && week >= 1 && week <= weekCount) current.weekMakes[week - 1] += makes;
    stats.set(stat.playerId, current);
  }

  const selected = selectedIds.map((id) => stats.get(id)).filter((row): row is PlayerStat => Boolean(row));
  const comparePair = selected.length === 2 ? ([selected[0], selected[1]] as const) : null;

  const compareLabel =
    mode === 'latest'
      ? `Latest week (Week ${latestWeek ?? '—'})`
      : selectedWeek
        ? `Week ${selectedWeek}`
        : 'Overall season';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-wide text-garnet-600">Player comparison</p>
          <h1 className="text-3xl font-bold text-ink">Head-to-head insights</h1>
          <p className="text-sm text-ash">Choose players and a time window to compare styles, volume, and efficiency.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <SeasonSelect seasons={orderedSeasons} value={seasonValue} />
          <GameTypeSelect value={typeValue} />
        </div>
      </div>

      <form className="grid gap-4 rounded-2xl border border-garnet-100 bg-white/85 p-5 shadow md:grid-cols-4" method="get">
        <input type="hidden" name="season" value={seasonValue} />
        <input type="hidden" name="type" value={typeValue} />
        <label className="text-xs font-semibold uppercase tracking-wide text-ash">
          Player A
          <select name="a" className="mt-2 w-full" defaultValue={searchParams.a ?? ''}>
            <option value="">Select player</option>
            {players.map((player) => (
              <option key={player.id} value={player.id}>
                {player.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold uppercase tracking-wide text-ash">
          Player B
          <select name="b" className="mt-2 w-full" defaultValue={searchParams.b ?? ''}>
            <option value="">Select player</option>
            {players.map((player) => (
              <option key={player.id} value={player.id}>
                {player.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold uppercase tracking-wide text-ash">
          Mode
          <select name="mode" className="mt-2 w-full" defaultValue={searchParams.mode ?? 'overall'}>
            <option value="overall">Overall season</option>
            <option value="latest">Latest week</option>
            <option value="week">Pick a week</option>
          </select>
        </label>
        <label className="text-xs font-semibold uppercase tracking-wide text-ash">
          Week
          <select name="week" className="mt-2 w-full" defaultValue={searchParams.week ?? ''}>
            <option value="">—</option>
            {Array.from({ length: weekCount }, (_, idx) => idx + 1).map((week) => (
              <option key={week} value={week}>
                Week {week}
              </option>
            ))}
          </select>
        </label>
        <div className="md:col-span-4">
          <button className="rounded-full bg-garnet-600 px-5 py-3 text-sm font-semibold text-sand shadow hover:bg-garnet-500">
            Compare players
          </button>
        </div>
      </form>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-ink">Comparison snapshot</h2>
          <span className="text-xs uppercase tracking-wide text-garnet-600">
            {compareLabel} · {season ? season.name : 'All seasons'}
          </span>
        </div>
        {selected.length === 0 && <p className="text-sm text-ash">Pick two players to see the comparison.</p>}
        {selected.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2">
            {selected.map((row) => {
              const totalMakes = row.topRegular + row.topIsos + row.bottomRegular + row.bottomIsos;
              const fg = row.attempts ? (totalMakes / row.attempts) * 100 : 0;
              return (
              <div key={row.id} className="rounded-2xl border border-garnet-100 bg-white/85 p-5 shadow">
                <div className="flex items-center justify-between">
                  <div>
                    <PlayerLink id={row.id} name={row.name} className="text-lg font-semibold text-ink hover:text-garnet-600" />
                    <p className="text-xs text-ash">{compareLabel}</p>
                  </div>
                  <Sparkline data={row.weekMakes} />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <StatTile label="Total cups" value={totalMakes} />
                  <StatTile label="FG%" value={row.attempts ? fg.toFixed(1) : '0'} />
                  <StatTile label="Player rating" value={row.playerRating.toFixed(2)} />
                  <StatTile label="Rating / shot" value={row.attempts ? (row.playerRating / row.attempts).toFixed(2) : '—'} />
                  <StatTile label="Tempo rating (tracked)" value={row.trackedAttempts ? row.tempoRating.toFixed(2) : '—'} />
                  <StatTile label="Tempo / shot (tracked)" value={row.trackedAttempts ? (row.tempoRating / row.trackedAttempts).toFixed(2) : '—'} />
                </div>
                <div className="mt-4">
                  <p className="text-xs uppercase tracking-wide text-ash">Shot profile</p>
                  <div className="mt-2 grid gap-2">
                    <SplitBar label="Top total" value={row.topRegular + row.topIsos} total={totalMakes} />
                    <SplitBar label="Bottom total" value={row.bottomRegular + row.bottomIsos} total={totalMakes} />
                    <SplitBar label="Clutch share (tracked)" value={row.clutchMakes} total={row.trackedMakes} />
                  </div>
                </div>
              </div>
            );
            })}
          </div>
        )}
      </section>

      {comparePair && (
        <section className="rounded-2xl border border-garnet-100 bg-white/85 p-5 shadow">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-ink">Visual matchup</h2>
              <p className="text-xs text-ash">Side-by-side bars for volume, efficiency, and rating.</p>
            </div>
            <span className="text-xs uppercase tracking-wide text-garnet-600">{compareLabel}</span>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
            <div className="space-y-3 rounded-xl border border-garnet-100 bg-parchment/60 p-4">
              <MetricBar
                label="Total cups"
                a={comparePair[0].topRegular + comparePair[0].topIsos + comparePair[0].bottomRegular + comparePair[0].bottomIsos}
                b={comparePair[1].topRegular + comparePair[1].topIsos + comparePair[1].bottomRegular + comparePair[1].bottomIsos}
                aLabel={comparePair[0].name}
                bLabel={comparePair[1].name}
                format={(value) => Math.round(value).toString()}
              />
              <MetricBar
                label="Player rating"
                a={comparePair[0].playerRating}
                b={comparePair[1].playerRating}
                aLabel={comparePair[0].name}
                bLabel={comparePair[1].name}
                format={(value) => value.toFixed(2)}
              />
              <MetricBar
                label="FG%"
                a={comparePair[0].attempts ? ((comparePair[0].topRegular + comparePair[0].topIsos + comparePair[0].bottomRegular + comparePair[0].bottomIsos) / comparePair[0].attempts) * 100 : 0}
                b={comparePair[1].attempts ? ((comparePair[1].topRegular + comparePair[1].topIsos + comparePair[1].bottomRegular + comparePair[1].bottomIsos) / comparePair[1].attempts) * 100 : 0}
                aLabel={comparePair[0].name}
                bLabel={comparePair[1].name}
                suffix="%"
              />
              <MetricBar
                label="Tempo rating / shot (tracked)"
                a={comparePair[0].trackedAttempts ? comparePair[0].tempoRating / comparePair[0].trackedAttempts : 0}
                b={comparePair[1].trackedAttempts ? comparePair[1].tempoRating / comparePair[1].trackedAttempts : 0}
                aLabel={comparePair[0].name}
                bLabel={comparePair[1].name}
                format={(value) => value.toFixed(2)}
              />
              <MetricBar
                label="Clutch makes (tracked)"
                a={comparePair[0].clutchMakes}
                b={comparePair[1].clutchMakes}
                aLabel={comparePair[0].name}
                bLabel={comparePair[1].name}
                format={(value) => Math.round(value).toString()}
              />
            </div>
            <div className="rounded-xl border border-garnet-100 bg-white/80 p-4">
              <p className="text-xs uppercase tracking-wide text-ash">Weekly scoring trend</p>
              <WeeklyBars a={comparePair[0]} b={comparePair[1]} />
            </div>
          </div>
        </section>
      )}

    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-garnet-100 bg-parchment/70 px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-ash">{label}</p>
      <p className="text-lg font-semibold text-garnet-600">{value}</p>
    </div>
  );
}

function SplitBar({ label, value, total }: { label: string; value: number; total: number }) {
  const percent = total ? Math.min((value / total) * 100, 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-ash">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-gold-100">
        <div className="h-full bg-garnet-500" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function MetricBar({
  label,
  a,
  b,
  aLabel,
  bLabel,
  suffix = '',
  format = (value: number) => value.toFixed(1)
}: {
  label: string;
  a: number;
  b: number;
  aLabel: string;
  bLabel: string;
  suffix?: string;
  format?: (value: number) => string;
}) {
  const max = Math.max(a, b, 1);
  const aPct = Math.round((a / max) * 100);
  const bPct = Math.round((b / max) * 100);
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-ash">
        <span>{label}</span>
        <span>
          {format(a)}
          {suffix} vs {format(b)}
          {suffix}
        </span>
      </div>
      <div className="mt-2 space-y-2">
        <div className="flex items-center gap-3">
          <span className="w-24 text-xs font-semibold text-ink">{aLabel}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-gold-100">
            <div className="h-full bg-garnet-500" style={{ width: `${aPct}%` }} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="w-24 text-xs font-semibold text-ink">{bLabel}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-gold-100">
            <div className="h-full bg-emerald-500" style={{ width: `${bPct}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function WeeklyBars({ a, b }: { a: PlayerStat; b: PlayerStat }) {
  const max = Math.max(...a.weekMakes, ...b.weekMakes, 1);
  return (
    <div className="mt-3 grid grid-cols-7 gap-2 text-[10px] text-ash">
      {a.weekMakes.map((_, idx) => {
        const aVal = a.weekMakes[idx];
        const bVal = b.weekMakes[idx];
        const aPct = Math.round((aVal / max) * 100);
        const bPct = Math.round((bVal / max) * 100);
        return (
          <div key={idx} className="flex flex-col items-center gap-2">
            <div className="flex h-20 w-full items-end justify-center gap-1">
              <div className="w-2 rounded-full bg-garnet-500/80" style={{ height: `${aPct}%` }} />
              <div className="w-2 rounded-full bg-emerald-500/80" style={{ height: `${bPct}%` }} />
            </div>
            <span>W{idx + 1}</span>
          </div>
        );
      })}
    </div>
  );
}
