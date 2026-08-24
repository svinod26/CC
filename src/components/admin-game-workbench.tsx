'use client';

import { ResultType } from '@prisma/client';
import Link from 'next/link';
import useSWR from 'swr';
import { useMemo, useState } from 'react';

type GameOption = {
  id: string;
  label: string;
  sublabel: string;
};

type Snapshot = {
  game: {
    id: string;
    status: string;
    type: string;
    statsSource: string;
    week: number | null;
    startedAt: string;
    homeTeamName: string;
    awayTeamName: string;
    homeCupsRemaining: number;
    awayCupsRemaining: number;
  };
  players: Array<{
    id: string;
    name: string;
    teamName: string;
    orderIndex: number;
    topRegular: number;
    topIso: number;
    bottomRegular: number;
    bottomIso: number;
    misses: number;
    totalMakes: number;
    attempts: number;
  }>;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const shotOptions: { value: ResultType; label: string }[] = [
  { value: ResultType.TOP_REGULAR, label: 'Top regular' },
  { value: ResultType.TOP_ISO, label: 'Top ISO' },
  { value: ResultType.BOTTOM_REGULAR, label: 'Bottom regular' },
  { value: ResultType.BOTTOM_ISO, label: 'Bottom ISO' },
  { value: ResultType.MISS, label: 'Miss' }
];

export function AdminGameWorkbench({
  games,
  initialGameId
}: {
  games: GameOption[];
  initialGameId: string | null;
}) {
  const [selectedGameId, setSelectedGameId] = useState<string | null>(
    initialGameId ?? games[0]?.id ?? null
  );
  const [query, setQuery] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [resultType, setResultType] = useState<ResultType>(ResultType.TOP_REGULAR);
  const [side, setSide] = useState<'HOME' | 'AWAY'>('HOME');
  const [sideCount, setSideCount] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filteredGames = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return games;
    return games.filter(
      (game) =>
        game.label.toLowerCase().includes(term) ||
        game.sublabel.toLowerCase().includes(term)
    );
  }, [games, query]);

  const { data, mutate, isLoading } = useSWR<Snapshot>(
    selectedGameId ? `/api/admin/games/${selectedGameId}/editor` : null,
    fetcher
  );

  const snapshot = data ?? null;
  const selectedPlayerId =
    playerId && snapshot?.players.some((player) => player.id === playerId)
      ? playerId
      : snapshot?.players[0]?.id ?? '';
  const selectedPlayer = snapshot?.players.find((player) => player.id === selectedPlayerId) ?? null;

  const selectGame = (id: string) => {
    setSelectedGameId(id);
    setPlayerId('');
    setMessage(null);
    setError(null);
  };

  const submitPlayer = async (action: 'ADD' | 'SUBTRACT') => {
    if (!selectedGameId || !selectedPlayerId) return;
    setMessage(null);
    setError(null);
    setIsSubmitting(true);
    const res = await fetch(`/api/games/${selectedGameId}/admin-adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: selectedPlayerId, resultType, action })
    });
    setIsSubmitting(false);

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body?.error ?? 'Failed to apply player adjustment');
      return;
    }

    if (body?.snapshot) {
      await mutate(body.snapshot, { revalidate: false });
    } else {
      await mutate();
    }
    setMessage(
      `${action === 'ADD' ? 'Added' : 'Removed'} ${shotOptions
        .find((option) => option.value === resultType)
        ?.label.toLowerCase() ?? 'shot'} for ${selectedPlayer?.name ?? 'player'}.`
    );
  };

  const submitSide = async (action: 'PULL' | 'ADD') => {
    if (!selectedGameId) return;
    const count = Math.max(1, Math.min(25, Math.trunc(sideCount || 1)));
    setMessage(null);
    setError(null);
    setIsSubmitting(true);
    const res = await fetch(`/api/games/${selectedGameId}/admin-adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ side, action, count })
    });
    setIsSubmitting(false);

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body?.error ?? 'Failed to apply side adjustment');
      return;
    }

    if (body?.snapshot) {
      await mutate(body.snapshot, { revalidate: false });
    } else {
      await mutate();
    }

    const sideLabel =
      side === 'HOME'
        ? snapshot?.game.homeTeamName ?? 'Home'
        : snapshot?.game.awayTeamName ?? 'Away';
    setMessage(
      `${action === 'PULL' ? 'Pulled' : 'Added'} ${count} cup${count === 1 ? '' : 's'} on ${sideLabel}'s side.`
    );
  };

  return (
    <section className="flex min-h-[36rem] min-w-0 flex-col overflow-hidden rounded-2xl border border-garnet-100 bg-white/85 shadow lg:h-[min(70vh,52rem)]">
      <div className="shrink-0 border-b border-garnet-100 px-4 py-3 sm:px-5">
        <p className="text-xs uppercase tracking-wide text-garnet-600">Corrections</p>
        <h2 className="text-lg font-semibold text-ink">Game score editor</h2>
        <p className="text-xs text-ash">Pick a game, then fix shots or cups without scrolling the whole page.</p>
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(15rem,18rem)_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-garnet-100 lg:border-b-0 lg:border-r">
          <label className="shrink-0 px-3 pt-3 text-[11px] font-semibold uppercase tracking-wide text-ash">
            Find game
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="mt-1 min-h-11 w-full rounded-lg border border-garnet-100 bg-white px-3 py-2 text-sm text-ink"
              placeholder="Team, week, type"
            />
          </label>
          <div className="max-h-48 min-h-0 flex-1 overflow-y-auto p-2 lg:max-h-none">
            {filteredGames.map((game) => (
              <button
                key={game.id}
                type="button"
                onClick={() => selectGame(game.id)}
                className={`mb-1 w-full rounded-lg border px-3 py-2 text-left transition ${
                  selectedGameId === game.id
                    ? 'border-garnet-300 bg-gold-50'
                    : 'border-transparent bg-white hover:border-garnet-100 hover:bg-gold-50/70'
                }`}
              >
                <p className="text-sm font-semibold text-ink">{game.label}</p>
                <p className="text-xs text-ash">{game.sublabel}</p>
              </button>
            ))}
            {filteredGames.length === 0 && (
              <p className="px-3 py-2 text-sm text-ash">No games match your search.</p>
            )}
          </div>
        </aside>

        <div className="flex min-h-0 flex-col">
          {!selectedGameId && (
            <p className="p-4 text-sm text-ash">No finalized tracked games available.</p>
          )}

          {selectedGameId && (
            <>
              <div className="flex shrink-0 flex-wrap items-start justify-between gap-2 border-b border-garnet-100 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-ink">
                    {snapshot?.game.homeTeamName ?? 'Home'} vs {snapshot?.game.awayTeamName ?? 'Away'}
                  </p>
                  <p className="text-xs text-ash">
                    {snapshot?.game.week ? `Week ${snapshot.game.week}` : 'No week'} ·{' '}
                    {snapshot ? new Date(snapshot.game.startedAt).toLocaleDateString() : 'Loading...'}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-garnet-700">
                    Remaining: {snapshot?.game.homeTeamName ?? 'Home'} {snapshot?.game.homeCupsRemaining ?? '—'} ·{' '}
                    {snapshot?.game.awayTeamName ?? 'Away'} {snapshot?.game.awayCupsRemaining ?? '—'}
                  </p>
                </div>
                <Link
                  href={`/games/${selectedGameId}`}
                  className="text-xs font-semibold text-garnet-600 hover:text-garnet-500"
                >
                  Open game page
                </Link>
              </div>

              <div className="min-h-0 flex-1 overflow-auto">
                <table className="min-w-[640px] w-full text-left text-sm">
                  <thead className="sticky top-0 bg-parchment text-[11px] uppercase tracking-wide text-ash">
                    <tr>
                      <th className="px-3 py-2">Player</th>
                      <th className="px-3 py-2">Team</th>
                      <th className="px-3 py-2 text-center">Total</th>
                      <th className="px-3 py-2 text-center">Top</th>
                      <th className="px-3 py-2 text-center">Top ISO</th>
                      <th className="px-3 py-2 text-center">Bottom</th>
                      <th className="px-3 py-2 text-center">Bottom ISO</th>
                      <th className="px-3 py-2 text-center">Misses</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(snapshot?.players ?? []).map((player) => {
                      const selected = player.id === selectedPlayerId;
                      return (
                        <tr
                          key={player.id}
                          onClick={() => setPlayerId(player.id)}
                          className={`cursor-pointer border-t border-garnet-100 ${
                            selected ? 'bg-gold-50' : 'bg-white hover:bg-gold-50/50'
                          }`}
                        >
                          <td className="px-3 py-2 font-semibold text-ink">{player.name}</td>
                          <td className="px-3 py-2 text-ash">{player.teamName}</td>
                          <td className="px-3 py-2 text-center font-semibold text-garnet-700">{player.totalMakes}</td>
                          <td className="px-3 py-2 text-center">{player.topRegular}</td>
                          <td className="px-3 py-2 text-center">{player.topIso}</td>
                          <td className="px-3 py-2 text-center">{player.bottomRegular}</td>
                          <td className="px-3 py-2 text-center">{player.bottomIso}</td>
                          <td className="px-3 py-2 text-center">{player.misses}</td>
                        </tr>
                      );
                    })}
                    {!snapshot?.players?.length && !isLoading && (
                      <tr>
                        <td className="px-3 py-3 text-ash" colSpan={8}>
                          No lineup players in this game.
                        </td>
                      </tr>
                    )}
                    {isLoading && (
                      <tr>
                        <td className="px-3 py-3 text-ash" colSpan={8}>
                          Loading box score...
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="shrink-0 space-y-2 border-t border-garnet-100 bg-parchment/60 p-3">
                {(message || error) && (
                  <p className={`text-xs ${error ? 'text-rose-700' : 'text-emerald-700'}`}>{error ?? message}</p>
                )}
                <div className="grid gap-3 xl:grid-cols-2">
                  <div className="min-w-0 rounded-xl border border-rose-200 bg-white p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-700">Player shot</p>
                    <p className="mt-0.5 text-xs text-ash">Click a row or pick a player, then add or remove one shot.</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <label className="space-y-1 text-xs text-ash">
                        Player
                        <select
                          className="min-h-11 w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm text-ink"
                          value={selectedPlayerId}
                          onChange={(event) => setPlayerId(event.target.value)}
                          disabled={isSubmitting}
                        >
                          {(snapshot?.players ?? []).map((player) => (
                            <option key={player.id} value={player.id}>
                              {player.name} ({player.teamName})
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-1 text-xs text-ash">
                        Shot type
                        <select
                          className="min-h-11 w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm text-ink"
                          value={resultType}
                          onChange={(event) => setResultType(event.target.value as ResultType)}
                          disabled={isSubmitting}
                        >
                          {shotOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => submitPlayer('ADD')}
                        disabled={isSubmitting || !selectedPlayerId}
                        className="inline-flex h-11 items-center justify-center rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                      >
                        Add shot
                      </button>
                      <button
                        type="button"
                        onClick={() => submitPlayer('SUBTRACT')}
                        disabled={isSubmitting || !selectedPlayerId}
                        className="inline-flex h-11 items-center justify-center rounded-lg bg-rose-600 px-3 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
                      >
                        Remove shot
                      </button>
                    </div>
                  </div>

                  <div className="min-w-0 rounded-xl border border-rose-200 bg-white p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-700">Side cups</p>
                    <p className="mt-0.5 text-xs text-ash">Pull or add cups on a team’s rack.</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <label className="space-y-1 text-xs text-ash">
                        Side
                        <select
                          className="min-h-11 w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm text-ink"
                          value={side}
                          onChange={(event) => setSide(event.target.value as 'HOME' | 'AWAY')}
                          disabled={isSubmitting}
                        >
                          <option value="HOME">{snapshot?.game.homeTeamName ?? 'Home'}&apos;s side</option>
                          <option value="AWAY">{snapshot?.game.awayTeamName ?? 'Away'}&apos;s side</option>
                        </select>
                      </label>
                      <label className="space-y-1 text-xs text-ash">
                        Cups
                        <input
                          type="number"
                          min={1}
                          max={25}
                          value={sideCount}
                          onChange={(event) => setSideCount(Number(event.target.value))}
                          className="min-h-11 w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm text-ink"
                          disabled={isSubmitting}
                        />
                      </label>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => submitSide('PULL')}
                        disabled={isSubmitting}
                        className="inline-flex h-11 items-center justify-center rounded-lg bg-rose-600 px-3 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
                      >
                        Pull cups
                      </button>
                      <button
                        type="button"
                        onClick={() => submitSide('ADD')}
                        disabled={isSubmitting}
                        className="inline-flex h-11 items-center justify-center rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                      >
                        Add cups
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
