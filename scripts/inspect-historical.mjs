// Read-only dry-run of scripts/import-historical.mjs parsing logic.
// Reports matchups, win markers, totals, and player-name resolution per season file.
import { PrismaClient } from '@prisma/client';
import xlsx from 'xlsx';
import fs from 'fs';

const prisma = new PrismaClient();
const XLSX = xlsx?.default ?? xlsx;
const NAME_MAPPING_FILE = 'Name_email_mapping.xlsx';
const GREEN_HEX = new Set(['93C47D', 'B6D7A8', '00FF00', 'A9D08E']);
const RED_HEX = new Set(['E06666', 'F4CCCC', 'FF0000', 'C0504D']);
const YELLOW_HEX = new Set(['FFFF00', 'FFF2CC', 'FFE599']);

const normalizeName = (value) => {
  if (!value) return '';
  return String(value).replace(/ /g, ' ').trim().replace(/\s+/g, ' ').replace(/\?$/, '');
};
const normalizeKey = (value) => normalizeName(value).toLowerCase().replace(/[^a-z0-9]/g, '');
const normalizeTeamName = (value) => {
  let name = normalizeName(value);
  if (!name) return '';
  name = name.replace(/^team\s+/i, '');
  name = name.replace(/\?$/, '');
  if (name.length <= 2) return name.toUpperCase();
  if (name === name.toLowerCase()) return name.replace(/\b\w/g, (c) => c.toUpperCase());
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
const getCell = (ws, row, col) => ws[XLSX.utils.encode_cell({ r: row, c: col })];
const getCellColor = (cell) => {
  if (!cell || !cell.s || !cell.s.fgColor) return null;
  const rgb = cell.s.fgColor.rgb;
  return rgb ? rgb.toUpperCase() : null;
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
    if (nameIndices.length >= 2) return { rowIndex: r, nameIndices };
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
    for (const label of labels) if (map.has(label)) return map.get(label);
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
  if (!ws) return { week: 0, matchups: [] };
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const week = Number(sheetName.replace(/\D/g, '')) || 0;
  const matchups = [];

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

    if (isYellowCell(leftPrimaryCell) && isValidTeamName(leftPrimary)) leftTeam = normalizeTeamName(leftPrimary);
    if (isYellowCell(rightPrimaryCell) && isValidTeamName(rightPrimary)) rightTeam = normalizeTeamName(rightPrimary);
    if (!leftTeam) {
      for (let c = 0; c < vsIndex; c += 1) {
        if (isYellowCell(getCell(ws, r, c)) && isValidTeamName(row[c])) { leftTeam = normalizeTeamName(row[c]); break; }
      }
    }
    if (!rightTeam) {
      for (let c = vsIndex + 1; c < row.length; c += 1) {
        if (isYellowCell(getCell(ws, r, c)) && isValidTeamName(row[c])) { rightTeam = normalizeTeamName(row[c]); break; }
      }
    }
    if (!leftTeam) leftTeam = normalizeTeamName(row.slice(0, vsIndex).find((c) => isValidTeamName(c)));
    if (!rightTeam) rightTeam = normalizeTeamName(row.slice(vsIndex + 1).find((c) => isValidTeamName(c)));
    if (!leftTeam || !rightTeam) continue;

    const leftMeta = { result: '', margin: 0 };
    const rightMeta = { result: '', margin: 0 };
    row.forEach((cell, idx) => {
      const label = normalizeName(cell).toLowerCase();
      if (label === 'result' && idx + 1 < row.length) {
        const inferred = inferResultFromCell(getCell(ws, r, idx + 1));
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
      const leftColor = inferResultFromCell(getCell(ws, r, 0));
      const rightColor = inferResultFromCell(getCell(ws, r, vsIndex + 1));
      if (!leftMeta.result && leftColor) leftMeta.result = leftColor;
      if (!rightMeta.result && rightColor) rightMeta.result = rightColor;
    }

    const headerInfo = findHeaderRow(rows, r + 1);
    if (!headerInfo) { matchups.push({ week, leftTeam, rightTeam, noHeader: true }); continue; }
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
      if (['total', 'totals'].includes(markerLeft) || ['total', 'totals'].includes(markerRight)) break;
      const grab = (cols) => ({
        name: normalizeName(dataRow[cols.name]),
        shotOrder: toNumber(dataRow[cols.shotOrder]),
        totalCups: toNumber(dataRow[cols.totalCups]),
        tops: toNumber(dataRow[cols.tops]),
        topIsos: toNumber(dataRow[cols.topIsos]),
        bottoms: toNumber(dataRow[cols.bottoms]),
        bottomIsos: toNumber(dataRow[cols.bottomIsos]),
        misses: toNumber(dataRow[cols.misses])
      });
      if (isValidPlayerName(dataRow[leftCols.name])) playersLeft.push(grab(leftCols));
      if (isValidPlayerName(dataRow[rightCols.name])) playersRight.push(grab(rightCols));
    }

    const hasStats = (players) => players.some((p) => p.totalCups + p.tops + p.topIsos + p.bottoms + p.bottomIsos + p.misses > 0);
    matchups.push({
      week, leftTeam, rightTeam, leftMeta, rightMeta,
      pulled: { left: pulledLeft, right: pulledRight },
      playersLeft, playersRight,
      played: hasStats(playersLeft) || hasStats(playersRight) || pulledLeft > 0 || pulledRight > 0
    });
  }
  return { week, matchups };
};

// --- alias projection: current DB aliases + what importAliasMapping would add
async function buildAliasProjection() {
  const players = await prisma.player.findMany({ include: { aliases: true } });
  const aliasMap = new Map();
  players.forEach((p) => {
    aliasMap.set(normalizeKey(p.name), p.name);
    p.aliases.forEach((a) => aliasMap.set(a.aliasKey, p.name));
  });

  const wb = XLSX.readFile(NAME_MAPPING_FILE);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  const firstCounts = new Map();
  const lastCounts = new Map();
  const initialLastCounts = new Map();
  for (let r = 1; r < rows.length; r += 1) {
    const canonical = normalizeName(rows[r][0]);
    if (!canonical) continue;
    const parts = canonical.split(' ');
    const first = parts[0]?.toLowerCase();
    const last = parts.length > 1 ? parts[parts.length - 1]?.toLowerCase() : '';
    if (!first) continue;
    firstCounts.set(first, (firstCounts.get(first) ?? 0) + 1);
    if (last) {
      lastCounts.set(last, (lastCounts.get(last) ?? 0) + 1);
      const il = `${first[0]}${last}`;
      initialLastCounts.set(il, (initialLastCounts.get(il) ?? 0) + 1);
    }
  }
  for (let r = 1; r < rows.length; r += 1) {
    const [name, nickname] = rows[r];
    const canonical = normalizeName(name);
    if (!canonical) continue;
    const set = (alias) => { const k = normalizeKey(alias); if (k && !aliasMap.has(k)) aliasMap.set(k, canonical); };
    set(canonical);
    if (nickname) set(normalizeName(nickname));
    const parts = canonical.split(' ');
    const first = parts[0]?.toLowerCase();
    const last = parts.length > 1 ? parts[parts.length - 1]?.toLowerCase() : '';
    if (first && firstCounts.get(first) === 1) set(parts[0]);
    if (last && lastCounts.get(last) === 1) set(parts[parts.length - 1]);
    if (first && last && initialLastCounts.get(`${first[0]}${last}`) === 1) set(`${first[0]}${last}`);
  }
  return aliasMap;
}

async function main() {
  const files = process.argv.slice(2);
  const aliasMap = await buildAliasProjection();
  const unresolvedGlobal = new Map(); // name -> seasons

  for (const file of files) {
    const wb = XLSX.readFile(file, { cellStyles: true });
    const season = file.match(/([FS]\d{4})/i)?.[1] ?? file;
    console.log(`\n===== ${season} (${file}) =====`);
    console.log('sheets:', wb.SheetNames.join(' | '));
    const weekSheets = wb.SheetNames.filter((n) => /^week\s*\d+/i.test(n));

    const teamNames = new Set();
    let gamesPlayed = 0, noResult = 0, noHeader = 0;
    for (const sheetName of weekSheets) {
      const { matchups } = parseWeekSheet(wb, sheetName);
      for (const m of matchups) {
        if (m.noHeader) { noHeader += 1; console.log(`  W${m.week} ${m.leftTeam} vs ${m.rightTeam}: NO HEADER ROW`); continue; }
        if (!m.played) continue;
        gamesPlayed += 1;
        teamNames.add(m.leftTeam);
        teamNames.add(m.rightTeam);
        const lTot = m.playersLeft.reduce((s, p) => s + (p.totalCups || (p.tops + p.topIsos + p.bottoms + p.bottomIsos)), 0);
        const rTot = m.playersRight.reduce((s, p) => s + (p.totalCups || (p.tops + p.topIsos + p.bottoms + p.bottomIsos)), 0);
        const res = `${m.leftMeta.result || '?'}/${m.rightMeta.result || '?'}`;
        const marginTxt = m.leftMeta.margin || m.rightMeta.margin || 0;
        if (!m.leftMeta.result && !m.rightMeta.result) noResult += 1;
        console.log(
          `  W${m.week} ${m.leftTeam}(${m.playersLeft.length}p,${lTot}c) vs ${m.rightTeam}(${m.playersRight.length}p,${rTot}c)` +
          ` res=${res} margin=${marginTxt} pulled=${m.pulled.left}/${m.pulled.right}`
        );
        for (const p of [...m.playersLeft, ...m.playersRight]) {
          const key = normalizeKey(p.name);
          if (!aliasMap.has(key)) {
            const entry = unresolvedGlobal.get(p.name) ?? new Set();
            entry.add(season);
            unresolvedGlobal.set(p.name, entry);
          }
          const breakdown = p.tops + p.topIsos + p.bottoms + p.bottomIsos;
          if (p.totalCups > 0 && breakdown > 0 && breakdown !== p.totalCups) {
            console.log(`      ~ ${p.name}: breakdown ${breakdown} != total ${p.totalCups}`);
          }
        }
      }
    }
    console.log(`  teams: ${[...teamNames].join(', ')}`);
    console.log(`  played games: ${gamesPlayed} · matchups missing result markers: ${noResult} · missing header: ${noHeader}`);
    console.log(`  draft sheet: ${wb.SheetNames.includes('Draft')} · full schedule: ${wb.SheetNames.includes('Full Schedule')}`);
  }

  console.log('\n===== UNRESOLVED PLAYER NAMES (would create new Player rows) =====');
  const sorted = [...unresolvedGlobal.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [name, seasons] of sorted) {
    console.log(`  ${name}  [${[...seasons].join(', ')}]`);
  }
  console.log(`  total unresolved: ${sorted.length}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
