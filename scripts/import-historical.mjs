import { PrismaClient, GameStatus, GameType, StatsSource } from '@prisma/client';
import xlsx from 'xlsx';
import fs from 'fs';
import path from 'path';

export const prisma = new PrismaClient();
const XLSX = xlsx?.default ?? xlsx;

const NAME_MAPPING_FILE = 'Name_email_mapping.xlsx';
const SEASON_FILE_REGEX = /^SOMIL\s+[FS]\d{4}\.xlsx$/i;
const GREEN_HEX = new Set(['93C47D', 'B6D7A8', '00FF00', 'A9D08E']);
const RED_HEX = new Set(['E06666', 'F4CCCC', 'FF0000', 'C0504D']);
const YELLOW_HEX = new Set(['FFFF00', 'FFF2CC', 'FFE599']);

const normalizeName = (value) => {
  if (!value) return '';
  return String(value)
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\?$/, '');
};

const normalizeEmail = (value) => {
  if (!value) return '';
  return String(value).trim().toLowerCase();
};

const normalizeKey = (value) => {
  const cleaned = normalizeName(value).toLowerCase();
  return cleaned.replace(/[^a-z0-9]/g, '');
};

const normalizeTeamName = (value) => {
  let name = normalizeName(value);
  if (!name) return '';
  name = name.replace(/^team\s+/i, '');
  name = name.replace(/\?$/, '');
  if (name.length <= 2) return name.toUpperCase();
  if (name === name.toLowerCase()) {
    return name.replace(/\b\w/g, (char) => char.toUpperCase());
  }
  return name;
};

