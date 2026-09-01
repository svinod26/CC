import { z } from 'zod';
import type { SeasonImportDraft, SeasonImportPlayer } from './excel.ts';
import { canonicalizeEmail, normalizeEmail } from './email.ts';
import { normalizePlayerKey, normalizePlayerName, normalizePlayerNameKey } from './player-name.ts';

export type SeasonImportCatalogPlayer = {
  id: string;
  name: string;
  email: string | null;
  updatedAt: string;
  aliases: Array<{ alias: string; aliasKey: string }>;
};

export type SeasonImportTeamCatalog = {
  seasonId: string;
  seasonName: string;
  teams: Array<{ name: string }>;
} | null;

export type SeasonImportIssue = {
  code: string;
  message: string;
  path: string;
  blocking: boolean;
};

export type SeasonImportCandidate = {
  id: string;
  name: string;
  email: string | null;
  reason: 'email' | 'exact name' | 'alias' | 'similar name';
};

export type SeasonImportPlayerResolution = {
  rowId: string;
  status: 'EXACT' | 'ALIAS' | 'MANUAL' | 'AMBIGUOUS' | 'UNRESOLVED';
  resolvedPlayerId: string | null;
  matchReason: string;
  candidates: SeasonImportCandidate[];
  canRememberAlias: boolean;
};

export type SeasonImportPlan = {
  draft: SeasonImportDraft;
  issues: SeasonImportIssue[];
  playerRows: SeasonImportPlayerResolution[];
  playerOptions: Array<{ id: string; name: string; email: string | null }>;
  teamOptions: Array<{ name: string }>;
  teamSourceSeason: { id: string; name: string } | null;
  canCommit: boolean;
  counts: { teams: number; players: number; schedule: number; blockingIssues: number };
};

const emailSchema = z.string().email().max(254);

const uniquePlayers = (players: SeasonImportCatalogPlayer[]) =>
  [...new Map(players.map((player) => [player.id, player])).values()];

const firstNameKey = (name: string) => normalizePlayerNameKey(name).split(' ')[0] ?? '';

