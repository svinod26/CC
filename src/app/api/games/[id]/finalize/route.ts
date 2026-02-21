import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { GameStatus } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const finalizeSchema = z
  .object({
    winnerTeamId: z.string().min(1).optional()
  })
  .optional();

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const json = await req.json().catch(() => undefined);
  const parsed = finalizeSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }
  const winnerTeamId = parsed.data?.winnerTeamId;

  const game = await prisma.game.findUnique({
    where: { id: params.id },
    include: { statTaker: true, state: true }
  });
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

  const isOvertimeTied =
    game.state?.phase === 'OVERTIME' &&
    game.state?.homeCupsRemaining === 0 &&
    game.state?.awayCupsRemaining === 0;
  if (isOvertimeTied) {
    if (!winnerTeamId || ![game.homeTeamId, game.awayTeamId].includes(winnerTeamId)) {
      return NextResponse.json({ error: 'Pick an overtime winner before finalizing.' }, { status: 400 });
    }
  }

  await prisma.$transaction([
    prisma.game.update({
      where: { id: params.id },
      data: {
        status: GameStatus.FINAL,
        endedAt: new Date()
      }
    }),
    prisma.gameState.updateMany({
      where: { gameId: params.id },
      data: {
        status: GameStatus.FINAL,
        ...(isOvertimeTied && winnerTeamId ? { possessionTeamId: winnerTeamId } : {})
      }
    })
  ]);

  return NextResponse.json({ ok: true });
}
