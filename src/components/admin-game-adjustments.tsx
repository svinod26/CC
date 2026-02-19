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
  players
}: {
  gameId: string;
  players: PlayerOption[];
}) {
  const router = useRouter();
  const [playerId, setPlayerId] = useState(players[0]?.id ?? '');
  const [resultType, setResultType] = useState<ResultType>(ResultType.TOP_REGULAR);
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

  if (players.length === 0) {
    return (
      <div className="rounded-xl border border-rose-200 bg-white/80 p-3 text-xs text-rose-700">
        No lineup players available for admin corrections.
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-rose-200 bg-white/85 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Score correction</p>
      <div className="grid gap-2 sm:grid-cols-2">
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
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => submitAdjustment('ADD')}
          disabled={isSubmitting}
          className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => submitAdjustment('SUBTRACT')}
          disabled={isSubmitting}
          className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
        >
          Subtract
        </button>
      </div>
      {message && <p className="text-xs text-emerald-700">{message}</p>}
      {error && <p className="text-xs text-rose-700">{error}</p>}
    </div>
  );
}
