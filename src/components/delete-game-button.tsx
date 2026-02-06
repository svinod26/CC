'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function DeleteGameButton({ gameId }: { gameId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    if (!window.confirm('Delete this game? This cannot be undone.')) return;
    setLoading(true);
    const res = await fetch(`/api/games/${gameId}`, { method: 'DELETE' });
    setLoading(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body?.error ?? 'Failed to delete game.');
      return;
    }
    router.push('/');
    router.refresh();
  };

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={loading}
      className="rounded-xl border border-rose-200 bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-500 disabled:opacity-60"
    >
      {loading ? 'Deleting…' : 'Delete game'}
    </button>
  );
}
