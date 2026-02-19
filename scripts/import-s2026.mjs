import { PrismaClient, GameStatus, GameType, StatsSource } from '@prisma/client';
import fs from 'fs';
import xlsx from 'xlsx';

const prisma = new PrismaClient();
const XLSX = xlsx?.default ?? xlsx;

const DATA_FILE = 's2026.json';
const NAME_MAPPING_FILE = 'Name_email_mapping.xlsx';

const TEAM_CONFERENCES = {
  C: 'Conference 1',
  E: 'Conference 1',
  F: 'Conference 1',
  Migos: 'Conference 2',
  Gargantuan: 'Conference 2',
  Candice: 'Conference 2'
};

const normalizeName = (value) => {
  if (!value) return '';
  return String(value)
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\?$/, '');
};

const normalizeKey = (value) => normalizeName(value).toLowerCase().replace(/[^a-z0-9]/g, '');

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

const normalizeEmail = (value) => {
  if (!value) return '';
  return String(value).trim().toLowerCase();
};

async function ensureSeason(seasonName, year) {
  const existing = await prisma.season.findFirst({ where: { name: seasonName } });
  if (existing) return existing;
  return prisma.season.create({ data: { name: seasonName, year } });
}

async function clearGamePayload(gameId) {
  await prisma.gameState.deleteMany({ where: { gameId } });
  await prisma.shotEvent.deleteMany({ where: { gameId } });
  await prisma.turn.deleteMany({ where: { gameId } });
  await prisma.gameLineup.deleteMany({ where: { gameId } });
  await prisma.legacyPlayerStat.deleteMany({ where: { gameId } });
  await prisma.legacyTeamStat.deleteMany({ where: { gameId } });
}

async function deleteLegacyGame(gameId) {
  await clearGamePayload(gameId);
  await prisma.game.delete({ where: { id: gameId } });
}

async function buildPlayerResolver() {
  const players = await prisma.player.findMany({ include: { aliases: true } });
  const aliasMap = new Map();

  players.forEach((player) => {
    aliasMap.set(normalizeKey(player.name), player);
    player.aliases.forEach((alias) => {
      aliasMap.set(alias.aliasKey, player);
    });
  });

  const ensureAlias = async (playerId, alias, source) => {
    const key = normalizeKey(alias);
    if (!key) return;
    if (aliasMap.has(key)) return;
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
      if (!(error && error.code === 'P2002')) throw error;
    }
    const player = await prisma.player.findUnique({ where: { id: playerId } });
    if (player) aliasMap.set(key, player);
  };

  const resolvePlayer = async (name, email) => {
    const key = normalizeKey(name);
    if (!key) return null;
    const existing = aliasMap.get(key);
    if (existing) {
      if (email && !existing.email) {
        const updated = await prisma.player.update({ where: { id: existing.id }, data: { email } });
        aliasMap.set(key, updated);
        return updated;
      }
      return existing;
    }
    const player = await prisma.player.create({ data: { name: normalizeName(name), email: email || null } });
    aliasMap.set(key, player);
    await ensureAlias(player.id, player.name, 'canonical');
    return player;
  };

  return { resolvePlayer, ensureAlias };
}

async function importAliasMapping(resolver) {
  if (!fs.existsSync(NAME_MAPPING_FILE)) return;
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
}

async function getOrCreateConference(seasonId, name) {
  const existing = await prisma.conference.findFirst({ where: { seasonId, name } });
  if (existing) return existing;
  return prisma.conference.create({ data: { seasonId, name } });
}

