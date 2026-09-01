import * as XLSX from 'xlsx';
import { z } from 'zod';
import { normalizeEmail } from './email.ts';
import { normalizePlayerName, normalizePlayerNameKey } from './player-name.ts';

export type SeasonImportLayout = 'CENTURY_CUP_RAW' | 'NORMALIZED' | 'MANUAL';

export type SeasonImportSourceWarning = {
  code: 'EMPTY_ROSTER_CELL' | 'INCOMPLETE_SCHEDULE_ROW' | 'MIRRORED_SCHEDULE_ROW';
  message: string;
  source: string;
};

export type SeasonImportTeamSelectionMode = 'EXISTING' | 'RENAMED' | null;

export type SeasonImportTeam = {
  id: string;
  sourceName: string;
  name: string;
  selectionMode: SeasonImportTeamSelectionMode;
  source: string;
};

export type SeasonImportPlayer = {
  id: string;
  entryMode: 'WORKBOOK' | 'MANUAL';
  rawName: string;
  email?: string;
  teamId: string;
  teamName: string;
  source: string;
  playerId: string | null;
  rememberAlias: boolean;
};

export type SeasonImportScheduleRow = {
  id: string;
  week: number;
  homeTeamId: string;
  awayTeamId: string;
  home: string;
  away: string;
  source: string;
};

export type SeasonImportDraft = {
  layout: SeasonImportLayout;
  seasonName: string;
  year: number;
  teams: SeasonImportTeam[];
  players: SeasonImportPlayer[];
  schedule: SeasonImportScheduleRow[];
  sourceWarnings: SeasonImportSourceWarning[];
};

const sourceWarningSchema = z.object({
  code: z.enum(['EMPTY_ROSTER_CELL', 'INCOMPLETE_SCHEDULE_ROW', 'MIRRORED_SCHEDULE_ROW']),
  message: z.string().max(300),
  source: z.string().max(150)
}).strict();

export const seasonImportDraftSchema = z.object({
  layout: z.enum(['CENTURY_CUP_RAW', 'NORMALIZED', 'MANUAL']),
  seasonName: z.string().trim().min(1).max(50),
  year: z.coerce.number().int().min(2000).max(2100),
  teams: z.array(z.object({
    id: z.string().min(1).max(150),
    sourceName: z.string().max(100),
    name: z.string().max(100),
    selectionMode: z.enum(['EXISTING', 'RENAMED']).nullable(),
    source: z.string().max(150)
  }).strict()).max(32),
  players: z.array(z.object({
    id: z.string().min(1).max(150),
    entryMode: z.enum(['WORKBOOK', 'MANUAL']),
    rawName: z.string().max(100),
    email: z.string().max(254).optional(),
    teamId: z.string().max(150),
    teamName: z.string().max(100),
    source: z.string().max(150),
    playerId: z.string().max(100).nullable(),
    rememberAlias: z.boolean()
  }).strict()).max(500),
  schedule: z.array(z.object({
    id: z.string().min(1).max(150),
    week: z.coerce.number().int().min(0).max(100),
    homeTeamId: z.string().max(150),
    awayTeamId: z.string().max(150),
    home: z.string().max(100),
    away: z.string().max(100),
    source: z.string().max(150)
  }).strict()).max(500),
  sourceWarnings: z.array(sourceWarningSchema).max(500)
}).strict();

type ParsedWorkbookData = Omit<SeasonImportDraft, 'seasonName' | 'year'>;

const cleanCell = (value: unknown) =>
  value === null || value === undefined ? '' : normalizePlayerName(String(value));

const cellSource = (sheet: string, row: number, column: number) =>
  `${sheet}!${XLSX.utils.encode_cell({ r: row, c: column })}`;

const rowsForSheet = (sheet: XLSX.WorkSheet) =>
  XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    raw: false,
    blankrows: true
  });

const findSheetName = (workbook: XLSX.WorkBook, name: string) =>
  workbook.SheetNames.find((sheetName) => sheetName.trim().toLocaleLowerCase() === name.toLocaleLowerCase());

