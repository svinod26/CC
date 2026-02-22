'use client';

import { useMemo, useState } from 'react';

type AdminUser = {
  id: string;
  name: string | null;
  email: string;
  role: string;
  createdAt: string;
};

export function AdminUsersTable({ users }: { users: AdminUser[] }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return users;
    return users.filter((user) => {
      const name = (user.name ?? '').toLowerCase();
      const email = user.email.toLowerCase();
      const role = user.role.toLowerCase();
      return name.includes(term) || email.includes(term) || role.includes(term);
    });
  }, [users, query]);

  return (
    <div className="rounded-2xl border border-garnet-100 bg-white/85 p-4 shadow sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-garnet-600">Accounts</p>
          <h2 className="text-lg font-semibold text-ink">Registered users</h2>
          <p className="text-xs text-ash">{filtered.length} shown · {users.length} total</p>
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="w-full rounded-lg border border-garnet-100 bg-white px-3 py-2 text-sm text-ink sm:w-64"
          placeholder="Search name or email"
        />
      </div>

      <div className="mt-3 max-h-[440px] overflow-auto rounded-xl border border-garnet-100">
        <table className="min-w-full text-left text-sm">
          <thead className="sticky top-0 bg-parchment/90 text-xs uppercase tracking-wide text-ash">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Joined</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((user) => (
              <tr key={user.id} className="border-t border-garnet-100 bg-white/80">
                <td className="px-3 py-2 text-ink">{user.name ?? '—'}</td>
                <td className="px-3 py-2 text-garnet-700">{user.email}</td>
                <td className="px-3 py-2 text-ash">{user.role}</td>
                <td className="px-3 py-2 text-ash">{new Date(user.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td className="px-3 py-4 text-ash" colSpan={4}>
                  No users match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
