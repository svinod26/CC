import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';

type MappingEntry = {
  name: string;
  email: string;
  nickname?: string;
};

const normalize = (value: unknown) =>
  String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .trim();

const normalizeEmail = (value: string) => value.trim().toLowerCase();

let cached: { map: Map<string, MappingEntry>; mtimeMs: number } | null = null;

export function loadEmailMapping(filePath = 'Name_email_mapping.xlsx') {
  const resolved = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    return new Map<string, MappingEntry>();
  }

  const stat = fs.statSync(resolved);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.map;
  }

  const workbook = XLSX.readFile(resolved);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as string[][];
  const map = new Map<string, MappingEntry>();

  for (let i = 1; i < rows.length; i += 1) {
    const [nameRaw, nicknameRaw, emailRaw] = rows[i];
    const name = normalize(nameRaw);
    const email = normalizeEmail(normalize(emailRaw));
    const nickname = normalize(nicknameRaw);
    if (!name || !email) continue;
    if (!map.has(email)) {
      map.set(email, { name, email, nickname: nickname || undefined });
    }
  }

  cached = { map, mtimeMs: stat.mtimeMs };
  return map;
}
