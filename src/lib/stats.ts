import { ResultType, ShotEvent, StatsSource } from '@prisma/client';

export type Multipliers = {
  top: number;
  bottom: number;
  topIso: number;
  bottomIso: number;
  alpha: number;
  p: number;
};

export const defaultMultipliers: Multipliers = {
  top: 1.1,
  bottom: 1.0,
  topIso: 1.2,
  bottomIso: 1.05,
  alpha: 0.5,
  p: 2
};

const makeTypes: ResultType[] = [
  ResultType.TOP_REGULAR,
  ResultType.TOP_ISO,
  ResultType.BOTTOM_REGULAR,
  ResultType.BOTTOM_ISO
];

export function isMake(result: ResultType) {
  return makeTypes.includes(result);
}

export function isShot(result: ResultType) {
  return result !== ResultType.PULL_HOME && result !== ResultType.PULL_AWAY;
}

export function winnerFromRemaining(
  homeRemaining: number | null | undefined,
  awayRemaining: number | null | undefined,
  statsSource: StatsSource | null | undefined
) {
  if (homeRemaining === null || homeRemaining === undefined) return null;
  if (awayRemaining === null || awayRemaining === undefined) return null;
  if (homeRemaining === awayRemaining) return null;
  if (statsSource === StatsSource.LEGACY) {
    return homeRemaining < awayRemaining ? 'home' : 'away';
  }
  return awayRemaining < homeRemaining ? 'home' : 'away';
}

type WinnerStateLike = {
  homeCupsRemaining: number | null | undefined;
  awayCupsRemaining: number | null | undefined;
  phase?: string | null;
  status?: string | null;
  possessionTeamId?: string | null;
};

export function winnerFromGameState(
  state: WinnerStateLike | null | undefined,
  options: {
    statsSource: StatsSource | null | undefined;
    homeTeamId?: string | null;
    awayTeamId?: string | null;
  }
) {
  const base = winnerFromRemaining(state?.homeCupsRemaining, state?.awayCupsRemaining, options.statsSource);
  if (base) return base;
  if (!state) return null;

  const tiedAtZero = state.homeCupsRemaining === 0 && state.awayCupsRemaining === 0;
  const isOvertimeFinal = state.phase === 'OVERTIME' && state.status === 'FINAL';
  if (!tiedAtZero || !isOvertimeFinal || !state.possessionTeamId) return null;

  if (options.homeTeamId && state.possessionTeamId === options.homeTeamId) return 'home';
  if (options.awayTeamId && state.possessionTeamId === options.awayTeamId) return 'away';
  return null;
}

type ShotLike = {
  resultType: ResultType;
  shooterId?: string | null;
  shooter?: { id: string; name: string | null } | null;
};

export function boxScore(events: ShotLike[]) {
  const byPlayer = new Map<
    string,
    {
      id: string;
      name: string;
      makes: number;
      attempts: number;
      topRegular: number;
      topIso: number;
      bottomRegular: number;
      bottomIso: number;
      misses: number;
    }
  >();

  events.forEach((event) => {
    if (!isShot(event.resultType)) return;
    const pid = event.shooterId ?? event.shooter?.id ?? 'unknown';
    const name = event.shooter?.name ?? 'Unknown';
    const current = byPlayer.get(pid) ?? {
      id: pid,
      name,
      makes: 0,
      attempts: 0,
      topRegular: 0,
      topIso: 0,
      bottomRegular: 0,
      bottomIso: 0,
      misses: 0
    };
    current.attempts += 1;
    if (isMake(event.resultType)) {
      current.makes += 1;
      if (event.resultType === ResultType.TOP_REGULAR) current.topRegular += 1;
      if (event.resultType === ResultType.TOP_ISO) current.topIso += 1;
      if (event.resultType === ResultType.BOTTOM_REGULAR) current.bottomRegular += 1;
      if (event.resultType === ResultType.BOTTOM_ISO) current.bottomIso += 1;
    } else {
      current.misses += 1;
    }
    byPlayer.set(pid, current);
  });

  return byPlayer;
}

export function advancedStats(
  events: (ShotEvent & { shooter?: { id: string; name: string | null } | null })[],
  multipliers: Multipliers = defaultMultipliers
) {
  const perPlayer = new Map<
    string,
    {
      name: string;
      weightedPoints: number;
      attempts: number;
      makes: number;
    }
  >();

  const weightFor = (event: ShotEvent) => {
    const base =
      event.resultType === ResultType.TOP_REGULAR
        ? multipliers.top
        : event.resultType === ResultType.TOP_ISO
          ? multipliers.topIso
          : event.resultType === ResultType.BOTTOM_ISO
            ? multipliers.bottomIso
            : multipliers.bottom;
    const remaining = event.remainingCupsBefore ?? 100;
    const temporal = 1 + multipliers.alpha * Math.pow(1 - remaining / 100, multipliers.p);
    return base * temporal;
  };

  events.forEach((event) => {
    if (!isShot(event.resultType)) return;
    const pid = event.shooterId ?? event.shooter?.id ?? 'unknown';
    const name = event.shooter?.name ?? 'Unknown';
    const current = perPlayer.get(pid) ?? { name, weightedPoints: 0, attempts: 0, makes: 0 };
    current.attempts += 1;
    if (isMake(event.resultType)) {
      current.weightedPoints += weightFor(event);
      current.makes += 1;
    }
    perPlayer.set(pid, current);
  });

  return perPlayer;
}

export function baseRatingStats(
  events: (ShotEvent & { shooter?: { id: string; name: string | null } | null })[],
  multipliers: Multipliers = defaultMultipliers
) {
  const perPlayer = new Map<
    string,
    {
      name: string;
      weightedPoints: number;
      attempts: number;
      makes: number;
    }
  >();

  const baseWeightFor = (event: ShotEvent) => {
    return event.resultType === ResultType.TOP_REGULAR
      ? multipliers.top
      : event.resultType === ResultType.TOP_ISO
        ? multipliers.topIso
        : event.resultType === ResultType.BOTTOM_ISO
          ? multipliers.bottomIso
          : multipliers.bottom;
  };

  events.forEach((event) => {
    if (!isShot(event.resultType)) return;
    const pid = event.shooterId ?? event.shooter?.id ?? 'unknown';
    const name = event.shooter?.name ?? 'Unknown';
    const current = perPlayer.get(pid) ?? { name, weightedPoints: 0, attempts: 0, makes: 0 };
    current.attempts += 1;
    if (isMake(event.resultType)) {
      current.weightedPoints += baseWeightFor(event);
      current.makes += 1;
    }
    perPlayer.set(pid, current);
  });

  return perPlayer;
}
