import { notFound } from 'next/navigation';
import type { Viewport } from 'next';
import { prisma } from '@/lib/prisma';
import { LiveConsole } from '@/components/live-console';
import { winnerFromGameState } from '@/lib/stats';
import { PlayerLink } from '@/components/player-link';
import { getServerAuthSession } from '@/lib/auth';
import { LiveBoxScores } from '@/components/live-box-scores';
import { LiveScorebug } from '@/components/live-scorebug';
import { GameFlowChart } from '@/components/game-flow-chart';
import { LiveGameInsights } from '@/components/live-game-insights';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false
};

export default async function GamePage({ params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const game = await prisma.game.findUnique({
    where: { id: params.id },
    include: {
      homeTeam: true,
      awayTeam: true,
      state: true,
      scheduleEntry: true,
      statTaker: true,
      lineups: { include: { player: true } },
      turns: {
        orderBy: { turnIndex: 'asc' },
        include: { events: { orderBy: { timestamp: 'asc' }, include: { shooter: true } }, offenseTeam: true }
      },
      events: { include: { shooter: true }, orderBy: { timestamp: 'asc' } },
      legacyStats: { include: { player: true } },
      legacyTeamStats: true
    }
  });

  if (!game) return notFound();

  const isLegacy = game.statsSource === 'LEGACY';

  const initialTurn = game.turns[game.turns.length - 1] ? [game.turns[game.turns.length - 1]] : [];
  const initialData = {
    id: game.id,
    type: game.type,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    state: game.state,
    lineups: game.lineups,
    turns: initialTurn as any
  };

  const homeRemaining = game.state?.homeCupsRemaining ?? 100;
  const awayRemaining = game.state?.awayCupsRemaining ?? 100;
  const homeSideRemaining = isLegacy ? awayRemaining : homeRemaining;
  const awaySideRemaining = isLegacy ? homeRemaining : awayRemaining;
  const homeOpponentRemaining = isLegacy ? homeRemaining : awayRemaining;
  const awayOpponentRemaining = isLegacy ? awayRemaining : homeRemaining;
  const homeMade = Math.max(0, 100 - homeOpponentRemaining);
  const awayMade = Math.max(0, 100 - awayOpponentRemaining);
  const hasResult = game.state !== null && game.state !== undefined;
  const winner = hasResult
    ? winnerFromGameState(game.state, {
        statsSource: game.statsSource,
        homeTeamId: game.homeTeamId,
        awayTeamId: game.awayTeamId
      })
    : null;
  const homeWon = winner === 'home';
  const awayWon = winner === 'away';

  const pulledHome = isLegacy
    ? game.legacyTeamStats.find((stat) => stat.teamId === game.homeTeamId)?.pulledCups ?? 0
    : game.events
        .filter((event) => event.resultType === 'PULL_HOME')
        .reduce((sum, event) => sum + event.cupsDelta, 0);
  const pulledAway = isLegacy
    ? game.legacyTeamStats.find((stat) => stat.teamId === game.awayTeamId)?.pulledCups ?? 0
    : game.events
        .filter((event) => event.resultType === 'PULL_AWAY')
        .reduce((sum, event) => sum + event.cupsDelta, 0);

  const weekLabel = game.scheduleEntry?.week
    ? `Week ${game.scheduleEntry.week}`
    : game.type === 'EXHIBITION'
      ? 'Exhibition'
      : 'Game';
  const startedLabel = game.startedAt ? new Date(game.startedAt).toLocaleDateString() : '';

  const showConsole = game.status === 'IN_PROGRESS' && !isLegacy;
  const isScorer = Boolean(
    (session?.user?.id && session.user.id === game.statTakerId) ||
      (session?.user?.email && game.statTaker?.email && session.user.email === game.statTaker.email)
  );
  const canScore = isScorer;
  const canRenderFlowChart = !isLegacy && Boolean(game.homeTeamId && game.awayTeamId);
  const mergedTurns = game.turns.reduce<
    {
      key: string;
      offenseTeamId: string | null;
      offenseTeamName: string;
      events: (typeof game.turns)[number]['events'];
      sourceTurnIndexes: number[];
    }[]
  >((groups, turn) => {
    const last = groups[groups.length - 1];
    const offenseTeamName = turn.offenseTeam?.name ?? 'Offense';
    if (last && last.offenseTeamId === turn.offenseTeamId) {
      last.events.push(...turn.events);
      last.sourceTurnIndexes.push(turn.turnIndex);
      return groups;
    }
    groups.push({
      key: turn.id,
      offenseTeamId: turn.offenseTeamId ?? null,
      offenseTeamName,
      events: [...turn.events],
      sourceTurnIndexes: [turn.turnIndex]
    });
    return groups;
  }, []);
  return (
    <div className="space-y-5 sm:space-y-6">
      <section className="rounded-2xl border border-garnet-100 bg-white/85 p-4 shadow sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs uppercase tracking-wide text-garnet-600">{weekLabel}</p>
              {isLegacy && (
                <span className="rounded-full border border-gold-300 bg-gold-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-garnet-600">
                  Legacy stats
                </span>
              )}
            </div>
            <h1 className="text-xl font-bold text-ink sm:text-2xl">
              {game.homeTeam?.name ?? 'Home'} vs {game.awayTeam?.name ?? 'Away'}
            </h1>
            <p className="text-xs text-ash">
              {startedLabel} · {game.status}
            </p>
          </div>
          <div className="w-full lg:w-auto">
            {isLegacy ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <TeamScoreCard
                  label={game.homeTeam?.name ?? 'Home'}
                  made={homeMade}
                  remaining={homeSideRemaining}
                  pulled={pulledHome}
                  result={homeWon ? 'W' : awayWon ? 'L' : ''}
                />
                <TeamScoreCard
                  label={game.awayTeam?.name ?? 'Away'}
                  made={awayMade}
                  remaining={awaySideRemaining}
                  pulled={pulledAway}
                  result={awayWon ? 'W' : homeWon ? 'L' : ''}
                />
              </div>
            ) : (
              <LiveScorebug
                gameId={game.id}
                initialData={{
                  id: game.id,
                  statsSource: game.statsSource,
                  homeTeam: game.homeTeam,
                  awayTeam: game.awayTeam,
                  state: game.state,
                  events: game.events,
                  legacyTeamStats: game.legacyTeamStats
                }}
              />
            )}
          </div>
        </div>
      </section>

      {showConsole && (
        <div>
          <LiveConsole gameId={game.id} initialData={initialData as any} isScorer={canScore} />
        </div>
      )}

      {isLegacy && (
        <section className="rounded-2xl border border-garnet-100 bg-parchment/70 p-4 text-sm text-ash sm:p-5">
          Legacy game: shot order and play-by-play were not recorded in the old system. Box scores below reflect final totals only.
        </section>
      )}

      <LiveBoxScores gameId={game.id} initialData={game as any} />

      <LiveGameInsights
        gameId={game.id}
        isLive={game.status === 'IN_PROGRESS'}
        initialData={{
          statsSource: game.statsSource,
          events: game.events as any,
          legacyStats: game.legacyStats as any
        }}
      />

      {canRenderFlowChart && (
        <GameFlowChart
          gameId={game.id}
          homeTeamId={game.homeTeamId as string}
          awayTeamId={game.awayTeamId as string}
          homeTeamName={game.homeTeam?.name ?? 'Home'}
          awayTeamName={game.awayTeam?.name ?? 'Away'}
          initialEvents={game.events as any}
          isLive={showConsole}
        />
      )}

      <section className="rounded-2xl border border-garnet-100 bg-white/85 p-4 shadow sm:p-5">
        <h2 className="text-base font-semibold text-ink sm:text-lg">Game flow turns</h2>
        <div className="mt-3 max-h-96 space-y-3 overflow-y-auto pr-2 text-sm text-ink">
          {mergedTurns.length === 0 && <p className="text-ash">No events logged.</p>}
          {mergedTurns.map((turn, index) => (
            <div key={turn.key} className="rounded-xl border border-garnet-100 bg-parchment/70 p-3">
              <p className="text-xs uppercase tracking-wide text-ash">
                Turn {index + 1} · {turn.offenseTeamName}
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {turn.events.map((event) => (
                  <span key={event.id} className="rounded-full bg-white/80 px-2 py-1">
                    {event.shooter ? (
                      <PlayerLink
                        id={event.shooter.id}
                        name={event.shooter.name ?? '—'}
                        className="text-ink hover:text-garnet-600"
                      />
                    ) : (
                      '—'
                    )}{' '}
                    · {event.resultType}
                  </span>
                ))}
                {turn.events.length === 0 && <span className="text-ash">No events yet.</span>}
              </div>
            </div>
          ))}
        </div>
      </section>

    </div>
  );
}

