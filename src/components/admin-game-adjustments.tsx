'use client';

import { ResultType } from '@prisma/client';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

type PlayerOption = {
  id: string;
  name: string;
  teamName: string;
};

const resultTypeOptions: { value: ResultType; label: string }[] = [
  { value: ResultType.TOP_REGULAR, label: 'Top regular' },
  { value: ResultType.TOP_ISO, label: 'Top ISO' },
  { value: ResultType.BOTTOM_REGULAR, label: 'Bottom regular' },
  { value: ResultType.BOTTOM_ISO, label: 'Bottom ISO' },
  { value: ResultType.MISS, label: 'Miss' }
];

export function AdminGameAdjustments({
  gameId,
  players,
  homeTeamName = 'Home',
  awayTeamName = 'Away'
}: {
  gameId: string;
  players: PlayerOption[];
  homeTeamName?: string;
  awayTeamName?: string;
}) {
  const router = useRouter();
  const [playerId, setPlayerId] = useState(players[0]?.id ?? '');
  const [resultType, setResultType] = useState<ResultType>(ResultType.TOP_REGULAR);
  const [side, setSide] = useState<'HOME' | 'AWAY'>('HOME');
  const [sideCount, setSideCount] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedPlayer = useMemo(() => players.find((player) => player.id === playerId), [playerId, players]);

  const submitAdjustment = async (action: 'ADD' | 'SUBTRACT') => {
    if (!playerId) return;
    setIsSubmitting(true);
    setMessage(null);
    setError(null);

    const res = await fetch(`/api/games/${gameId}/admin-adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, resultType, action })
    });

    setIsSubmitting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body?.error ?? 'Failed to apply adjustment');
      return;
    }

    setMessage(
      `${action === 'ADD' ? 'Added' : 'Removed'} ${resultTypeOptions.find((option) => option.value === resultType)?.label.toLowerCase() ?? 'shot'} for ${selectedPlayer?.name ?? 'player'}.`
    );
    router.refresh();
  };

  const submitSideAdjustment = async (action: 'PULL' | 'ADD') => {
    const count = Math.max(1, Math.min(25, Math.trunc(sideCount || 1)));
    setIsSubmitting(true);
    setMessage(null);
    setError(null);

    const res = await fetch(`/api/games/${gameId}/admin-adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ side, action, count })
    });

    setIsSubmitting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body?.error ?? 'Failed to apply side adjustment');
      return;
    }

    setMessage(
      `${action === 'PULL' ? 'Pulled' : 'Added'} ${count} cup${count === 1 ? '' : 's'} on ${side === 'HOME' ? homeTeamName : awayTeamName}'s side.`
    );
    router.refresh();
  };

  if (players.length === 0) {
    return (
      <div className="rounded-xl border border-rose-200 bg-white/80 p-3 text-xs text-rose-700">
        No lineup players available for admin corrections.
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-rose-200 bg-white/85 p-3">
      <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Player shot correction</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="space-y-1 text-xs text-ash">
            Player
            <select
              className="w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm text-ink"
              value={playerId}
              onChange={(event) => setPlayerId(event.target.value)}
              disabled={isSubmitting}
            >
              {players.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.name} ({player.teamName})
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-ash">
            Shot type
            <select
              className="w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm text-ink"
              value={resultType}
              onChange={(event) => setResultType(event.target.value as ResultType)}
              disabled={isSubmitting}
            >
              {resultTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => submitAdjustment('ADD')}
            disabled={isSubmitting}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            Add shot
          </button>
          <button
            type="button"
            onClick={() => submitAdjustment('SUBTRACT')}
            disabled={isSubmitting}
            className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
          >
            Remove shot
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Side cup correction</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_120px]">
          <label className="space-y-1 text-xs text-ash">
            Side
            <select
              className="w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm text-ink"
              value={side}
              onChange={(event) => setSide(event.target.value as 'HOME' | 'AWAY')}
              disabled={isSubmitting}
            >
              <option value="HOME">{homeTeamName}&apos;s side</option>
              <option value="AWAY">{awayTeamName}&apos;s side</option>
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
              className="w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm text-ink"
              disabled={isSubmitting}
            />
          </label>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => submitSideAdjustment('PULL')}
            disabled={isSubmitting}
            className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
          >
            Pull cups
          </button>
          <button
            type="button"
            onClick={() => submitSideAdjustment('ADD')}
            disabled={isSubmitting}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            Add cups
          </button>
        </div>
      </div>

      {message && <p className="text-xs text-emerald-700">{message}</p>}
      {error && <p className="text-xs text-rose-700">{error}</p>}
    </div>
  );
}
