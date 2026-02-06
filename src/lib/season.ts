export type SeasonLike = {
  id: string;
  name: string;
  year: number | null;
};

const seasonRank = (name: string) => {
  const term = name.slice(0, 1).toUpperCase();
  const year = Number(name.slice(1)) || 0;
  return year * 2 + (term === 'F' ? 1 : 0);
};

export const sortSeasons = <T extends SeasonLike>(seasons: T[]) => {
  return [...seasons].sort((a, b) => seasonRank(b.name) - seasonRank(a.name));
};

export const seasonNameForDate = (date = new Date()) => {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  const term = month >= 7 ? 'F' : 'S';
  return `${term}${year}`;
};

export const resolveSeasonSelection = <T extends SeasonLike>(
  seasons: T[],
  param?: string | string[]
) => {
  const sorted = sortSeasons(seasons);
  const raw = Array.isArray(param) ? param[0] : param;
  if (raw === 'all') {
    return { season: null, value: 'all', seasons: sorted };
  }
  const desired = raw || seasonNameForDate();
  const season = sorted.find((s) => s.name === desired) ?? sorted[0] ?? null;
  return { season, value: season?.name ?? 'all', seasons: sorted };
};
