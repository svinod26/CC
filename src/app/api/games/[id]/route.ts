import { authOptions } from '@/lib/auth';
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
    select: { id: true }
  });
  if (!existing) {
    return NextResponse.json({ error: 'Game not found' }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.schedule.updateMany({
      where: { gameId: params.id },
      data: { gameId: null }
    }),
    prisma.game.delete({ where: { id: params.id } })
  ]);

  return NextResponse.json({ ok: true });
}
