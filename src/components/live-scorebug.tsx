'use client';

import useSWR from 'swr';
import { ResultType, StatsSource } from '@prisma/client';
import { winnerFromRemaining } from '@/lib/stats';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type LiveGame = {
  id: string;
  statsSource: StatsSource;
  homeTeam: { id: string; name: string } | null;
  awayTeam: { id: string; name: string } | null;
  state: { homeCupsRemaining: number; awayCupsRemaining: number } | null;
  events: { resultType: ResultType; cupsDelta: number; offenseTeamId?: string | null }[];
  legacyTeamStats?: { teamId: string | null; pulledCups: number }[];
};

const makeResultTypes = new Set<ResultType>([
  ResultType.TOP_REGULAR,
  ResultType.TOP_ISO,
  ResultType.BOTTOM_REGULAR,
  ResultType.BOTTOM_ISO
]);

export function LiveScorebug({ gameId, initialData }: { gameId: string; initialData: LiveGame }) {
  const { data } = useSWR<LiveGame>(`/api/games/${gameId}/state`, fetcher, {
    fallbackData: initialData,
    refreshInterval: 1200
  });

  if (!data) return null;

  const homeRemaining = data.state?.homeCupsRemaining ?? 100;
  const awayRemaining = data.state?.awayCupsRemaining ?? 100;
  const trackedMakesByTeam = data.events.reduce(
    (acc, event) => {
      if (!makeResultTypes.has(event.resultType) || !event.offenseTeamId) return acc;
      if (event.offenseTeamId === data.homeTeam?.id) acc.home += 1;
      if (event.offenseTeamId === data.awayTeam?.id) acc.away += 1;
      return acc;
    },
    { home: 0, away: 0 }
  );
  const hasOffenseScopedMakes = trackedMakesByTeam.home + trackedMakesByTeam.away > 0;
  const homeMade =
    data.statsSource === StatsSource.TRACKED && hasOffenseScopedMakes
      ? trackedMakesByTeam.home
      : Math.max(0, 100 - awayRemaining);
  const awayMade =
    data.statsSource === StatsSource.TRACKED && hasOffenseScopedMakes
      ? trackedMakesByTeam.away
      : Math.max(0, 100 - homeRemaining);
  const winner = winnerFromRemaining(homeRemaining, awayRemaining, data.statsSource);

  const pulledHome = data.statsSource === 'LEGACY'
    ? data.legacyTeamStats?.find((stat) => stat.teamId === data.homeTeam?.id)?.pulledCups ?? 0
    : Math.max(
        0,
        data.events
          .filter((event) => event.resultType === ResultType.PULL_HOME)
          .reduce((sum, event) => sum + event.cupsDelta, 0)
      );

  const pulledAway = data.statsSource === 'LEGACY'
    ? data.legacyTeamStats?.find((stat) => stat.teamId === data.awayTeam?.id)?.pulledCups ?? 0
    : Math.max(
        0,
        data.events
          .filter((event) => event.resultType === ResultType.PULL_AWAY)
          .reduce((sum, event) => sum + event.cupsDelta, 0)
      );

  return (
    <div className="flex flex-wrap gap-3">
      <TeamScoreCard
        label={data.homeTeam?.name ?? 'Home'}
        made={homeMade}
        remaining={homeRemaining}
        pulled={pulledHome}
        result={winner === 'home' ? 'W' : winner === 'away' ? 'L' : ''}
      />
      <TeamScoreCard
        label={data.awayTeam?.name ?? 'Away'}
        made={awayMade}
        remaining={awayRemaining}
        pulled={pulledAway}
        result={winner === 'away' ? 'W' : winner === 'home' ? 'L' : ''}
      />
    </div>
  );
}

function TeamScoreCard({
  label,
  made,
  remaining,
  pulled,
  result
}: {
  label: string;
  made: number;
  remaining: number;
  pulled: number;
  result: string;
}) {
  const resultStyles =
    result === 'W'
      ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900'
      : result === 'L'
        ? 'border-rose-200 bg-rose-50/70 text-rose-900'
        : 'border-garnet-100 bg-parchment/70 text-ink';

  return (
    <div className={`rounded-xl border px-4 py-3 ${resultStyles}`}>
      <div className="flex items-center justify-between text-xs uppercase text-ash">
        <span>{label}</span>
      </div>
      <div className="mt-2 text-2xl font-bold text-garnet-700">{made}</div>
      <div className="mt-1 text-xs text-ash">Remaining: {remaining}</div>
      <div className="text-xs text-ash">Pulled cups: {pulled}</div>
    </div>
  );
}
