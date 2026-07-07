import { authOptions } from '@/lib/auth';
import { logAdminAudit } from '@/lib/admin-audit';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const existing = await prisma.game.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      seasonId: true,
      type: true,
      status: true,
      homeTeamId: true,
      awayTeamId: true
    }
  });
  if (!existing) {
    return NextResponse.json({ error: 'Game not found' }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.schedule.updateMany({
      where: { gameId: params.id },
      data: { gameId: null }
    });
    await tx.game.delete({ where: { id: params.id } });

    // Exhibition games create ad-hoc teams (no season); remove them if this
    // was the only game referencing them so they don't pile up.
    const adhocTeamIds = [existing.homeTeamId, existing.awayTeamId].filter(
      (id): id is string => Boolean(id)
    );
    if (existing.type === 'EXHIBITION' && adhocTeamIds.length > 0) {
      await tx.team.deleteMany({
        where: {
          id: { in: adhocTeamIds },
          seasonId: null,
          rosters: { none: {} },
          homeGames: { none: {} },
          awayGames: { none: {} },
          scheduleHome: { none: {} },
          scheduleAway: { none: {} },
          legacyStats: { none: {} },
          legacyTeamStats: { none: {} }
        }
      });
    }
  });

  await logAdminAudit({
    actorUserId: session.user.id,
    // The game row is gone, so the FK reference must stay null; the id is
    // preserved in entityId/details below.
    gameId: null,
    action: 'GAME_DELETE',
    entityType: 'Game',
    entityId: existing.id,
    details: {
      seasonId: existing.seasonId,
      type: existing.type,
      status: existing.status,
      homeTeamId: existing.homeTeamId,
      awayTeamId: existing.awayTeamId
    }
  });

  return NextResponse.json({ ok: true });
}
