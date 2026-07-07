import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const game = await prisma.game.findUnique({
    where: { id: params.id },
    include: {
      homeTeam: true,
      awayTeam: true,
      state: true,
      lineups: { include: { player: true } },
      scheduleEntry: true,
      events: { orderBy: { timestamp: 'asc' }, include: { shooter: true } },
      legacyStats: { include: { player: true } },
      legacyTeamStats: true,
      turns: {
        orderBy: { turnIndex: 'desc' },
        take: 1,
        include: { events: { orderBy: { timestamp: 'asc' }, include: { shooter: true } } }
      }
    }
  });

  if (!game) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(game);
}