const toNumber = (value) => {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value).replace(/[^0-9.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return 0;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
};

const isValidPlayerName = (value) => {
  const name = normalizeName(value);
  if (!name) return false;
  if (/^\d+$/.test(name)) return false;
  const lowered = name.toLowerCase();
  if (['total', 'totals', 'pulled cups', 'pulled cup', 'bank'].includes(lowered)) return false;
  if (lowered.startsWith('team ')) return false;
  return true;
};

const isValidTeamName = (value) => {
  const name = normalizeName(value);
  if (!name) return false;
  const lowered = name.toLowerCase();
  if (['result', 'margin', 'vs', 'win', 'loss'].includes(lowered)) return false;
  return true;
};

const getSheetNames = (workbook) => workbook.SheetNames.filter((name) => /^week\s*\d+/i.test(name));

const parseSeasonFromFilename = (file) => {
  const match = file.match(/([FS])(\d{4})/i);
  if (!match) return null;
  const term = match[1].toUpperCase();
  const year = Number(match[2]);
  return {
    name: `${term}${year}`,
    year
  };
};

const getCell = (ws, row, col) => ws[XLSX.utils.encode_cell({ r: row, c: col })];

const getCellColor = (cell) => {
  if (!cell || !cell.s || !cell.s.fgColor) return null;
  const rgb = cell.s.fgColor.rgb;
  if (!rgb) return null;
  return rgb.toUpperCase();
};

const isYellowCell = (cell) => {
  const color = getCellColor(cell);
  return color ? YELLOW_HEX.has(color) : false;
};

const inferResultFromCell = (cell) => {
  if (!cell) return '';
  const text = normalizeName(cell.v).toLowerCase();
  if (text.startsWith('w')) return 'win';
  if (text.startsWith('l')) return 'loss';
  const color = getCellColor(cell);
  if (color && GREEN_HEX.has(color)) return 'win';
  if (color && RED_HEX.has(color)) return 'loss';
  return '';
};

const findHeaderRow = (rows, startRow) => {
  for (let r = startRow; r < Math.min(rows.length, startRow + 4); r += 1) {
    const row = rows[r] ?? [];
    const nameIndices = row
      .map((cell, idx) => (normalizeName(cell).toLowerCase() === 'name' ? idx : -1))
      .filter((idx) => idx >= 0);
    if (nameIndices.length >= 2) {
      return { rowIndex: r, nameIndices };
    }
  }
  return null;
};

const buildColumnMap = (row, startIdx, endIdx) => {
  const map = new Map();
  for (let c = startIdx; c < endIdx; c += 1) {
    const label = normalizeName(row[c]).toLowerCase();
    if (!label) continue;
    map.set(label, c);
  }
  const colFor = (labels, fallback) => {
    for (const label of labels) {
      if (map.has(label)) return map.get(label);
    }
    return fallback;
  };
  return {
    name: colFor(['name'], startIdx),
    shotOrder: colFor(['shot order', 'order'], startIdx + 1),
    totalCups: colFor(['total cups', 'cups', 'total'], startIdx + 2),
    tops: colFor(['tops', 'top'], startIdx + 3),
    topIsos: colFor(['top isos', 'top iso'], startIdx + 4),
    bottoms: colFor(['bottoms', 'bottom'], startIdx + 5),
    bottomIsos: colFor(['bottom isos', 'bottom iso'], startIdx + 6),
    misses: colFor(['misses', 'miss'], startIdx + 7)
  };
};

const parseWeekSheet = (wb, sheetName) => {
  const ws = wb.Sheets[sheetName];
  if (!ws) return { week: 0, matchups: [], issues: [] };
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const week = Number(sheetName.replace(/\D/g, '')) || 0;
  const matchups = [];
  const issues = [];

  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r] ?? [];
    const vsIndex = row.findIndex((cell) => normalizeName(cell).toLowerCase() === 'vs');
    if (vsIndex === -1) continue;

    const leftPrimary = row[0];
    const rightPrimary = row[vsIndex + 1];
    let leftTeam = '';
    let rightTeam = '';

    const leftPrimaryCell = getCell(ws, r, 0);
    const rightPrimaryCell = getCell(ws, r, vsIndex + 1);

    if (isYellowCell(leftPrimaryCell) && isValidTeamName(leftPrimary)) {
      leftTeam = normalizeTeamName(leftPrimary);
    }
    if (isYellowCell(rightPrimaryCell) && isValidTeamName(rightPrimary)) {
      rightTeam = normalizeTeamName(rightPrimary);
    }

    if (!leftTeam) {
      for (let c = 0; c < vsIndex; c += 1) {
        const cellValue = row[c];
        const cell = getCell(ws, r, c);
        if (isYellowCell(cell) && isValidTeamName(cellValue)) {
          leftTeam = normalizeTeamName(cellValue);
          break;
        }
      }
    }
    if (!rightTeam) {
      for (let c = vsIndex + 1; c < row.length; c += 1) {
        const cellValue = row[c];
        const cell = getCell(ws, r, c);
        if (isYellowCell(cell) && isValidTeamName(cellValue)) {
          rightTeam = normalizeTeamName(cellValue);
          break;
        }
      }
    }

    if (!leftTeam) {
      leftTeam = normalizeTeamName(row.slice(0, vsIndex).find((cell) => isValidTeamName(cell)));
    }
    if (!rightTeam) {
      rightTeam = normalizeTeamName(row.slice(vsIndex + 1).find((cell) => isValidTeamName(cell)));
    }
    if (!leftTeam || !rightTeam) continue;

    const leftMeta = { result: '', margin: 0 };
    const rightMeta = { result: '', margin: 0 };

    row.forEach((cell, idx) => {
      const label = normalizeName(cell).toLowerCase();
      if (label === 'result' && idx + 1 < row.length) {
        const resultCell = getCell(ws, r, idx + 1);
        const inferred = inferResultFromCell(resultCell);
        if (idx < vsIndex && inferred) leftMeta.result = inferred;
        if (idx > vsIndex && inferred) rightMeta.result = inferred;
      }
      if (label === 'margin' && idx + 1 < row.length) {
        const raw = toNumber(row[idx + 1]);
        if (idx < vsIndex && raw) leftMeta.margin = Math.abs(raw);
        if (idx > vsIndex && raw) rightMeta.margin = Math.abs(raw);
      }
    });

    if (!leftMeta.result || !rightMeta.result) {
      const leftCell = getCell(ws, r, 0);
      const rightCell = getCell(ws, r, vsIndex + 1);
      const leftColor = inferResultFromCell(leftCell);
      const rightColor = inferResultFromCell(rightCell);
      if (!leftMeta.result && leftColor) leftMeta.result = leftColor;
      if (!rightMeta.result && rightColor) rightMeta.result = rightColor;
    }

    const headerInfo = findHeaderRow(rows, r + 1);
    if (!headerInfo) continue;
    const headerRow = rows[headerInfo.rowIndex];
    const [leftNameIdx, rightNameIdx] = headerInfo.nameIndices;
    const leftCols = buildColumnMap(headerRow, leftNameIdx, rightNameIdx);
    const rightCols = buildColumnMap(headerRow, rightNameIdx, headerRow.length);

    const playersLeft = [];
    const playersRight = [];
    let pulledLeft = 0;
    let pulledRight = 0;

    for (let i = headerInfo.rowIndex + 1; i < rows.length; i += 1) {
      const dataRow = rows[i];
      const markerLeft = normalizeName(dataRow[leftCols.name]).toLowerCase();
      const markerRight = normalizeName(dataRow[rightCols.name]).toLowerCase();

      if (markerLeft === 'pulled cups' || markerRight === 'pulled cups') {
        const leftRaw = toNumber(dataRow[leftCols.totalCups]);
        const rightRaw = toNumber(dataRow[rightCols.totalCups]);
        pulledLeft = leftRaw > 0 ? leftRaw : 0;
        pulledRight = rightRaw > 0 ? rightRaw : 0;
        continue;
      }

      if (markerLeft === 'total' || markerRight === 'total' || markerLeft === 'totals' || markerRight === 'totals') {
        break;
      }

      if (isValidPlayerName(dataRow[leftCols.name])) {
        playersLeft.push({
          name: normalizeName(dataRow[leftCols.name]),
          rowIndex: i,
          shotOrder: toNumber(dataRow[leftCols.shotOrder]),
          totalCups: toNumber(dataRow[leftCols.totalCups]),
          tops: toNumber(dataRow[leftCols.tops]),
          topIsos: toNumber(dataRow[leftCols.topIsos]),
          bottoms: toNumber(dataRow[leftCols.bottoms]),
          bottomIsos: toNumber(dataRow[leftCols.bottomIsos]),
          misses: toNumber(dataRow[leftCols.misses])
        });
      }

      if (isValidPlayerName(dataRow[rightCols.name])) {
        playersRight.push({
          name: normalizeName(dataRow[rightCols.name]),
          rowIndex: i,
          shotOrder: toNumber(dataRow[rightCols.shotOrder]),
          totalCups: toNumber(dataRow[rightCols.totalCups]),
          tops: toNumber(dataRow[rightCols.tops]),
          topIsos: toNumber(dataRow[rightCols.topIsos]),
          bottoms: toNumber(dataRow[rightCols.bottoms]),
          bottomIsos: toNumber(dataRow[rightCols.bottomIsos]),
          misses: toNumber(dataRow[rightCols.misses])
        });
      }
    }

    const hasStats = (players) =>
      players.some((p) => {
        const makes = p.tops + p.topIsos + p.bottoms + p.bottomIsos;
        return p.totalCups + makes + p.misses > 0;
      });

    matchups.push({
      week,
      leftTeam,
      rightTeam,
      leftMeta,
      rightMeta,
      pulled: { left: pulledLeft, right: pulledRight },
      playersLeft,
      playersRight,
      played: hasStats(playersLeft) || hasStats(playersRight) || pulledLeft > 0 || pulledRight > 0
    });
  }

  return { week, matchups, issues };
};