async function getOrCreateTeam(seasonId, teamMap, name) {
  const normalized = normalizeTeamName(name);
  if (!normalized) return null;
  const key = normalized.toLowerCase();
  if (teamMap.has(key)) return teamMap.get(key);
  const confName = TEAM_CONFERENCES[normalized] ?? 'Conference 1';
  const conference = await getOrCreateConference(seasonId, confName);
  let existing = await prisma.team.findFirst({ where: { seasonId, name: normalized } });
  if (!existing) {
    existing = await prisma.team.create({
      data: { seasonId, name: normalized, conferenceId: conference.id }
    });
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

async function createSchedule(seasonId, week, homeTeamId, awayTeamId) {
  const existing = await prisma.schedule.findFirst({ where: { seasonId, week, homeTeamId, awayTeamId } });
  if (existing) return existing;
  return prisma.schedule.create({ data: { seasonId, week, homeTeamId, awayTeamId } });
}

async function importMatchup({ seasonId, week, matchup, teamMap, resolver }) {
  if (!matchup?.team1?.name || !matchup?.team2?.name) {
    console.log(`Skipping malformed matchup in Week ${week}.`);
    return;
  }

  const team1 = await getOrCreateTeam(seasonId, teamMap, matchup.team1.name);
  const team2 = await getOrCreateTeam(seasonId, teamMap, matchup.team2.name);
  if (!team1 || !team2) return;

  const scheduleRow = await createSchedule(seasonId, week, team1.id, team2.id);
  const trackedCandidate = await prisma.game.findFirst({
    where: {
      seasonId,
      statsSource: StatsSource.TRACKED,
      OR: [
        { homeTeamId: team1.id, awayTeamId: team2.id },
        { homeTeamId: team2.id, awayTeamId: team1.id }
      ]
    },
    select: { id: true }
  });

  if (trackedCandidate) {
    const linkedGame = scheduleRow.gameId
      ? await prisma.game.findUnique({
          where: { id: scheduleRow.gameId },
          select: { id: true, statsSource: true }
        })
      : null;

    if (linkedGame && linkedGame.id !== trackedCandidate.id && linkedGame.statsSource === StatsSource.LEGACY) {
      await deleteLegacyGame(linkedGame.id);
    }

    if (scheduleRow.gameId !== trackedCandidate.id) {
      await prisma.schedule.update({ where: { id: scheduleRow.id }, data: { gameId: trackedCandidate.id } });
    }

    console.log(`Using TRACKED game for Week ${week} ${team1.name} vs ${team2.name}; skipping legacy import.`);
    return;
  }

  const linkedGame = scheduleRow.gameId
    ? await prisma.game.findUnique({
        where: { id: scheduleRow.gameId },
        select: { id: true, statsSource: true }
      })
    : null;

  if (linkedGame?.statsSource === StatsSource.TRACKED) {
    console.log(`Skipping Week ${week} ${team1.name} vs ${team2.name}: existing TRACKED game takes precedence.`);
    return;
  }

  const startedAt = new Date();
  let game;
  if (linkedGame?.statsSource === StatsSource.LEGACY) {
    await clearGamePayload(linkedGame.id);
    game = await prisma.game.update({
      where: { id: linkedGame.id },
      data: {
        seasonId,
        type: GameType.LEAGUE,
        status: GameStatus.FINAL,
        homeTeamId: team1.id,
        awayTeamId: team2.id,
        startedAt,
        endedAt: startedAt,
        statsSource: StatsSource.LEGACY
      }
    });
  } else {
    game = await prisma.game.create({
      data: {
        seasonId,
        type: GameType.LEAGUE,
        status: GameStatus.FINAL,
        homeTeamId: team1.id,
        awayTeamId: team2.id,
        startedAt,
        endedAt: startedAt,
        statsSource: StatsSource.LEGACY
      }
    });
  }

  const legacyStats = [];
  const lineupData = [];

  const ingestTeamPlayers = async (team, players) => {
    const safePlayers = Array.isArray(players) ? players : [];
    for (const [idx, player] of safePlayers.entries()) {
      if (!player) continue;
      const name = normalizeName(player.name);
      if (!isValidPlayerName(name)) continue;
      const totals = {
        total: toNumber(player.total_cups),
        tops: toNumber(player.tops),
        topIsos: toNumber(player.top_isos),
        bottoms: toNumber(player.bottoms),
        bottomIsos: toNumber(player.bottom_isos),
        misses: toNumber(player.misses)
      };
      const breakdown = totals.tops + totals.topIsos + totals.bottoms + totals.bottomIsos;
      const makes = totals.total > 0 ? totals.total : breakdown;
      const attempts = makes + totals.misses;
      const hasStats = attempts > 0;

      const dbPlayer = await resolver.resolvePlayer(name);
      if (!dbPlayer) continue;
      await ensureRoster(seasonId, team.id, dbPlayer.id);

      if (hasStats) {
        lineupData.push({
          gameId: game.id,
          teamId: team.id,
          playerId: dbPlayer.id,
          orderIndex: idx
        });
        legacyStats.push({
          gameId: game.id,
          playerId: dbPlayer.id,
          teamId: team.id,
          totalCups: makes,
          topRegular: totals.tops,
          topIso: totals.topIsos,
          bottomRegular: totals.bottoms,
          bottomIso: totals.bottomIsos,
          misses: totals.misses,
          shotOrder: null
        });
      }
    }
  };

  await ingestTeamPlayers(team1, matchup.team1.players);
  await ingestTeamPlayers(team2, matchup.team2.players);

  if (lineupData.length) {
    await prisma.gameLineup.createMany({ data: lineupData, skipDuplicates: true });
  }
  if (legacyStats.length) {
    await prisma.legacyPlayerStat.createMany({ data: legacyStats, skipDuplicates: true });
  }

  const winner =
    String(matchup.team1.result).toLowerCase().startsWith('w') ? 'team1' :
    String(matchup.team2.result).toLowerCase().startsWith('w') ? 'team2' :
    String(matchup.team1.result).toLowerCase().startsWith('l') ? 'team2' :
    String(matchup.team2.result).toLowerCase().startsWith('l') ? 'team1' :
    '';

  const marginValue = Math.abs(toNumber(matchup.team1.margin || matchup.team2.margin));
  let homeRemaining = 0;
  let awayRemaining = 0;
  if (winner === 'team1') {
    homeRemaining = 0;
    awayRemaining = marginValue;
  } else if (winner === 'team2') {
    homeRemaining = marginValue;
    awayRemaining = 0;
  }

  await prisma.gameState.create({
    data: {
      gameId: game.id,
      possessionTeamId: team1.id,
      homeCupsRemaining: homeRemaining,
      awayCupsRemaining: awayRemaining,
      currentTurnNumber: 1,
      currentShooterIndex: 0,
      status: GameStatus.FINAL
    }
  });

  await prisma.schedule.update({ where: { id: scheduleRow.id }, data: { gameId: game.id } });
}

async function main() {
  if (!fs.existsSync(DATA_FILE)) {
    console.log(`Missing ${DATA_FILE}`);
    return;
  }

  const season = await ensureSeason('S2026', 2026);
  const teamMap = new Map();

  const resolver = await buildPlayerResolver();
  await importAliasMapping(resolver);

  const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const weekKeys = Object.keys(raw).sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')));

  for (const weekKey of weekKeys) {
    const week = Number(weekKey.replace(/\D/g, '')) || 0;
    const matchups = raw[weekKey] || [];
    for (const matchup of matchups) {
      await importMatchup({ seasonId: season.id, week, matchup, teamMap, resolver });
    }
  }

  console.log('S2026 JSON import complete.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
