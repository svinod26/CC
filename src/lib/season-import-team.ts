import { normalizePlayerNameKey } from './player-name.ts';

export const sameSeasonImportTeamName = (left: string, right: string) =>
  normalizePlayerNameKey(left) === normalizePlayerNameKey(right);

export function selectionModeForEditedTeamName({
  sourceName,
  nextName,
  previousSeasonNames
}: {
  sourceName: string;
  nextName: string;
  previousSeasonNames: string[];
}): 'EXISTING' | 'RENAMED' {
  const sourceKey = normalizePlayerNameKey(sourceName);
  const nextKey = normalizePlayerNameKey(nextName);
  const sourceWasPreviousTeam = Boolean(
    sourceKey && previousSeasonNames.some((name) => normalizePlayerNameKey(name) === sourceKey)
  );

  return sourceWasPreviousTeam && nextKey === sourceKey ? 'EXISTING' : 'RENAMED';
}
