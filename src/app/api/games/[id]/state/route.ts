import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { attachTurnEvents, gameTurnSelect, gameViewSelect } from '@/lib/game-view';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const game = await prisma.game.findUnique({
    where: { id },
    select: {
      ...gameViewSelect,
      turns: {
        orderBy: { turnIndex: 'desc' },
        take: 1,
        select: gameTurnSelect
      }
    }
  });

  if (!game) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ ...game, turns: attachTurnEvents(game.turns, game.events) });
}
