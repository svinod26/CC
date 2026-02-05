'use client';

import { useState } from 'react';

export function ImportForm() {
  const [filePath, setFilePath] = useState('');
  const [seasonName, setSeasonName] = useState('Century Cup Season');
  const [year, setYear] = useState(new Date().getFullYear());
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    const res = await fetch('/api/admin/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filePath: filePath || undefined,
        seasonName,
        year: Number(year)
      })
    });
    setLoading(false);
    const body = await res.json();
    if (!res.ok) {
      setMessage(body?.error ?? 'Import failed');
    } else {
      setMessage(`Imported into season ${body.seasonId}`);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-garnet-100 bg-white/85 p-5 shadow">
      {message && <div className="rounded-xl bg-gold-50 px-3 py-2 text-sm text-garnet-700">{message}</div>}
      <label className="block space-y-1 text-sm text-ink">
        <span>Workbook path (optional)</span>
        <input
          value={filePath}
          onChange={(e) => setFilePath(e.target.value)}
          className="w-full"
          placeholder="Defaults to ./S2026 CC Master Sheet.xlsx"
        />
      </label>
      <label className="block space-y-1 text-sm text-ink">
        <span>Season name</span>
        <input
          value={seasonName}
          onChange={(e) => setSeasonName(e.target.value)}
          className="w-full"
        />
      </label>
      <label className="block space-y-1 text-sm text-ink">
        <span>Year</span>
        <input
          type="number"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="w-full"
        />
      </label>
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-full bg-garnet-600 px-5 py-3 text-base font-semibold text-sand shadow hover:bg-garnet-500 disabled:opacity-50"
      >
        {loading ? 'Importing…' : 'Run import'}
      </button>
    </form>
  );
}
