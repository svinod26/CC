import type { Prisma } from '@prisma/client';

const identitySelect = { id: true, name: true } as const;

// Shared by the initial page and /state. Never serialize full Player/User records.
export const gameViewSelect = {
  id: true, type: true, status: true, statsSource: true,
  homeTeamId: true, awayTeamId: true, startedAt: true, endedAt: true,
  homeTeam: { select: identitySelect },
  awayTeam: { select: identitySelect },
  state: { select: {
    homeCupsRemaining: true, awayCupsRemaining: true, possessionTeamId: true,
    currentTurnNumber: true, currentShooterIndex: true, status: true,
    phase: true, updatedAt: true
  } },
  scheduleEntry: { select: { week: true } },
  lineups: { select: {
    id: true, teamId: true, playerId: true, orderIndex: true, isActive: true,
    player: { select: identitySelect }
  } },
  events: {
    orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
    select: {
      id: true, turnId: true, shooterId: true, resultType: true,
      offenseTeamId: true, cupsDelta: true, timestamp: true,
      remainingCupsBefore: true, shooter: { select: identitySelect }
    }
  },
  legacyStats: { select: {
    playerId: true, teamId: true, totalCups: true, topRegular: true,
    topIso: true, bottomRegular: true, bottomIso: true, misses: true,
    player: { select: identitySelect }
  } },
  legacyTeamStats: { select: { teamId: true, pulledCups: true } }
} as const satisfies Prisma.GameSelect;

export const gameTurnSelect = {
  id: true, offenseTeamId: true, turnIndex: true, shootersJson: true
} as const satisfies Prisma.TurnSelect;

export type GameViewRecord = Prisma.GameGetPayload<{ select: typeof gameViewSelect }>;
export type GameViewTurn = Prisma.TurnGetPayload<{ select: typeof gameTurnSelect }>;

// Keep null-turn events in the full history; only attach matching events to turns.
export function attachTurnEvents<T extends { id: string }, E extends { turnId: string | null }>(
  turns: T[], events: E[]
) {
  const byTurn = new Map<string, E[]>();
  for (const event of events) {
    if (event.turnId === null) continue;
    const bucket = byTurn.get(event.turnId) ?? [];
    bucket.push(event);
    byTurn.set(event.turnId, bucket);
  }
  return turns.map((turn) => ({ ...turn, events: byTurn.get(turn.id) ?? [] }));
}

export type GameView = GameViewRecord & {
  turns: Array<GameViewTurn & { events: GameViewRecord['events'] }>;
};

export function gameRefreshInterval(game: Pick<GameView, 'status' | 'statsSource'> | null | undefined) {
  return game?.status === 'IN_PROGRESS' && game.statsSource === 'TRACKED' ? 3000 : 0;
}

export class GameFetchError extends Error {
  status: number;
  constructor(status: number) {
    super('Failed to load game state');
    this.status = status;
  }
}

export async function fetchGameView(url: string): Promise<GameView | null> {
  const response = await fetch(url, { cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) throw new GameFetchError(response.status);
  return response.json();
}

export function shouldRetryGameFetch(error: Error) {
  return !(error instanceof GameFetchError && [401, 403, 404].includes(error.status));
}
