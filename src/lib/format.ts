import { GameStatus, GameType, ResultType } from '@prisma/client';

export function formatGameStatus(status: GameStatus | string) {
  switch (status) {
    case GameStatus.SCHEDULED:
      return 'Scheduled';
    case GameStatus.IN_PROGRESS:
      return 'In progress';
    case GameStatus.FINAL:
      return 'Final';
    default:
      return String(status);
  }
}

export function formatGameType(type: GameType | string) {
  switch (type) {
    case GameType.LEAGUE:
      return 'League';
    case GameType.EXHIBITION:
      return 'Exhibition';
    default:
      return String(type);
  }
}

export function formatShotResult(resultType: ResultType | string) {
  switch (resultType) {
    case ResultType.TOP_REGULAR:
      return 'Top';
    case ResultType.TOP_ISO:
      return 'Top ISO';
    case ResultType.BOTTOM_REGULAR:
      return 'Bottom';
    case ResultType.BOTTOM_ISO:
      return 'Bottom ISO';
    case ResultType.MISS:
      return 'Miss';
    case ResultType.PULL_HOME:
      return 'Pull (home side)';
    case ResultType.PULL_AWAY:
      return 'Pull (away side)';
    default:
      return String(resultType);
  }
}
