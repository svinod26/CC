import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { defaultMultipliers, isMake } from '@/lib/stats';
import { Sparkline } from '@/components/sparkline';
import { PlayerLink } from '@/components/player-link';
import { ResultType } from '@prisma/client';

const weightFor = (resultType: ResultType) => {
  const base =
    resultType === ResultType.TOP_REGULAR
      ? defaultMultipliers.top
      : resultType === ResultType.TOP_ISO
        ? defaultMultipliers.topIso
        : resultType === ResultType.BOTTOM_ISO
          ? defaultMultipliers.bottomIso
          : defaultMultipliers.bottom;
  return base;
};

const tempoWeightFor = (remaining: number, resultType: ResultType) => {
  const base = weightFor(resultType);
  const temporal = 1 + defaultMultipliers.alpha * Math.pow(1 - remaining / 100, defaultMultipliers.p);
  return base * temporal;
};

type PlayerImpact = {
  id: string;
  name: string;
  makes: number;
  attempts: number;
  weightedPoints: number;
};

export default async function TeamPage({ params }: { params: { id: string } }) {
  const team = await prisma.team.findUnique({
    where: { id: params.id },
    include: {
      season: true,
      conference: true,
      rosters: { include: { player: true } }
    }
  });
  const playerNameById = new Map(team?.rosters.map((r) => [r.playerId, r.player.name]));

  if (!team) return notFound();

  const games = await prisma.game.findMany({
    where: { OR: [{ homeTeamId: team.id }, { awayTeamId: team.id }] },
    orderBy: { startedAt: 'desc' },
    include: {
      homeTeam: true,
      awayTeam: true,
      state: true,
      scheduleEntry: true,
      events: true,
      legacyStats: true,
      legacyTeamStats: true
    }
  });

  const pullEvents = await prisma.shotEvent.findMany({
    where: {
      resultType: { in: [ResultType.PULL_HOME, ResultType.PULL_AWAY] },
      defenseTeamId: team.id
    }
  });

  const totalPulled =
    pullEvents.reduce((sum, event) => sum + event.cupsDelta, 0) +
    games.reduce((sum, game) => {
      const legacyPull = game.legacyTeamStats.find((stat) => stat.teamId === team.id)?.pulledCups ?? 0;
      return sum + legacyPull;
    }, 0);

  const maxWeekRow = await prisma.schedule.aggregate({
    where: team?.seasonId ? { seasonId: team.seasonId } : {},
    _max: { week: true }
  });
  const weekCount = Math.max(maxWeekRow._max.week ?? 7, 7);
  const weeklyMakes = new Array(weekCount).fill(0);
  const playerImpact = new Map<string, PlayerImpact>();
  let teamTempoRating = 0;

  for (const game of games) {
    if (game.statsSource === 'LEGACY') {
      const legacyRows = game.legacyStats.filter((stat) => stat.teamId === team.id);
      const week = game.scheduleEntry?.week;
      let gameMakes = 0;

      for (const stat of legacyRows) {
        const breakdown = stat.topRegular + stat.topIso + stat.bottomRegular + stat.bottomIso;
        const makes = stat.totalCups > 0 ? stat.totalCups : breakdown;
        const attempts = makes + stat.misses;
        gameMakes += makes;

        const weightedPoints =
          stat.topRegular * defaultMultipliers.top +
          stat.topIso * defaultMultipliers.topIso +
          stat.bottomRegular * defaultMultipliers.bottom +
          stat.bottomIso * defaultMultipliers.bottomIso;

        const current = playerImpact.get(stat.playerId) ?? {
          id: stat.playerId,
          name: playerNameById.get(stat.playerId) ?? 'Unknown',
          makes: 0,
          attempts: 0,
          weightedPoints: 0
        };
        current.makes += makes;
        current.attempts += attempts;
        current.weightedPoints += weightedPoints;
        playerImpact.set(stat.playerId, current);
      }

      if (week && week >= 1 && week <= weekCount) weeklyMakes[week - 1] += gameMakes;
      continue;
    }

    const week = game.scheduleEntry?.week;
    let gameMakes = 0;
    for (const event of game.events) {
      if (event.offenseTeamId !== team.id) continue;
      if (event.resultType === ResultType.PULL_HOME || event.resultType === ResultType.PULL_AWAY) continue;
      if (isMake(event.resultType)) {
        gameMakes += 1;
      }
      if (!event.shooterId) continue;
      const current = playerImpact.get(event.shooterId) ?? {
        id: event.shooterId,
        name: playerNameById.get(event.shooterId) ?? 'Unknown',
        makes: 0,
        attempts: 0,
        weightedPoints: 0
      };
      current.attempts += 1;
      if (isMake(event.resultType)) {
        current.makes += 1;
        current.weightedPoints += weightFor(event.resultType);
        teamTempoRating += tempoWeightFor(event.remainingCupsBefore ?? 100, event.resultType);
      }
      playerImpact.set(event.shooterId, current);
    }

    if (week && week >= 1 && week <= weekCount) weeklyMakes[week - 1] += gameMakes;
  }

  const impacts = Array.from(playerImpact.values()).sort((a, b) => b.weightedPoints - a.weightedPoints);
  const topImpacts = impacts;
  const teamRating = impacts.reduce((sum, row) => sum + row.weightedPoints, 0);

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-garnet-600">Team profile</p>
          <h1 className="text-2xl font-bold text-ink sm:text-3xl">{team.name}</h1>
          <p className="text-[11px] text-ash sm:text-sm">
            {team.conference?.name ?? 'No conference'} · {team.season?.name ?? 'No season'}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/teams"
            className="rounded-full border border-garnet-200 px-4 py-2 text-sm font-semibold text-garnet-600 hover:bg-gold-100"
          >
            Team hub
          </Link>
          <Link
            href="/games/new"
            className="rounded-full bg-garnet-600 px-4 py-2 text-sm font-semibold text-sand shadow hover:bg-garnet-500"
          >
            Start game
          </Link>
        </div>
      </div>

      <section className="grid gap-3 md:grid-cols-3">
        <InfoCard label="Games played" value={games.length} />
        <InfoCard label="Total pulled cups" value={totalPulled} />
        <InfoCard label="Weeks tracked" value={weeklyMakes.filter((v) => v > 0).length} />
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <InfoCard label="Team rating" value={Number(teamRating.toFixed(2))} />
        <InfoCard
          label="Tempo rating (tracked)"
          value={teamTempoRating > 0 ? Number(teamTempoRating.toFixed(2)) : '—'}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-2xl border border-garnet-100 bg-white/85 p-4 shadow sm:p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-ink">Weekly scoring trend</h2>
            <Sparkline data={weeklyMakes} />
          </div>
          <p className="mt-2 text-xs text-ash">Total cups made per week.</p>
        </div>

        <div className="rounded-2xl border border-garnet-100 bg-white/85 p-4 shadow sm:p-5">
          <h2 className="text-lg font-semibold text-ink">Roster</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {team.rosters.map((r) => (
              <span key={r.id} className="rounded-full bg-gold-50 px-2 py-0.5 text-xs text-ink">
                <PlayerLink id={r.player.id} name={r.player.name} className="text-ink hover:text-garnet-600" />
              </span>
            ))}
            {team.rosters.length === 0 && <span className="text-xs text-ash">No roster loaded.</span>}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-garnet-100 bg-white/85 p-4 shadow sm:p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">Impact leaders</h2>
          <span className="text-xs text-ash">Adjusted FGM (base cup weights) across all games.</span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {topImpacts.map((row, idx) => (
            <div key={row.id} className="rounded-xl border border-garnet-100 bg-parchment/70 px-4 py-3 text-sm">
              <p className="text-xs uppercase tracking-wide text-ash">#{idx + 1} impact</p>
              <p className="font-semibold text-ink">
                <PlayerLink id={row.id} name={row.name} className="text-ink hover:text-garnet-600" />
              </p>
              <p className="text-garnet-600">
                {row.weightedPoints.toFixed(2)} adjusted FGM · {row.makes} cups ·{' '}
                {row.attempts ? ((row.makes / row.attempts) * 100).toFixed(1) : '0'}% FG
              </p>
            </div>
          ))}
          {topImpacts.length === 0 && <p className="text-sm text-ash">No rating data yet.</p>}
        </div>
      </section>

      <section className="rounded-2xl border border-garnet-100 bg-white/85 p-4 shadow sm:p-5">
        <h2 className="text-lg font-semibold text-ink">Recent games</h2>
        <div className="mt-4 space-y-3">
          {games.slice(0, 10).map((game) => {
            const isLegacy = game.statsSource === 'LEGACY';
            const weekLabel = game.scheduleEntry?.week ? `Week ${game.scheduleEntry.week}` : '—';
            const matchup = `${game.homeTeam?.name ?? 'Home'} vs ${game.awayTeam?.name ?? 'Away'}`;
            return (
              <div
                key={game.id}
                className="flex items-center justify-between rounded-xl border border-garnet-100 bg-parchment/70 px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-semibold text-ink">{matchup}</p>
                  <p className="text-xs text-ash">{weekLabel}</p>
                </div>
                <div className="text-right">
                  {isLegacy && (
                    <span className="rounded-full border border-gold-300 bg-gold-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-garnet-600">
                      Legacy
                    </span>
                  )}
                  <Link href={`/games/${game.id}`} className="ml-3 text-xs font-semibold text-garnet-600">
                    View game
                  </Link>
                </div>
              </div>
            );
          })}
          {games.length === 0 && <p className="text-sm text-ash">No games logged yet.</p>}
        </div>
      </section>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-garnet-100 bg-white/85 p-3 shadow sm:p-4">
      <p className="text-[10px] uppercase tracking-wide text-ash sm:text-xs">{label}</p>
      <p className="text-lg font-bold text-garnet-600 sm:text-2xl">{value}</p>
    </div>
  );
}
