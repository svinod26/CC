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

export type AdminRosterPlayer = {
  id: string;
  name: string;
  email: string | null;
  activeTeamName: string | null;
  hasMultipleActiveTeams: boolean;
};

type RosterPreview = {
  fingerprint: string;
  request: { name: string; email: string; teamId: string };
  season: { id: string; name: string };
  team: { id: string; name: string };
  player: {
    name: string;
    email: string;
  };
  linkedUser: { id: string; name: string | null } | null;
  action: 'CREATE_PLAYER';
  changed: boolean;
  requiredConfirmations: AdminRosterConfirmation[];
  warnings: Array<{ code: AdminRosterConfirmation; message: string }>;
};

type AssignmentPreview = {
  fingerprint: string;
  request: { playerId: string; teamId: string | null };
  season: { id: string; name: string };
  player: { id: string; name: string; email: string | null };
  currentTeam: { id: string; name: string } | null;
  destinationTeam: { id: string; name: string } | null;
  action: 'ASSIGN_PLAYER' | 'MOVE_PLAYER' | 'UNASSIGN_PLAYER' | 'NO_CHANGE';
  changed: boolean;
  requiredConfirmations: AdminRosterConfirmation[];
  warnings: Array<{ code: AdminRosterConfirmation; message: string }>;
};