const normalizePlayerStats = (player, context, issues) => {
  const normalizedName = normalizeName(player.name);
  const tops = toNumber(player.tops);
  const topIsos = toNumber(player.topIsos);
  const bottoms = toNumber(player.bottoms);
  const bottomIsos = toNumber(player.bottomIsos);
  const totalCups = toNumber(player.totalCups);
  const misses = toNumber(player.misses);
  const shotOrder = toNumber(player.shotOrder);
  const makes = tops + topIsos + bottoms + bottomIsos;
  const hasStats = totalCups + makes + misses > 0;

  if (totalCups > 0 && makes > 0 && makes !== totalCups) {
    issues.push(`${context} - ${normalizedName}: breakdown ${makes} != total ${totalCups}`);
  }
  if (totalCups > 0 && makes === 0) {
    issues.push(`${context} - ${normalizedName}: total cups without breakdown`);
  }

  let normalizedTotal = totalCups;
  if (totalCups === 0 && makes > 0) normalizedTotal = makes;
  if (totalCups > 0 && makes > 0 && makes !== totalCups) normalizedTotal = makes;

  return {
    ...player,
    name: normalizedName,
    tops,
    topIsos,
    bottoms,
    bottomIsos,
    totalCups: normalizedTotal,
    misses,
    shotOrder,
    hasStats
  };
};