function parseNormalizedWorkbook(workbook: XLSX.WorkBook): ParsedWorkbookData | null {
  const playersSheetName = findSheetName(workbook, 'Players');
  const teamsSheetName = findSheetName(workbook, 'Teams');
  if (!playersSheetName || !teamsSheetName) return null;

  const playersSheet = workbook.Sheets[playersSheetName];
  const teamsSheet = workbook.Sheets[teamsSheetName];
  if (!playersSheet || !teamsSheet) return null;

  const teamRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(teamsSheet, { defval: '' });
  const teams = teamRows.map((row, index) => ({
    id: `normalized-team-${index + 1}`,
    sourceName: cleanCell(row.Team ?? row.Name ?? row.team),
    name: cleanCell(row.Team ?? row.Name ?? row.team),
    selectionMode: null,
    source: `${teamsSheetName}!A${index + 2}`
  }));

  const playerRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(playersSheet, { defval: '' });
  const teamByName = new Map(teams.map((team) => [normalizePlayerNameKey(team.name), team]));
  const players = playerRows.map((row, index) => {
    const teamName = cleanCell(row.Team ?? row.team ?? row.Squad);
    return {
      id: `normalized-player-${index + 1}`,
      entryMode: 'WORKBOOK' as const,
      rawName: cleanCell(row.Name ?? row.Player ?? row.player ?? row['Player Name']),
      email: cleanCell(row.Email ?? row.email) ? normalizeEmail(cleanCell(row.Email ?? row.email)) : undefined,
      teamId: teamByName.get(normalizePlayerNameKey(teamName))?.id ?? '',
      teamName,
      source: `${playersSheetName}!A${index + 2}`,
      playerId: null,
      rememberAlias: false
    };
  });

  const scheduleSheetName = findSheetName(workbook, 'Schedule');
  const scheduleSheet = scheduleSheetName ? workbook.Sheets[scheduleSheetName] : undefined;
  const scheduleRows = scheduleSheet
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(scheduleSheet, { defval: '' })
    : [];
  const schedule = scheduleRows.map((row, index) => {
    const home = cleanCell(row.Home ?? row.home ?? row['Home Team']);
    const away = cleanCell(row.Away ?? row.away ?? row['Away Team']);
    return {
      id: `normalized-schedule-${index + 1}`,
      week: Number(row.Week ?? row.week ?? row['Week #'] ?? 0),
      homeTeamId: teamByName.get(normalizePlayerNameKey(home))?.id ?? '',
      awayTeamId: teamByName.get(normalizePlayerNameKey(away))?.id ?? '',
      home,
      away,
      source: `${scheduleSheetName ?? 'Schedule'}!A${index + 2}`
    };
  });

  return { layout: 'NORMALIZED', teams, players, schedule, sourceWarnings: [] };
}

type RawRosterCandidate = {
  teams: SeasonImportTeam[];
  players: SeasonImportPlayer[];
  warnings: SeasonImportSourceWarning[];
};

function findRawRoster(sheetName: string, rows: unknown[][]): RawRosterCandidate | null {
  const candidates: RawRosterCandidate[] = [];

  for (let rowIndex = 0; rowIndex < rows.length - 2; rowIndex += 1) {
    if (cleanCell(rows[rowIndex]?.[0]).toLocaleLowerCase() !== 'teams') continue;

    const headerRow = rows[rowIndex + 1] ?? [];
    if (cleanCell(headerRow[0])) continue;
    const teamColumns: Array<{ column: number; name: string }> = [];
    let started = false;
    for (let column = 1; column < Math.min(headerRow.length, 32); column += 1) {
      const name = cleanCell(headerRow[column]);
      if (name) {
        started = true;
        teamColumns.push({ column, name });
      } else if (started) {
        break;
      }
    }
    if (teamColumns.length < 2) continue;

    const teams = teamColumns.map(({ column, name }, index) => ({
      id: `raw-team-${index + 1}`,
      sourceName: name,
      name,
      selectionMode: null,
      source: cellSource(sheetName, rowIndex + 1, column)
    }));
    const players: SeasonImportPlayer[] = [];
    const warnings: SeasonImportSourceWarning[] = [];

    for (let playerRowIndex = rowIndex + 2; playerRowIndex < rows.length; playerRowIndex += 1) {
      const label = cleanCell(rows[playerRowIndex]?.[0]);
      const names = teamColumns.map(({ column }) => cleanCell(rows[playerRowIndex]?.[column]));
      if (!names.some(Boolean)) break;

      for (let teamIndex = 0; teamIndex < teamColumns.length; teamIndex += 1) {
        const { column } = teamColumns[teamIndex];
        const rawName = names[teamIndex];
        const source = cellSource(sheetName, playerRowIndex, column);
        if (!rawName) {
          warnings.push({
            code: 'EMPTY_ROSTER_CELL',
            source,
            message: `${label || 'Roster row'} has a blank player cell for ${teams[teamIndex].name}.`
          });
          continue;
        }
        players.push({
          id: source,
          entryMode: 'WORKBOOK',
          rawName,
          teamId: teams[teamIndex].id,
          teamName: teams[teamIndex].name,
          source,
          playerId: null,
          rememberAlias: false
        });
      }
    }

    if (players.length > 0) candidates.push({ teams, players, warnings });
  }

  return candidates.sort((a, b) => b.players.length - a.players.length)[0] ?? null;
}

