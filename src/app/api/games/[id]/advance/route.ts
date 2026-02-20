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

  const game = await prisma.game.findUnique({
    where: { id: params.id },
    include: {
      state: true,
      homeTeam: true,
      awayTeam: true,
      turns: { orderBy: { turnIndex: 'desc' }, take: 1 },
      statTaker: true
    }
  });
  if (!game || !game.state || !game.homeTeamId || !game.awayTeamId) {
    return NextResponse.json({ error: 'Game not found' }, { status: 404 });
  }
  const isScorer =
    (game.statTakerId && session.user.id === game.statTakerId) ||
    (game.statTaker?.email && session.user.email && game.statTaker.email === session.user.email);
  if (!isScorer) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (game.status !== GameStatus.IN_PROGRESS) {
    return NextResponse.json({ error: 'Only in-progress games can be advanced' }, { status: 403 });
  }

  const nextOffense = game.state.possessionTeamId === game.homeTeamId ? game.awayTeamId : game.homeTeamId;
  const nextTurnIndex = (game.turns[0]?.turnIndex ?? 1) + 1;

  await prisma.$transaction([
    prisma.turn.create({
      data: {
        gameId: params.id,
        offenseTeamId: nextOffense,
        turnIndex: nextTurnIndex,
        isBonus: false
      }
    }),
    prisma.gameState.update({
      where: { gameId: params.id },
      data: {
        possessionTeamId: nextOffense,
        currentTurnNumber: nextTurnIndex,
        currentShooterIndex: 0
      }
    })
  ]);

  return NextResponse.json({ ok: true });
}
