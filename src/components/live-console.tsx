'use client';

import { GameState, GameType, ResultType, Team, GameLineup, Player, Turn } from '@prisma/client';
import useSWR from 'swr';
import { useMemo, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isMake } from '@/lib/stats';

type LineupWithPlayer = GameLineup & { player: Player };
type TurnWithEvents = Turn & {
  events: {
    id: string;
    shooterId: string | null;
    shooter: Player | null;
    resultType: ResultType;
    timestamp: string | Date;
  }[];
};

type GameStatePayload = {
  id: string;
  type: GameType;
  homeTeam: Team | null;
  awayTeam: Team | null;
  state: GameState | null;
  lineups: LineupWithPlayer[];
  turns: TurnWithEvents[];
};

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error('Failed to load game state');
  }
  return res.json();
};

const touchClass = 'touch-manipulation select-none active:scale-[0.98]';

export function LiveConsole({
  gameId,
  initialData,
  isScorer
}: {
  gameId: string;
  initialData: GameStatePayload;
  isScorer: boolean;
}) {
  const { data, mutate } = useSWR<GameStatePayload | null>(`/api/games/${gameId}/state`, fetcher, {
    fallbackData: initialData,
    refreshInterval: isScorer ? 900 : 1200,
    revalidateOnFocus: true
  });
  const router = useRouter();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [adjustCount, setAdjustCount] = useState(1);
  const [adjustTarget, setAdjustTarget] = useState<
    'PULL_HOME' | 'PULL_AWAY' | 'ADD_HOME' | 'ADD_AWAY' | null
  >(null);
  const [endConfirm, setEndConfirm] = useState(false);
  const [loadingAction, setLoadingAction] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const possessionTeamId = data?.state?.possessionTeamId;
  const offenseTeam = possessionTeamId
    ? [data?.homeTeam, data?.awayTeam].find((team) => team?.id === possessionTeamId)
    : data?.homeTeam;
  const phase = data?.state?.phase ?? 'REGULATION';

  const offenseLineup = useMemo(
    () =>
      (data?.lineups ?? [])
        .filter((lineup) => lineup.teamId === offenseTeam?.id && lineup.isActive)
        .sort((a, b) => a.orderIndex - b.orderIndex),
    [data?.lineups, offenseTeam?.id]
  );

  const latestTurn = data?.turns?.[0];
  const bonusShooters = (latestTurn?.shootersJson as string[] | null) ?? [];
  const bonusPlayers =
    bonusShooters.length > 0
      ? offenseLineup.filter((slot) => bonusShooters.includes(slot.playerId))
      : offenseLineup;

  const shooters = bonusPlayers.length > 0 ? bonusPlayers : offenseLineup;
  const currentShooterIndex = data?.state?.currentShooterIndex ?? 0;
  const activeShooter =
    shooters.length > 0 ? shooters[currentShooterIndex % shooters.length]?.player : undefined;

  const turnMakes = latestTurn?.events?.filter((event) => isMake(event.resultType)).length ?? 0;

  const lastResultByShooter = useMemo(() => {
    const map = new Map<string, ResultType>();
    latestTurn?.events?.forEach((event) => {
      if (event.shooterId) {
        map.set(event.shooterId, event.resultType);
      }
    });
    return map;
  }, [latestTurn?.events]);

  const isFinal = data?.state?.status === 'FINAL';

  useEffect(() => {
    if (isFinal && isScorer) {
      router.replace('/');
    }
  }, [isFinal, isScorer, router]);

  useEffect(() => {
    if (data === null) {
      router.replace('/');
    }
  }, [data, router]);

  const postEvent = async (body: Record<string, any>) => {
    setLoadingAction(true);
    setActionError(null);
    const res = await fetch(`/api/games/${gameId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    setLoadingAction(false);
    if (!res.ok) {
      const parsed = await res.json().catch(() => ({}));
      setActionError(parsed?.error ?? 'Failed to record event');
      return;
    }
    await mutate();
  };

  const handleShot = async (resultType: ResultType) => {
    if (!possessionTeamId || !activeShooter?.id) return;
    await postEvent({
      shooterId: activeShooter.id,
      resultType,
      teamId: possessionTeamId
    });
  };

  const handlePull = async (type: ResultType, count: number) => {
    if (!possessionTeamId) return;
    await postEvent({ resultType: type, teamId: possessionTeamId, count });
  };

  const handleFinalize = async () => {
    setLoadingAction(true);
    setActionError(null);
    const res = await fetch(`/api/games/${gameId}/finalize`, { method: 'POST' });
    setLoadingAction(false);
    if (!res.ok) {
      const parsed = await res.json().catch(() => ({}));
      setActionError(parsed?.error ?? 'Failed to end game');
      return;
    }
    await mutate();
  };

  const handleUndo = async () => {
    setLoadingAction(true);
    setActionError(null);
    const res = await fetch(`/api/games/${gameId}/undo`, { method: 'POST' });
    setLoadingAction(false);
    if (!res.ok) {
      const parsed = await res.json().catch(() => ({}));
      setActionError(parsed?.error ?? 'Nothing to undo');
      return;
    }
    await mutate();
  };

  const openAdjustment = (target: 'PULL_HOME' | 'PULL_AWAY' | 'ADD_HOME' | 'ADD_AWAY') => {
    setAdjustTarget(target);
    setAdjustCount(1);
    setEndConfirm(false);
    setOptionsOpen(false);
  };

  if (data === null || isFinal) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-garnet-100 bg-white/85 p-3 sm:p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ash">Current rack</p>
          <p className="text-xs text-ash">
            {offenseTeam?.name ?? 'Offense'} · {phase}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {shooters.length === 0 && <span className="text-xs text-ash">No lineup loaded.</span>}
          {shooters.map((slot, idx) => {
            const current = currentShooterIndex % Math.max(shooters.length, 1) === idx;
            const lastResult = lastResultByShooter.get(slot.player.id);
            const made = lastResult ? isMake(lastResult) : false;
            const missed = lastResult === ResultType.MISS;
            const statusClass = made
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
              : missed
                ? 'border-rose-300 bg-rose-50 text-rose-700'
                : 'border-garnet-100 bg-white/90 text-ink';
            return (
              <div
                key={slot.id}
                className={`truncate rounded-xl border px-3 py-2 text-sm font-semibold transition ${statusClass} ${
                  current ? 'ring-2 ring-gold-300' : ''
                }`}
              >
                {slot.player.name}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-garnet-100 bg-white/90 px-4 py-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ash">Shooter up</p>
          <p className="text-lg font-bold text-garnet-700">{activeShooter?.name ?? '—'}</p>
        </div>
        <div className="rounded-full bg-gold-50 px-3 py-1 text-sm font-semibold text-ink">Makes this rack: {turnMakes}</div>
      </div>

      {actionError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {actionError}
        </div>
      )}

      {isScorer && !isFinal && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <ShotButton label="Top" onClick={() => handleShot(ResultType.TOP_REGULAR)} disabled={loadingAction} />
            <ShotButton label="Top ISO" onClick={() => handleShot(ResultType.TOP_ISO)} disabled={loadingAction} />
            <ShotButton
              label="Bottom"
              onClick={() => handleShot(ResultType.BOTTOM_REGULAR)}
              disabled={loadingAction}
            />
            <ShotButton
              label="Bottom ISO"
              onClick={() => handleShot(ResultType.BOTTOM_ISO)}
              disabled={loadingAction}
            />
            <ShotButton label="Miss" variant="miss" onClick={() => handleShot(ResultType.MISS)} disabled={loadingAction} />
            <ShotButton label="Undo" variant="undo" onClick={handleUndo} disabled={loadingAction} />
          </div>

          <div className="rounded-2xl border border-garnet-100 bg-white/85 p-3 sm:p-4">
            <button
              type="button"
              onClick={() => setOptionsOpen((prev) => !prev)}
              className={`w-full rounded-xl border border-garnet-200 bg-parchment/70 px-4 py-3 text-sm font-semibold text-garnet-700 ${touchClass}`}
            >
              {optionsOpen ? 'Hide options' : 'Show options'}
            </button>

            {optionsOpen && (
              <div className="mt-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => openAdjustment('PULL_HOME')}
                    className={`rounded-xl border border-rose-200 bg-rose-100 px-3 py-2 text-sm font-semibold text-rose-900 ${touchClass}`}
                  >
                    Pull home cup
                  </button>
                  <button
                    type="button"
                    onClick={() => openAdjustment('PULL_AWAY')}
                    className={`rounded-xl border border-rose-200 bg-rose-100 px-3 py-2 text-sm font-semibold text-rose-900 ${touchClass}`}
                  >
                    Pull away cup
                  </button>
                  <button
                    type="button"
                    onClick={() => openAdjustment('ADD_HOME')}
                    className={`rounded-xl border border-gold-200 bg-gold-50 px-3 py-2 text-sm font-semibold text-garnet-700 ${touchClass}`}
                  >
                    Add home cup
                  </button>
                  <button
                    type="button"
                    onClick={() => openAdjustment('ADD_AWAY')}
                    className={`rounded-xl border border-gold-200 bg-gold-50 px-3 py-2 text-sm font-semibold text-garnet-700 ${touchClass}`}
                  >
                    Add away cup
                  </button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEndConfirm(true);
                      setAdjustTarget(null);
                      setOptionsOpen(false);
                    }}
                    className={`rounded-xl border border-rose-300 bg-rose-600 px-4 py-3 text-sm font-semibold text-white ${touchClass}`}
                  >
                    End game
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push('/games')}
                    className={`rounded-xl border border-garnet-200 bg-white px-4 py-3 text-sm font-semibold text-garnet-700 ${touchClass}`}
                  >
                    Save and exit
                  </button>
                </div>
              </div>
            )}

            {adjustTarget && (
              <div className="mt-3 rounded-xl border border-garnet-100 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-ash">
                  {adjustTarget === 'PULL_HOME' && 'Pull from home rack'}
                  {adjustTarget === 'PULL_AWAY' && 'Pull from away rack'}
                  {adjustTarget === 'ADD_HOME' && 'Add to home rack'}
                  {adjustTarget === 'ADD_AWAY' && 'Add to away rack'}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {[1, 2, 3, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setAdjustCount(value)}
                      className={`rounded-lg border px-3 py-2 text-sm font-semibold ${touchClass} ${
                        adjustCount === value
                          ? 'border-garnet-300 bg-garnet-600 text-white'
                          : 'border-garnet-100 bg-parchment/70 text-ink'
                      }`}
                    >
                      {value}
                    </button>
                  ))}
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        const isAdd = adjustTarget === 'ADD_HOME' || adjustTarget === 'ADD_AWAY';
                        const resultType =
                          adjustTarget === 'PULL_HOME' || adjustTarget === 'ADD_HOME'
                            ? ResultType.PULL_HOME
                            : ResultType.PULL_AWAY;
                        const count = isAdd ? -adjustCount : adjustCount;
                        await handlePull(resultType, count);
                        setAdjustTarget(null);
                      }}
                      className={`rounded-lg bg-garnet-600 px-4 py-2 text-sm font-semibold text-sand ${touchClass}`}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdjustTarget(null)}
                      className={`rounded-lg border border-garnet-200 px-3 py-2 text-sm font-semibold text-garnet-600 ${touchClass}`}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {endConfirm && (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
                <p className="text-sm font-semibold text-rose-700">Finalize this game now?</p>
                <p className="text-xs text-rose-600">This locks the game in final status.</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      await handleFinalize();
                      setEndConfirm(false);
                    }}
                    className={`rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white ${touchClass}`}
                  >
                    Confirm end
                  </button>
                  <button
                    type="button"
                    onClick={() => setEndConfirm(false)}
                    className={`rounded-lg border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 ${touchClass}`}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {!isScorer && (
        <div className="rounded-xl border border-garnet-100 bg-white/75 px-3 py-2 text-xs text-ash">
          View-only mode. Live score updates refresh automatically.
        </div>
      )}
    </div>
  );
}

function ShotButton({
  label,
  onClick,
  variant = 'primary',
  disabled
}: {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'miss' | 'undo';
  disabled?: boolean;
}) {
  const base =
    variant === 'undo'
      ? 'border-amber-200 bg-amber-400 text-ink'
      : variant === 'miss'
        ? 'border-garnet-200 bg-white text-ink'
        : 'border-garnet-300/70 bg-garnet-600 text-sand';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`h-14 rounded-xl border px-2 text-sm font-bold shadow-sm transition disabled:opacity-50 ${base} ${touchClass}`}
    >
      {label}
    </button>
  );
}
