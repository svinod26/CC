'use client';

import { useState } from 'react';

export function ImportForm() {
  const [file, setFile] = useState<File | null>(null);
  const [seasonName, setSeasonName] = useState('Century Cup Season');
  const [year, setYear] = useState(new Date().getFullYear());
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setMessage('Choose an Excel workbook first.');
      return;
    }
    setLoading(true);
    setMessage(null);
    const formData = new FormData();
    formData.set('file', file);
    formData.set('seasonName', seasonName);
    formData.set('year', String(year));
    try {
      const res = await fetch('/api/admin/import', {
        method: 'POST',
        body: formData
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(body?.error ?? 'Import failed');
      } else {
        setMessage(`Imported into season ${body.seasonId}`);
      }
    } catch {
      setMessage('Import failed. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-garnet-100 bg-white/85 p-4 shadow sm:p-5">
      {message && <div className="rounded-xl bg-gold-50 px-3 py-2 text-sm text-garnet-700">{message}</div>}
      <label className="block space-y-1 text-sm text-ink">
        <span>Excel workbook</span>
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="w-full"
          required
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
