import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { LiveConsole } from '@/components/live-console';
import { advancedStats, baseRatingStats, boxScore, defaultMultipliers, winnerFromRemaining } from '@/lib/stats';
import { PlayerLink } from '@/components/player-link';
import { getServerAuthSession } from '@/lib/auth';
import { LiveBoxScores } from '@/components/live-box-scores';
import { LivePlayByPlay } from '@/components/live-play-by-play';
import { DeleteGameButton } from '@/components/delete-game-button';
import { LiveScorebug } from '@/components/live-scorebug';

export default async function GamePage({ params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const game = await prisma.game.findUnique({
    where: { id: params.id },
    include: {
      homeTeam: true,
      awayTeam: true,
      state: true,
      scheduleEntry: true,
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

  const fullBox = !isLegacy ? boxScore(game.events) : new Map();
  const baseRatings = !isLegacy ? baseRatingStats(game.events, defaultMultipliers) : new Map();

  const tempoRatings = !isLegacy ? advancedStats(game.events, defaultMultipliers) : new Map();

  const homeRemaining = game.state?.homeCupsRemaining ?? 100;
  const awayRemaining = game.state?.awayCupsRemaining ?? 100;
  const homeMade = Math.max(0, 100 - awayRemaining);
  const awayMade = Math.max(0, 100 - homeRemaining);
  const hasResult = game.state !== null && game.state !== undefined;
  const winner = hasResult ? winnerFromRemaining(homeRemaining, awayRemaining, game.statsSource) : null;
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

  const ratingRows = isLegacy
    ? game.legacyStats
        .map((stat) => {
          const breakdown = stat.topRegular + stat.topIso + stat.bottomRegular + stat.bottomIso;
          const makes = stat.totalCups > 0 ? stat.totalCups : breakdown;
          const attempts = makes + stat.misses;
          const weightedPoints =
            stat.topRegular * defaultMultipliers.top +
            stat.topIso * defaultMultipliers.topIso +
            stat.bottomRegular * defaultMultipliers.bottom +
            stat.bottomIso * defaultMultipliers.bottomIso;
          return {
            id: stat.playerId,
            name: stat.player?.name ?? 'Unknown',
            makes,
            attempts,
            weightedPoints,
            pps: attempts ? weightedPoints / attempts : 0
          };
        })
        .sort((a, b) => b.weightedPoints - a.weightedPoints)
    : Array.from(baseRatings.entries())
        .map(([id, row]) => {
          const attempts = fullBox.get(id)?.attempts ?? row.attempts;
          const makes = fullBox.get(id)?.makes ?? row.makes;
          return {
            id,
            name: row.name,
            makes,
            attempts,
            weightedPoints: row.weightedPoints,
            pps: attempts ? row.weightedPoints / attempts : 0
          };
        })
        .sort((a, b) => b.weightedPoints - a.weightedPoints);

  const tempoRows = !isLegacy
    ? Array.from(tempoRatings.entries())
        .map(([id, row]) => {
          const attempts = fullBox.get(id)?.attempts ?? row.attempts;
          const makes = fullBox.get(id)?.makes ?? row.makes;
          return {
            id,
            name: row.name,
            makes,
            attempts,
            weightedPoints: row.weightedPoints,
            pps: attempts ? row.weightedPoints / attempts : 0
          };
        })
        .sort((a, b) => b.weightedPoints - a.weightedPoints)
    : [];

  const mvp = tempoRows[0] ?? ratingRows[0];
  const ratingLeaders = ratingRows.filter((row) => row.id !== mvp?.id).slice(0, 3);

  const weekLabel = game.scheduleEntry?.week
    ? `Week ${game.scheduleEntry.week}`
    : game.type === 'EXHIBITION'
      ? 'Exhibition'
      : 'Game';
  const startedLabel = game.startedAt ? new Date(game.startedAt).toLocaleDateString() : '';

  const showConsole = game.status === 'IN_PROGRESS' && !isLegacy;
  const isScorer = Boolean(session?.user?.id && session.user.id === game.statTakerId);
  const isAdmin = session?.user?.role === 'ADMIN';

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-garnet-100 bg-white/85 p-6 shadow">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm uppercase tracking-wide text-garnet-600">{weekLabel}</p>
              {isLegacy && (
                <span className="rounded-full border border-gold-300 bg-gold-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-garnet-600">
                  Legacy stats
                </span>
              )}
            </div>
            <h1 className="text-2xl font-bold text-ink">
              {game.homeTeam?.name ?? 'Home'} vs {game.awayTeam?.name ?? 'Away'}
            </h1>
            <p className="text-xs text-ash">
              {startedLabel} · {game.status}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {isLegacy ? (
              <>
                <TeamScoreCard
                  label={game.homeTeam?.name ?? 'Home'}
                  made={homeMade}
                  remaining={homeRemaining}
                  pulled={pulledHome}
                  result={homeWon ? 'W' : awayWon ? 'L' : ''}
                />
                <TeamScoreCard
                  label={game.awayTeam?.name ?? 'Away'}
                  made={awayMade}
                  remaining={awayRemaining}
                  pulled={pulledAway}
                  result={awayWon ? 'W' : homeWon ? 'L' : ''}
                />
              </>
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
          <LiveConsole gameId={game.id} initialData={initialData as any} isScorer={isScorer} />
        </div>
      )}

      {isLegacy && (
        <section className="rounded-2xl border border-garnet-100 bg-parchment/70 p-5 text-sm text-ash">
          Legacy game: shot order and play-by-play were not recorded in the old system. Box scores below reflect final totals only.
        </section>
      )}

      <LiveBoxScores gameId={game.id} initialData={game as any} />

      <section className="rounded-2xl border border-garnet-100 bg-white/85 p-5 shadow">
        <div className="flex items-center justify-between">
          <div>
          <h2 className="text-lg font-semibold text-ink">MVP</h2>
          <p className="text-xs text-ash">
            {tempoRows.length > 0 ? 'Tempo rating (temporal scaling) if tracked.' : 'Player rating (base weights).'}
          </p>
          </div>
          <span className="rounded-full border border-gold-300 bg-gold-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-garnet-600">
            {isLegacy ? 'Legacy' : 'Tracked'}
          </span>
        </div>

        {mvp ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_2fr]">
            <div className="rounded-xl border border-garnet-100 bg-parchment/70 p-4">
              <p className="text-xs uppercase tracking-wide text-ash">Game MVP</p>
              <p className="mt-1 text-lg font-semibold text-ink">
                <PlayerLink id={mvp.id} name={mvp.name} className="text-ink hover:text-garnet-600" />
              </p>
              <p className="mt-2 text-sm text-garnet-600">
                {mvp.weightedPoints.toFixed(2)} rating · {mvp.makes} cups ·{' '}
                {mvp.attempts ? ((mvp.makes / mvp.attempts) * 100).toFixed(1) : '0'}% FG
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {ratingLeaders.map((row, idx) => (
                <div key={row.id} className="rounded-xl border border-garnet-100 bg-white/80 p-4">
                  <p className="text-xs uppercase tracking-wide text-ash">#{idx + 1} rating</p>
                  <p className="mt-1 font-semibold text-ink">
                    <PlayerLink id={row.id} name={row.name} className="text-ink hover:text-garnet-600" />
                  </p>
                  <p className="mt-2 text-sm text-garnet-600">
                    {row.weightedPoints.toFixed(2)} · {row.makes} cups ·{' '}
                    {row.attempts ? ((row.makes / row.attempts) * 100).toFixed(1) : '0'}% FG
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-ash">No rating data yet.</p>
        )}
      </section>

      {!isLegacy && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-garnet-100 bg-white/80 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">Advanced</h2>
              <p className="text-xs text-ash">
                player rating uses base weights; tempo rating applies temporal scaling.
              </p>
            </div>
            <div className="mt-3 overflow-auto">
              <table className="min-w-full text-sm text-ink">
                <thead className="text-ash">
                  <tr>
                    <th className="px-2 py-1 text-left">Player</th>
                    <th className="px-2 py-1 text-center">Player rating</th>
                    <th className="px-2 py-1 text-center">Rating / shot</th>
                    <th className="px-2 py-1 text-center">Tempo rating</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(baseRatings.entries()).map(([id, row]) => {
                    const attempts = fullBox.get(id)?.attempts ?? row.attempts;
                    const tempo = tempoRatings.get(id);
                    return (
                      <tr key={id} className="border-t border-garnet-100">
                        <td className="px-2 py-1 text-ink">
                          <PlayerLink
                            id={id === 'unknown' ? null : id}
                            name={row.name}
                            className="text-ink hover:text-garnet-600"
                          />
                        </td>
                        <td className="px-2 py-1 text-center">{row.weightedPoints.toFixed(2)}</td>
                        <td className="px-2 py-1 text-center">
                          {attempts > 0 ? (row.weightedPoints / attempts).toFixed(2) : '—'}
                        </td>
                        <td className="px-2 py-1 text-center">{tempo ? tempo.weightedPoints.toFixed(2) : '—'}</td>
                      </tr>
                    );
                  })}
                  {baseRatings.size === 0 && (
                    <tr>
                      <td className="px-2 py-3 text-center text-ash" colSpan={4}>
                        No advanced stats yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-garnet-100 bg-white/80 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">Play-by-play</h2>
              <p className="text-xs text-ash">Tap undo in console to remove last event</p>
            </div>
            <div className="mt-3">
              <LivePlayByPlay gameId={game.id} initialEvents={game.events as any} />
            </div>
          </div>
        </div>
      )}

      <section className="rounded-2xl border border-garnet-100 bg-white/85 p-5 shadow">
        <h2 className="text-lg font-semibold text-ink">Game flow</h2>
        <div className="mt-3 max-h-96 space-y-3 overflow-y-auto pr-2 text-sm text-ink">
          {game.turns.length === 0 && <p className="text-ash">No events logged.</p>}
          {game.turns.map((turn) => (
            <div key={turn.id} className="rounded-xl border border-garnet-100 bg-parchment/70 p-3">
              <p className="text-xs uppercase tracking-wide text-ash">
                Turn {turn.turnIndex} · {turn.offenseTeam?.name ?? 'Offense'}
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

      {isAdmin && (
        <section className="rounded-2xl border border-rose-200 bg-rose-50/70 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-rose-700">Admin controls</h2>
              <p className="text-xs text-rose-600">
                Delete this game to remove it from the season history.
              </p>
            </div>
            <DeleteGameButton gameId={game.id} />
          </div>
        </section>
      )}
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
  result: 'W' | 'L' | '';
}) {
  const resultStyles =
    result === 'W'
      ? 'border-emerald-200 bg-emerald-50/70 text-emerald-700'
      : result === 'L'
        ? 'border-rose-200 bg-rose-50/70 text-rose-600'
        : 'border-garnet-100 bg-parchment/70 text-ink';

  return (
    <div className={`min-w-[160px] rounded-xl border px-4 py-3 ${resultStyles}`}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{label}</p>
      </div>
      <div className="mt-2 text-xs uppercase text-ash">Cups made</div>
      <div className="text-2xl font-bold text-ink">{made}</div>
      <div className="mt-1 text-xs text-ash">Remaining: {remaining}</div>
      <div className="mt-1 text-[11px] text-ash">Pulled cups: {pulled}</div>
    </div>
  );
}
