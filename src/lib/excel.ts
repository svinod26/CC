import path from 'path';
import * as XLSX from 'xlsx';

type PlayerRow = { name: string; email?: string; team?: string; conference?: string };
type ScheduleRow = { week: number; home?: string; away?: string };

export type ParsedWorkbook = {
  players: PlayerRow[];
  teams: { name: string; conference?: string }[];
  conferences: string[];
  schedule: ScheduleRow[];
};

function normalizeName(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseWorkbook(filePath?: string): ParsedWorkbook {
  const resolved = filePath ? path.resolve(filePath) : path.resolve(process.cwd(), 'S2026 CC Master Sheet.xlsx');
  const workbook = XLSX.readFile(resolved);
  const sheetNames = workbook.SheetNames.map((s) => s.toLowerCase());

  const playersSheetName =
    workbook.SheetNames.find((s) => s.toLowerCase().includes('player')) ?? workbook.SheetNames[0];
  const scheduleSheetName = workbook.SheetNames.find((s) => s.toLowerCase().includes('schedule'));

  const playerRows = XLSX.utils.sheet_to_json(workbook.Sheets[playersSheetName]) as Record<string, any>[];
  const players: PlayerRow[] = playerRows
    .map((row) => ({
      name: normalizeName(row.Name ?? row.Player ?? row.player ?? row['Player Name']),
      email: normalizeName(row.Email ?? row.email ?? ''),
      team: normalizeName(row.Team ?? row.team ?? row.Squad),
      conference: normalizeName(row.Conference ?? row.conference ?? row.Division)
    }))
    .filter((p) => p.name.length > 0);

  const teamsMap = new Map<string, { name: string; conference?: string }>();
  const conferences = new Set<string>();
  players.forEach((p) => {
    if (p.team) teamsMap.set(p.team, { name: p.team, conference: p.conference });
    if (p.conference) conferences.add(p.conference);
  });

  const schedule: ScheduleRow[] = [];
  if (scheduleSheetName) {
    const scheduleRows = XLSX.utils.sheet_to_json(workbook.Sheets[scheduleSheetName]) as Record<string, any>[];
    scheduleRows.forEach((row) => {
      const week = Number(row.Week ?? row.week ?? row['Week #'] ?? 0);
      schedule.push({
        week: isNaN(week) ? 0 : week,
        home: normalizeName(row.Home ?? row.home ?? row['Home Team']),
        away: normalizeName(row.Away ?? row.away ?? row['Away Team'])
      });
    });
  }

  // If workbook has explicit teams sheet, merge
  const teamSheetName = workbook.SheetNames.find((s) => s.toLowerCase().includes('team'));
  if (teamSheetName && !teamSheetName.toLowerCase().includes('roster')) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[teamSheetName]) as Record<string, any>[];
    rows.forEach((row) => {
      const name = normalizeName(row.Team ?? row.Name ?? row.team);
      const conference = normalizeName(row.Conference ?? row.conference);
      if (name) {
        teamsMap.set(name, { name, conference });
        if (conference) conferences.add(conference);
      }
    });
  }

  return {
    players,
    teams: Array.from(teamsMap.values()),
    conferences: Array.from(conferences),
    schedule: schedule.filter((s) => s.home || s.away)
  };
}
