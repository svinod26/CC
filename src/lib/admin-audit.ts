import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

type AdminAuditLogInput = {
  actorUserId: string;
  gameId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: Prisma.JsonObject | null;
};

export async function logAdminAudit({
  actorUserId,
  gameId,
  action,
  entityType,
  entityId,
  details
}: AdminAuditLogInput) {
  try {
    await prisma.adminAuditLog.create({
      data: {
        actorUserId,
        gameId: gameId ?? null,
        action,
        entityType,
        entityId: entityId ?? null,
        ...(details ? { details } : {})
      }
    });
  } catch (error) {
    console.error('Failed to write admin audit log', error);
  }
}
