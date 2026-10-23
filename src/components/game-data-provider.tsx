'use client';

import { createContext, useContext, type ReactNode } from 'react';
import useSWR, { type KeyedMutator } from 'swr';
import { fetchGameView, gameRefreshInterval, shouldRetryGameFetch, type GameView } from '@/lib/game-view';

const GameDataContext = createContext<{
  data: GameView | null;
  mutate: KeyedMutator<GameView | null>;
} | null>(null);

export function GameDataProvider({ initialData, children }: { initialData: GameView; children: ReactNode }) {
  const { data, mutate } = useSWR<GameView | null>(
    `/api/games/${initialData.id}/state`, fetchGameView,
    {
      fallbackData: initialData,
      // SWR's cache can be empty while fallbackData is displayed. Re-evaluate
      // on render as well so a refreshed status can start/stop the timer.
      refreshInterval: (latest) => gameRefreshInterval(latest === undefined ? initialData : latest),
      refreshWhenHidden: false,
      refreshWhenOffline: false,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      shouldRetryOnError: shouldRetryGameFetch,
      errorRetryCount: 3
    }
  );
  return <GameDataContext.Provider value={{ data: data === undefined ? initialData : data, mutate }}>
    {children}
  </GameDataContext.Provider>;
}

export function useGameData() {
  const value = useContext(GameDataContext);
  if (!value) throw new Error('Game components require GameDataProvider');
  return value;
}
