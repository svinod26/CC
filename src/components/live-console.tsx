'use client';

import { GameState, GameType, ResultType, Team, GameLineup, Player, Turn } from '@prisma/client';
import useSWR from 'swr';
import { useMemo, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

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

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function LiveConsole({
  gameId,
  initialData,
  isScorer
}: {
  gameId: string;
  initialData: GameStatePayload;
  isScorer: boolean;
}) {
  const { data, mutate } = useSWR<GameStatePayload>(`/api/games/${gameId}/state`, fetcher, {
    fallbackData: initialData,
    refreshInterval: 5000
  });
  const router = useRouter();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [adjustCount, setAdjustCount] = useState(1);
  const [adjustTarget, setAdjustTarget] = useState<
    'PULL_HOME' | 'PULL_AWAY' | 'ADD_HOME' | 'ADD_AWAY' | null
  >(null);
  const [endConfirm, setEndConfirm] = useState(false);
  const [loadingAction, setLoadingAction] = useState(false);

  const possessionTeamId = data?.state?.possessionTeamId;
  const offenseTeam = possessionTeamId
    ? [data?.homeTeam, data?.awayTeam].find((t) => t?.id === possessionTeamId)
    : data?.homeTeam;
  const defenseTeam =
    offenseTeam?.id === data?.homeTeam?.id ? data?.awayTeam ?? null : data?.homeTeam ?? null;
  const phase = data?.state?.phase ?? 'REGULATION';

  const offenseLineup = useMemo(
    () =>
      (data?.lineups ?? [])
        .filter((l) => l.teamId === offenseTeam?.id && l.isActive)
        .sort((a, b) => a.orderIndex - b.orderIndex),
    [data?.lineups, offenseTeam?.id]
  );

  const latestTurn = data?.turns?.[0];
  const bonusShooters = (latestTurn?.shootersJson as string[] | null) ?? [];
  const bonusPlayers =
    bonusShooters.length > 0
      ? offenseLineup.filter((p) => bonusShooters.includes(p.playerId))
      : offenseLineup;

  const shooters = bonusPlayers.length > 0 ? bonusPlayers : offenseLineup;
  const currentShooterIndex = data?.state?.currentShooterIndex ?? 0;
  const activeShooter =
    shooters.length > 0 ? shooters[currentShooterIndex % shooters.length]?.player : undefined;

  const turnMakes =
    latestTurn?.events?.filter((event) =>
      [ResultType.TOP_REGULAR, ResultType.TOP_ISO, ResultType.BOTTOM_REGULAR, ResultType.BOTTOM_ISO].includes(
        event.resultType
      )
    ).length ?? 0;

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

  const postEvent = async (body: Record<string, any>) => {
    setLoadingAction(true);
    const res = await fetch(`/api/games/${gameId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    setLoadingAction(false);
    if (!res.ok) {
      alert('Failed to record event');
      return;
    }
    mutate();
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
    const res = await fetch(`/api/games/${gameId}/finalize`, { method: 'POST' });
    setLoadingAction(false);
    if (!res.ok) {
      alert('Failed to end game');
      return;
    }
    mutate();
  };

  const handleUndo = async () => {
    setLoadingAction(true);
    const res = await fetch(`/api/games/${gameId}/undo`, { method: 'POST' });
    setLoadingAction(false);
    if (!res.ok) {
      alert('Nothing to undo');
      return;
    }
    mutate();
  };

  if (isFinal) {
    return null;
  }

  return (
    <div className="space-y-4">

      <div className="rounded-2xl border border-garnet-100 bg-white/80 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {shooters.length === 0 && <span className="text-xs text-ash">No lineup loaded.</span>}
          {shooters.map((slot, idx) => {
            const current = currentShooterIndex % Math.max(shooters.length, 1) === idx;
            const lastResult = lastResultByShooter.get(slot.player.id);
            const isMake = lastResult
              ? [ResultType.TOP_REGULAR, ResultType.TOP_ISO, ResultType.BOTTOM_REGULAR, ResultType.BOTTOM_ISO].includes(
                  lastResult
                )
              : false;
            const isMiss = lastResult === ResultType.MISS;
            const statusClass = isMake
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : isMiss
                ? 'border-rose-200 bg-rose-50 text-rose-600'
                : 'border-garnet-100 text-ink';
            return (
              <div
                key={slot.id}
                className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${statusClass} ${
                  current ? 'ring-2 ring-gold-200' : ''
                }`}
              >
                {slot.player.name}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between rounded-2xl border border-garnet-100 bg-white/85 px-4 py-3">
        <div className="flex items-baseline gap-2">
          <p className="text-sm font-semibold text-ash">Shooter up</p>
          <p className="text-lg font-bold text-garnet-600">{activeShooter?.name ?? '—'}</p>
        </div>
        <div className="rounded-full bg-gold-50 px-3 py-1 text-lg font-bold text-ink">{turnMakes}</div>
      </div>

      {isScorer && !isFinal && (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <ShotButton label="Top Regular" onClick={() => handleShot(ResultType.TOP_REGULAR)} />
            <ShotButton label="Top ISO" onClick={() => handleShot(ResultType.TOP_ISO)} />
            <ShotButton label="Bottom Regular" onClick={() => handleShot(ResultType.BOTTOM_REGULAR)} />
            <ShotButton label="Bottom ISO" onClick={() => handleShot(ResultType.BOTTOM_ISO)} />
            <ShotButton label="Miss" variant="miss" onClick={() => handleShot(ResultType.MISS)} />
            <ShotButton label="Undo" variant="undo" onClick={handleUndo} disabled={loadingAction} />
          </div>

          <div className="rounded-2xl border border-garnet-100 bg-white/80 p-4">
            <button
              type="button"
              onClick={() => setOptionsOpen((prev) => !prev)}
              className="w-full rounded-xl border border-garnet-200 bg-parchment/70 px-4 py-3 text-sm font-semibold text-garnet-700 hover:bg-gold-100"
            >
              Options
            </button>

            {optionsOpen && (
              <div className="mt-3 space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAdjustTarget('PULL_HOME');
                      setAdjustCount(1);
                      setEndConfirm(false);
                    }}
                  className="rounded-xl border border-rose-200 bg-rose-300 px-4 py-3 text-sm font-semibold text-rose-900 hover:bg-rose-200"
                >
                  Pull home cup
                </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAdjustTarget('PULL_AWAY');
                      setAdjustCount(1);
                      setEndConfirm(false);
                    }}
                  className="rounded-xl border border-rose-200 bg-rose-300 px-4 py-3 text-sm font-semibold text-rose-900 hover:bg-rose-200"
                >
                  Pull away cup
                </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAdjustTarget('ADD_HOME');
                      setAdjustCount(1);
                      setEndConfirm(false);
                    }}
                  className="rounded-xl border border-gold-200 bg-gold-50 px-4 py-3 text-sm font-semibold text-garnet-700 hover:bg-gold-100"
                >
                  Add home cup
                </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAdjustTarget('ADD_AWAY');
                      setAdjustCount(1);
                      setEndConfirm(false);
                    }}
                  className="rounded-xl border border-gold-200 bg-gold-50 px-4 py-3 text-sm font-semibold text-garnet-700 hover:bg-gold-100"
                >
                  Add away cup
                </button>
              </div>
              <button
                  type="button"
                  onClick={() => {
                    setEndConfirm(true);
                    setAdjustTarget(null);
                  }}
                className="w-full rounded-xl border border-rose-300 bg-rose-600 px-4 py-3 text-sm font-semibold text-white hover:bg-rose-500"
              >
                End game
              </button>
            </div>
            )}

            {adjustTarget && (
              <div className="mt-3 rounded-xl border border-garnet-100 bg-white/90 p-3">
                <p className="text-xs uppercase tracking-wide text-ash">
                  {adjustTarget === 'PULL_HOME' && 'Home rack pull'}
                  {adjustTarget === 'PULL_AWAY' && 'Away rack pull'}
                  {adjustTarget === 'ADD_HOME' && 'Add cup to home rack'}
                  {adjustTarget === 'ADD_AWAY' && 'Add cup to away rack'}
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setAdjustCount((c) => Math.max(1, c - 1))}
                    className="h-10 w-10 rounded-full border border-garnet-100 bg-parchment/70 text-lg font-semibold text-ink"
                  >
                    –
                  </button>
                  <span className="text-lg font-semibold text-ink">{adjustCount}</span>
                  <button
                    type="button"
                    onClick={() => setAdjustCount((c) => c + 1)}
                    className="h-10 w-10 rounded-full border border-garnet-100 bg-parchment/70 text-lg font-semibold text-ink"
                  >
                    +
                  </button>
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
                    className="ml-auto rounded-lg bg-garnet-600 px-4 py-2 text-sm font-semibold text-sand hover:bg-garnet-500"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdjustTarget(null)}
                    className="rounded-lg border border-garnet-200 px-3 py-2 text-sm font-semibold text-garnet-600 hover:bg-gold-100"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {endConfirm && (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
                <p className="text-sm font-semibold text-rose-700">End game now?</p>
                <p className="text-xs text-rose-600">This will finalize the game immediately.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      await handleFinalize();
                      setEndConfirm(false);
                      setOptionsOpen(false);
                    }}
                    className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500"
                  >
                    Confirm end
                  </button>
                  <button
                    type="button"
                    onClick={() => setEndConfirm(false)}
                    className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-100"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ScoreTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-garnet-100 bg-white/80 px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-ash">{label}</p>
      <p className="text-3xl font-bold text-garnet-600">{value}</p>
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
      ? 'border-amber-200 bg-amber-500 text-ink hover:bg-amber-400'
      : variant === 'miss'
        ? 'border-garnet-100 bg-white text-ink hover:border-garnet-300'
        : 'border-garnet-300/70 bg-garnet-600 text-sand hover:bg-garnet-500';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`h-20 rounded-xl border text-lg font-bold shadow transition disabled:opacity-50 ${base}`}
    >
      {label}
    </button>
  );
}
