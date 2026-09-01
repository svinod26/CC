'use client';

import { useMemo, useRef, useState } from 'react';
import type { SeasonImportDraft } from '@/lib/excel';
import type {
  SeasonImportIssue,
  SeasonImportPlayerResolution
} from '@/lib/season-import-plan';
import {
  sameSeasonImportTeamName,
  selectionModeForEditedTeamName
} from '@/lib/season-import-team';

type ImportPlan = {
  fingerprint: string;
  draft: SeasonImportDraft;
  issues: SeasonImportIssue[];
  playerRows: SeasonImportPlayerResolution[];
  playerOptions: Array<{ id: string; name: string; email: string | null }>;
  teamOptions: Array<{ name: string }>;
  teamSourceSeason: { id: string; name: string } | null;
  canCommit: boolean;
  counts: { teams: number; players: number; schedule: number; blockingIssues: number };
};

const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

const inputClass = 'min-h-10 w-full rounded-lg border border-garnet-100 bg-white px-3 py-2 text-sm text-ink';

export function ImportForm() {
  const [file, setFile] = useState<File | null>(null);
  const [seasonName, setSeasonName] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [draft, setDraft] = useState<SeasonImportDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [editingTeamIds, setEditingTeamIds] = useState<Set<string>>(() => new Set());
  const reviewRef = useRef<HTMLDivElement>(null);

  const resolutions = useMemo(
    () => new Map(plan?.playerRows.map((row) => [row.rowId, row]) ?? []),
    [plan]
  );
  const canCommit = Boolean(plan?.canCommit && !dirty && reviewed && draft && !committing);

  const acceptPlan = (nextPlan: ImportPlan) => {
    setPlan(nextPlan);
    setDraft(nextPlan.draft);
    setDirty(false);
    setReviewed(false);
    setError(null);
    setEditingTeamIds(new Set());
    setTimeout(() => reviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  const startPreview = async (manual: boolean) => {
    if (!seasonName.trim()) {
      setError('Enter the season name, such as F2026.');
      return;
    }
    if (!manual && !file) {
      setError('Choose a Century Cup Excel file first.');
      return;
    }
    setLoading(true);
    setError(null);
    setMessage(null);
    const formData = new FormData();
    formData.set('seasonName', seasonName);
    formData.set('year', String(year));
    if (!manual && file) formData.set('file', file);
    try {
      const response = await fetch('/api/admin/import/preview', { method: 'POST', body: formData });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body?.error ?? 'Unable to preview that import.');
        return;
      }
      acceptPlan(body.plan as ImportPlan);
    } catch {
      setError('Network error. No League data was changed.');
    } finally {
      setLoading(false);
    }
  };

  const changeDraft = (updater: (current: SeasonImportDraft) => SeasonImportDraft) => {
    setDraft((current) => current ? updater(current) : current);
    setDirty(true);
    setReviewed(false);
    setMessage(null);
  };

  const validateDraft = async () => {
    if (!draft) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/import/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body?.error ?? 'Unable to validate the edited import.');
        return;
      }
      acceptPlan(body.plan as ImportPlan);
    } catch {
      setError('Network error. No League data was changed.');
    } finally {
      setLoading(false);
    }
  };

  const commit = async () => {
    if (!canCommit || !draft || !plan) return;
    setCommitting(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft, fingerprint: plan.fingerprint, reviewed: true })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body?.error ?? 'Unable to create the season.');
        return;
      }
      setMessage(`Created ${body.result.seasonName} with ${body.result.teams} teams, ${body.result.players} players, and ${body.result.scheduleRows} schedule rows.`);
      setPlan(null);
      setDraft(null);
      setFile(null);
      setReviewed(false);
      setEditingTeamIds(new Set());
    } catch {
      setError('Network error. The season was not confirmed.');
    } finally {
      setCommitting(false);
    }
  };

  const updateTeamName = (teamId: string, nextName: string) => changeDraft((current) => {
    return {
      ...current,
      teams: current.teams.map((team) => team.id === teamId ? {
        ...team,
        name: nextName,
        selectionMode: selectionModeForEditedTeamName({
          sourceName: team.sourceName,
          nextName,
          previousSeasonNames: plan?.teamOptions.map((option) => option.name) ?? []
        })
      } : team)
    };
  });

  const addTeam = () => {
    const id = newId('team');
    changeDraft((current) => ({
      ...current,
      teams: [...current.teams, {
        id,
        sourceName: '',
        name: '',
        selectionMode: 'RENAMED',
        source: 'Manual entry'
      }]
    }));
    setEditingTeamIds((current) => new Set(current).add(id));
  };

  const selectRosterPlayer = (rowId: string, playerId: string) => changeDraft((current) => {
    const selectedPlayer = plan?.playerOptions.find((player) => player.id === playerId) ?? null;
    return {
      ...current,
      players: current.players.map((row) => row.id === rowId ? {
        ...row,
        playerId: selectedPlayer?.id ?? null,
        rawName: row.entryMode === 'MANUAL' ? selectedPlayer?.name ?? '' : row.rawName,
        email: row.entryMode === 'MANUAL' ? undefined : row.email,
        rememberAlias: false
      } : row)
    };
  });

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-garnet-100 bg-white/85 p-4 shadow sm:p-5">
        <div className="grid gap-3 md:grid-cols-[1fr_0.45fr]">
          <label className="space-y-1 text-sm text-ink">
            <span>Season name</span>
            <input value={seasonName} onChange={(event) => setSeasonName(event.target.value)} placeholder="F2026" maxLength={50} className={inputClass} />
          </label>
          <label className="space-y-1 text-sm text-ink">
            <span>Year</span>
            <input type="number" min={2000} max={2100} value={year} onChange={(event) => setYear(Number(event.target.value))} className={inputClass} />
          </label>
        </div>
        <label className="mt-3 block space-y-1 text-sm text-ink">
          <span>Century Cup xlsx</span>
          <input type="file" accept=".xlsx,.xls" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="w-full text-sm" />
          <span className="block text-xs text-ash">The standard Draft and Full Schedule layout is expected. Existing normalized import files remain supported.</span>
        </label>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={loading} onClick={() => startPreview(false)} className="rounded-full bg-garnet-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-garnet-600 disabled:opacity-50">
            {loading ? 'Preparing…' : 'Upload and review'}
          </button>
          <button type="button" disabled={loading} onClick={() => startPreview(true)} className="rounded-full border border-garnet-200 px-5 py-2.5 text-sm font-semibold text-garnet-700 hover:bg-gold-50 disabled:opacity-50">
            Enter season manually
          </button>
        </div>
        <p className="mt-3 text-xs text-ash">All imported teams are placed in the League conference. Uploading and validating are read only.</p>
      </section>

      {message && <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</p>}
      {error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}

      {draft && plan && (
        <div ref={reviewRef} className="space-y-5 scroll-mt-4">
          <section className="rounded-2xl border border-garnet-100 bg-white/90 p-4 shadow sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-garnet-600">League import review</p>
                <h2 className="text-xl font-bold text-ink">{draft.layout === 'MANUAL' ? 'Manual season' : draft.layout === 'CENTURY_CUP_RAW' ? 'Century Cup workbook' : 'Normalized workbook'}</h2>
                <p className="text-sm text-ash">{plan.counts.teams} teams · {plan.counts.players} players · {plan.counts.schedule} games</p>
              </div>
              <div className={`rounded-full px-3 py-1 text-sm font-semibold ${dirty ? 'bg-amber-100 text-amber-900' : plan.canCommit ? 'bg-emerald-100 text-emerald-900' : 'bg-rose-100 text-rose-900'}`}>
                {dirty ? 'Changes need validation' : plan.canCommit ? 'Ready after final review' : `${plan.counts.blockingIssues} blocking issue${plan.counts.blockingIssues === 1 ? '' : 's'}`}
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_0.4fr]">
              <label className="space-y-1 text-sm"><span>Season name</span><input className={inputClass} value={draft.seasonName} onChange={(event) => changeDraft((current) => ({ ...current, seasonName: event.target.value }))} /></label>
              <label className="space-y-1 text-sm"><span>Year</span><input className={inputClass} type="number" min={2000} max={2100} value={draft.year} onChange={(event) => changeDraft((current) => ({ ...current, year: Number(event.target.value) }))} /></label>
            </div>
          </section>

          {!dirty && plan.issues.length > 0 && (
            <section className="rounded-2xl border border-garnet-100 bg-white/90 p-4 shadow sm:p-5">
              <h3 className="font-semibold text-ink">Validation findings</h3>
              <div className="mt-3 space-y-2">
                {plan.issues.map((issue, index) => (
                  <p key={`${issue.code}-${issue.path}-${index}`} className={`rounded-lg border px-3 py-2 text-sm ${issue.blocking ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
                    <span className="font-semibold">{issue.blocking ? 'Fix required' : 'Review'}:</span> {issue.message} <span className="text-xs opacity-70">({issue.path})</span>
                  </p>
                ))}
              </div>
            </section>
          )}

          <section className="rounded-2xl border border-garnet-100 bg-white/90 p-4 shadow sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-ink">Teams</h3>
                <p className="text-xs text-ash">
                  {plan.teamSourceSeason
                    ? `Team names carry forward from ${plan.teamSourceSeason.name}. Any different xlsx name is kept and flagged for verification.`
                    : 'No earlier League season was found. Verify each new team name carefully.'}
                </p>
              </div>
              <button type="button" onClick={addTeam} className="rounded-full border border-garnet-200 px-3 py-1.5 text-sm font-semibold text-garnet-700">Add team</button>
            </div>
            <div className="mt-3 space-y-3">
              {draft.teams.map((team) => {
                const isEditing = editingTeamIds.has(team.id) || !team.name;
                const sourceChanged = Boolean(
                  team.sourceName && !sameSeasonImportTeamName(team.sourceName, team.name)
                );
                return (
                  <div key={team.id} className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 ${team.selectionMode === 'RENAMED' ? 'border-amber-200 bg-amber-50/40' : 'border-garnet-100'}`}>
                    <div className="min-w-0 flex-1">
                      {isEditing ? (
                        <label className="block space-y-1 text-xs text-ash">
                          <span>Team name for {draft.seasonName}</span>
                          <input autoFocus={!team.name} className={inputClass} value={team.name} maxLength={100} onChange={(event) => updateTeamName(team.id, event.target.value)} />
                        </label>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-ink">{team.name}</span>
                          {team.selectionMode === 'RENAMED' && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">New name · verify spelling</span>}
                        </div>
                      )}
                      {sourceChanged && <span className="mt-1 block text-xs text-ash">Originally: {team.sourceName}</span>}
                    </div>
                    <button type="button" disabled={isEditing && !team.name.trim()} onClick={() => setEditingTeamIds((current) => { const next = new Set(current); if (isEditing) next.delete(team.id); else next.add(team.id); return next; })} className="rounded-lg border border-garnet-200 px-3 py-2 text-sm font-semibold text-garnet-700 disabled:opacity-50">{isEditing ? 'Done' : 'Edit name'}</button>
                    <button type="button" aria-label={`Remove ${team.name || 'team'}`} onClick={() => { changeDraft((current) => ({ ...current, teams: current.teams.filter((item) => item.id !== team.id) })); setEditingTeamIds((current) => { const next = new Set(current); next.delete(team.id); return next; }); }} className="rounded-lg border border-rose-200 px-3 py-2 text-rose-700">×</button>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-garnet-100 bg-white/90 p-4 shadow sm:p-5">
            <div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold text-ink">Roster Assignments</h3><p className="text-xs text-ash">Every row must point to one existing Player. Nothing here creates or updates a Player or User. For a new player that is NOT here: remove them now, create the season, then add them in admin panel. OR add them to the platform and then remake the season</p></div><button type="button" onClick={() => changeDraft((current) => ({ ...current, players: [...current.players, { id: newId('player'), entryMode: 'MANUAL', rawName: '', teamId: current.teams[0]?.id ?? '', teamName: current.teams[0]?.name ?? '', source: 'Manual entry', playerId: null, rememberAlias: false }] }))} className="rounded-full border border-garnet-200 px-3 py-1.5 text-sm font-semibold text-garnet-700">Add player</button></div>
            <div className="mt-3 space-y-3">
              {draft.players.map((row) => {
                const resolution = resolutions.get(row.id);
                const isManualRow = row.entryMode === 'MANUAL';
                return (
                  <div key={row.id} className={`grid gap-2 rounded-xl border p-3 ${isManualRow ? 'lg:grid-cols-[0.6fr_1fr_auto]' : 'lg:grid-cols-[0.8fr_0.55fr_1fr_auto]'} ${resolution?.resolvedPlayerId ? 'border-emerald-200 bg-emerald-50/40' : 'border-rose-200 bg-rose-50/40'}`}>
                    {!isManualRow && <div className="space-y-1 text-xs text-ash"><span>Workbook name</span><div className="min-h-10 rounded-lg border border-garnet-100 bg-gold-50 px-3 py-2 text-sm text-ink">{row.rawName || '(blank)'}</div></div>}
                    <label className="space-y-1 text-xs text-ash"><span>Team</span><select className={inputClass} value={row.teamId} onChange={(event) => changeDraft((current) => { const selectedTeam = current.teams.find((team) => team.id === event.target.value); return { ...current, players: current.players.map((item) => item.id === row.id ? { ...item, teamId: selectedTeam?.id ?? '', teamName: selectedTeam?.name ?? '' } : item) }; })}><option value="">Select</option>{draft.teams.map((team) => <option key={team.id} value={team.id}>{team.name || team.sourceName}</option>)}</select></label>
                    <div className="space-y-1 text-xs text-ash"><label htmlFor={`player-resolution-${row.id}`}>Existing Player {resolution ? `· ${resolution.matchReason}` : ''}</label><select id={`player-resolution-${row.id}`} className={inputClass} value={row.playerId ?? ''} onChange={(event) => selectRosterPlayer(row.id, event.target.value)}><option value="">Needs selection</option>{plan.playerOptions.map((player) => <option key={player.id} value={player.id}>{player.name}{player.email ? ` · ${player.email}` : ''}</option>)}</select>{!isManualRow && resolution && resolution.candidates.length > 0 && <span className="block text-[11px]">Suggestions: {resolution.candidates.map((item) => item.name).join(', ')}</span>}{!isManualRow && resolution?.canRememberAlias && <label className="mt-1 flex items-center gap-2 text-xs text-ink"><input type="checkbox" checked={row.rememberAlias} onChange={(event) => changeDraft((current) => ({ ...current, players: current.players.map((item) => item.id === row.id ? { ...item, rememberAlias: event.target.checked } : item) }))} />Remember “{row.rawName}” as an alias</label>}</div>
                    <button type="button" aria-label={`Remove ${row.rawName || 'player'}`} onClick={() => changeDraft((current) => ({ ...current, players: current.players.filter((item) => item.id !== row.id) }))} className="self-end rounded-lg border border-rose-200 px-3 py-2 text-rose-700">×</button>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-garnet-100 bg-white/90 p-4 shadow sm:p-5">
            <div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold text-ink">Schedule</h3><p className="text-xs text-ash">Schedule rows are optional, but every included row must be valid.</p></div><button type="button" onClick={() => changeDraft((current) => ({ ...current, schedule: [...current.schedule, { id: newId('schedule'), week: 1, homeTeamId: current.teams[0]?.id ?? '', awayTeamId: current.teams[1]?.id ?? '', home: current.teams[0]?.name ?? '', away: current.teams[1]?.name ?? '', source: 'Manual entry' }] }))} className="rounded-full border border-garnet-200 px-3 py-1.5 text-sm font-semibold text-garnet-700">Add game</button></div>
            <div className="mt-3 space-y-2">
              {draft.schedule.map((row) => (
                <div key={row.id} className="grid gap-2 rounded-xl border border-garnet-100 p-3 sm:grid-cols-[0.3fr_1fr_1fr_auto]">
                  <label className="space-y-1 text-xs text-ash"><span>Week</span><input className={inputClass} type="number" min={1} value={row.week} onChange={(event) => changeDraft((current) => ({ ...current, schedule: current.schedule.map((item) => item.id === row.id ? { ...item, week: Number(event.target.value) } : item) }))} /></label>
                  <label className="space-y-1 text-xs text-ash"><span>Home</span><select className={inputClass} value={row.homeTeamId} onChange={(event) => changeDraft((current) => { const selectedTeam = current.teams.find((team) => team.id === event.target.value); return { ...current, schedule: current.schedule.map((item) => item.id === row.id ? { ...item, homeTeamId: selectedTeam?.id ?? '', home: selectedTeam?.name ?? '' } : item) }; })}><option value="">Select</option>{draft.teams.map((team) => <option key={team.id} value={team.id}>{team.name || team.sourceName}</option>)}</select></label>
                  <label className="space-y-1 text-xs text-ash"><span>Away</span><select className={inputClass} value={row.awayTeamId} onChange={(event) => changeDraft((current) => { const selectedTeam = current.teams.find((team) => team.id === event.target.value); return { ...current, schedule: current.schedule.map((item) => item.id === row.id ? { ...item, awayTeamId: selectedTeam?.id ?? '', away: selectedTeam?.name ?? '' } : item) }; })}><option value="">Select</option>{draft.teams.map((team) => <option key={team.id} value={team.id}>{team.name || team.sourceName}</option>)}</select></label>
                  <button type="button" aria-label="Remove schedule row" onClick={() => changeDraft((current) => ({ ...current, schedule: current.schedule.filter((item) => item.id !== row.id) }))} className="self-end rounded-lg border border-rose-200 px-3 py-2 text-rose-700">×</button>
                </div>
              ))}
            </div>
          </section>

          <section className="sticky bottom-3 rounded-2xl border border-garnet-200 bg-white/95 p-4 shadow-xl backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-2">
                <label className="flex items-start gap-2 text-sm text-ink"><input type="checkbox" className="mt-1" checked={reviewed} disabled={dirty || !plan.canCommit} onChange={(event) => setReviewed(event.target.checked)} /><span>I reviewed every team, Player assignment, and schedule row shown above.</span></label>
                <p className="text-xs text-ash">Only Confirm creates data. Validation never writes to the database.</p>
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={loading} onClick={validateDraft} className="rounded-full border border-garnet-200 px-4 py-2 text-sm font-semibold text-garnet-700 disabled:opacity-50">{loading ? 'Validating…' : dirty ? 'Validate changes' : 'Revalidate'}</button>
                <button type="button" disabled={!canCommit} onClick={commit} className="rounded-full bg-garnet-700 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{committing ? 'Creating…' : `Confirm ${draft.seasonName}`}</button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
