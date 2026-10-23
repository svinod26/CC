'use client';

import type { GameView } from '@/lib/game-view';
import { useGameData } from '@/components/game-data-provider';
import { boxScore } from '@/lib/stats';
import { PlayerLink } from '@/components/player-link';

type LineupSlot = GameView['lineups'][number];

type BoxRow = {
  id: string;
  name: string;
  makes: number;
  attempts: number;
  topRegular: number;
  topIso: number;
  bottomRegular: number;
  bottomIso: number;
  misses: number;
};

const buildLegacyBox = (stats: GameView['legacyStats']) => {
  const map = new Map<string, BoxRow>();
  stats.forEach((stat) => {
    const breakdown = stat.topRegular + stat.topIso + stat.bottomRegular + stat.bottomIso;
    const makes = stat.totalCups > 0 ? stat.totalCups : breakdown;
    const attempts = makes + stat.misses;
    map.set(stat.playerId, {
      id: stat.playerId,
      name: stat.player?.name ?? 'Unknown',
      makes,
      attempts,
      topRegular: stat.topRegular,
      topIso: stat.topIso,
      bottomRegular: stat.bottomRegular,
      bottomIso: stat.bottomIso,
      misses: stat.misses
    });
  });
  return map;
};

const blankRow = (id: string, name: string): BoxRow => ({
  id,
  name,
  makes: 0,
  attempts: 0,
  topRegular: 0,
  topIso: 0,
  bottomRegular: 0,
  bottomIso: 0,
  misses: 0
});

export function LiveBoxScores() {
  const { data } = useGameData();

  if (!data) return null;

  const isLegacy = data.legacyStats.length > 0 && data.events.length === 0;
  const trackedBox = boxScore(data.events);
  const legacyBox = buildLegacyBox(data.legacyStats);

  const homeLineup = data.lineups
    .filter((slot) => slot.teamId === data.homeTeam?.id)
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const awayLineup = data.lineups
    .filter((slot) => slot.teamId === data.awayTeam?.id)
    .sort((a, b) => a.orderIndex - b.orderIndex);

  const orderRows = (lineup: LineupSlot[]) => {
    const box = isLegacy ? legacyBox : trackedBox;
    if (lineup.length === 0) {
      return Array.from(box.values());
    }
    return lineup.map((slot) => box.get(slot.player.id) ?? blankRow(slot.player.id, slot.player.name ?? 'Unknown'));
  };

  const homeRows = orderRows(homeLineup);
  const awayRows = orderRows(awayLineup);
  const targetRowCount = Math.max(homeRows.length, awayRows.length);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <TeamTable
        title={`${data.homeTeam?.name ?? 'Home'} box score`}
        rows={homeRows}
        targetRowCount={targetRowCount}
      />
      <TeamTable
        title={`${data.awayTeam?.name ?? 'Away'} box score`}
        rows={awayRows}
        targetRowCount={targetRowCount}
      />
    </div>
  );
}

function TeamTable({
  title,
  rows,
  targetRowCount
}: {
  title: string;
  rows: BoxRow[];
  targetRowCount: number;
}) {
  const fillerCount = Math.max(0, targetRowCount - rows.length);

  return (
    <div className="overflow-hidden rounded-2xl border border-garnet-100 bg-white/85 shadow">
      <div className="border-b border-garnet-100 bg-gold-50 px-4 py-3">
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
      </div>
      <div className="overflow-auto">
        <table className="min-w-full text-sm text-ink">
          <thead className="bg-parchment/80 text-ash">
            <tr>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-center">Total Makes</th>
              <th className="px-3 py-2 text-center">Top</th>
              <th className="px-3 py-2 text-center">Top ISO</th>
              <th className="px-3 py-2 text-center">Bottom</th>
              <th className="px-3 py-2 text-center">Bottom ISO</th>
              <th className="px-3 py-2 text-center">Misses</th>
              <th className="px-3 py-2 text-center">FG%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row.id} className={idx % 2 === 1 ? 'bg-gold-50/50' : 'bg-white'}>
                <td className="px-3 py-2 font-semibold text-ink">
                  <PlayerLink
                    id={row.id === 'unknown' ? null : row.id}
                    name={row.name}
                    className="text-ink hover:text-garnet-600"
                  />
                </td>
                <td className="px-3 py-2 text-center">{row.makes}</td>
                <td className="px-3 py-2 text-center">{row.topRegular}</td>
                <td className="px-3 py-2 text-center">{row.topIso}</td>
                <td className="px-3 py-2 text-center">{row.bottomRegular}</td>
                <td className="px-3 py-2 text-center">{row.bottomIso}</td>
                <td className="px-3 py-2 text-center">{row.misses}</td>
                <td className="px-3 py-2 text-center">
                  {row.attempts > 0 ? ((row.makes / row.attempts) * 100).toFixed(1) : '—'}
                </td>
              </tr>
            ))}
            {Array.from({ length: fillerCount }).map((_, idx) => {
              const rowIndex = rows.length + idx;
              return (
                <tr
                  key={`filler-${idx}`}
                  className={`${rowIndex % 2 === 1 ? 'bg-gold-50/50' : 'bg-white'} hidden lg:table-row`}
                >
                  <td className="px-3 py-2">&nbsp;</td>
                  <td className="px-3 py-2">&nbsp;</td>
                  <td className="px-3 py-2">&nbsp;</td>
                  <td className="px-3 py-2">&nbsp;</td>
                  <td className="px-3 py-2">&nbsp;</td>
                  <td className="px-3 py-2">&nbsp;</td>
                  <td className="px-3 py-2">&nbsp;</td>
                  <td className="px-3 py-2">&nbsp;</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td className="px-3 py-4 text-center text-ash" colSpan={8}>
                  No shots logged yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
