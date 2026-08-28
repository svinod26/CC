import type { Prisma, PrismaClient } from '@prisma/client';
import { canonicalizeEmail, normalizeEmail } from '@/lib/email';

type IdentityClient = PrismaClient | Prisma.TransactionClient;

type IdentityPlayer = {
  id: string;
  name: string;
  email: string | null;
};

type IdentityUser = {
  id: string;
  name: string | null;
  email: string;
};

export class AccountIdentityConflictError extends Error {
  constructor() {
    super('Multiple accounts use equivalent email addresses.');
    this.name = 'AccountIdentityConflictError';
  }
}

export async function resolveAccountIdentity(db: IdentityClient, submittedEmail: string) {
  const normalizedInputEmail = normalizeEmail(submittedEmail);
  const canonicalEmail = canonicalizeEmail(normalizedInputEmail);
  const [players, users] = await Promise.all([
    db.player.findMany({
      where: { email: { not: null } },
      select: { id: true, name: true, email: true }
    }),
    db.user.findMany({
      select: { id: true, name: true, email: true }
    })
  ]);

  const matchingPlayers = players.filter(
    (player: IdentityPlayer) => player.email && canonicalizeEmail(player.email) === canonicalEmail
  );
  const matchingUsers = users.filter(
    (user: IdentityUser) => canonicalizeEmail(user.email) === canonicalEmail
  );

  if (matchingPlayers.length > 1 || matchingUsers.length > 1) {
    throw new AccountIdentityConflictError();
  }

  const player = matchingPlayers[0] ?? null;
  const user = matchingUsers[0] ?? null;
  const storedEmail = player?.email ?? user?.email ?? null;

  return {
    normalizedInputEmail,
    canonicalEmail,
    player,
    user,
    accountEmail: storedEmail ? normalizeEmail(storedEmail) : null
  };
}