async function buildPlayerResolver() {
  const players = await prisma.player.findMany({ include: { aliases: true } });
  const aliasMap = new Map();
  const playerById = new Map(players.map((player) => [player.id, player]));

  players.forEach((player) => {
    aliasMap.set(normalizeKey(player.name), player);
    player.aliases.forEach((alias) => {
      aliasMap.set(alias.aliasKey, player);
    });
  });

  const ensureAlias = async (playerId, alias, source) => {
    const key = normalizeKey(alias);
    if (!key) return;
    const mapped = aliasMap.get(key);
    if (mapped) return;
    const existing = await prisma.playerAlias.findUnique({ where: { aliasKey: key } });
    if (existing) return;
    try {
      await prisma.playerAlias.create({
        data: {
          alias,
          aliasKey: key,
          playerId,
          source
        }
      });
    } catch (error) {
      if (!(error && error.code === 'P2002')) {
        throw error;
      }
    }
    const player = playerById.get(playerId);
    if (player) {
      aliasMap.set(key, player);
    }
  };

  const resolvePlayer = async (name, email) => {
    const key = normalizeKey(name);
    if (!key) return null;
    const existing = aliasMap.get(key);
    if (existing) {
      if (email && !existing.email) {
        const updated = await prisma.player.update({ where: { id: existing.id }, data: { email } });
        playerById.set(updated.id, updated);
        aliasMap.set(key, updated);
        return updated;
      }
      return existing;
    }
    const player = await prisma.player.create({ data: { name: normalizeName(name), email: email || null } });
    playerById.set(player.id, player);
    aliasMap.set(key, player);
    await ensureAlias(player.id, player.name, 'canonical');
    return player;
  };

  return { resolvePlayer, ensureAlias, aliasMap };
}

async function importAliasMapping(resolver) {
  if (!fs.existsSync(NAME_MAPPING_FILE)) return [];
  const wb = XLSX.readFile(NAME_MAPPING_FILE);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const firstNameCounts = new Map();
  const lastNameCounts = new Map();
  const initialLastCounts = new Map();
  for (let r = 1; r < rows.length; r += 1) {
    const [name] = rows[r];
    const canonical = normalizeName(name);
    if (!canonical) continue;
    const parts = canonical.split(' ');
    const first = parts[0]?.toLowerCase();
    const last = parts.length > 1 ? parts[parts.length - 1]?.toLowerCase() : '';
    if (!first) continue;
    firstNameCounts.set(first, (firstNameCounts.get(first) ?? 0) + 1);
    if (last) {
      lastNameCounts.set(last, (lastNameCounts.get(last) ?? 0) + 1);
      const initialLast = `${first[0] ?? ''}${last}`;
      initialLastCounts.set(initialLast, (initialLastCounts.get(initialLast) ?? 0) + 1);
    }
  }
  const issues = [];
  for (let r = 1; r < rows.length; r += 1) {
    const [name, nickname, email] = rows[r];
    const canonical = normalizeName(name);
    if (!canonical) continue;
    const player = await resolver.resolvePlayer(canonical, normalizeEmail(email));
    if (!player) continue;
    if (nickname) {
      await resolver.ensureAlias(player.id, normalizeName(nickname), 'nickname');
    }
    const parts = canonical.split(' ');
    const first = parts[0]?.toLowerCase();
    const last = parts.length > 1 ? parts[parts.length - 1]?.toLowerCase() : '';
    if (first && firstNameCounts.get(first) === 1) {
      await resolver.ensureAlias(player.id, parts[0], 'first_name');
    }
    if (last && lastNameCounts.get(last) === 1) {
      await resolver.ensureAlias(player.id, parts[parts.length - 1], 'last_name');
    }
    if (first && last) {
      const initialLast = `${first[0] ?? ''}${last}`;
      if (initialLastCounts.get(initialLast) === 1) {
        await resolver.ensureAlias(player.id, initialLast.toUpperCase(), 'initial_last');
      }
    }
  }
  return issues;
}

