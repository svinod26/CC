import { canonicalizeEmail } from '@/lib/email';
import { prisma } from '@/lib/prisma';

export async function getCurrentPlayerForUserId(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true }
  });
  if (!user) return null;

  const canonicalUserEmail = canonicalizeEmail(user.email);
  const players = await prisma.player.findMany({
    where: { email: { not: null } }
  });
  const matches = players.filter(
    (player) => player.email && canonicalizeEmail(player.email) === canonicalUserEmail
  );

  return matches.length === 1 ? matches[0] : null;
}
