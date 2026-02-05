import { prisma } from '@/lib/prisma';
import { ResultType } from '@prisma/client';
import { isMake, isShot, winnerFromRemaining } from '@/lib/stats';
import { TeamCard } from '@/components/team-card';
import { resolveSeasonSelection } from '@/lib/season';
import { SeasonSelect } from '@/components/season-select';

export const metadata = {
  title: 'Teams | Century Cup'
};

type TeamAgg = {
  id: string;
  name: string;
  conference?: string;
  wins: number;
  losses: number;
  games: number;
  margin: number;
  makes: number;
  attempts: number;
  trackedAttempts: number;
  tops: number;
  bottoms: number;
  topIsos: number;
  bottomIsos: number;
  clutchMakes: number;
  pulledCups: number;
  weekMakes: number[];
};

const maxFrom = (rows: TeamAgg[], valueFor: (row: TeamAgg) => number) => {
  if (rows.length === 0) return 1;
  return Math.max(...rows.map((row) => valueFor(row))) || 1;
};

export default async function TeamsPage({
  searchParams
}: {
  searchParams?: { season?: string };
}) {
  const seasons = await prisma.season.findMany({ orderBy: { year: 'desc' } });
  const seasonParam = searchParams?.season === 'all' ? undefined : searchParams?.season;
  const { season, value: seasonValue, seasons: orderedSeasons } = resolveSeasonSelection(seasons, seasonParam);
  const maxWeekRow = await prisma.schedule.aggregate({
    where: season ? { seasonId: season.id } : {},
    _max: { week: true }
  });
  const weekCount = Math.max(maxWeekRow._max.week ?? 7, 7);

  const teams = await prisma.team.findMany({
    where: season ? { seasonId: season.id } : {},
    orderBy: { name: 'asc' },
    include: {
      season: true,
      conference: true,
      rosters: { include: { player: true } }
    }
  });

  const games = await prisma.game.findMany({
    where: season ? { seasonId: season.id } : {},
    include: { homeTeam: true, awayTeam: true, state: true, scheduleEntry: true }
  });

  const events = await prisma.shotEvent.findMany({
    where: {
      resultType: { notIn: [ResultType.PULL_HOME, ResultType.PULL_AWAY] },
      ...(season ? { game: { seasonId: season.id } } : {})
    },
    include: { game: { include: { scheduleEntry: true } } }
  });
  const pullEvents = await prisma.shotEvent.findMany({
    where: {
      resultType: { in: [ResultType.PULL_HOME, ResultType.PULL_AWAY] },
      ...(season ? { game: { seasonId: season.id } } : {})
    }
  });
  const legacyTeamStats = await prisma.legacyTeamStat.findMany({
    where: season ? { game: { seasonId: season.id } } : {}
  });
  const legacyStats = await prisma.legacyPlayerStat.findMany({
    where: season ? { game: { seasonId: season.id } } : {},
    include: { game: { include: { scheduleEntry: true } } }
  });

  const teamStats = new Map<string, TeamAgg>();
  teams.forEach((team) => {
    teamStats.set(team.id, {
      id: team.id,
      name: team.name,
      conference: team.conference?.name ?? undefined,
      wins: 0,
      losses: 0,
      games: 0,
      margin: 0,
      makes: 0,
      attempts: 0,
      trackedAttempts: 0,
      tops: 0,
      bottoms: 0,
      topIsos: 0,
      bottomIsos: 0,
      clutchMakes: 0,
      pulledCups: 0,
      weekMakes: new Array(weekCount).fill(0)
    });
  });

  for (const game of games) {
    if (game.status !== 'FINAL' || !game.state || !game.homeTeamId || !game.awayTeamId) continue;
    const home = teamStats.get(game.homeTeamId);
    const away = teamStats.get(game.awayTeamId);
    if (!home || !away) continue;
    home.games += 1;
    away.games += 1;
    const homeRemaining = game.state.homeCupsRemaining;
    const awayRemaining = game.state.awayCupsRemaining;
    const margin = awayRemaining - homeRemaining;
    home.margin += margin;
    away.margin -= margin;
    const winner = winnerFromRemaining(homeRemaining, awayRemaining, game.statsSource);
    if (winner === 'home') {
      home.wins += 1;
      away.losses += 1;
    } else if (winner === 'away') {
      away.wins += 1;
      home.losses += 1;
    }
  }

  for (const event of events) {
    if (!event.offenseTeamId) continue;
    const current = teamStats.get(event.offenseTeamId);
    if (!current) continue;

    if (isShot(event.resultType)) {
      current.attempts += 1;
      current.trackedAttempts += 1;
    }

    if (isMake(event.resultType)) {
      current.makes += 1;
      if (event.resultType === ResultType.TOP_REGULAR || event.resultType === ResultType.TOP_ISO) current.tops += 1;
      if (event.resultType === ResultType.TOP_ISO) current.topIsos += 1;
      if (event.resultType === ResultType.BOTTOM_REGULAR || event.resultType === ResultType.BOTTOM_ISO) current.bottoms += 1;
      if (event.resultType === ResultType.BOTTOM_ISO) current.bottomIsos += 1;

      if ((event.remainingCupsBefore ?? 100) <= 20) current.clutchMakes += 1;

      const week = event.game?.scheduleEntry?.week;
      if (week && week >= 1 && week <= weekCount) current.weekMakes[week - 1] += 1;
    }

    teamStats.set(event.offenseTeamId, current);
  }

  for (const event of pullEvents) {
    const pulledTeamId = event.defenseTeamId;
    if (!pulledTeamId) continue;
    const current = teamStats.get(pulledTeamId);
    if (!current) continue;
    current.pulledCups += event.cupsDelta;
    teamStats.set(pulledTeamId, current);
  }

  for (const stat of legacyTeamStats) {
    if (!stat.teamId) continue;
    const current = teamStats.get(stat.teamId);
    if (!current) continue;
    current.pulledCups += stat.pulledCups;
    teamStats.set(stat.teamId, current);
  }

  for (const stat of legacyStats) {
    if (!stat.teamId) continue;
    const current = teamStats.get(stat.teamId);
    if (!current) continue;
    const breakdown = stat.topRegular + stat.topIso + stat.bottomRegular + stat.bottomIso;
    const makes = stat.totalCups > 0 ? stat.totalCups : breakdown;
    const attempts = makes + stat.misses;

    current.makes += makes;
    current.attempts += attempts;
    current.tops += stat.topRegular + stat.topIso;
    current.topIsos += stat.topIso;
    current.bottoms += stat.bottomRegular + stat.bottomIso;
    current.bottomIsos += stat.bottomIso;

    const week = stat.game?.scheduleEntry?.week;
    if (week && week >= 1 && week <= weekCount) current.weekMakes[week - 1] += makes;

    teamStats.set(stat.teamId, current);
  }

  const list = Array.from(teamStats.values());
  const topBy = (key: keyof TeamAgg, n = 10) =>
    [...list].sort((a, b) => Number(b[key]) - Number(a[key])).slice(0, n);
  const topFG = [...list]
    .filter((team) => team.attempts >= 30)
    .sort((a, b) => b.makes / b.attempts - a.makes / a.attempts)
    .slice(0, 10);
  const topIso = [...list]
    .sort((a, b) => b.topIsos + b.bottomIsos - (a.topIsos + a.bottomIsos))
    .slice(0, 10);
  const topMargin = [...list].sort((a, b) => b.margin - a.margin).slice(0, 10);
  const topClutch = topBy('clutchMakes');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-wide text-garnet-600">Team hub</p>
          <h1 className="text-2xl font-bold text-ink">League squads</h1>
          <p className="text-sm text-ash">Roster depth, team form, and where each squad is thriving.</p>
        </div>
        <SeasonSelect seasons={orderedSeasons} value={seasonValue} allowAll={false} />
      </div>

      <section className="grid gap-4 md:grid-cols-2">
        {teams.map((team) => {
          const stats = teamStats.get(team.id);
          const fg = stats?.attempts ? ((stats.makes / stats.attempts) * 100).toFixed(1) : '0.0';
          return (
            <TeamCard
              key={team.id}
              teamId={team.id}
              name={team.name}
              conference={team.conference?.name ?? 'No conference'}
              season={team.season?.name ?? 'No season'}
              wins={stats?.wins ?? 0}
              losses={stats?.losses ?? 0}
              margin={stats?.margin ?? 0}
              fg={fg}
              clutch={stats?.clutchMakes ?? 0}
              pulled={stats?.pulledCups ?? 0}
              weekly={stats?.weekMakes ?? []}
              roster={team.rosters.map((r) => ({ id: r.player.id, name: r.player.name }))}
            />
          );
        })}
        {teams.length === 0 && <p className="text-sm text-ash">No teams yet. Import from Excel.</p>}
      </section>

      <section className="grid items-start gap-4 lg:grid-cols-2">
        <CollapsibleCard title="Top margin" subtitle="Total margin across finalized games.">
          {topMargin.length === 0 && <p className="text-sm text-ash">No data yet.</p>}
          {topMargin.map((row) => (
            <BarRow
              key={row.id}
              label={row.name}
              value={row.margin}
              max={maxFrom(list, (t) => Math.abs(t.margin))}
              signed
            />
          ))}
        </CollapsibleCard>
        <CollapsibleCard title="Best FG%" subtitle="Minimum 30 attempts to qualify.">
          {topFG.length === 0 && <p className="text-sm text-ash">No data yet.</p>}
          {topFG.map((row) => (
            <BarRow
              key={row.id}
              label={row.name}
              value={Number(((row.makes / row.attempts) * 100).toFixed(1))}
              max={100}
              suffix="%"
            />
          ))}
        </CollapsibleCard>
      </section>

      <section className="grid items-start gap-4 lg:grid-cols-2">
        <CollapsibleCard title="Top ISO volume" subtitle="ISO makes (top + bottom).">
          {topIso.length === 0 && <p className="text-sm text-ash">No data yet.</p>}
          {topIso.map((row) => (
            <BarRow
              key={row.id}
              label={row.name}
              value={row.topIsos + row.bottomIsos}
              max={maxFrom(list, (t) => t.topIsos + t.bottomIsos)}
            />
          ))}
        </CollapsibleCard>
        <CollapsibleCard title="Clutch teams" subtitle="Makes with 20 or fewer cups remaining (tracked only).">
          {topClutch.length === 0 && <p className="text-sm text-ash">No data yet.</p>}
          {topClutch.map((row) => (
            <BarRow
              key={row.id}
              label={row.name}
              value={row.clutchMakes}
              max={maxFrom(list, (t) => t.clutchMakes)}
            />
          ))}
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
      <div className="space-y-2 border-t border-garnet-100 px-5 pb-5 pt-4">{children}</div>
    </details>
  );
}

function BarRow({
  label,
  value,
  max,
  suffix,
  signed
}: {
  label: string;
  value: number;
  max: number;
  suffix?: string;
  signed?: boolean;
}) {
  const percent = max ? Math.min((Math.abs(value) / max) * 100, 100) : 0;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-garnet-100 bg-parchment/70 px-3 py-2 text-sm">
      <div className="w-36 truncate font-semibold text-ink">{label}</div>
      <div className="flex-1">
        <div className="h-2 w-full overflow-hidden rounded-full bg-gold-100">
          <div className="h-full bg-garnet-500" style={{ width: `${percent}%` }} />
        </div>
      </div>
      <div className="w-16 text-right text-garnet-600">
        {signed && value > 0 ? '+' : ''}
        {value}
        {suffix ?? ''}
      </div>
    </div>
  );
}