async function cleanupInvalidPlayers() {
  const players = await prisma.player.findMany();
  const invalid = players.filter((player) => {
    const key = normalizeKey(player.name);
    if (!key) return true;
    if (key === 'bank') return true;
    if (key.startsWith('team')) return true;
    return false;
  });
  if (!invalid.length) return;
  const ids = invalid.map((player) => player.id);
  await prisma.playerAlias.deleteMany({ where: { playerId: { in: ids } } });
  await prisma.legacyPlayerStat.deleteMany({ where: { playerId: { in: ids } } });
  await prisma.shotEvent.deleteMany({ where: { shooterId: { in: ids } } });
  await prisma.gameLineup.deleteMany({ where: { playerId: { in: ids } } });
  await prisma.teamRoster.deleteMany({ where: { playerId: { in: ids } } });
  await prisma.player.deleteMany({ where: { id: { in: ids } } });
}

async function getOrCreateSeason(name, year) {
  const existing = await prisma.season.findFirst({ where: { name } });
  if (existing) return existing;
  return prisma.season.create({ data: { name, year } });
}

async function getOrCreateConference(seasonId, name) {
  const existing = await prisma.conference.findFirst({ where: { seasonId, name } });
  if (existing) return existing;
  return prisma.conference.create({ data: { seasonId, name } });
}

async function getOrCreateTeam(teamMap, seasonId, name, conferenceId) {
  const normalized = normalizeTeamName(name);
  if (!normalized) return null;
  const key = normalized.toLowerCase();
  if (teamMap.has(key)) return teamMap.get(key);
  let existing = await prisma.team.findFirst({ where: { seasonId, name: normalized } });
  if (!existing) {
    existing = await prisma.team.create({
      data: { seasonId, name: normalized, conferenceId: conferenceId ?? null }
    });
  } else if (!existing.conferenceId && conferenceId) {
    existing = await prisma.team.update({ where: { id: existing.id }, data: { conferenceId } });
  }
  teamMap.set(key, existing);
  return existing;
}

async function ensureRoster(seasonId, teamId, playerId) {
  if (!teamId || !playerId) return null;
  const existing = await prisma.teamRoster.findFirst({ where: { seasonId, teamId, playerId } });
  if (existing) return existing;
  return prisma.teamRoster.create({ data: { seasonId, teamId, playerId } });
}

async function importDraft({ wb, seasonId, teamMap, conferenceId, resolver }) {
  const ws = wb.Sheets['Draft'];
  if (!ws) return;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const teamsRowIndex = rows.findIndex((row) => normalizeName(row[0]).toLowerCase() === 'teams');
  if (teamsRowIndex === -1) return;

  let teamHeaderRowIndex = teamsRowIndex + 1;
  for (let i = teamsRowIndex + 1; i < teamsRowIndex + 6; i += 1) {
    const row = rows[i] ?? [];
    const names = row.map((cell) => normalizeTeamName(cell)).filter((cell) => cell);
    if (names.length >= 2) {
      teamHeaderRowIndex = i;
      break;
    }
  }
  const teamRow = rows[teamHeaderRowIndex] ?? [];
  const teamColumns = new Map();
  teamRow.forEach((cell, idx) => {
    const name = normalizeTeamName(cell);
    if (name && !['Bank', 'Current Trades'].includes(name)) {
      teamColumns.set(idx, name);
    }
  });

  for (const name of teamColumns.values()) {
    await getOrCreateTeam(teamMap, seasonId, name, conferenceId);
  }

  for (let r = teamHeaderRowIndex + 1; r < rows.length; r += 1) {
    const row = rows[r];
    for (const [colIndex, teamName] of teamColumns.entries()) {
      const playerName = normalizeName(row[colIndex]);
      if (!isValidPlayerName(playerName)) continue;
      const team = await getOrCreateTeam(teamMap, seasonId, teamName, conferenceId);
      const player = await resolver.resolvePlayer(playerName);
      if (team && player) {
        await ensureRoster(seasonId, team.id, player.id);
      }
    }
  }
}