function parseRawSchedule(
  workbook: XLSX.WorkBook,
  teams: SeasonImportTeam[]
): { schedule: SeasonImportScheduleRow[]; warnings: SeasonImportSourceWarning[] } {
  const sheetName = findSheetName(workbook, 'Full Schedule');
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheetName || !sheet) return { schedule: [], warnings: [] };

  const rows = rowsForSheet(sheet);
  const headers = rows[0] ?? [];
  const weekRow = rows[1] ?? [];
  const schedule: SeasonImportScheduleRow[] = [];
  const warnings: SeasonImportSourceWarning[] = [];
  const knownTeams = new Map(teams.map((team) => [normalizePlayerNameKey(team.name), team]));
  const firstMatchupRowIndex = 2;
  const matchupRowsPerWeek = Math.floor(teams.length / 2);

  for (let column = 0; column + 1 < headers.length; column += 2) {
    if (
      cleanCell(headers[column]).toLocaleLowerCase() !== 'home' ||
      cleanCell(headers[column + 1]).toLocaleLowerCase() !== 'away'
    ) continue;

    const weekMatch = cleanCell(weekRow[column]).match(/\d+/);
    const week = weekMatch ? Number(weekMatch[0]) : 0;
    const seenMatchups = new Set<string>();

    const matchupRowLimit = Math.min(rows.length, firstMatchupRowIndex + matchupRowsPerWeek);
    for (let rowIndex = firstMatchupRowIndex; rowIndex < matchupRowLimit; rowIndex += 1) {
      const rawHome = cleanCell(rows[rowIndex]?.[column]);
      const rawAway = cleanCell(rows[rowIndex]?.[column + 1]);
      if (!rawHome && !rawAway) continue;
      const source = `${cellSource(sheetName, rowIndex, column)}:${XLSX.utils.encode_cell({ r: rowIndex, c: column + 1 })}`;
      if (!rawHome || !rawAway) {
        warnings.push({
          code: 'INCOMPLETE_SCHEDULE_ROW',
          source,
          message: `Week ${week || '?'} contains a schedule row with only one team.`
        });
        continue;
      }

      const homeTeam = knownTeams.get(normalizePlayerNameKey(rawHome));
      const awayTeam = knownTeams.get(normalizePlayerNameKey(rawAway));
      const home = homeTeam?.name ?? rawHome;
      const away = awayTeam?.name ?? rawAway;
      const matchupKey = [normalizePlayerNameKey(home), normalizePlayerNameKey(away)].sort().join('|');
      if (seenMatchups.has(matchupKey)) {
        continue;
      }
      seenMatchups.add(matchupKey);
      schedule.push({
        id: `raw-schedule-${week}-${column}-${rowIndex}`,
        week,
        homeTeamId: homeTeam?.id ?? '',
        awayTeamId: awayTeam?.id ?? '',
        home,
        away,
        source
      });
    }
  }

  return { schedule, warnings };
}

function parseRawWorkbook(workbook: XLSX.WorkBook): ParsedWorkbookData {
  const draftSheetName = findSheetName(workbook, 'Draft');
  const draftSheet = draftSheetName ? workbook.Sheets[draftSheetName] : undefined;
  if (!draftSheetName || !draftSheet) {
    throw new Error('The Century Cup workbook must contain a Draft sheet.');
  }

  const roster = findRawRoster(draftSheetName, rowsForSheet(draftSheet));
  if (!roster) throw new Error('Could not find the Teams roster grid on the Draft sheet.');
  const parsedSchedule = parseRawSchedule(workbook, roster.teams);
  return {
    layout: 'CENTURY_CUP_RAW',
    teams: roster.teams,
    players: roster.players,
    schedule: parsedSchedule.schedule,
    sourceWarnings: [...roster.warnings, ...parsedSchedule.warnings]
  };
}

export function parseSeasonWorkbook(data: ArrayBuffer, seasonName: string, year: number): SeasonImportDraft {
  const workbook = XLSX.read(data, { type: 'array', cellFormula: false, cellHTML: false });
  if (workbook.SheetNames.length === 0) throw new Error('Workbook has no sheets.');
  if (workbook.SheetNames.length > 50) throw new Error('Workbook has too many sheets.');
  const totalCells = workbook.SheetNames.reduce((count, sheetName) => {
    const reference = workbook.Sheets[sheetName]?.['!ref'];
    if (!reference) return count;
    const range = XLSX.utils.decode_range(reference);
    return count + (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1);
  }, 0);
  if (totalCells > 250_000) throw new Error('Workbook contains too many cells.');

  const parsed = parseNormalizedWorkbook(workbook) ?? parseRawWorkbook(workbook);
  return seasonImportDraftSchema.parse({ ...parsed, seasonName, year });
}

export function createManualSeasonImportDraft(seasonName: string, year: number): SeasonImportDraft {
  return {
    layout: 'MANUAL',
    seasonName: seasonName.trim(),
    year,
    teams: [],
    players: [],
    schedule: [],
    sourceWarnings: []
  };
}
