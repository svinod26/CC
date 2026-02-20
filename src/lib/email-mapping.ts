import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

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
const canonicalizeEmail = (value: string) => {
  const normalized = normalizeEmail(value);
  const atIndex = normalized.indexOf('@');
  if (atIndex < 1) return normalized;
  const local = normalized.slice(0, atIndex);
  const domain = normalized.slice(atIndex + 1);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    const withoutTag = local.split('+')[0] ?? local;
    const withoutDots = withoutTag.replace(/\./g, '');
    return `${withoutDots}@gmail.com`;
  }
  return normalized;
};
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

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
  const header = rows[0]?.map((cell) => normalize(cell).toLowerCase()) ?? [];
  const nameIndex = Math.max(0, header.findIndex((cell) => cell === 'name'));
  const nicknameIndex = header.findIndex((cell) => cell === 'nickname');
  const emailIndex = header.findIndex((cell) => cell === 'email');

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    const nameRaw = row[nameIndex];
    const nicknameRaw = nicknameIndex >= 0 ? row[nicknameIndex] : '';
    const emailRaw = row[emailIndex >= 0 ? emailIndex : 2];
    const name = normalize(nameRaw);
    const email = normalizeEmail(normalize(emailRaw));
    const canonicalEmail = canonicalizeEmail(email);
    const nickname = normalize(nicknameRaw);
    if (!name || !email) continue;
    const entry = { name, email, nickname: nickname || undefined };
    if (!map.has(email)) {
      map.set(email, entry);
    }
    if (!map.has(canonicalEmail)) {
      map.set(canonicalEmail, entry);
    }
  }

  cached = { map, mtimeMs: stat.mtimeMs };
  return map;
}
