'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

export function PlayerSearch({ players }: { players: { id: string; name: string }[] }) {
  const [query, setQuery] = useState('');
  const minChars = 2;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < minChars) return [];
    return players.filter((player) => player.name.toLowerCase().includes(q)).slice(0, 12);
  }, [players, query, minChars]);

  return (
    <div className="rounded-2xl border border-garnet-100 bg-white/85 p-3 shadow sm:p-4">
      <label className="text-[10px] font-semibold uppercase tracking-wide text-ash sm:text-xs">
        Jump to player
        <input
          className="mt-2 w-full rounded-xl border border-garnet-200 bg-white/80 px-3 py-2 text-sm text-ink shadow-sm"
          placeholder="Type a name (e.g., Somil)"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="mt-3 grid gap-2">
        {query.trim().length < minChars && (
          <p className="text-xs text-ash">Start typing to see matches.</p>
        )}
        {filtered.map((player) => (
          <Link
            key={player.id}
            href={`/players/${player.id}`}
            className="rounded-xl border border-garnet-100 bg-parchment/70 px-3 py-2 text-sm font-semibold text-ink hover:text-garnet-600"
          >
            {player.name}
          </Link>
        ))}
        {query.trim().length >= minChars && filtered.length === 0 && <p className="text-xs text-ash">No matches.</p>}
      </div>
    </div>
  );
}
