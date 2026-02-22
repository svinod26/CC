'use client';

import { useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

type AdminGameOption = {
  id: string;
  label: string;
  sublabel: string;
};

export function AdminGamePicker({
  games,
  selectedGameId
}: {
  games: AdminGameOption[];
  selectedGameId: string | null;
}) {
  const [query, setQuery] = useState('');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return games;
    return games.filter(
      (game) =>
        game.label.toLowerCase().includes(term) ||
        game.sublabel.toLowerCase().includes(term)
    );
  }, [games, query]);

  const handleSelect = (gameId: string) => {
    const params = new URLSearchParams(searchParams?.toString());
    params.set('game', gameId);
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="space-y-2 rounded-xl border border-garnet-100 bg-white/85 p-3">
      <label className="block text-xs uppercase tracking-wide text-ash">
        Find game
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="mt-1 w-full rounded-lg border border-garnet-100 bg-white px-3 py-2 text-sm text-ink"
          placeholder="Search by team, week, type"
        />
      </label>
      <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
        {filtered.map((game) => (
          <button
            key={game.id}
            type="button"
            onClick={() => handleSelect(game.id)}
            className={`w-full rounded-lg border px-3 py-2 text-left transition ${
              selectedGameId === game.id
                ? 'border-garnet-300 bg-gold-50'
                : 'border-garnet-100 bg-white hover:bg-gold-50/70'
            }`}
          >
            <p className="text-sm font-semibold text-ink">{game.label}</p>
            <p className="text-xs text-ash">{game.sublabel}</p>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="rounded-lg border border-garnet-100 bg-white px-3 py-2 text-sm text-ash">
            No games match your search.
          </p>
        )}
      </div>
    </div>
  );
}