const TEAM_SHORT_NAMES: Record<string, string> = {
  gargantuan: 'Garg',
  'candice?': 'Cand'
};

function shortenTeamName(name: string) {
  const trimmed = name.trim();
  const mapped = TEAM_SHORT_NAMES[trimmed.toLowerCase()];
  if (mapped) return mapped;
  if (trimmed.length <= 10) return trimmed;
  if (!trimmed.includes(' ')) return trimmed.slice(0, 4);
  return trimmed;
}

function possessiveTeamLabel(name: string) {
  return name.endsWith('s') ? `${name}'` : `${name}'s`;
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
  result: 'W' | 'L' | '';
}) {
  const sideTeam = possessiveTeamLabel(shortenTeamName(label));
  const resultStyles =
    result === 'W'
      ? 'border-emerald-200 bg-emerald-50/70 text-emerald-700'
      : result === 'L'
        ? 'border-rose-200 bg-rose-50/70 text-rose-600'
        : 'border-garnet-100 bg-parchment/70 text-ink';

  return (
    <div className={`w-full min-w-0 rounded-xl border px-4 py-3 sm:min-w-[160px] ${resultStyles}`}>
      <div className="flex items-center justify-between">
        <p className="truncate text-sm font-semibold">{label}</p>
      </div>
      <div className="mt-2 text-xs uppercase text-ash">Cups made</div>
      <div className="text-2xl font-bold text-ink">{made}</div>
      <div className="mt-1 text-xs text-ash">On {sideTeam} side: {remaining}</div>
      <div className="mt-1 text-[11px] text-ash">Pulled cups: {pulled}</div>
    </div>
  );
}
