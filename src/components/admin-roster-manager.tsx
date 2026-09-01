'use client';

import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { AdminRosterConfirmation } from '@/lib/admin-roster-plan';

export type AdminRosterSeason = {
  id: string;
  name: string;
  teams: Array<{ id: string; name: string }>;
};

type RosterPreview = {
  fingerprint: string;
  request: { name: string; email: string; teamId: string };
  season: { id: string; name: string };
  team: { id: string; name: string };
  player: {
    id: string | null;
    name: string;
    currentEmail: string | null;
    email: string;
    willCreate: boolean;
    emailWillBeAssigned: boolean;
  };
  linkedUser: { id: string; name: string | null } | null;
  existingSeasonTeams: Array<{ id: string; name: string }>;
  alreadyRostered: boolean;
  changed: boolean;
  requiredConfirmations: AdminRosterConfirmation[];
  warnings: Array<{ code: AdminRosterConfirmation; message: string }>;
};

export function AdminRosterManager({ latestSeason }: { latestSeason: AdminRosterSeason | null }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [teamId, setTeamId] = useState('');
  const [preview, setPreview] = useState<RosterPreview | null>(null);
  const [confirmations, setConfirmations] = useState<AdminRosterConfirmation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const canAddPlayer = Boolean(latestSeason && latestSeason.teams.length > 0);

  const canCommit = useMemo(
    () =>
      Boolean(preview?.changed) &&
      (preview?.requiredConfirmations.every((confirmation) =>
        confirmations.includes(confirmation)
      ) ?? false),
    [confirmations, preview]
  );

  const closePreview = () => {
    if (isCommitting) return;
    setPreview(null);
    setConfirmations([]);
    setDialogError(null);
  };

  const requestPreview = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setIsPreviewing(true);
    try {
      const response = await fetch('/api/admin/roster-members/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, teamId })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body?.error ?? 'Unable to preview that roster addition.');
        return;
      }

      setPreview(body.plan as RosterPreview);
      setConfirmations([]);
      setDialogError(null);
    } catch {
      setError('Network error. No roster changes were made.');
    } finally {
      setIsPreviewing(false);
    }
  };

  const commit = async () => {
    if (!preview || !canCommit) return;
    setDialogError(null);
    setIsCommitting(true);
    try {
      const response = await fetch('/api/admin/roster-members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...preview.request,
          fingerprint: preview.fingerprint,
          confirmations
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setDialogError(body?.error ?? 'Unable to add that roster player.');
        return;
      }

      const result = body.result as {
        playerCreated: boolean;
        playerName: string;
        teamName: string;
        seasonName: string;
      };
      setMessage(
        `${result.playerCreated ? 'Created' : 'Reused'} ${result.playerName} and added them to ${result.teamName} · ${result.seasonName}.`
      );
      setName('');
      setEmail('');
      setPreview(null);
      setConfirmations([]);
      router.refresh();
    } catch {
      setDialogError('Network error. No roster change was confirmed.');
    } finally {
      setIsCommitting(false);
    }
  };

  return (
    <section className="min-w-0 rounded-2xl border border-garnet-100 bg-white/85 p-4 shadow sm:p-5">
      <div>
        <p className="text-xs uppercase tracking-wide text-garnet-600">Roster</p>
        <h2 className="text-lg font-semibold text-ink">Add player</h2>
        <p className="text-xs text-ash">
          {latestSeason?.teams.length
            ? `Creates or reuses a Player and adds them to the latest season, ${latestSeason.name}.`
            : latestSeason
              ? `${latestSeason.name} has no teams. Add or import its teams before adding roster players.`
              : 'Import a season before adding roster players.'}
        </p>
      </div>

      {message && (
        <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </p>
      )}

      <form className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_0.8fr_auto] lg:items-end" onSubmit={requestPreview}>
        <label className="space-y-1 text-sm text-ink">
          <span>Full name</span>
          <input
            type="text"
            required
            maxLength={100}
            autoComplete="off"
            disabled={!canAddPlayer || isPreviewing}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="min-h-11 w-full rounded-lg border border-garnet-100 bg-white px-3 py-2 disabled:opacity-60"
          />
        </label>
        <label className="space-y-1 text-sm text-ink">
          <span>Email</span>
          <input
            type="email"
            required
            maxLength={254}
            autoComplete="off"
            disabled={!canAddPlayer || isPreviewing}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="min-h-11 w-full rounded-lg border border-garnet-100 bg-white px-3 py-2 disabled:opacity-60"
          />
        </label>
        <label className="space-y-1 text-sm text-ink">
          <span>Team</span>
          <select
            required
            disabled={!canAddPlayer || isPreviewing}
            value={teamId}
            onChange={(event) => setTeamId(event.target.value)}
            className="min-h-11 w-full rounded-lg border border-garnet-100 bg-white px-3 py-2 disabled:opacity-60"
          >
            <option value="">Select team</option>
            {latestSeason?.teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={!canAddPlayer || isPreviewing}
          className="min-h-11 rounded-full border border-garnet-300 bg-garnet-700 px-5 py-2 text-sm font-semibold text-white hover:bg-garnet-600 disabled:opacity-50"
        >
          {isPreviewing ? 'Checking…' : 'Review addition'}
        </button>
      </form>

      {error && (
        <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      )}

      <Dialog open={Boolean(preview)} onClose={closePreview} className="relative z-50">
        <DialogBackdrop className="fixed inset-0 bg-ink/45" />
        <div className="fixed inset-0 flex items-center justify-center overflow-y-auto p-4">
          <DialogPanel className="w-full max-w-xl rounded-2xl border border-garnet-100 bg-white p-5 shadow-2xl">
            <DialogTitle className="text-xl font-bold text-ink">Review roster addition</DialogTitle>
            {preview && (
              <div className="mt-4 space-y-4">
                <div className="rounded-xl border border-garnet-100 bg-parchment/60 p-3 text-sm">
                  <p className="font-semibold text-ink">
                    {preview.player.willCreate ? 'Create new Player' : 'Reuse existing Player'}
                  </p>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                    <dt className="text-ash">Player</dt>
                    <dd className="font-medium text-ink">{preview.player.name}</dd>
                    {preview.player.id && (
                      <>
                        <dt className="text-ash">Player ID</dt>
                        <dd className="break-all text-xs text-ink">{preview.player.id}</dd>
                      </>
                    )}
                    <dt className="text-ash">Email</dt>
                    <dd className="break-all font-medium text-garnet-700">{preview.player.email}</dd>
                    <dt className="text-ash">Team</dt>
                    <dd className="font-medium text-ink">{preview.team.name}</dd>
                    <dt className="text-ash">Season</dt>
                    <dd className="font-medium text-ink">{preview.season.name} (latest)</dd>
                  </dl>
                </div>

                {preview.player.willCreate ? (
                  <p className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
                    This creates one global Player and one roster membership. It does not create a User account; the
                    player can request a password afterward using this email.
                  </p>
                ) : (
                  <p className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
                    Existing stats, games, aliases, and previous roster memberships remain attached to this Player.
                    {preview.player.emailWillBeAssigned
                      ? ' Their currently empty Player email will be set to the displayed email.'
                      : ' Their existing Player email will not be changed.'}
                  </p>
                )}

                {preview.alreadyRostered && (
                  <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    {preview.player.name} is already on {preview.team.name} for {preview.season.name}. No Player,
                    email, User, or roster data will be changed. Use Email management separately if an email needs
                    correction.
                  </p>
                )}

                {preview.warnings.map((warning) => (
                  <label
                    key={warning.code}
                    className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4"
                      checked={confirmations.includes(warning.code)}
                      disabled={isCommitting}
                      onChange={(event) =>
                        setConfirmations((current) =>
                          event.target.checked
                            ? [...current, warning.code]
                            : current.filter((confirmation) => confirmation !== warning.code)
                        )
                      }
                    />
                    <span>{warning.message}</span>
                  </label>
                ))}

                {dialogError && (
                  <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                    {dialogError}
                  </p>
                )}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closePreview}
                    disabled={isCommitting}
                    className="rounded-full border border-garnet-100 px-4 py-2 text-sm font-semibold text-ash hover:bg-parchment disabled:opacity-50"
                  >
                    {preview.changed ? 'Cancel' : 'Close'}
                  </button>
                  {preview.changed && (
                    <button
                      type="button"
                      onClick={commit}
                      disabled={!canCommit || isCommitting}
                      className="rounded-full border border-garnet-300 bg-garnet-700 px-4 py-2 text-sm font-semibold text-white hover:bg-garnet-600 disabled:opacity-50"
                    >
                      {isCommitting ? 'Adding…' : 'Confirm roster addition'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </DialogPanel>
        </div>
      </Dialog>
    </section>
  );
}