async function importSchedule({ wb, seasonId, teamMap, conferenceId }) {
  const ws = wb.Sheets['Full Schedule'];
  if (!ws) return;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const weekRow = rows[1];
  if (!weekRow) return;
  const weekColumns = [];
  weekRow.forEach((cell, idx) => {
    const value = normalizeName(cell);
    if (value.toLowerCase().startsWith('week')) {
      const week = Number(value.replace(/week/i, '').trim());
      if (Number.isFinite(week)) {
        weekColumns.push({ week, homeCol: idx, awayCol: idx + 1 });
      }
    }
  });

  for (const { week, homeCol, awayCol } of weekColumns) {
    for (let r = 2; r < rows.length; r += 1) {
      const homeName = normalizeTeamName(rows[r][homeCol]);
      const awayName = normalizeTeamName(rows[r][awayCol]);
      if (!homeName || !awayName) continue;
      const homeTeam = await getOrCreateTeam(teamMap, seasonId, homeName, conferenceId);
      const awayTeam = await getOrCreateTeam(teamMap, seasonId, awayName, conferenceId);
      if (!homeTeam || !awayTeam) continue;
      const existing = await prisma.schedule.findFirst({
        where: { seasonId, week, homeTeamId: homeTeam.id, awayTeamId: awayTeam.id }
      });
      if (existing) continue;
      await prisma.schedule.create({
        data: { seasonId, week, homeTeamId: homeTeam.id, awayTeamId: awayTeam.id }
      });
    }
  }
}

