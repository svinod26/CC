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
