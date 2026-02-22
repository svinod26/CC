'use client';

import useSWR from 'swr';

type AuditLogRow = {
  id: string;
  createdAt: string;
  action: string;
  summary: string;
  actorName: string | null;
  actorEmail: string | null;
  gameId: string | null;
  gameLabel: string | null;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function AdminAuditLog() {
  const { data } = useSWR<{ logs: AuditLogRow[] }>('/api/admin/audit-log?limit=120', fetcher, {
    refreshInterval: 5000
  });
  const logs = data?.logs ?? [];

  return (
    <section className="rounded-2xl border border-garnet-100 bg-white/85 p-4 shadow sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-garnet-600">Audit</p>
          <h2 className="text-lg font-semibold text-ink">Immutable admin change log</h2>
          <p className="text-xs text-ash">Latest commissioner actions (auto-updates).</p>
        </div>
      </div>

      <div className="mt-3 max-h-[360px] overflow-auto rounded-xl border border-garnet-100">
        <table className="min-w-full text-left text-sm">
          <thead className="sticky top-0 bg-parchment/90 text-xs uppercase tracking-wide text-ash">
            <tr>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Admin</th>
              <th className="px-3 py-2">Game</th>
              <th className="px-3 py-2">Change</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-t border-garnet-100 bg-white/80">
                <td className="whitespace-nowrap px-3 py-2 text-ash">
                  {new Date(log.createdAt).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-ink">
                  {log.actorName ?? 'Admin'}
                  {log.actorEmail ? (
                    <span className="ml-1 text-xs text-ash">({log.actorEmail})</span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-ash">{log.gameLabel ?? '—'}</td>
                <td className="px-3 py-2 text-garnet-700">{log.summary}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td className="px-3 py-4 text-ash" colSpan={4}>
                  No admin changes logged yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
