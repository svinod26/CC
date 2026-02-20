import { authOptions } from '@/lib/auth';
import { recomputeGameState } from '@/lib/game-state';
import { prisma } from '@/lib/prisma';
import { GameStatus } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const game = await prisma.game.findUnique({
    where: { id: params.id },
    include: { statTaker: true }
  });
  if (!game) {
    return NextResponse.json({ error: 'Game not found' }, { status: 404 });
  }
  const isScorer =
    (game.statTakerId && session.user.id === game.statTakerId) ||
    (game.statTaker?.email && session.user.email && game.statTaker.email === session.user.email);
  if (!isScorer) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (game.status !== GameStatus.IN_PROGRESS) {
    return NextResponse.json({ error: 'Only in-progress games can be edited' }, { status: 403 });
  }

  const lastEvent = await prisma.shotEvent.findFirst({
    where: { gameId: params.id },
    orderBy: { timestamp: 'desc' }
  });

  if (!lastEvent) {
    return NextResponse.json({ error: 'No events to undo' }, { status: 400 });
  }

  await prisma.shotEvent.delete({ where: { id: lastEvent.id } });

  await recomputeGameState(params.id);

  return NextResponse.json({ ok: true });
}
