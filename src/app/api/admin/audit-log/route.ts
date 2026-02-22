import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';

const toSummary = (entry: {
  action: string;
  details: unknown;
}) => {
  const details = entry.details as Record<string, unknown> | null;
  if (entry.action === 'GAME_SCORE_ADJUST_ADD') {
    const resultType = String(details?.resultType ?? 'shot').replaceAll('_', ' ').toLowerCase();
    return `Added ${resultType}`;
  }
  if (entry.action === 'GAME_SCORE_ADJUST_SUBTRACT') {
    const resultType = String(details?.resultType ?? 'shot').replaceAll('_', ' ').toLowerCase();
    return `Removed ${resultType}`;
  }
  if (entry.action === 'GAME_SIDE_ADJUST_PULL') {
    const count = Number(details?.count ?? 0);
    const side = String(details?.side ?? '').toLowerCase();
    return `Pulled ${count} on ${side} side`;
  }
  if (entry.action === 'GAME_SIDE_ADJUST_ADD') {
    const count = Number(details?.count ?? 0);
    const side = String(details?.side ?? '').toLowerCase();
    return `Added ${count} on ${side} side`;
  }
  return entry.action.replaceAll('_', ' ');
};

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get('limit') ?? 100);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 250)) : 100;

  const logs = await prisma.adminAuditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      actor: { select: { name: true, email: true } },
      game: {
        select: {
          id: true,
          scheduleEntry: { select: { week: true } },
          homeTeam: { select: { name: true } },
          awayTeam: { select: { name: true } }
        }
      }
    }
  });

  return NextResponse.json({
    logs: logs.map((log) => ({
      id: log.id,
      createdAt: log.createdAt.toISOString(),
      action: log.action,
      summary: toSummary(log),
      actorName: log.actor?.name ?? null,
      actorEmail: log.actor?.email ?? null,
      gameId: log.gameId ?? null,
      gameLabel: log.game
        ? `${log.game.homeTeam?.name ?? 'Home'} vs ${log.game.awayTeam?.name ?? 'Away'}${
            log.game.scheduleEntry?.week ? ` · Week ${log.game.scheduleEntry.week}` : ''
          }`
        : null,
      details: log.details ?? null
    }))
  });
}
