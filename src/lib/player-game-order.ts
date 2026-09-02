import { sortSeasons, type SeasonLike } from './season.ts';

type PlayerGameOrderLike = {
  id: string;
  seasonId: string | null;
  startedAt: Date;
  createdAt: Date;
  scheduleEntry: { week: number } | null;
};

const descendingDate = (a: Date, b: Date) => b.getTime() - a.getTime();

export const sortPlayerGamesBySeasonAndWeek = <T extends PlayerGameOrderLike>(
  games: T[],
  seasons: SeasonLike[]
) => {
  const seasonPositions = new Map(
    sortSeasons(seasons).map((season, index) => [season.id, index])
  );

  return [...games].sort((a, b) => {
    const seasonA = a.seasonId ? seasonPositions.get(a.seasonId) : undefined;
    const seasonB = b.seasonId ? seasonPositions.get(b.seasonId) : undefined;
    const seasonPositionA = seasonA ?? Number.MAX_SAFE_INTEGER;
    const seasonPositionB = seasonB ?? Number.MAX_SAFE_INTEGER;

    if (seasonPositionA !== seasonPositionB) return seasonPositionA - seasonPositionB;

    const weekA = a.scheduleEntry?.week;
    const weekB = b.scheduleEntry?.week;
    if (weekA !== weekB) {
      if (weekA === undefined) return 1;
      if (weekB === undefined) return -1;
      return weekB - weekA;
    }

    const startedAtOrder = descendingDate(a.startedAt, b.startedAt);
    if (startedAtOrder !== 0) return startedAtOrder;

    const createdAtOrder = descendingDate(a.createdAt, b.createdAt);
    if (createdAtOrder !== 0) return createdAtOrder;

    return b.id.localeCompare(a.id);
  });
};
