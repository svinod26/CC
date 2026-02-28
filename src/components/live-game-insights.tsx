'use client';

import useSWR from 'swr';
import { ResultType, StatsSource } from '@prisma/client';
import { advancedStats, baseRatingStats, boxScore, defaultMultipliers } from '@/lib/stats';
import { PlayerLink } from '@/components/player-link';

type LiveInsightsData = {
  statsSource: StatsSource;
  events: Array<{
    id: string;
    shooterId: string | null;
    shooter: { id: string; name: string | null } | null;
    resultType: ResultType;
    remainingCupsBefore?: number | null;
  }>;
  legacyStats: Array<{
    playerId: string;
    player: { id: string; name: string | null } | null;
    totalCups: number;
    topRegular: number;
    topIso: number;
    bottomRegular: number;
    bottomIso: number;
    misses: number;
  }>;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function LiveGameInsights({
  gameId,
  isLive,
  initialData
}: {
  gameId: string;
  isLive: boolean;
  initialData: LiveInsightsData;
}) {
  const { data } = useSWR<LiveInsightsData>(`/api/games/${gameId}/state`, fetcher, {
    fallbackData: initialData,
    refreshInterval: isLive ? 1200 : 0
  });

  const statsSource = data?.statsSource ?? initialData.statsSource;
  const isLegacy = statsSource === 'LEGACY';
  const events = data?.events ?? initialData.events;
  const legacyStats = data?.legacyStats ?? initialData.legacyStats;

  const fullBox = !isLegacy ? boxScore(events) : new Map();
  const baseRatings = !isLegacy ? baseRatingStats(events as any, defaultMultipliers) : new Map();
  const tempoRatings = !isLegacy ? advancedStats(events as any, defaultMultipliers) : new Map();

  const ratingRows = isLegacy
    ? legacyStats
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
            weightedPoints
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
            weightedPoints: row.weightedPoints
          };
        })
        .sort((a, b) => b.weightedPoints - a.weightedPoints);

  const mvp = ratingRows[0];
  const ratingLeaders = ratingRows.filter((row) => row.id !== mvp?.id).slice(0, 3);

  return (
    <>
      <section className="rounded-2xl border border-garnet-100 bg-white/85 p-4 shadow sm:p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink sm:text-lg">MVP</h2>
            <p className="text-[11px] text-ash sm:text-xs">Adjusted FGM (base cup weights).</p>
          </div>
          <span className="rounded-full border border-gold-300 bg-gold-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-garnet-600">
            {isLegacy ? 'Legacy' : 'Tracked'}
          </span>
        </div>

        {mvp ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_2fr]">
            <div className="rounded-xl border border-garnet-100 bg-parchment/70 p-4">
              <p className="text-xs uppercase tracking-wide text-ash">Game MVP</p>
              <p className="mt-1 text-base font-semibold text-ink sm:text-lg">
                <PlayerLink id={mvp.id} name={mvp.name} className="text-ink hover:text-garnet-600" />
              </p>
              <p className="mt-2 text-sm text-garnet-600">
                {mvp.weightedPoints.toFixed(2)} adjusted FGM · {mvp.makes} cups ·{' '}
                {mvp.attempts ? ((mvp.makes / mvp.attempts) * 100).toFixed(1) : '0'}% FG
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {ratingLeaders.map((row, idx) => (
                <div key={row.id} className="rounded-xl border border-garnet-100 bg-white/80 p-4">
                  <p className="text-xs uppercase tracking-wide text-ash">#{idx + 1} adjusted FGM</p>
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
          <p className="mt-4 text-sm text-ash">No adjusted FGM data yet.</p>
        )}
      </section>

      {!isLegacy && (
        <section className="min-w-0 rounded-xl border border-garnet-100 bg-white/80 p-4">
          <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-base font-semibold text-ink sm:text-lg">Advanced</h2>
            <p className="max-w-full text-[11px] text-ash sm:max-w-[260px] sm:text-xs sm:text-right">
              Adjusted FGM uses base weights; tempo rating applies temporal scaling.
            </p>
          </div>
          <div className="mt-3 overflow-auto">
            <table className="min-w-[420px] text-xs text-ink sm:min-w-full sm:text-sm">
              <thead className="text-[11px] text-ash sm:text-xs">
                <tr>
                  <th className="px-2 py-1 text-left">Player</th>
                  <th className="px-2 py-1 text-center">Adjusted FGM</th>
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
                      <td className="px-2 py-1 text-center">
                        {tempo ? tempo.weightedPoints.toFixed(2) : '—'}
                      </td>
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
        </section>
      )}
    </>
  );
}