async function createGameFromMatchup({ seasonId, matchup, scheduleRow, teamMap, conferenceId, resolver, issues }) {
  const { leftTeam, rightTeam, playersLeft, playersRight, pulled, week, leftMeta, rightMeta } = matchup;
  const left = await getOrCreateTeam(teamMap, seasonId, leftTeam, conferenceId);
  const right = await getOrCreateTeam(teamMap, seasonId, rightTeam, conferenceId);
  if (!left || !right) return null;

  const contextLeft = `Week ${week} ${leftTeam}`;
  const contextRight = `Week ${week} ${rightTeam}`;

  const normalizedLeft = playersLeft.map((p) => normalizePlayerStats(p, contextLeft, issues));
  const normalizedRight = playersRight.map((p) => normalizePlayerStats(p, contextRight, issues));

  const leftTotal = normalizedLeft.reduce((sum, p) => sum + toNumber(p.totalCups), 0);
  const rightTotal = normalizedRight.reduce((sum, p) => sum + toNumber(p.totalCups), 0);

  if (leftTotal + rightTotal + pulled.left + pulled.right === 0) return null;

  const homeTeamId = scheduleRow?.homeTeamId ?? left.id;
  const awayTeamId = scheduleRow?.awayTeamId ?? right.id;

  const startedAt = new Date();
  const game = await prisma.game.create({
    data: {
      seasonId,
      type: GameType.LEAGUE,
      status: GameStatus.FINAL,
      homeTeamId,
      awayTeamId,
      startedAt,
      endedAt: startedAt,
      statsSource: StatsSource.LEGACY
    }
  });

  const activeLeft = normalizedLeft.filter((p) => p.hasStats);
  const activeRight = normalizedRight.filter((p) => p.hasStats);

  const lineupData = [];
  const leftSorted = activeLeft.sort((a, b) => {
    const orderA = a.shotOrder > 0 ? a.shotOrder : 999;
    const orderB = b.shotOrder > 0 ? b.shotOrder : 999;
    if (orderA !== orderB) return orderA - orderB;
    return a.rowIndex - b.rowIndex;
  });
  const rightSorted = activeRight.sort((a, b) => {
    const orderA = a.shotOrder > 0 ? a.shotOrder : 999;
    const orderB = b.shotOrder > 0 ? b.shotOrder : 999;
    if (orderA !== orderB) return orderA - orderB;
    return a.rowIndex - b.rowIndex;
  });

  for (const [idx, player] of leftSorted.entries()) {
    const dbPlayer = await resolver.resolvePlayer(player.name);
    if (dbPlayer) {
      await ensureRoster(seasonId, left.id, dbPlayer.id);
      lineupData.push({ gameId: game.id, teamId: left.id, playerId: dbPlayer.id, orderIndex: idx });
    }
  }
  for (const [idx, player] of rightSorted.entries()) {
    const dbPlayer = await resolver.resolvePlayer(player.name);
    if (dbPlayer) {
      await ensureRoster(seasonId, right.id, dbPlayer.id);
      lineupData.push({ gameId: game.id, teamId: right.id, playerId: dbPlayer.id, orderIndex: idx });
    }
  }
  if (lineupData.length) {
    await prisma.gameLineup.createMany({ data: lineupData, skipDuplicates: true });
  }

  const legacyStats = [];
  for (const player of leftSorted) {
    if (!player.hasStats) continue;
    const dbPlayer = await resolver.resolvePlayer(player.name);
    if (!dbPlayer) continue;
    legacyStats.push({
      gameId: game.id,
      playerId: dbPlayer.id,
      teamId: left.id,
      totalCups: player.totalCups,
      topRegular: player.tops,
      topIso: player.topIsos,
      bottomRegular: player.bottoms,
      bottomIso: player.bottomIsos,
      misses: player.misses,
      shotOrder: player.shotOrder || null
    });
  }
  for (const player of rightSorted) {
    if (!player.hasStats) continue;
    const dbPlayer = await resolver.resolvePlayer(player.name);
    if (!dbPlayer) continue;
    legacyStats.push({
      gameId: game.id,
      playerId: dbPlayer.id,
      teamId: right.id,
      totalCups: player.totalCups,
      topRegular: player.tops,
      topIso: player.topIsos,
      bottomRegular: player.bottoms,
      bottomIso: player.bottomIsos,
      misses: player.misses,
      shotOrder: player.shotOrder || null
    });
  }

  if (legacyStats.length) {
    await prisma.legacyPlayerStat.createMany({ data: legacyStats, skipDuplicates: true });
  }

  const legacyTeamStats = [];
  if (pulled.left > 0) {
    legacyTeamStats.push({ gameId: game.id, teamId: left.id, pulledCups: pulled.left });
  }
  if (pulled.right > 0) {
    legacyTeamStats.push({ gameId: game.id, teamId: right.id, pulledCups: pulled.right });
  }
  if (legacyTeamStats.length) {
    await prisma.legacyTeamStat.createMany({ data: legacyTeamStats, skipDuplicates: true });
  }

  const leftResult = (leftMeta?.result ?? '').toLowerCase();
  const rightResult = (rightMeta?.result ?? '').toLowerCase();
  let marginValue = leftMeta?.margin || rightMeta?.margin || 0;
  let winner = '';
  if (leftResult === 'win') winner = 'left';
  if (rightResult === 'win') winner = 'right';

  if (!winner && leftResult === 'loss') winner = 'right';
  if (!winner && rightResult === 'loss') winner = 'left';

  if (!marginValue) {
    const derived = Math.abs(leftTotal - rightTotal);
    if (derived > 0) marginValue = derived;
  }

  let remainingLeft = Math.max(100 - (rightTotal + pulled.left), 0);
  let remainingRight = Math.max(100 - (leftTotal + pulled.right), 0);
  if (marginValue > 0 && winner) {
    if (winner === 'left') {
      remainingLeft = 0;
      remainingRight = marginValue;
    } else if (winner === 'right') {
      remainingRight = 0;
      remainingLeft = marginValue;
    }
  }

  const homeRemaining = homeTeamId === left.id ? remainingLeft : remainingRight;
  const awayRemaining = homeTeamId === left.id ? remainingRight : remainingLeft;

  await prisma.gameState.create({
    data: {
      gameId: game.id,
      possessionTeamId: homeTeamId,
      homeCupsRemaining: homeRemaining,
      awayCupsRemaining: awayRemaining,
      currentTurnNumber: 1,
      currentShooterIndex: 0,
      status: GameStatus.FINAL
    }
  });

  if (scheduleRow) {
    await prisma.schedule.update({ where: { id: scheduleRow.id }, data: { gameId: game.id } });
  }

  return game;
}