function levenshtein(left: string, right: string) {
  if (!left) return right.length;
  if (!right) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function similarPlayers(rawName: string, players: SeasonImportCatalogPlayer[]) {
  const rawKey = normalizePlayerKey(rawName);
  if (rawKey.length < 3) return [];
  return players
    .map((player) => {
      const nameKey = normalizePlayerKey(player.name);
      const tokenKeys = normalizePlayerNameKey(player.name).split(' ').map(normalizePlayerKey);
      const distance = Math.min(levenshtein(rawKey, nameKey), ...tokenKeys.map((key) => levenshtein(rawKey, key)));
      const contains = nameKey.includes(rawKey) || tokenKeys.some((key) => key.startsWith(rawKey) || rawKey.startsWith(key));
      return { player, distance, contains };
    })
    .filter(({ distance, contains }) => contains || distance <= Math.max(2, Math.floor(rawKey.length * 0.25)))
    .sort((a, b) => Number(b.contains) - Number(a.contains) || a.distance - b.distance || a.player.name.localeCompare(b.player.name))
    .slice(0, 5)
    .map(({ player }) => player);
}

const candidate = (
  player: SeasonImportCatalogPlayer,
  reason: SeasonImportCandidate['reason']
): SeasonImportCandidate => ({ id: player.id, name: player.name, email: player.email, reason });

export function seedManualSeasonTeams(
  draft: SeasonImportDraft,
  teamCatalog: SeasonImportTeamCatalog
): SeasonImportDraft {
  if (draft.layout !== 'MANUAL' || draft.teams.length > 0 || !teamCatalog) return draft;
  return {
    ...draft,
    teams: teamCatalog.teams.map((team, index) => ({
      id: `manual-template-team-${index + 1}`,
      sourceName: team.name,
      name: team.name,
      selectionMode: 'EXISTING',
      source: `${teamCatalog.seasonName} League team template`
    }))
  };
}

function resolvePlayerRow(
  row: SeasonImportPlayer,
  players: SeasonImportCatalogPlayer[],
  issues: SeasonImportIssue[]
): SeasonImportPlayerResolution {
  if (row.entryMode === 'MANUAL') {
    const selected = row.playerId
      ? players.find((player) => player.id === row.playerId) ?? null
      : null;
    if (!row.playerId) {
      issues.push({
        code: 'MISSING_PLAYER_SELECTION',
        message: 'Select an existing Player.',
        path: row.id,
        blocking: true
      });
    } else if (!selected) {
      issues.push({
        code: 'UNKNOWN_PLAYER_SELECTION',
        message: 'The selected Player no longer exists. Select another Player.',
        path: row.id,
        blocking: true
      });
    }
    return {
      rowId: row.id,
      status: selected ? 'MANUAL' : 'UNRESOLVED',
      resolvedPlayerId: selected?.id ?? null,
      matchReason: selected ? 'Selected by admin' : 'Needs Player selection',
      candidates: [],
      canRememberAlias: false
    };
  }

  const rawName = normalizePlayerName(row.rawName);
  if (!rawName) {
    issues.push({ code: 'MISSING_PLAYER_NAME', message: 'Player name is required.', path: row.id, blocking: true });
    return { rowId: row.id, status: 'UNRESOLVED', resolvedPlayerId: null, matchReason: 'Missing name', candidates: [], canRememberAlias: false };
  }

  const rawNameKey = normalizePlayerNameKey(rawName);
  const rawIdentityKey = normalizePlayerKey(rawName);
  const normalizedEmail = row.email ? normalizeEmail(row.email) : null;
  if (normalizedEmail && !emailSchema.safeParse(normalizedEmail).success) {
    issues.push({ code: 'INVALID_PLAYER_EMAIL', message: `${rawName} has an invalid workbook email.`, path: row.id, blocking: true });
  }

  const exactName = players.filter((player) => normalizePlayerNameKey(player.name) === rawNameKey);
  const identityName = players.filter((player) => normalizePlayerKey(player.name) === rawIdentityKey);
  const aliasMatches = players.filter((player) => player.aliases.some((alias) => alias.aliasKey === rawIdentityKey));
  const emailMatches = normalizedEmail
    ? players.filter((player) => player.email && canonicalizeEmail(player.email) === canonicalizeEmail(normalizedEmail))
    : [];
  const oneToken = !rawNameKey.includes(' ');
  const firstNameMatches = oneToken
    ? players.filter((player) => {
        const first = firstNameKey(player.name);
        return first === rawNameKey || (rawNameKey.length >= 3 && first.startsWith(rawNameKey));
      })
    : [];
  const similar = similarPlayers(rawName, players);
  const strongNameMatches = uniquePlayers([...exactName, ...identityName, ...aliasMatches, ...firstNameMatches]);
  const selected = row.playerId ? players.find((player) => player.id === row.playerId) ?? null : null;

  if (row.playerId && !selected) {
    issues.push({ code: 'UNKNOWN_PLAYER_SELECTION', message: `${rawName} references a Player that no longer exists.`, path: row.id, blocking: true });
  }

  let resolved: SeasonImportCatalogPlayer | null = selected;
  let status: SeasonImportPlayerResolution['status'] = selected ? 'MANUAL' : 'UNRESOLVED';
  let matchReason = selected ? 'Selected by admin' : 'No existing Player found';

  if (!selected) {
    const exactCandidates = uniquePlayers([...emailMatches, ...exactName, ...identityName]);
    if (exactCandidates.length === 1 && strongNameMatches.every((match) => match.id === exactCandidates[0].id)) {
      resolved = exactCandidates[0];
      status = 'EXACT';
      matchReason = emailMatches.some((match) => match.id === resolved?.id) ? 'Exact email' : 'Exact full name';
    } else if (exactCandidates.length > 1 || strongNameMatches.length > 1) {
      status = 'AMBIGUOUS';
      matchReason = 'Multiple plausible Players';
    } else if (aliasMatches.length === 1 && firstNameMatches.every((match) => match.id === aliasMatches[0].id)) {
      resolved = aliasMatches[0];
      status = 'ALIAS';
      matchReason = 'Existing alias';
    }
  }

  const conflictingWorkbookEmail = Boolean(
    resolved?.email && normalizedEmail && canonicalizeEmail(resolved.email) !== canonicalizeEmail(normalizedEmail)
  );
  if (conflictingWorkbookEmail) {
    issues.push({
      code: 'PLAYER_EMAIL_CONFLICT',
      message: `${rawName}'s workbook email does not match ${resolved!.name}'s existing Player email.`,
      path: row.id,
      blocking: true
    });
  }

  if (!resolved) {
    issues.push({
      code: status === 'AMBIGUOUS' ? 'AMBIGUOUS_PLAYER' : 'UNRESOLVED_PLAYER',
      message: status === 'AMBIGUOUS'
        ? `${rawName} could refer to more than one existing Player. Select the correct person.`
        : `No existing Player was confirmed for ${rawName}. Select one before importing.`,
      path: row.id,
      blocking: true
    });
  }

  const existingAliasOwner = players.find((player) => player.aliases.some((alias) => alias.aliasKey === rawIdentityKey));
  const canonicalOwner = players.find((player) => normalizePlayerKey(player.name) === rawIdentityKey);
  const aliasCollision = Boolean(
    resolved &&
      ((existingAliasOwner && existingAliasOwner.id !== resolved.id) ||
        (canonicalOwner && canonicalOwner.id !== resolved.id) ||
        (oneToken && firstNameMatches.some((player) => player.id !== resolved.id)))
  );
  const aliasAlreadyKnown = Boolean(
    resolved &&
      (normalizePlayerKey(resolved.name) === rawIdentityKey ||
        resolved.aliases.some((alias) => alias.aliasKey === rawIdentityKey))
  );
  const canRememberAlias = Boolean(resolved && rawIdentityKey && !aliasAlreadyKnown && !aliasCollision);

  if (row.rememberAlias && !canRememberAlias) {
    issues.push({
      code: 'UNSAFE_ALIAS',
      message: `“${rawName}” cannot be saved as a global alias because it is already known or could identify another Player.`,
      path: row.id,
      blocking: true
    });
  }

  const orderedCandidates = new Map<string, SeasonImportCandidate>();
  for (const player of emailMatches) orderedCandidates.set(player.id, candidate(player, 'email'));
  for (const player of uniquePlayers([...exactName, ...identityName])) {
    if (!orderedCandidates.has(player.id)) orderedCandidates.set(player.id, candidate(player, 'exact name'));
  }
  for (const player of aliasMatches) {
    if (!orderedCandidates.has(player.id)) orderedCandidates.set(player.id, candidate(player, 'alias'));
  }
  for (const player of uniquePlayers([...firstNameMatches, ...similar])) {
    if (!orderedCandidates.has(player.id)) orderedCandidates.set(player.id, candidate(player, 'similar name'));
  }

  return {
    rowId: row.id,
    status,
    resolvedPlayerId: resolved?.id ?? null,
    matchReason,
    candidates: [...orderedCandidates.values()].slice(0, 8),
    canRememberAlias
  };
}

export function planSeasonImport(
  submittedDraft: SeasonImportDraft,
  players: SeasonImportCatalogPlayer[],
  teamCatalog: SeasonImportTeamCatalog = null
): SeasonImportPlan {
  const issues: SeasonImportIssue[] = submittedDraft.sourceWarnings.map((warning) => ({
    code: warning.code,
    message: warning.message,
    path: warning.source,
    blocking: false
  }));
  const teamOptionsByKey = new Map<string, string>();
  for (const team of teamCatalog?.teams ?? []) {
    const name = normalizePlayerName(team.name);
    const key = normalizePlayerNameKey(name);
    if (key && !teamOptionsByKey.has(key)) teamOptionsByKey.set(key, name);
  }
  const teamOptions = [...teamOptionsByKey.values()]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name }));
  const normalizedTeams: SeasonImportDraft['teams'] = submittedDraft.teams.map((team) => {
    const sourceName = normalizePlayerName(team.sourceName);
    const submittedName = normalizePlayerName(team.name);
    const requestedName = team.selectionMode === 'RENAMED'
      ? submittedName
      : sourceName || submittedName;
    const exactExistingName = teamOptionsByKey.get(normalizePlayerNameKey(requestedName));
    if (exactExistingName) {
      return { ...team, sourceName, name: exactExistingName, selectionMode: 'EXISTING' };
    }
    return { ...team, sourceName, name: requestedName, selectionMode: 'RENAMED' };
  });
  const normalizedTeamsById = new Map(normalizedTeams.map((team) => [team.id, team]));
  const draft: SeasonImportDraft = {
    ...submittedDraft,
    seasonName: submittedDraft.seasonName.trim(),
    teams: normalizedTeams,
    players: submittedDraft.players.map((row) => {
      const selectedTeam = normalizedTeamsById.get(row.teamId);
      const manuallySelectedPlayer = row.entryMode === 'MANUAL' && row.playerId
        ? players.find((player) => player.id === row.playerId) ?? null
        : null;
      return {
        ...row,
        rawName: row.entryMode === 'MANUAL'
          ? manuallySelectedPlayer?.name ?? ''
          : normalizePlayerName(row.rawName),
        teamName: selectedTeam?.name ?? normalizePlayerName(row.teamName),
        email: row.entryMode === 'MANUAL'
          ? undefined
          : row.email ? normalizeEmail(row.email) : undefined,
        rememberAlias: row.entryMode === 'MANUAL' ? false : row.rememberAlias
      };
    }),
    schedule: submittedDraft.schedule.map((row) => ({
      ...row,
      home: normalizedTeamsById.get(row.homeTeamId)?.name ?? normalizePlayerName(row.home),
      away: normalizedTeamsById.get(row.awayTeamId)?.name ?? normalizePlayerName(row.away)
    }))
  };

  if (draft.teams.length === 0) {
    issues.push({ code: 'NO_TEAMS', message: 'Add at least one League team.', path: 'teams', blocking: true });
  }
  if (draft.players.length === 0) {
    issues.push({ code: 'NO_PLAYERS', message: 'Add at least one roster player.', path: 'players', blocking: true });
  }

  const teamRowsById = new Map<string, string[]>();
  const teamsByKey = new Map<string, string[]>();
  for (const team of draft.teams) {
    teamRowsById.set(team.id, [...(teamRowsById.get(team.id) ?? []), team.source]);
    const key = normalizePlayerNameKey(team.name);
    const sourceKey = normalizePlayerNameKey(team.sourceName);
    if (!key) {
      issues.push({ code: 'MISSING_TEAM_NAME', message: 'Enter the team name.', path: team.id, blocking: true });
    } else if (
      team.selectionMode === 'EXISTING' &&
      teamOptionsByKey.has(sourceKey) &&
      sourceKey !== key
    ) {
      issues.push({
        code: 'TEAM_CHANGED_TO_DIFFERENT_EXISTING',
        message: `“${team.sourceName}” cannot be changed to the existing team “${team.name}”. Enter a genuinely new name instead.`,
        path: team.id,
        blocking: true
      });
    } else if (team.selectionMode === 'RENAMED') {
      issues.push({
        code: 'NEW_TEAM_NAME',
        message: teamCatalog
          ? `“${team.name}” is not a team name from ${teamCatalog.seasonName}. It will be used for the new season; verify that its spelling is exact.`
          : `“${team.name}” is a new League team name. Verify that its spelling is exact.`,
        path: team.id,
        blocking: false
      });
    }
    teamsByKey.set(key, [...(teamsByKey.get(key) ?? []), team.id]);
  }
  for (const [id, sources] of teamRowsById) {
    if (sources.length > 1) {
      issues.push({ code: 'DUPLICATE_TEAM_ID', message: 'Two team rows have the same internal identifier. Remove one and add it again.', path: id, blocking: true });
    }
  }
  for (const [key, ids] of teamsByKey) {
    if (key && ids.length > 1) {
      issues.push({ code: 'DUPLICATE_TEAM', message: `The team name “${draft.teams.find((team) => team.id === ids[0])?.name}” is duplicated.`, path: ids.join(','), blocking: true });
    }
  }
  if (teamCatalog) {
    const selectedTeamKeys = new Set(draft.teams.map((team) => normalizePlayerNameKey(team.name)));
    const omittedPreviousTeams = teamOptions
      .map((team) => team.name)
      .filter((name) => !selectedTeamKeys.has(normalizePlayerNameKey(name)));
    if (omittedPreviousTeams.length > 0) {
      issues.push({
        code: 'PREVIOUS_TEAMS_NOT_USED',
        message: `${teamCatalog.seasonName} team${omittedPreviousTeams.length === 1 ? '' : 's'} not present under the same name: ${omittedPreviousTeams.join(', ')}. If any were renamed, verify the new name carefully.`,
        path: 'teams',
        blocking: false
      });
    }
  }
  const knownTeamIds = new Set(draft.teams.map((team) => team.id));

  for (const row of draft.players) {
    if (!row.teamId || !knownTeamIds.has(row.teamId)) {
      issues.push({ code: 'UNKNOWN_ROSTER_TEAM', message: `${row.rawName || 'Player'} references the unknown team “${row.teamName || '(blank)'}”.`, path: row.id, blocking: true });
    }
  }

  const duplicateRawRows = new Map<string, string[]>();
  for (const row of draft.players) {
    const key = `${normalizePlayerNameKey(row.rawName)}|${row.teamId}`;
    duplicateRawRows.set(key, [...(duplicateRawRows.get(key) ?? []), row.id]);
  }
  for (const [key, ids] of duplicateRawRows) {
    if (!key.startsWith('|') && ids.length > 1) {
      issues.push({ code: 'DUPLICATE_ROSTER_ROW', message: 'The same player name appears more than once on the same team.', path: ids.join(','), blocking: true });
    }
  }

  const resolutions = draft.players.map((row) => resolvePlayerRow(row, players, issues));
  const resolutionsById = new Map(resolutions.map((resolution) => [resolution.rowId, resolution]));
  draft.players = draft.players.map((row) => ({
    ...row,
    playerId: resolutionsById.get(row.id)?.resolvedPlayerId ?? row.playerId
  }));

  const selectedRows = new Map<string, SeasonImportPlayer[]>();
  for (const row of draft.players) {
    if (!row.playerId) continue;
    selectedRows.set(row.playerId, [...(selectedRows.get(row.playerId) ?? []), row]);
  }
  for (const rows of selectedRows.values()) {
    if (rows.length > 1) {
      const player = players.find((item) => item.id === rows[0].playerId);
      issues.push({ code: 'DUPLICATE_PLAYER', message: `${player?.name ?? 'The selected Player'} is assigned to multiple roster rows.`, path: rows.map((row) => row.id).join(','), blocking: true });
    }
  }

  const scheduleMatchups = new Map<string, string[]>();
  const teamsPerWeek = new Map<string, string[]>();
  for (const row of draft.schedule) {
    if (!Number.isInteger(row.week) || row.week < 1) {
      issues.push({ code: 'INVALID_WEEK', message: 'Schedule week must be a positive whole number.', path: row.id, blocking: true });
    }
    if (!row.homeTeamId || !row.awayTeamId || !knownTeamIds.has(row.homeTeamId) || !knownTeamIds.has(row.awayTeamId)) {
      issues.push({ code: 'UNKNOWN_SCHEDULE_TEAM', message: `Schedule row references an unknown team: ${row.home || '(blank)'} vs ${row.away || '(blank)'}.`, path: row.id, blocking: true });
    }
    if (row.homeTeamId && row.homeTeamId === row.awayTeamId) {
      issues.push({ code: 'SAME_SCHEDULE_TEAM', message: 'A team cannot play itself.', path: row.id, blocking: true });
    }
    const matchupKey = `${row.week}|${[row.homeTeamId, row.awayTeamId].sort().join('|')}`;
    scheduleMatchups.set(matchupKey, [...(scheduleMatchups.get(matchupKey) ?? []), row.id]);
    for (const teamId of [row.homeTeamId, row.awayTeamId].filter(Boolean)) {
      const weekTeamKey = `${row.week}|${teamId}`;
      teamsPerWeek.set(weekTeamKey, [...(teamsPerWeek.get(weekTeamKey) ?? []), row.id]);
    }
  }
  for (const ids of scheduleMatchups.values()) {
    if (ids.length > 1) issues.push({ code: 'DUPLICATE_MATCHUP', message: 'The same matchup appears more than once in a week.', path: ids.join(','), blocking: true });
  }
  for (const ids of teamsPerWeek.values()) {
    if (ids.length > 1) issues.push({ code: 'TEAM_DOUBLE_BOOKED', message: 'A team appears in more than one game in the same week.', path: ids.join(','), blocking: true });
  }

  if (draft.schedule.length === 0) {
    issues.push({ code: 'NO_SCHEDULE', message: 'No schedule is included. The season can still be created.', path: 'schedule', blocking: false });
  }

  const blockingIssues = issues.filter((issue) => issue.blocking).length;
  return {
    draft,
    issues,
    playerRows: resolutions,
    playerOptions: players.map(({ id, name, email }) => ({ id, name, email })).sort((a, b) => a.name.localeCompare(b.name)),
    teamOptions,
    teamSourceSeason: teamCatalog ? { id: teamCatalog.seasonId, name: teamCatalog.seasonName } : null,
    canCommit: blockingIssues === 0,
    counts: { teams: draft.teams.length, players: draft.players.length, schedule: draft.schedule.length, blockingIssues }
  };
}