export function AdminRosterManager({
  latestSeason,
  players
}: {
  latestSeason: AdminRosterSeason | null;
  players: AdminRosterPlayer[];
}) {
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
  const [assignmentPlayerId, setAssignmentPlayerId] = useState('');
  const [assignmentTeamId, setAssignmentTeamId] = useState('');
  const [assignmentPreview, setAssignmentPreview] = useState<AssignmentPreview | null>(null);
  const [assignmentConfirmations, setAssignmentConfirmations] = useState<AdminRosterConfirmation[]>([]);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [assignmentDialogError, setAssignmentDialogError] = useState<string | null>(null);
  const [isAssignmentPreviewing, setIsAssignmentPreviewing] = useState(false);
  const [isAssignmentCommitting, setIsAssignmentCommitting] = useState(false);
  const canAddPlayer = Boolean(latestSeason && latestSeason.teams.length > 0);

  const canCommit = useMemo(
    () =>
      Boolean(preview?.changed) &&
      (preview?.requiredConfirmations.every((confirmation) =>
        confirmations.includes(confirmation)
      ) ?? false),
    [confirmations, preview]
  );
  const canCommitAssignment = useMemo(
    () =>
      Boolean(assignmentPreview?.changed) &&
      (assignmentPreview?.requiredConfirmations.every((confirmation) =>
        assignmentConfirmations.includes(confirmation)
      ) ?? false),
    [assignmentConfirmations, assignmentPreview]
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
        setError(body?.error ?? 'Unable to preview that new player.');
        return;
      }

      setPreview(body.plan as RosterPreview);
      setConfirmations([]);
      setDialogError(null);
    } catch {
      setError('Network error. No player or roster data were changed.');
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
        setDialogError(body?.error ?? 'Unable to create that new player.');
        return;
      }

      const result = body.result as {
        playerName: string;
        teamName: string;
        seasonName: string;
      };
      setMessage(`Created and assigned ${result.playerName} to ${result.teamName} · ${result.seasonName}.`);
      setName('');
      setEmail('');
      setTeamId('');
      setPreview(null);
      setConfirmations([]);
      router.refresh();
    } catch {
      setDialogError('Network error. No new player was created.');
    } finally {
      setIsCommitting(false);
    }
  };

  const closeAssignmentPreview = () => {
    if (isAssignmentCommitting) return;
    setAssignmentPreview(null);
    setAssignmentConfirmations([]);
    setAssignmentDialogError(null);
  };

  const requestAssignmentPreview = async (event: React.FormEvent) => {
    event.preventDefault();
    setAssignmentError(null);
    setMessage(null);
    setIsAssignmentPreviewing(true);
    try {
      const response = await fetch('/api/admin/roster-assignments/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: assignmentPlayerId,
          teamId: assignmentTeamId || null
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setAssignmentError(body?.error ?? 'Unable to preview that roster assignment.');
        return;
      }
      setAssignmentPreview(body.plan as AssignmentPreview);
      setAssignmentConfirmations([]);
      setAssignmentDialogError(null);
    } catch {
      setAssignmentError('Network error. No roster changes were made.');
    } finally {
      setIsAssignmentPreviewing(false);
    }
  };

  const commitAssignment = async () => {
    if (!assignmentPreview || !canCommitAssignment) return;
    setAssignmentDialogError(null);
    setIsAssignmentCommitting(true);
    try {
      const response = await fetch('/api/admin/roster-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...assignmentPreview.request,
          fingerprint: assignmentPreview.fingerprint,
          confirmations: assignmentConfirmations
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setAssignmentDialogError(body?.error ?? 'Unable to change that roster assignment.');
        return;
      }
      const result = body.result as {
        action: AssignmentPreview['action'];
        playerName: string;
        teamName: string | null;
        seasonName: string;
      };
      setMessage(
        result.action === 'UNASSIGN_PLAYER'
          ? `Unassigned ${result.playerName} from ${result.seasonName}.`
          : `${result.action === 'MOVE_PLAYER' ? 'Moved' : 'Assigned'} ${result.playerName} to ${result.teamName} · ${result.seasonName}.`
      );
      setAssignmentPreview(null);
      setAssignmentConfirmations([]);
      router.refresh();
    } catch {
      setAssignmentDialogError('Network error. No roster change was confirmed.');
    } finally {
      setIsAssignmentCommitting(false);
    }
  };

  return (
    <section className="min-w-0 rounded-2xl border border-garnet-100 bg-white/85 p-4 shadow sm:p-5">
      <div>
        <p className="text-xs uppercase tracking-wide text-garnet-600">Roster Management</p>
        <h2 className="text-lg font-semibold text-ink">Add new player to Site</h2>
        <p className="text-xs text-ash">
          {latestSeason?.teams.length
            ? `Creates a new Player and assigns them to a team in the latest season, ${latestSeason.name}. This is only for allowing new people access to the site.`
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
          {isPreviewing ? 'Checking…' : 'Review new player'}
        </button>
      </form>

      {error && (
        <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      )}

      <div className="mt-6 border-t border-garnet-100 pt-5">
        <h3 className="text-base font-semibold text-ink">Move, assign, or unassign existing player</h3>
        <p className="mt-1 text-xs text-ash">
          Changes only the active team for {latestSeason?.name ?? 'the latest season'}. Historical memberships,
          games, lineups, and stats are retained.
        </p>
        <form
          className="mt-4 grid gap-3 lg:grid-cols-[1.2fr_1fr_auto] lg:items-end"
          onSubmit={requestAssignmentPreview}
        >
          <label className="space-y-1 text-sm text-ink">
            <span>Existing player</span>
            <select
              required
              disabled={!canAddPlayer || isAssignmentPreviewing}
              value={assignmentPlayerId}
              onChange={(event) => setAssignmentPlayerId(event.target.value)}
              className="min-h-11 w-full rounded-lg border border-garnet-100 bg-white px-3 py-2 disabled:opacity-60"
            >
              <option value="">Select player</option>
              {players.map((player) => (
                <option key={player.id} value={player.id} disabled={player.hasMultipleActiveTeams}>
                  {player.name} · {player.activeTeamName ?? 'Unassigned'}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm text-ink">
            <span>New active team</span>
            <select
              disabled={!canAddPlayer || isAssignmentPreviewing}
              value={assignmentTeamId}
              onChange={(event) => setAssignmentTeamId(event.target.value)}
              className="min-h-11 w-full rounded-lg border border-garnet-100 bg-white px-3 py-2 disabled:opacity-60"
            >
              <option value="">Unassigned</option>
              {latestSeason?.teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={!canAddPlayer || !assignmentPlayerId || isAssignmentPreviewing}
            className="min-h-11 rounded-full border border-garnet-300 bg-garnet-700 px-5 py-2 text-sm font-semibold text-white hover:bg-garnet-600 disabled:opacity-50"
          >
            {isAssignmentPreviewing ? 'Checking…' : 'Review assignment'}
          </button>
        </form>
        {assignmentError && (
          <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {assignmentError}
          </p>
        )}
      </div>

      <Dialog open={Boolean(preview)} onClose={closePreview} className="relative z-50">
        <DialogBackdrop className="fixed inset-0 bg-ink/45" />
        <div className="fixed inset-0 flex items-center justify-center overflow-y-auto p-4">
          <DialogPanel className="w-full max-w-xl rounded-2xl border border-garnet-100 bg-white p-5 shadow-2xl">
            <DialogTitle className="text-xl font-bold text-ink">Review new player</DialogTitle>
            {preview && (
              <div className="mt-4 space-y-4">
                <div className="rounded-xl border border-garnet-100 bg-parchment/60 p-3 text-sm">
                  <p className="font-semibold text-ink">Create new Player</p>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                    <dt className="text-ash">Player</dt>
                    <dd className="font-medium text-ink">{preview.player.name}</dd>
                    <dt className="text-ash">Email</dt>
                    <dd className="break-all font-medium text-garnet-700">{preview.player.email}</dd>
                    <dt className="text-ash">Team</dt>
                    <dd className="font-medium text-ink">{preview.team.name}</dd>
                    <dt className="text-ash">Season</dt>
                    <dd className="font-medium text-ink">{preview.season.name} (latest)</dd>
                  </dl>
                </div>

                <p className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
                  This creates one global Player and one initial roster membership. It does not create a User account;
                  the player can request a password afterward using this email.
                </p>

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
                      {isCommitting ? 'Adding…' : 'Confirm new player'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </DialogPanel>
        </div>
      </Dialog>

      <Dialog open={Boolean(assignmentPreview)} onClose={closeAssignmentPreview} className="relative z-50">
        <DialogBackdrop className="fixed inset-0 bg-ink/45" />
        <div className="fixed inset-0 flex items-center justify-center overflow-y-auto p-4">
          <DialogPanel className="w-full max-w-xl rounded-2xl border border-garnet-100 bg-white p-5 shadow-2xl">
            <DialogTitle className="text-xl font-bold text-ink">Review roster assignment</DialogTitle>
            {assignmentPreview && (
              <div className="mt-4 space-y-4">
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl border border-garnet-100 bg-parchment/60 p-3 text-sm">
                  <dt className="text-ash">Player</dt>
                  <dd className="font-medium text-ink">{assignmentPreview.player.name}</dd>
                  <dt className="text-ash">Current team</dt>
                  <dd className="font-medium text-ink">{assignmentPreview.currentTeam?.name ?? 'Unassigned'}</dd>
                  <dt className="text-ash">New team</dt>
                  <dd className="font-medium text-ink">{assignmentPreview.destinationTeam?.name ?? 'Unassigned'}</dd>
                  <dt className="text-ash">Season</dt>
                  <dd className="font-medium text-ink">{assignmentPreview.season.name} (latest)</dd>
                </dl>

                <p className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
                  This changes only active roster eligibility. No Player, User, game, lineup, shot, legacy stat, or
                  historical roster row will be deleted or reassigned.
                </p>

                {!assignmentPreview.changed && (
                  <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    This player already has the selected assignment. No data will be changed.
                  </p>
                )}

                {assignmentPreview.warnings.map((warning) => (
                  <label
                    key={warning.code}
                    className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4"
                      checked={assignmentConfirmations.includes(warning.code)}
                      disabled={isAssignmentCommitting}
                      onChange={(event) =>
                        setAssignmentConfirmations((current) =>
                          event.target.checked
                            ? [...current, warning.code]
                            : current.filter((confirmation) => confirmation !== warning.code)
                        )
                      }
                    />
                    <span>{warning.message}</span>
                  </label>
                ))}

                {assignmentDialogError && (
                  <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                    {assignmentDialogError}
                  </p>
                )}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeAssignmentPreview}
                    disabled={isAssignmentCommitting}
                    className="rounded-full border border-garnet-100 px-4 py-2 text-sm font-semibold text-ash hover:bg-parchment disabled:opacity-50"
                  >
                    {assignmentPreview.changed ? 'Cancel' : 'Close'}
                  </button>
                  {assignmentPreview.changed && (
                    <button
                      type="button"
                      onClick={commitAssignment}
                      disabled={!canCommitAssignment || isAssignmentCommitting}
                      className="rounded-full border border-garnet-300 bg-garnet-700 px-4 py-2 text-sm font-semibold text-white hover:bg-garnet-600 disabled:opacity-50"
                    >
                      {isAssignmentCommitting ? 'Saving…' : 'Confirm assignment'}
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
