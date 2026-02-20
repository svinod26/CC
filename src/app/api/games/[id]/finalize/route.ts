import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { GameStatus } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const game = await prisma.game.findUnique({ where: { id: params.id }, include: { statTaker: true } });
  if (!game) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const isScorer =
    (game.statTakerId && session.user.id === game.statTakerId) ||
    (game.statTaker?.email && session.user.email && game.statTaker.email === session.user.email);
  if (!isScorer) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (game.status === GameStatus.FINAL) {
    return NextResponse.json({ ok: true });
  }
  if (game.status !== GameStatus.IN_PROGRESS) {
    return NextResponse.json({ error: 'Only in-progress games can be finalized' }, { status: 400 });
  }

  await prisma.game.update({
    where: { id: params.id },
    data: {
      status: GameStatus.FINAL,
      endedAt: new Date()
    }
  });

  await prisma.gameState.updateMany({
    where: { gameId: params.id },
    data: { status: GameStatus.FINAL }
  });

  return NextResponse.json({ ok: true });
}