async function importWeekSheets({ wb, seasonId, teamMap, conferenceId, resolver }) {
  const weekSheets = getSheetNames(wb).sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')));
  const issues = [];

  for (const sheetName of weekSheets) {
    const parsed = parseWeekSheet(wb, sheetName);
    const matchups = parsed.matchups.filter((m) => m.played);
    if (matchups.length === 0) continue;

    const scheduleRows = await prisma.schedule.findMany({
      where: { seasonId, week: parsed.week },
      include: { homeTeam: true, awayTeam: true }
    });
    const scheduleMap = new Map();
    scheduleRows.forEach((row) => {
      if (row.homeTeam && row.awayTeam) {
        const key = [normalizeTeamName(row.homeTeam.name), normalizeTeamName(row.awayTeam.name)].sort().join('|');
        scheduleMap.set(key, row);
      }
    });

    for (const matchup of matchups) {
      const key = [matchup.leftTeam, matchup.rightTeam].sort().join('|');
      const scheduleRow = scheduleMap.get(key);
      if (!scheduleRow) {
        issues.push(`Week ${matchup.week} ${matchup.leftTeam} vs ${matchup.rightTeam}: no schedule match`);
      }
      if (scheduleRow?.gameId) {
        await prisma.schedule.update({ where: { id: scheduleRow.id }, data: { gameId: null } });
      }

      const left = await getOrCreateTeam(teamMap, seasonId, matchup.leftTeam, conferenceId);
      const right = await getOrCreateTeam(teamMap, seasonId, matchup.rightTeam, conferenceId);
      if (left && right) {
        await prisma.game.deleteMany({
          where: {
            seasonId,
            statsSource: StatsSource.LEGACY,
            type: GameType.LEAGUE,
            AND: [
              {
                OR: [
                  { homeTeamId: left.id, awayTeamId: right.id },
                  { homeTeamId: right.id, awayTeamId: left.id }
                ]
              },
              {
                OR: [
                  { scheduleEntry: { week: parsed.week } },
                  { scheduleEntry: null }
                ]
              }
            ]
          }
        });
      }

      await createGameFromMatchup({
        seasonId,
        matchup,
        scheduleRow: scheduleRow ?? null,
        teamMap,
        conferenceId,
        resolver,
        issues
      });
    }
  }

  return issues;
}

async function importSeason(file, resolver) {
  const seasonInfo = parseSeasonFromFilename(file);
  if (!seasonInfo) {
    console.log(`Skipping ${file} (cannot parse season).`);
    return;
  }

  const wb = XLSX.readFile(file, { cellStyles: true });
  const season = await getOrCreateSeason(seasonInfo.name, seasonInfo.year);
  const conference = await getOrCreateConference(season.id, 'League');
  const teamMap = new Map();

  await importDraft({ wb, seasonId: season.id, teamMap, conferenceId: conference.id, resolver });
  await importSchedule({ wb, seasonId: season.id, teamMap, conferenceId: conference.id });
  const issues = await importWeekSheets({ wb, seasonId: season.id, teamMap, conferenceId: conference.id, resolver });

  if (issues.length) {
    console.log(`Issues for ${season.name}:`);
    issues.forEach((issue) => console.log(`- ${issue}`));
  } else {
    console.log(`Week data checks clean for ${season.name}.`);
  }
}

export async function runImport({ files }) {
  if (!files.length) {
    console.log('No season files found.');
    return;
  }

  const resolver = await buildPlayerResolver();
  await importAliasMapping(resolver);
  await cleanupInvalidPlayers();

  const sorted = files.sort((a, b) => {
    const aInfo = parseSeasonFromFilename(a);
    const bInfo = parseSeasonFromFilename(b);
    if (!aInfo || !bInfo) return a.localeCompare(b);
    if (aInfo.year !== bInfo.year) return aInfo.year - bInfo.year;
    return aInfo.name.localeCompare(bInfo.name);
  });

  for (const file of sorted) {
    await importSeason(file, resolver);
  }

  console.log('Import complete.');
}

export async function shutdown() {
  await prisma.$disconnect();
}

async function main() {
  const args = process.argv.slice(2);
  const fileArgIndex = args.indexOf('--file');
  const targetFiles =
    fileArgIndex >= 0 && args[fileArgIndex + 1]
      ? [args[fileArgIndex + 1]]
      : fs.readdirSync(process.cwd()).filter((file) => SEASON_FILE_REGEX.test(file));

  await runImport({ files: targetFiles });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await shutdown();
  });
