import { Prisma } from '@prisma/client';
import { AdminEmailPlanError, planAdminEmailUpdate } from '@/lib/admin-email-plan';
import { canonicalizeEmail, normalizeEmail } from '@/lib/email';
import { prisma } from '@/lib/prisma';

export type AdminEmailTargetType = 'PLAYER' | 'USER';

export type AdminEmailUpdateInput = {
  actorUserId: string;
  targetType: AdminEmailTargetType;
  targetId: string;
  email: string;
  expectedCurrentEmail: string | null;
};

export class AdminEmailIdentityError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'STALE' | 'CONFLICT' | 'AMBIGUOUS',
    message: string,
    readonly status: 404 | 409
  ) {
    super(message);
    this.name = 'AdminEmailIdentityError';
  }
}

const normalizeNullableEmail = (value: string | null) =>
  value === null ? null : normalizeEmail(value);

async function applyAdminEmailUpdate(
  tx: Prisma.TransactionClient,
  input: AdminEmailUpdateInput
) {
  const [players, users] = await Promise.all([
    tx.player.findMany({ select: { id: true, name: true, email: true } }),
    tx.user.findMany({ select: { id: true, name: true, email: true, role: true } })
  ]);

  const newEmail = normalizeEmail(input.email);
  const newCanonicalEmail = canonicalizeEmail(newEmail);
  let plan;
  try {
    plan = planAdminEmailUpdate({
      players: players.map((player) => ({
        id: player.id,
        email: player.email,
        normalizedEmail: normalizeNullableEmail(player.email),
        canonicalEmail: player.email ? canonicalizeEmail(player.email) : null
      })),
      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        normalizedEmail: normalizeEmail(user.email),
        canonicalEmail: canonicalizeEmail(user.email)
      })),
      targetType: input.targetType,
      targetId: input.targetId,
      expectedCurrentEmail: normalizeNullableEmail(input.expectedCurrentEmail),
      newEmail,
      newCanonicalEmail
    });
  } catch (error) {
    if (error instanceof AdminEmailPlanError) {
      throw new AdminEmailIdentityError(
        error.code,
        error.message,
        error.code === 'NOT_FOUND' ? 404 : 409
      );
    }
    throw error;
  }

  const targetPlayer =
    input.targetType === 'PLAYER'
      ? players.find((player) => player.id === input.targetId) ?? null
      : null;
  const targetUser =
    input.targetType === 'USER'
      ? users.find((user) => user.id === input.targetId) ?? null
      : null;
  const linkedPlayer = plan.linkedPlayerId
    ? players.find((player) => player.id === plan.linkedPlayerId) ?? null
    : null;
  const linkedUser = plan.linkedUserId
    ? users.find((user) => user.id === plan.linkedUserId) ?? null
    : null;
  const { playerEmailUpdated, userEmailUpdated } = plan;

  if (!playerEmailUpdated && !userEmailUpdated) {
    return {
      changed: false,
      targetType: input.targetType,
      targetId: input.targetId,
      name: targetPlayer?.name ?? targetUser?.name ?? 'Account',
      email: newEmail,
      playerId: linkedPlayer?.id ?? null,
      userId: linkedUser?.id ?? null,
      userRole: linkedUser?.role ?? null,
      playerEmailUpdated: false,
      userEmailUpdated: false
    };
  }

  if (linkedPlayer) {
    await tx.player.update({ where: { id: linkedPlayer.id }, data: { email: newEmail } });
  }
  if (linkedUser) {
    await tx.user.update({ where: { id: linkedUser.id }, data: { email: newEmail } });
  }

  const targetName = targetPlayer?.name ?? targetUser?.name ?? 'Account';
  await tx.adminAuditLog.create({
    data: {
      actorUserId: input.actorUserId,
      gameId: null,
      action: 'ACCOUNT_EMAIL_UPDATE',
      entityType: input.targetType === 'PLAYER' ? 'Player' : 'User',
      entityId: input.targetId,
      details: {
        targetType: input.targetType,
        targetName,
        oldEmail: plan.targetCurrentEmail,
        oldPlayerEmail: linkedPlayer?.email ?? null,
        oldUserEmail: linkedUser?.email ?? null,
        newEmail,
        playerId: linkedPlayer?.id ?? null,
        userId: linkedUser?.id ?? null,
        userRole: linkedUser?.role ?? null,
        playerEmailUpdated,
        userEmailUpdated
      }
    }
  });

  return {
    changed: true,
    targetType: input.targetType,
    targetId: input.targetId,
    name: targetName,
    email: newEmail,
    playerId: linkedPlayer?.id ?? null,
    userId: linkedUser?.id ?? null,
    userRole: linkedUser?.role ?? null,
    playerEmailUpdated,
    userEmailUpdated
  };
}

const isPrismaCode = (error: unknown, code: string) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;

export async function updateAdminEmailIdentity(input: AdminEmailUpdateInput) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction((tx) => applyAdminEmailUpdate(tx, input), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 10_000
      });
    } catch (error) {
      if (isPrismaCode(error, 'P2034') && attempt < 2) {
        continue;
      }
      if (isPrismaCode(error, 'P2002')) {
        throw new AdminEmailIdentityError(
          'CONFLICT',
          'That email is already assigned to another registered account.',
          409
        );
      }
      if (isPrismaCode(error, 'P2034')) {
        throw new AdminEmailIdentityError(
          'STALE',
          'Another email update completed at the same time. Refresh and try again.',
          409
        );
      }
      throw error;
    }
  }

  throw new AdminEmailIdentityError(
    'STALE',
    'Another email update completed at the same time. Refresh and try again.',
    409
  );
}
