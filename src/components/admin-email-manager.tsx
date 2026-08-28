'use client';

import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle
} from '@headlessui/react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

export type AdminEmailIdentityRow = {
  targetType: 'PLAYER' | 'USER';
  targetId: string;
  name: string;
  email: string | null;
  teamContext: string | null;
  userId: string | null;
  userRole: 'ADMIN' | 'USER' | null;
};

const normalizeEmail = (value: string) => value.trim().toLowerCase();

const statusFor = (row: AdminEmailIdentityRow) => {
  if (row.targetType === 'USER') return row.userRole === 'ADMIN' ? 'Admin account' : 'Standalone account';
  if (!row.email) return 'No email';
  if (row.userId) return row.userRole === 'ADMIN' ? 'Registered admin' : 'Registered';
  return 'Player only';
};

const statusClassFor = (row: AdminEmailIdentityRow) => {
  if (!row.email) return 'border-amber-200 bg-amber-50 text-amber-800';
  if (row.userRole === 'ADMIN') return 'border-violet-200 bg-violet-50 text-violet-800';
  if (row.userId) return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  return 'border-sky-200 bg-sky-50 text-sky-800';
};

export function AdminEmailManager({ identities }: { identities: AdminEmailIdentityRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'NEEDS_EMAIL' | 'ALL'>('NEEDS_EMAIL');
  const [selected, setSelected] = useState<AdminEmailIdentityRow | null>(null);
  const [email, setEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const needsEmailCount = useMemo(
    () => identities.filter((identity) => identity.targetType === 'PLAYER' && !identity.email).length,
    [identities]
  );

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return identities.filter((identity) => {
      if (view === 'NEEDS_EMAIL' && (identity.targetType !== 'PLAYER' || identity.email)) return false;
      if (!term) return true;
      return (
        identity.name.toLowerCase().includes(term) ||
        (identity.email ?? '').toLowerCase().includes(term) ||
        (identity.teamContext ?? '').toLowerCase().includes(term) ||
        statusFor(identity).toLowerCase().includes(term)
      );
    });
  }, [identities, query, view]);

  const beginEdit = (identity: AdminEmailIdentityRow) => {
    setSelected(identity);
    setEmail(identity.email ?? '');
    setConfirmEmail(identity.email ?? '');
    setError(null);
  };

  const closeDialog = () => {
    if (isSubmitting) return;
    setSelected(null);
    setError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;

    const normalizedEmail = normalizeEmail(email);
    const normalizedConfirmation = normalizeEmail(confirmEmail);
    if (!normalizedEmail) {
      setError('Enter a valid email. Removing an email is not supported by this tool.');
      return;
    }
    if (normalizedEmail !== normalizedConfirmation) {
      setError('The two email entries do not match.');
      return;
    }

    setError(null);
    setMessage(null);
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/admin/email-identities', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType: selected.targetType,
          targetId: selected.targetId,
          email: normalizedEmail,
          expectedCurrentEmail: selected.email
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body?.error ?? 'Unable to update that email.');
        return;
      }

      const changed = Boolean(body?.result?.changed);
      setMessage(
        changed
          ? `Updated the email for ${selected.name}.`
          : `${selected.name} already uses that email.`
      );
      setSelected(null);
      router.refresh();
    } catch {
      setError('Network error. No email change was confirmed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-garnet-100 bg-white/85 shadow">
      <div className="border-b border-garnet-100 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-garnet-600">Identity</p>
            <h2 className="text-lg font-semibold text-ink">Email management</h2>
            <p className="text-xs text-ash">
              Add Player emails or update a Player and its registered account together.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setView('NEEDS_EMAIL')}
              className={`rounded-full border px-3 py-2 text-xs font-semibold ${
                view === 'NEEDS_EMAIL'
                  ? 'border-garnet-300 bg-gold-50 text-garnet-700'
                  : 'border-garnet-100 bg-white text-ash hover:bg-gold-50/60'
              }`}
            >
              Needs email ({needsEmailCount})
            </button>
            <button
              type="button"
              onClick={() => setView('ALL')}
              className={`rounded-full border px-3 py-2 text-xs font-semibold ${
                view === 'ALL'
                  ? 'border-garnet-300 bg-gold-50 text-garnet-700'
                  : 'border-garnet-100 bg-white text-ash hover:bg-gold-50/60'
              }`}
            >
              All identities ({identities.length})
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-h-11 w-full rounded-lg border border-garnet-100 bg-white px-3 py-2 text-sm text-ink sm:max-w-sm"
            placeholder="Search player, email, team, or status"
          />
          <p className="text-xs text-ash">{filtered.length} shown</p>
        </div>

        {message && (
          <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {message}
          </p>
        )}
      </div>

      <div className="max-h-[34rem] overflow-auto">
        <table className="min-w-[760px] w-full text-left text-sm">
          <thead className="sticky top-0 bg-parchment/95 text-xs uppercase tracking-wide text-ash">
            <tr>
              <th className="px-4 py-2">Identity</th>
              <th className="px-3 py-2">Team context</th>
              <th className="px-3 py-2">Current email</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-4 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((identity) => (
              <tr key={`${identity.targetType}:${identity.targetId}`} className="border-t border-garnet-100 bg-white/80">
                <td className="px-4 py-3">
                  <p className="font-semibold text-ink">{identity.name}</p>
                  <p className="text-[11px] text-ash">
                    {identity.targetType === 'PLAYER' ? 'Player' : 'Standalone user'} · {identity.targetId}
                  </p>
                </td>
                <td className="px-3 py-3 text-ash">{identity.teamContext ?? '—'}</td>
                <td className="max-w-xs break-all px-3 py-3 text-garnet-700">{identity.email ?? '—'}</td>
                <td className="px-3 py-3">
                  <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${statusClassFor(identity)}`}>
                    {statusFor(identity)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => beginEdit(identity)}
                    className="rounded-full border border-garnet-200 px-3 py-2 text-xs font-semibold text-garnet-700 hover:bg-gold-50"
                  >
                    {identity.email ? 'Change email' : 'Add email'}
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-ash" colSpan={5}>
                  No identities match this view.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={Boolean(selected)} onClose={closeDialog} className="relative z-50">
        <DialogBackdrop className="fixed inset-0 bg-ink/45" />
        <div className="fixed inset-0 flex items-center justify-center overflow-y-auto p-4">
          <DialogPanel className="w-full max-w-lg rounded-2xl border border-garnet-100 bg-white p-5 shadow-2xl">
            <DialogTitle className="text-xl font-bold text-ink">
              {selected?.email ? 'Change email' : 'Add email'}
            </DialogTitle>
            {selected && (
              <form className="mt-4 space-y-4" onSubmit={submit}>
                <div className="rounded-xl border border-garnet-100 bg-parchment/60 p-3 text-sm">
                  <p className="font-semibold text-ink">{selected.name}</p>
                  <p className="text-ash">Current email: {selected.email ?? 'None'}</p>
                  <p className="text-ash">Status: {statusFor(selected)}</p>
                </div>

                {selected.targetType === 'PLAYER' && selected.userId && (
                  <p className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
                    This changes both the Player email and the linked registered login. Password, role, stats, games,
                    rosters, and aliases will not change.
                  </p>
                )}
                {selected.targetType === 'PLAYER' && !selected.userId && (
                  <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    This changes the Player record only. The player can create their registered account afterward from
                    the signup page.
                  </p>
                )}
                {selected.targetType === 'USER' && (
                  <p className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
                    This changes the standalone registered login only. The account password and role will not change.
                  </p>
                )}
                {selected.userRole === 'ADMIN' && (
                  <p className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm font-semibold text-violet-900">
                    This is an administrator account. Confirm the address carefully; its next sign-in must use the new
                    email.
                  </p>
                )}

                <label className="block space-y-1 text-sm text-ink">
                  <span>New email</span>
                  <input
                    type="email"
                    required
                    maxLength={254}
                    autoComplete="off"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="min-h-11 w-full rounded-lg border border-garnet-100 bg-white px-3 py-2"
                  />
                </label>
                <label className="block space-y-1 text-sm text-ink">
                  <span>Confirm new email</span>
                  <input
                    type="email"
                    required
                    maxLength={254}
                    autoComplete="off"
                    value={confirmEmail}
                    onChange={(event) => setConfirmEmail(event.target.value)}
                    className="min-h-11 w-full rounded-lg border border-garnet-100 bg-white px-3 py-2"
                  />
                </label>

                {error && (
                  <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                    {error}
                  </p>
                )}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeDialog}
                    disabled={isSubmitting}
                    className="rounded-full border border-garnet-100 px-4 py-2 text-sm font-semibold text-ash hover:bg-parchment disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="rounded-full border border-garnet-300 bg-garnet-700 px-4 py-2 text-sm font-semibold text-white hover:bg-garnet-600 disabled:opacity-50"
                  >
                    {isSubmitting ? 'Saving…' : 'Confirm email update'}
                  </button>
                </div>
              </form>
            )}
          </DialogPanel>
        </div>
      </Dialog>
    </section>
  );
}
