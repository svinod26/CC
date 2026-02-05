import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
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
